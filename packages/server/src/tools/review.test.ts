import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerReview } from "./review.js";
import type { InFlightTracker } from "../services/in-flight-tracker.js";
import {
  FabReviewInputSchema,
  FabReviewInputShape,
  FabReviewOutputSchema,
  FabReviewOutputShape,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

// v2.2 全砍 Stage 2/3 (B2 cutover): review reads/writes through the store.
const TEST_TEAM_UUID = "22222222-2222-4222-8222-222222222222";
const TEST_PERSONAL_UUID = "11111111-1111-4111-8111-111111111111";

type RegisteredTool = {
  name: string;
  definition: { inputSchema: unknown; outputSchema: unknown; annotations: unknown };
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent: unknown;
  }>;
};

const tempDirs: string[] = [];
let originalProjectRoot: string | undefined;
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalProjectRoot = process.env.FABRIC_PROJECT_ROOT;
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-tools-review-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalProjectRoot === undefined) {
    delete process.env.FABRIC_PROJECT_ROOT;
  } else {
    process.env.FABRIC_PROJECT_ROOT = originalProjectRoot;
  }
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

function captureRegistration(): { tool: () => RegisteredTool; server: McpServer } {
  let captured: RegisteredTool | undefined;
  const registerTool = vi.fn(
    (name: string, definition: RegisteredTool["definition"], handler: RegisteredTool["handler"]) => {
      captured = { name, definition, handler };
    },
  );
  const server = { registerTool } as unknown as McpServer;
  return {
    server,
    tool: () => {
      if (captured === undefined) {
        throw new Error("tool not registered");
      }
      return captured;
    },
  };
}

async function seedPendingFile(
  projectRoot: string,
  type: "decisions" | "guidelines" | "pitfalls",
  slug: string,
): Promise<string> {
  // v2.2 全砍: seed into the team store's pending dir; review reports + accepts
  // the absolute store path.
  const dir = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: TEST_TEAM_UUID }), STORE_LAYOUT.knowledgeDir, "pending", type);
  await mkdir(dir, { recursive: true });
  const frontmatter = [
    "---",
    `type: ${type}`,
    "maturity: draft",
    "layer: team",
    `created_at: ${new Date().toISOString()}`,
    "source_session: sess-tool-review",
    "tags: []",
    "x-fabric-idempotency-key: sha256:0000000000000000000000000000000000000000000000000000000000000000",
    "---",
    "",
    "## Summary",
    "",
    "Body text.",
    "",
  ].join("\n");
  const absPath = join(dir, `${slug}.md`);
  await writeFile(absPath, frontmatter, "utf8");
  return absPath;
}

async function makeProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-tools-review-"));
  tempDirs.push(projectRoot);
  execFileSync("git", ["init", "--quiet"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tests@example.com"], { cwd: projectRoot, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Fabric Tests"], { cwd: projectRoot, stdio: "pipe" });
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: TEST_PERSONAL_UUID, alias: "personal", personal: true, writable: true },
      { store_uuid: TEST_TEAM_UUID, alias: "team", remote: "git@e:t.git", writable: true },
    ],
  });
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team" }, null, 2)}\n`,
  );
  return projectRoot;
}

describe("registerReview", () => {
  it("registers fab_review with correct name and schemas", () => {
    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();
    expect(t.name).toBe("fab_review");
    expect(t.definition.inputSchema).toBeDefined();
    expect(t.definition.outputSchema).toBeDefined();
    expect(t.definition.annotations).toBeDefined();
  });

  it("invokes reviewKnowledge end-to-end (defer action) and returns structured content", async () => {
    // W3-K K2: list/search relocated to pending.test.ts. This exercises the
    // write-side envelope (single-line content + structuredContent) via a
    // benign defer against a seeded pending entry.
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    const seeded = await seedPendingFile(projectRoot, "decisions", "tool-defer-target");

    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();

    const result = await t.handler({ action: "defer", pending_paths: [seeded], reason: "later" });
    expect(result.structuredContent).toMatchObject({ action: "defer" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    // W3-K K4: content[].text is a single-line summary, not a JSON mirror.
    expect(result.content[0]!.text).toContain("Fabric review: defer");
    expect(result.content[0]!.text).toContain("see structuredContent");
    expect(result.content[0]!.text).not.toBe(JSON.stringify(result.structuredContent));
  });

  it("invokes modify-content-batch end-to-end and returns modified[] structured content", async () => {
    // v2.3: exercises the full MCP round-trip for the batch path — the ONLY
    // place FabReviewOutputShape.modified is runtime-validated by the SDK
    // (there is no output-shape drift test, unlike the input side).
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    const p1 = await seedPendingFile(projectRoot, "decisions", "tool-batch-a");
    const p2 = await seedPendingFile(projectRoot, "pitfalls", "tool-batch-b");

    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();

    const result = await t.handler({
      action: "modify-content-batch",
      items: [
        { pending_path: p1, changes: { tags: ["x"] } },
        { pending_path: p2, changes: { summary: "batched" } },
      ],
    });
    const sc = result.structuredContent as {
      action: string;
      modified: Array<{ pending_path: string; ok: boolean }>;
    };
    expect(sc.action).toBe("modify-content-batch");
    expect(sc.modified).toHaveLength(2);
    expect(sc.modified.every((m) => m.ok)).toBe(true);
    expect(result.content[0]!.text).toContain("Fabric review: modify-content-batch");
  });

  it("calls tracker.enter and tracker.exit around the handler invocation", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    const seeded = await seedPendingFile(projectRoot, "decisions", "tracker-target");

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerReview(server, tracker);
    const t = tool();

    await t.handler({ action: "defer", pending_paths: [seeded], reason: "later" });

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    const enterId = enter.mock.calls[0]?.[0];
    const exitId = exit.mock.calls[0]?.[0];
    expect(typeof enterId).toBe("string");
    expect(enterId).toBe(exitId);
  });

  it("calls tracker.exit even if the underlying service throws", async () => {
    // Use a modify action against a missing path — service throws.
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerReview(server, tracker);
    const t = tool();

    await expect(
      t.handler({
        action: "modify",
        pending_path: ".fabric/knowledge/pending/decisions/no-such-file.md",
        changes: { maturity: "verified" },
      }),
    ).rejects.toBeDefined();

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("works without a tracker (optional argument)", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    const seeded = await seedPendingFile(projectRoot, "decisions", "no-tracker-target");

    const { server, tool } = captureRegistration();
    registerReview(server); // no tracker
    const t = tool();

    const result = await t.handler({ action: "defer", pending_paths: [seeded], reason: "later" });
    expect((result.structuredContent as { action: string }).action).toBe("defer");
  });

  // -------------------------------------------------------------------------
  // TASK-001: SDK-shape split — flat ZodRawShape for registration, internal
  // discriminatedUnion for runtime narrowing. The five tests below match
  // tests.unit[] in the task spec.
  // -------------------------------------------------------------------------

  it("test_fab_review_input_shape_exposes_action_enum_and_optional_fields", () => {
    // (a) action is a required ZodEnum exposing exactly the 8 WRITE literals
    // (W3-C added `retire`; v2.3 added `modify-content-batch`). W3-K K2: the two
    // READ actions (list / search) moved to the read-only fab_pending tool, so
    // fab_review is now write-only.
    const actionSchema = FabReviewInputShape.action;
    expect(actionSchema).toBeInstanceOf(z.ZodEnum);
    expect(actionSchema.options.sort()).toEqual(
      [
        "approve",
        "defer",
        "modify",
        "modify-content",
        "modify-content-batch",
        "modify-layer",
        "reject",
        "retire",
      ],
    );

    // (b) Every other declared field is optional (so the SDK-flattened shape
    // never rejects valid per-action inputs at the top level). W3-K K2: the
    // read-only `filters` / `query` fields left with list/search.
    const optionalFields = ["pending_paths", "pending_path", "reason", "changes", "items", "until", "superseded_by"];
    for (const field of optionalFields) {
      const sub = (FabReviewInputShape as Record<string, z.ZodTypeAny>)[field];
      expect(sub, `field=${field}`).toBeDefined();
      expect(sub.isOptional(), `field=${field} should be .optional()`).toBe(true);
    }

    // (c) Drift-guard: keys of FabReviewInputShape MUST be a superset of every
    // branch field in FabReviewInputSchema (the discriminatedUnion). Adding a
    // new action without updating the flat shape fails this assertion loudly.
    const branchKeys = new Set<string>();
    for (const opt of FabReviewInputSchema.options) {
      for (const k of Object.keys((opt as z.AnyZodObject).shape)) branchKeys.add(k);
    }
    const shapeKeys = new Set(Object.keys(FabReviewInputShape));
    for (const k of branchKeys) {
      expect(shapeKeys.has(k), `FabReviewInputShape missing branch field '${k}'`).toBe(true);
    }
  });

  it("test_fab_review_register_tool_publishes_non_empty_properties", () => {
    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();

    // The MCP SDK derives JSON Schema from the ZodRawShape via its internal
    // converter; the public assertion we care about is that the inputSchema
    // we passed is a flat object whose keys map to the union of all branch
    // fields (≥ 1 field beyond `action`). Empty {} would reproduce the original
    // bug where ToolSearch sees `properties: {}`.
    const inputSchema = t.definition.inputSchema as Record<string, unknown>;
    expect(typeof inputSchema).toBe("object");
    expect(inputSchema).not.toBeNull();
    const keys = Object.keys(inputSchema);
    expect(keys).toContain("action");
    expect(keys.length).toBeGreaterThanOrEqual(2);
    // Sanity: a representative subset of WRITE branch fields is published.
    for (const k of ["pending_paths", "pending_path", "changes", "reason"]) {
      expect(keys, `inputSchema must publish '${k}'`).toContain(k);
    }

    const outputSchema = t.definition.outputSchema as Record<string, unknown>;
    expect(typeof outputSchema).toBe("object");
    expect(Object.keys(outputSchema)).toContain("action");
  });

  it("test_fab_review_handler_narrows_via_discriminated_union", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();

    // Pass an input that the FLAT shape would accept (every per-action field
    // is optional there) but the discriminated union must REJECT
    // (action=approve with no pending_paths). The handler's
    // FabReviewInputSchema.parse must throw.
    await expect(t.handler({ action: "approve" })).rejects.toBeInstanceOf(z.ZodError);
  });

  it("test_fab_review_approve_missing_id_throws_zod_error_naming_id", async () => {
    // NOTE: The actual schema field is `pending_paths` (plural array), not
    // `id` — the task spec's "naming id" wording was a placeholder. We assert
    // the same semantic intent: the error path identifies the missing required
    // field for action=approve.
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();

    let caught: unknown;
    try {
      await t.handler({ action: "approve" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(z.ZodError);
    const zerr = caught as z.ZodError;
    const hasPendingPathsIssue = zerr.issues.some((i) => i.path.includes("pending_paths"));
    expect(hasPendingPathsIssue, JSON.stringify(zerr.issues)).toBe(true);
    // Error type is the canonical `invalid_type` (or required) discriminator
    // missing — both indicate the union failed to select a branch.
    const codes = new Set(zerr.issues.map((i) => i.code));
    expect(
      codes.has("invalid_type") || codes.has("invalid_union") || codes.has("invalid_literal"),
    ).toBe(true);
  });

  it("test_fab_review_each_action_happy_path_validates_output_shape", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    // Seed two pending entries we can exercise approve/reject/modify/defer/search against.
    const a = await seedPendingFile(projectRoot, "decisions", "happy-a");
    const b = await seedPendingFile(projectRoot, "decisions", "happy-b");

    const { server, tool } = captureRegistration();
    registerReview(server);
    const t = tool();

    // Output validator built from the flat shape (mirrors what the SDK would
    // run). We additionally re-validate against the strict union for
    // belt-and-braces. W3-K K2: list/search moved to fab_pending (covered in
    // pending.test.ts) — this exercises only the 6 WRITE actions.
    const FlatOutput = z.object(FabReviewOutputShape);

    // Extract structured warning codes from a handler result.
    const warnCodes = (out: { structuredContent: unknown }): string[] =>
      ((out.structuredContent as { warnings?: Array<{ code?: string }> }).warnings ?? [])
        .map((w) => w.code)
        .filter((c): c is string => typeof c === "string");

    // 1. defer
    const deferOut = await t.handler({ action: "defer", pending_paths: [b], reason: "later" });
    expect(FlatOutput.safeParse(deferOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(deferOut.structuredContent).success).toBe(true);
    // #44×#43 control: this fixture is unsealed (no project_id/active_project),
    // so the project-scope warning fires on a write action that can land a new
    // entry — proving the mechanism is active for the retire-skip assertion below.
    expect(warnCodes(deferOut)).toContain("project_scope_unsealed");

    // 2. reject
    const rejectOut = await t.handler({ action: "reject", pending_paths: [b], reason: "stale" });
    expect(FlatOutput.safeParse(rejectOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(rejectOut.structuredContent).success).toBe(true);

    // 3. approve (consumes `a`).
    const approveOut = await t.handler({ action: "approve", pending_paths: [a] });
    expect(FlatOutput.safeParse(approveOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(approveOut.structuredContent).success).toBe(true);
    const approved = (approveOut.structuredContent as { approved: Array<{ stable_id: string }> }).approved;
    expect(approved).toHaveLength(1);

    // 4. modify (against the canonical entry just produced by approve — now in
    // the team store).
    const stableId = approved[0].stable_id;
    const canonicalRel = join(
      resolveGlobalRoot(),
      storeRelativePathForMount({ store_uuid: TEST_TEAM_UUID }),
      STORE_LAYOUT.knowledgeDir,
      "decisions",
      `${stableId}--happy-a.md`,
    );
    const modifyOut = await t.handler({
      action: "modify",
      pending_path: canonicalRel,
      changes: { maturity: "verified" },
    });
    expect(FlatOutput.safeParse(modifyOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(modifyOut.structuredContent).success).toBe(true);

    // 5. retire (against the same canonical entry) — validates the W3-C output
    // wiring end-to-end through the tool handler.
    const retireOut = await t.handler({
      action: "retire",
      pending_paths: [canonicalRel],
      superseded_by: "KT-DEC-9999",
    });
    expect(FlatOutput.safeParse(retireOut.structuredContent).success).toBe(true);
    expect(FabReviewOutputSchema.safeParse(retireOut.structuredContent).success).toBe(true);
    expect(retireOut.structuredContent).toMatchObject({
      action: "retire",
      retired: [{ path: canonicalRel, superseded_by: "KT-DEC-9999" }],
    });
    // retire is an in-place deprecate — the unsealed-project scope warning must
    // NOT attach (false-positive: retire never lands a new entry flat), even
    // though the identical fixture triggers it for `defer` above.
    expect(warnCodes(retireOut)).not.toContain("project_scope_unsealed");
  });
});

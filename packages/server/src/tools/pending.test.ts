import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerPending } from "./pending.js";
import type { InFlightTracker } from "../services/in-flight-tracker.js";
import {
  FabPendingInputSchema,
  FabPendingInputShape,
  FabPendingOutputSchema,
  FabPendingOutputShape,
  fabPendingAnnotations,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

// v2.2 全砍 Stage 2/3 (B2 cutover): pending reads through the store.
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
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-tools-pending-home-"));
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
  const dir = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: TEST_TEAM_UUID }), STORE_LAYOUT.knowledgeDir, "pending", type);
  await mkdir(dir, { recursive: true });
  const frontmatter = [
    "---",
    `type: ${type}`,
    "maturity: draft",
    "layer: team",
    `created_at: ${new Date().toISOString()}`,
    "source_session: sess-tool-pending",
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
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-tools-pending-"));
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

describe("registerPending", () => {
  it("registers fab_pending with correct name, schemas, and read-only annotations", () => {
    const { server, tool } = captureRegistration();
    registerPending(server);
    const t = tool();
    expect(t.name).toBe("fab_pending");
    expect(t.definition.inputSchema).toBeDefined();
    expect(t.definition.outputSchema).toBeDefined();
    // C-002: honest read-only tool — readOnlyHint:true, idempotentHint:true.
    expect(t.definition.annotations).toBe(fabPendingAnnotations);
    expect((t.definition.annotations as { readOnlyHint: boolean }).readOnlyHint).toBe(true);
    expect((t.definition.annotations as { idempotentHint: boolean }).idempotentHint).toBe(true);
  });

  it("invokes the list action end-to-end and returns structured content", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    await seedPendingFile(projectRoot, "decisions", "tool-list-target");

    const { server, tool } = captureRegistration();
    registerPending(server);
    const t = tool();

    const result = await t.handler({ action: "list" });
    expect(result.structuredContent).toMatchObject({ action: "list" });
    expect(Array.isArray((result.structuredContent as { items: unknown }).items)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]!.text).toContain("Fabric pending: list");
    expect(result.content[0]!.text).toContain("see structuredContent");
    expect(result.content[0]!.text).not.toBe(JSON.stringify(result.structuredContent));
  });

  // ISS werewolf-minigame (rootless MCP spawn, KT-PIT-0046): a root without
  // .fabric/fabric-config.json silently served the personal store only. The
  // tool response must now carry the fail-loud project_root_unresolved warning.
  it("appends the project_root_unresolved warning when the root has no fabric-config.json", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-tools-pending-bare-"));
    tempDirs.push(projectRoot);
    saveGlobalConfig({
      uid: "test-uid",
      stores: [
        { store_uuid: TEST_PERSONAL_UUID, alias: "personal", personal: true, writable: true },
      ],
    });
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerPending(server);

    const result = await tool().handler({ action: "list" });
    const warnings = (result.structuredContent as {
      warnings?: Array<{ code: string; message?: string; action_hint: string }>;
    }).warnings;
    const rootWarn = warnings?.find((w) => w.code === "project_root_unresolved");
    expect(rootWarn).toBeDefined();
    expect(rootWarn?.message).toContain("project root unresolved — serving personal store only");
    expect(rootWarn?.action_hint).toContain("FABRIC_PROJECT_ROOT");
  });

  it("emits NO project_root_unresolved warning when the root carries fabric-config.json", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerPending(server);

    const result = await tool().handler({ action: "list" });
    const warnings = (result.structuredContent as {
      warnings?: Array<{ code: string }>;
    }).warnings;
    expect(warnings?.some((w) => w.code === "project_root_unresolved") ?? false).toBe(false);
  });

  it("invokes the search action end-to-end and returns structured content", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    await seedPendingFile(projectRoot, "decisions", "tool-search-target");

    const { server, tool } = captureRegistration();
    registerPending(server);
    const t = tool();

    const result = await t.handler({ action: "search", query: "tool-search-target" });
    expect(result.structuredContent).toMatchObject({ action: "search" });
    expect(Array.isArray((result.structuredContent as { items: unknown }).items)).toBe(true);
    expect(result.content[0]!.text).toContain("Fabric pending: search");
  });

  it("calls tracker.enter and tracker.exit around the handler invocation", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerPending(server, tracker);
    const t = tool();

    await t.handler({ action: "list" });

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    const enterId = enter.mock.calls[0]?.[0];
    const exitId = exit.mock.calls[0]?.[0];
    expect(typeof enterId).toBe("string");
    expect(enterId).toBe(exitId);
  });

  it("works without a tracker (optional argument)", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerPending(server); // no tracker
    const t = tool();

    const result = await t.handler({ action: "list" });
    expect((result.structuredContent as { action: string }).action).toBe("list");
  });

  // -------------------------------------------------------------------------
  // SDK-shape split: flat ZodRawShape for registration, internal
  // discriminatedUnion for runtime narrowing (mirrors the fab_review split).
  // -------------------------------------------------------------------------

  it("test_fab_pending_input_shape_exposes_action_enum_and_optional_fields", () => {
    // (a) action is a required ZodEnum exposing exactly the two read literals.
    const actionSchema = FabPendingInputShape.action;
    expect(actionSchema).toBeInstanceOf(z.ZodEnum);
    expect(actionSchema.options.sort()).toEqual(["list", "search"]);

    // (b) Every other declared field is optional.
    const optionalFields = ["filters", "query"];
    for (const field of optionalFields) {
      const sub = (FabPendingInputShape as Record<string, z.ZodTypeAny>)[field];
      expect(sub, `field=${field}`).toBeDefined();
      expect(sub.isOptional(), `field=${field} should be .optional()`).toBe(true);
    }

    // (c) Drift-guard: keys of FabPendingInputShape MUST be a superset of every
    // branch field in FabPendingInputSchema.
    const branchKeys = new Set<string>();
    for (const opt of FabPendingInputSchema.options) {
      for (const k of Object.keys((opt as z.AnyZodObject).shape)) branchKeys.add(k);
    }
    const shapeKeys = new Set(Object.keys(FabPendingInputShape));
    for (const k of branchKeys) {
      expect(shapeKeys.has(k), `FabPendingInputShape missing branch field '${k}'`).toBe(true);
    }
  });

  it("handler narrows via the discriminated union (search without query throws)", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;

    const { server, tool } = captureRegistration();
    registerPending(server);
    const t = tool();

    // The FLAT shape accepts action=search with no query (every per-action
    // field is optional there) but the discriminated union must REJECT it.
    // ISS-20260713-009: the ZodError is mapped to a structured MCP error result
    // (code "invalid_input") rather than rethrown.
    const result = await t.handler({ action: "search" });
    expect(result).toMatchObject({ isError: true, structuredContent: { code: "invalid_input" } });
  });

  it("list and search happy paths validate the output shape", async () => {
    const projectRoot = await makeProject();
    process.env.FABRIC_PROJECT_ROOT = projectRoot;
    await seedPendingFile(projectRoot, "decisions", "happy-a");

    const { server, tool } = captureRegistration();
    registerPending(server);
    const t = tool();

    const FlatOutput = z.object(FabPendingOutputShape);

    const listOut = await t.handler({ action: "list" });
    expect(FlatOutput.safeParse(listOut.structuredContent).success).toBe(true);
    expect(FabPendingOutputSchema.safeParse(listOut.structuredContent).success).toBe(true);

    const searchOut = await t.handler({ action: "search", query: "happy" });
    expect(FlatOutput.safeParse(searchOut.structuredContent).success).toBe(true);
    expect(FabPendingOutputSchema.safeParse(searchOut.structuredContent).success).toBe(true);
  });
});

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORE_LAYOUT,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { registerExtractKnowledge } from "./extract-knowledge.js";

// v2.2 全砍 Stage 2/3 (B2 cutover): write path is store-only. Provision a
// deterministic personal + team store + project config so extract resolves a
// write-target store; helpers compute the store-rooted reported/absolute paths.
const TEST_PERSONAL_UUID = "11111111-1111-4111-8111-111111111111";
const TEST_TEAM_UUID = "22222222-2222-4222-8222-222222222222";

async function createProjectWithStores(prefix = "fabric-tools-extract-"): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(projectRoot);
  process.env.FABRIC_PROJECT_ROOT = projectRoot;
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

function pendingStoreRel(layer: "team" | "personal", type: string, slug: string): string {
  const uuid = layer === "personal" ? TEST_PERSONAL_UUID : TEST_TEAM_UUID;
  return `~/.fabric/${storeRelativePath(uuid)}/${STORE_LAYOUT.knowledgeDir}/pending/${type}/${slug}.md`;
}

function pendingStoreAbs(reported: string): string {
  return join(process.env.FABRIC_HOME!, reported.slice(2));
}
import {
  resetFirstReconcileGate,
  setFirstReconcile,
} from "../services/first-reconcile-gate.js";
import type { InFlightTracker } from "../services/in-flight-tracker.js";

type RegisteredTool = {
  name: string;
  definition: { inputSchema: unknown; outputSchema: unknown; annotations: unknown };
  handler: (input: Record<string, unknown>) => Promise<{
    content: Array<{ type: string; text: string }>;
    structuredContent: {
      pending_path: string;
      idempotency_key: string;
      // v2.0.0-rc.23 TASK-009 (d): optional warnings surface.
      warnings?: Array<{ code: string; file: string; action_hint: string }>;
    };
  }>;
};

const tempDirs: string[] = [];
let originalProjectRoot: string | undefined;
let originalFabricHome: string | undefined;

beforeEach(async () => {
  originalProjectRoot = process.env.FABRIC_PROJECT_ROOT;
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-tools-extract-home-"));
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
  // v2.0.0-rc.23 TASK-009 (d): reset gate state so the "no reconcile
  // registered" fast path applies cleanly to the next case.
  resetFirstReconcileGate();
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

describe("registerExtractKnowledge", () => {
  it("registers fab_extract_knowledge with correct name and schemas", () => {
    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();
    expect(t.name).toBe("fab_extract_knowledge");
    expect(t.definition.inputSchema).toBeDefined();
    expect(t.definition.outputSchema).toBeDefined();
    expect(t.definition.annotations).toBeDefined();
  });

  it("invokes extractKnowledge service end-to-end and returns structured content", async () => {
    const projectRoot = await createProjectWithStores();

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();

    const result = await t.handler({
      source_sessions: ["sess-tool-001"],
      recent_paths: ["packages/server/src/index.ts"],
      user_messages_summary: "Tool-handler integration: write through to pending.",
      proposed_reason: "decision-confirmation",
      session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
      type: "decisions",
      slug: "tool-handler-coverage",
    });

    expect(result.structuredContent.pending_path).toBe(pendingStoreRel("team", "decisions", "tool-handler-coverage"));
    expect(result.structuredContent.idempotency_key).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
    // text mirrors structuredContent
    const textParsed = JSON.parse(result.content[0]!.text) as {
      pending_path: string;
      idempotency_key: string;
    };
    expect(textParsed).toEqual(result.structuredContent);
  });

  it("calls tracker.enter and tracker.exit around the handler invocation", async () => {
    const projectRoot = await createProjectWithStores();

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server, tracker);
    const t = tool();

    await t.handler({
      source_sessions: ["sess-tracker"],
      recent_paths: [],
      user_messages_summary: "Tracker exercises enter/exit on success.",
      proposed_reason: "decision-confirmation",
      session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
      type: "guidelines",
      slug: "tracker-enter-exit",
    });

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    // Both calls receive the same request id (a UUID string).
    const enterId = enter.mock.calls[0]?.[0];
    const exitId = exit.mock.calls[0]?.[0];
    expect(typeof enterId).toBe("string");
    expect(enterId).toBe(exitId);
  });

  it("calls tracker.exit even if the underlying service throws", async () => {
    // Force resolveProjectRoot() to point at a path that is unwriteable so
    // ensureParentDirectory throws inside extractKnowledge — we still want
    // tracker.exit() to fire (the tool body wraps the call in try/finally).
    process.env.FABRIC_PROJECT_ROOT = "/nonexistent-readonly-path-fabric-tools-test";

    const enter = vi.fn();
    const exit = vi.fn();
    const tracker = { enter, exit } as unknown as InFlightTracker;

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server, tracker);
    const t = tool();

    await expect(
      t.handler({
        source_sessions: ["sess-throw"],
        recent_paths: [],
        user_messages_summary: "Forces a failure path.",
        proposed_reason: "decision-confirmation",
        session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
        type: "decisions",
        slug: "force-throw",
      }),
    ).rejects.toBeDefined();

    expect(enter).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  // v2.0.0-rc.23 TASK-009 (d): handler-level wiring of the first-reconcile
  // gate. The gate's stale/ready/failed semantics themselves are exercised
  // exhaustively in first-reconcile-gate.test.ts; this case verifies the
  // tool handler actually consults the gate and translates a non-ready
  // result into a response.warnings entry. We pick extract-knowledge as
  // the concrete probe because its happy path is the smallest — the
  // wiring is identical in plan-context, knowledge-sections, and review.
  //
  // We exercise the `failed` path (not `stale`) because the gate's default
  // timeout is 5s — a stale-path handler test would block the suite for
  // 5s with no extra signal beyond what the unit test already provides.
  // The `failed` path resolves immediately and proves the same wiring.
  it("attaches reconcile_failed warning when first reconcile has rejected", async () => {
    const projectRoot = await createProjectWithStores();

    const failure = new Error("simulated reconcile failure");
    setFirstReconcile(Promise.reject(failure));
    // Let the gate's wrapper observe the rejection before the handler runs.
    await Promise.resolve();
    await Promise.resolve();

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();

    const result = await t.handler({
      source_sessions: ["sess-gate-failed"],
      recent_paths: [],
      user_messages_summary: "Gate failed-path coverage.",
      proposed_reason: "decision-confirmation",
      session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
      type: "decisions",
      slug: "gate-failed-coverage",
    });

    expect(result.structuredContent.warnings).toBeDefined();
    expect(result.structuredContent.warnings?.[0]?.code).toBe("reconcile_failed");
    expect(result.structuredContent.warnings?.[0]?.action_hint).toMatch(/fabric doctor --fix/);
  });

  // v2.0.0-rc.23 TASK-006 (a-C1): four optional structured triage fields
  // (intent_clues / tech_stack / impact / must_read_if) flow through the
  // tool handler -> service -> pending-file frontmatter unchanged. The
  // service-level test exercises emit / omit / subset / idempotency exhaustively;
  // here we verify the tool registration accepts them via the public schema
  // and persists them end-to-end through the registered handler.
  it("passes through C1 triage fields end-to-end via the tool handler", async () => {
    const { readFile } = await import("node:fs/promises");
    const projectRoot = await createProjectWithStores();

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();

    const result = await t.handler({
      source_sessions: ["sess-tool-c1"],
      recent_paths: ["packages/cli/src/commands/hooks.ts"],
      user_messages_summary: "C1 triage fields propagate via the tool layer.",
      proposed_reason: "decision-confirmation",
      session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
      type: "guidelines",
      slug: "c1-tool-layer",
      intent_clues: ["editing hooks.ts"],
      tech_stack: ["typescript"],
      impact: ["protected-token drift"],
      must_read_if: "touching hooks.ts",
    });

    const body = await readFile(
      pendingStoreAbs(result.structuredContent.pending_path),
      "utf8",
    );
    expect(body).toMatch(/^intent_clues: \["editing hooks\.ts"\]$/mu);
    expect(body).toMatch(/^tech_stack: \["typescript"\]$/mu);
    expect(body).toMatch(/^impact: \["protected-token drift"\]$/mu);
    expect(body).toMatch(/^must_read_if: "touching hooks\.ts"$/mu);
  });

  it("omits all C1 frontmatter lines when caller omits the four fields", async () => {
    const { readFile } = await import("node:fs/promises");
    const projectRoot = await createProjectWithStores();

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();

    const result = await t.handler({
      source_sessions: ["sess-tool-c1-omit"],
      recent_paths: [],
      user_messages_summary: "C1 omit path coverage at the tool layer.",
      proposed_reason: "decision-confirmation",
      session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
      type: "decisions",
      slug: "c1-tool-omit",
    });

    const body = await readFile(
      pendingStoreAbs(result.structuredContent.pending_path),
      "utf8",
    );
    expect(body).not.toMatch(/^intent_clues:/mu);
    expect(body).not.toMatch(/^tech_stack:/mu);
    expect(body).not.toMatch(/^impact:/mu);
    expect(body).not.toMatch(/^must_read_if:/mu);
  });

  // W1-10 (F5): registerTool validates against the raw shape, which lacks the
  // superRefine requiring a non-empty source_sessions[]. The handler must
  // re-parse through FabExtractKnowledgeInputSchema so a missing/empty
  // source_sessions is rejected instead of persisting a source_sessions=[]
  // contract violation.
  it("rejects input with source_sessions omitted (superRefine enforced in handler)", async () => {
    const projectRoot = await createProjectWithStores();

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();

    await expect(
      t.handler({
        recent_paths: [],
        user_messages_summary: "Missing source_sessions must be rejected.",
        proposed_reason: "decision-confirmation",
        session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
        type: "decisions",
        slug: "missing-source-sessions",
      }),
    ).rejects.toBeTruthy();
  });

  it("rejects input with an empty source_sessions array", async () => {
    const projectRoot = await createProjectWithStores();

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server);
    const t = tool();

    await expect(
      t.handler({
        source_sessions: [],
        recent_paths: [],
        user_messages_summary: "Empty source_sessions must be rejected.",
        proposed_reason: "decision-confirmation",
        session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
        type: "decisions",
        slug: "empty-source-sessions",
      }),
    ).rejects.toBeTruthy();
  });

  it("works without a tracker (optional argument)", async () => {
    const projectRoot = await createProjectWithStores();

    const { server, tool } = captureRegistration();
    registerExtractKnowledge(server); // no tracker
    const t = tool();

    const result = await t.handler({
      source_sessions: ["sess-no-tracker"],
      recent_paths: [],
      user_messages_summary: "Verifies the optional-tracker branch.",
      proposed_reason: "decision-confirmation",
      session_context: "Session goal: cover the extract-knowledge tool handler. Turning point: validated the parse path.",
      type: "guidelines",
      slug: "no-tracker-branch",
    });
    expect(result.structuredContent.pending_path).toMatch(/no-tracker-branch\.md$/u);
  });
});

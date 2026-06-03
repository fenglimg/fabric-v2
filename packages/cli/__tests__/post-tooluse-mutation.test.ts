/**
 * Contract tests for templates/hooks/post-tooluse-mutation.cjs
 * (lifecycle-refactor W2-T3 — PostToolUse mutation marker hook).
 *
 * In-process invocation only (no child_process.spawn): the .cjs is loaded via
 * createRequire and driven through the `env.payload` test seam. Each test runs
 * against an isolated temp `.fabric/` directory. The emitted lines are validated
 * against the canonical `eventLedgerEventSchema` (safeParse) so the on-disk
 * file_mutated shape can never drift from the shared schema.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { eventLedgerEventSchema } from "@fenglimg/fabric-shared";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/post-tooluse-mutation.cjs", import.meta.url),
);

type HookEnv = {
  cwd?: string;
  now?: Date;
  payload?: unknown;
  stdin?: string;
};

type HookModule = {
  main: (env: HookEnv) => void;
  readPayload: (raw: string) => Record<string, unknown> | null;
  extractToolName: (payload: unknown) => string | null;
  extractToolInput: (payload: unknown) => Record<string, unknown> | null;
  extractPaths: (toolInput: unknown) => string[];
  extractToolCallId: (payload: unknown) => string | null;
  normalizePath: (projectRoot: string, p: string) => string | null;
  appendFileMutated: (
    projectRoot: string,
    now: Date,
    paths: string[],
    toolCallId: string | null,
    toolName: string | null,
    sessionId: string | null,
  ) => void;
  CONSTANTS: { FABRIC_DIR_REL: string; EVENTS_LEDGER_FILE: string; EDIT_TOOL_NAMES: Set<string> };
};

const hook = require(hookPath) as HookModule;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop() as string, { recursive: true, force: true });
  }
});

function mkRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  tempRoots.push(root);
  return root;
}

function mkFabric(root: string): void {
  mkdirSync(join(root, ".fabric"), { recursive: true });
}

function readLedgerLines(root: string): string[] {
  const file = join(root, hook.CONSTANTS.FABRIC_DIR_REL, hook.CONSTANTS.EVENTS_LEDGER_FILE);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0);
}

describe("post-tooluse-mutation.cjs — extractToolCallId", () => {
  it("reads tool_use_id (Claude Code PostToolUse convention)", () => {
    expect(hook.extractToolCallId({ tool_use_id: "toolu_abc" })).toBe("toolu_abc");
  });
  it("falls back to tool_call_id / call_id / id in order", () => {
    expect(hook.extractToolCallId({ tool_call_id: "tc1" })).toBe("tc1");
    expect(hook.extractToolCallId({ call_id: "c1" })).toBe("c1");
    expect(hook.extractToolCallId({ id: "i1" })).toBe("i1");
  });
  it("returns null when no id field present", () => {
    expect(hook.extractToolCallId({ foo: "bar" })).toBeNull();
  });
});

describe("post-tooluse-mutation.cjs — extractPaths", () => {
  it("extracts a scalar file_path", () => {
    expect(hook.extractPaths({ file_path: "src/a.ts" })).toEqual(["src/a.ts"]);
  });
  it("extracts + dedupes MultiEdit edits[] file_paths", () => {
    expect(
      hook.extractPaths({ file_path: "src/a.ts", edits: [{ file_path: "src/a.ts" }, { file_path: "src/b.ts" }] }),
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

describe("post-tooluse-mutation.cjs — main marker append", () => {
  it("appends one file_mutated event per path with the tool_call_id", () => {
    const root = mkRoot("post-tooluse-happy");
    mkFabric(root);
    const now = new Date("2026-06-03T00:00:00.000Z");
    hook.main({
      cwd: root,
      now,
      payload: {
        tool_name: "Edit",
        tool_use_id: "toolu_xyz",
        session_id: "sess-9",
        tool_input: { file_path: "src/foo.ts" },
      },
    });

    const lines = readLedgerLines(root);
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]);
    expect(event.event_type).toBe("file_mutated");
    expect(event.path).toBe("src/foo.ts");
    expect(event.tool_call_id).toBe("toolu_xyz");
    expect(event.tool_name).toBe("Edit");
    expect(event.session_id).toBe("sess-9");
    expect(event.ts).toBe(now.getTime());
  });

  it("emits one event per MultiEdit path sharing one tool_call_id", () => {
    const root = mkRoot("post-tooluse-multi");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: {
        tool_name: "MultiEdit",
        tool_use_id: "toolu_multi",
        tool_input: { file_path: "a.ts", edits: [{ file_path: "a.ts" }, { file_path: "b.ts" }] },
      },
    });

    const lines = readLedgerLines(root).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines.map((e) => e.path).sort()).toEqual(["a.ts", "b.ts"]);
    expect(new Set(lines.map((e) => e.tool_call_id))).toEqual(new Set(["toolu_multi"]));
  });

  it("emitted lines satisfy the shared eventLedgerEventSchema (safeParse)", () => {
    const root = mkRoot("post-tooluse-schema");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: { tool_name: "Write", tool_use_id: "toolu_s", tool_input: { file_path: "x.ts" } },
    });
    const lines = readLedgerLines(root);
    expect(lines).toHaveLength(1);
    const parsed = eventLedgerEventSchema.safeParse(JSON.parse(lines[0]));
    expect(parsed.success).toBe(true);
  });

  it("uses a best-effort fallback key when tool_call_id is missing but still appends", () => {
    const root = mkRoot("post-tooluse-fallback");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: { tool_name: "Edit", tool_input: { file_path: "y.ts" } },
    });
    const lines = readLedgerLines(root).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].tool_call_id).toMatch(/^fallback:/);
    // still schema-valid (tool_call_id is a non-empty string)
    expect(eventLedgerEventSchema.safeParse(lines[0]).success).toBe(true);
  });

  it("omits session_id from the event when the client omits it (still schema-valid)", () => {
    const root = mkRoot("post-tooluse-nosession");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: { tool_name: "Edit", tool_use_id: "t", tool_input: { file_path: "z.ts" } },
    });
    const event = JSON.parse(readLedgerLines(root)[0]);
    expect(event.session_id).toBeUndefined();
    expect(eventLedgerEventSchema.safeParse(event).success).toBe(true);
  });

  it("ignores non-edit tools (no append)", () => {
    const root = mkRoot("post-tooluse-readtool");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: { tool_name: "Read", tool_use_id: "t", tool_input: { file_path: "z.ts" } },
    });
    expect(readLedgerLines(root)).toHaveLength(0);
  });

  it("is a silent no-op when .fabric/ does not exist and never throws on null payload", () => {
    const noFabric = mkRoot("post-tooluse-nofabric");
    expect(() =>
      hook.main({ cwd: noFabric, now: new Date(), payload: { tool_name: "Edit", tool_input: { file_path: "a.ts" } } }),
    ).not.toThrow();
    expect(readLedgerLines(noFabric)).toHaveLength(0);

    const nullRoot = mkRoot("post-tooluse-null");
    mkFabric(nullRoot);
    expect(() => hook.main({ cwd: nullRoot, now: new Date(), payload: null })).not.toThrow();
    expect(readLedgerLines(nullRoot)).toHaveLength(0);
  });
});

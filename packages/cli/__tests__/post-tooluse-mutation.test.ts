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
  extractKnowledgeBodyRead: (
    filePath: string,
  ) => { stable_id: string; store: string | null; path: string } | null;
  appendKnowledgeBodyRead: (
    projectRoot: string,
    now: Date,
    paths: string[],
    toolCallId: string | null,
    toolName: string | null,
    sessionId: string | null,
  ) => void;
  CONSTANTS: {
    FABRIC_DIR_REL: string;
    EVENTS_LEDGER_FILE: string;
    EDIT_TOOL_NAMES: Set<string>;
    READ_TOOL_NAMES: Set<string>;
  };
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
  // ISS-20260711-212: Codex apply_patch path harvest
  it("harvests paths from apply_patch *** File: directives", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: packages/cli/src/a.ts",
      "+const x = 1",
      "*** Add File: packages/cli/src/b.ts",
      "+export {}",
      "*** End Patch",
    ].join("\n");
    expect(hook.extractPaths({ input: patch })).toEqual([
      "packages/cli/src/a.ts",
      "packages/cli/src/b.ts",
    ]);
  });
  it("EDIT_TOOL_NAMES includes apply_patch", () => {
    expect(hook.CONSTANTS.EDIT_TOOL_NAMES.has("apply_patch")).toBe(true);
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

  it("ignores a non-knowledge Read (no append)", () => {
    const root = mkRoot("post-tooluse-readtool");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: { tool_name: "Read", tool_use_id: "t", tool_input: { file_path: "z.ts" } },
    });
    expect(readLedgerLines(root)).toHaveLength(0);
  });

  it("ignores an unrelated tool entirely (no append)", () => {
    const root = mkRoot("post-tooluse-other");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: { tool_name: "Bash", tool_use_id: "t", tool_input: { command: "ls" } },
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

describe("post-tooluse-mutation.cjs — extractKnowledgeBodyRead (KT-DEC-0030)", () => {
  it("parses stable_id + store from a multistore knowledge path", () => {
    const r = hook.extractKnowledgeBodyRead(
      "/Users/me/.fabric/stores/team/fabric-team-knowledge/knowledge/decisions/KT-DEC-0030--body-read-observability-hook.md",
    );
    expect(r).not.toBeNull();
    expect(r?.stable_id).toBe("KT-DEC-0030");
    expect(r?.store).toBe("team");
  });

  it("parses a personal-layer KP id and all 5 type tokens", () => {
    expect(
      hook.extractKnowledgeBodyRead(
        "/home/u/.fabric/stores/personal/kb/knowledge/pitfalls/KP-PIT-0004--x.md",
      )?.stable_id,
    ).toBe("KP-PIT-0004");
    expect(
      hook.extractKnowledgeBodyRead("/x/knowledge/models/KT-MOD-0001--m.md")?.stable_id,
    ).toBe("KT-MOD-0001");
    expect(
      hook.extractKnowledgeBodyRead("/x/knowledge/guidelines/KT-GLD-0005--g.md")?.stable_id,
    ).toBe("KT-GLD-0005");
    expect(
      hook.extractKnowledgeBodyRead("/x/knowledge/processes/KT-PRO-0002--p.md")?.stable_id,
    ).toBe("KT-PRO-0002");
  });

  it("returns null store when no stores/<alias>/ segment is present (legacy dual-root)", () => {
    const r = hook.extractKnowledgeBodyRead(
      "/Users/me/.fabric/knowledge/decisions/KT-DEC-0007--single-cjs-hook.md",
    );
    expect(r?.stable_id).toBe("KT-DEC-0007");
    expect(r?.store).toBeNull();
  });

  it("returns null for non-knowledge paths and id-shaped tokens outside /knowledge/<type>/", () => {
    expect(hook.extractKnowledgeBodyRead("src/app/KT-DEC-0001--note.md")).toBeNull(); // no /knowledge/<type>/
    expect(hook.extractKnowledgeBodyRead("/x/knowledge/decisions/not-an-id.md")).toBeNull();
    expect(hook.extractKnowledgeBodyRead("/x/knowledge/decisions/KT-DEC-0001.md")).toBeNull(); // no -- slug
    expect(hook.extractKnowledgeBodyRead("")).toBeNull();
  });
});

describe("post-tooluse-mutation.cjs — knowledge_body_read append (KT-DEC-0030)", () => {
  const KB_PATH =
    "/Users/me/.fabric/stores/team/fabric-team-knowledge/knowledge/decisions/KT-DEC-0030--body-read-observability-hook.md";

  it("emits a schema-valid knowledge_body_read on a Read of a store knowledge body", () => {
    const root = mkRoot("body-read-happy");
    mkFabric(root);
    const now = new Date("2026-06-15T00:00:00.000Z");
    hook.main({
      cwd: root,
      now,
      payload: {
        tool_name: "Read",
        tool_use_id: "toolu_read",
        session_id: "sess-7",
        tool_input: { file_path: KB_PATH },
      },
    });
    const lines = readLedgerLines(root).map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    const ev = lines[0];
    expect(ev.event_type).toBe("knowledge_body_read");
    expect(ev.stable_id).toBe("KT-DEC-0030");
    expect(ev.store).toBe("team");
    expect(ev.tool_call_id).toBe("toolu_read");
    expect(ev.tool_name).toBe("Read");
    expect(ev.session_id).toBe("sess-7");
    expect(ev.ts).toBe(now.getTime());
    expect(eventLedgerEventSchema.safeParse(ev).success).toBe(true);
  });

  it("produces no event for a Read of an ordinary source file", () => {
    const root = mkRoot("body-read-source");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: { tool_name: "Read", tool_use_id: "t", tool_input: { file_path: "src/index.ts" } },
    });
    expect(readLedgerLines(root)).toHaveLength(0);
  });

  it("omits store when the read path has no stores/<alias>/ segment but stays schema-valid", () => {
    const root = mkRoot("body-read-nostore");
    mkFabric(root);
    hook.main({
      cwd: root,
      now: new Date(),
      payload: {
        tool_name: "Read",
        tool_use_id: "t",
        tool_input: { file_path: "/home/u/.fabric/knowledge/pitfalls/KP-PIT-0001--x.md" },
      },
    });
    const ev = JSON.parse(readLedgerLines(root)[0]);
    expect(ev.event_type).toBe("knowledge_body_read");
    expect(ev.stable_id).toBe("KP-PIT-0001");
    expect(ev.store).toBeUndefined();
    expect(eventLedgerEventSchema.safeParse(ev).success).toBe(true);
  });
});

/**
 * Contract tests for templates/hooks/knowledge-hint-narrow.cjs
 * (rc.6 TASK-020 / E2 + E4 — PreToolUse narrow-injection hook + edit-counter
 * sidecar).
 *
 * Per signal-handler / fabric-hint test policy: in-process invocation only,
 * NO child_process.spawn in CI. We load the .cjs via createRequire so
 * Vitest's ESM resolver does not interfere. The CLI invocation is stubbed
 * via the `env.cliResult` test seam, and stdin parsing via `env.payload`
 * — tests never touch process.stdin or spawn the `fabric` binary.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/knowledge-hint-narrow.cjs", import.meta.url),
);

type NarrowEntry = {
  id: string;
  type: string;
  maturity: string;
  summary: string;
};

type CliPayload = {
  version: 2;
  revision_hash: string;
  target_paths: string[];
  entries: NarrowEntry[];
  broad_count: number;
};

type HookEnv = {
  cwd?: string;
  now?: Date;
  payload?: unknown;
  cliResult?: CliPayload | null;
  skipCounter?: boolean;
  stdin?: string;
  // rc.6 TASK-021 (E3) test seams
  cacheSeed?: SessionHintsCache | null;
  skipCacheWrite?: boolean;
  processEnv?: Record<string, string | undefined>;
  // rc.6 TASK-023 (E6) test seam — disable silence-counter append.
  skipSilenceCounter?: boolean;
};

type SessionHintsCache = {
  session_id: string;
  revision_hash: string;
  hinted_paths: string[];
  hinted_stable_ids: string[];
  last_emitted_index_hash: string;
};

type HookModule = {
  main: (env: HookEnv, stdio: { stderr: { write: (chunk: string) => void } }) => void;
  readPayload: (raw: string) => Record<string, unknown> | null;
  extractToolName: (payload: unknown) => string | null;
  extractToolInput: (payload: unknown) => Record<string, unknown> | null;
  extractPaths: (toolInput: unknown) => string[];
  appendEditCounter: (projectRoot: string, now: Date, paths?: string[]) => void;
  appendHintSilenceCounter: (projectRoot: string, now: Date) => void;
  renderSummary: (payload: CliPayload) => string[];
  truncateSummary: (raw: string) => string;
  formatEntryLine: (entry: NarrowEntry) => string;
  resolveSessionId: (
    payload: unknown,
    env?: { processEnv?: Record<string, string | undefined> },
  ) => string;
  resetSyntheticSessionId: () => void;
  sessionHintsCachePath: (projectRoot: string, sessionId: string) => string;
  readSessionHintsCache: (
    projectRoot: string,
    sessionId: string,
  ) => SessionHintsCache | null;
  writeSessionHintsCache: (projectRoot: string, cache: SessionHintsCache) => void;
  computeIndexHash: (narrow: NarrowEntry[]) => string;
  applyEmitGate: (
    cache: SessionHintsCache | null,
    narrow: NarrowEntry[],
    targetPaths: string[],
    currentRevisionHash: string,
  ) => { render: boolean; narrow: NarrowEntry[]; cache: SessionHintsCache };
  CONSTANTS: {
    CLI_TIMEOUT_MS: number;
    SUMMARY_MAX_LEN: number;
    EDIT_COUNTER_DIR_REL: string;
    EDIT_COUNTER_FILE: string;
    HINT_SILENCE_COUNTER_DIR_REL: string;
    HINT_SILENCE_COUNTER_FILE: string;
    EDIT_TOOL_NAMES: Set<string>;
    SESSION_HINTS_DIR_REL: string;
    SESSION_HINTS_FILE_PREFIX: string;
    SESSION_HINTS_FILE_SUFFIX: string;
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

function makeEntry(
  id: string,
  type: string,
  maturity: string,
  summary: string,
): NarrowEntry {
  return { id, type, maturity, summary };
}

function makeCliPayload(
  narrow: NarrowEntry[],
  opts: { revision_hash?: string } = {},
): CliPayload {
  return {
    version: 2,
    revision_hash: opts.revision_hash ?? "rev-narrow-001",
    target_paths: ["**"],
    entries: narrow,
    broad_count: narrow.length,
  };
}

function captureStderr(env: HookEnv): string[] {
  const writes: string[] = [];
  const stderr = { write: (chunk: string) => writes.push(chunk) };
  hook.main(env, { stderr });
  return writes;
}

function readCounterFile(projectRoot: string): string | null {
  const file = join(
    projectRoot,
    hook.CONSTANTS.EDIT_COUNTER_DIR_REL,
    hook.CONSTANTS.EDIT_COUNTER_FILE,
  );
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

// rc.6 TASK-023 (E6) — companion sidecar reader for the hint-silence-counter.
function readSilenceCounterFile(projectRoot: string): string | null {
  const file = join(
    projectRoot,
    hook.CONSTANTS.HINT_SILENCE_COUNTER_DIR_REL,
    hook.CONSTANTS.HINT_SILENCE_COUNTER_FILE,
  );
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

// ---------------------------------------------------------------------------
// readPayload
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — readPayload", () => {
  it("parses a valid JSON object", () => {
    const parsed = hook.readPayload(JSON.stringify({ tool_name: "Edit" }));
    expect(parsed).toEqual({ tool_name: "Edit" });
  });

  it("returns null for empty string", () => {
    expect(hook.readPayload("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(hook.readPayload("{ not json")).toBeNull();
  });

  it("returns null for non-object JSON (array, primitive)", () => {
    expect(hook.readPayload("[1,2,3]")).toBeNull();
    expect(hook.readPayload("42")).toBeNull();
    expect(hook.readPayload("null")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractToolName / extractToolInput
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — extractToolName", () => {
  it("reads tool_name (Claude/Codex convention)", () => {
    expect(hook.extractToolName({ tool_name: "Edit" })).toBe("Edit");
  });

  it("reads tool (Cursor legacy convention)", () => {
    expect(hook.extractToolName({ tool: "Write" })).toBe("Write");
  });

  it("returns null when no recognizable field", () => {
    expect(hook.extractToolName({})).toBeNull();
    expect(hook.extractToolName(null)).toBeNull();
    expect(hook.extractToolName(undefined)).toBeNull();
  });
});

describe("knowledge-hint-narrow.cjs — extractToolInput", () => {
  it("reads tool_input (Claude/Codex convention)", () => {
    const out = hook.extractToolInput({ tool_input: { file_path: "x.ts" } });
    expect(out).toEqual({ file_path: "x.ts" });
  });

  it("reads input (Cursor legacy convention)", () => {
    const out = hook.extractToolInput({ input: { file_path: "y.ts" } });
    expect(out).toEqual({ file_path: "y.ts" });
  });

  it("returns null when neither field is present", () => {
    expect(hook.extractToolInput({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractPaths — single, array, MultiEdit, dedupe
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — extractPaths", () => {
  it("extracts a single file_path (Edit/Write shape)", () => {
    expect(hook.extractPaths({ file_path: "src/foo.ts" })).toEqual([
      "src/foo.ts",
    ]);
  });

  it("extracts an array file_paths (bulk variant)", () => {
    expect(
      hook.extractPaths({ file_paths: ["src/foo.ts", "src/bar.ts"] }),
    ).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("extracts paths from MultiEdit edits[] entries", () => {
    expect(
      hook.extractPaths({
        edits: [
          { file_path: "a.ts", old: "x", new: "y" },
          { file_path: "b.ts", old: "x", new: "y" },
          { file_path: "c.ts", old: "x", new: "y" },
        ],
      }),
    ).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("dedupes paths within a single request, preserving first-occurrence order", () => {
    expect(
      hook.extractPaths({
        file_path: "src/foo.ts",
        file_paths: ["src/bar.ts", "src/foo.ts"],
        edits: [{ file_path: "src/bar.ts" }, { file_path: "src/baz.ts" }],
      }),
    ).toEqual(["src/foo.ts", "src/bar.ts", "src/baz.ts"]);
  });

  it("handles MultiEdit with a single file_path + edits array (Claude Code shape)", () => {
    // Claude Code's current MultiEdit issues edits[] against a single
    // file_path — verify the scalar path is captured exactly once.
    expect(
      hook.extractPaths({
        file_path: "src/foo.ts",
        edits: [{ old_string: "x", new_string: "y" }, { old_string: "a", new_string: "b" }],
      }),
    ).toEqual(["src/foo.ts"]);
  });

  it("returns empty array on malformed input", () => {
    expect(hook.extractPaths(null)).toEqual([]);
    expect(hook.extractPaths(undefined)).toEqual([]);
    expect(hook.extractPaths({})).toEqual([]);
    expect(hook.extractPaths({ file_path: "" })).toEqual([]);
    expect(hook.extractPaths({ file_path: 42 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// appendEditCounter / E4 sidecar
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — appendEditCounter (E4 + rc.7 T4)", () => {
  it("creates .fabric/.cache/ directory if missing and writes one JSON-line", () => {
    const root = mkRoot("narrow-counter-mkdir");
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:00.000Z"));
    const contents = readCounterFile(root);
    // rc.7 T4: JSON-line shape replaces bare-ISO.
    expect(contents).toBe('{"ts":"2026-05-12T10:00:00.000Z","paths":[]}\n');
  });

  it("appends a second line on second call (counter grows monotonically)", () => {
    const root = mkRoot("narrow-counter-append");
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:00.000Z"));
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:01.000Z"));
    const contents = readCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines).toEqual([
      '{"ts":"2026-05-12T10:00:00.000Z","paths":[]}',
      '{"ts":"2026-05-12T10:00:01.000Z","paths":[]}',
    ]);
  });

  it("rc.7 T4: records paths array when supplied", () => {
    const root = mkRoot("narrow-counter-paths");
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:00.000Z"), [
      "packages/cli/a.ts",
      "packages/cli/b.ts",
    ]);
    const contents = readCounterFile(root) ?? "";
    expect(contents).toBe(
      '{"ts":"2026-05-12T10:00:00.000Z","paths":["packages/cli/a.ts","packages/cli/b.ts"]}\n',
    );
  });

  it("rc.7 T4: filters non-string entries from paths array", () => {
    const root = mkRoot("narrow-counter-paths-filter");
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:00.000Z"), [
      "packages/cli/a.ts",
      // @ts-expect-error — defensive path filtering
      null,
      // @ts-expect-error
      123,
      "",
      "packages/cli/b.ts",
    ]);
    const contents = readCounterFile(root) ?? "";
    expect(contents).toBe(
      '{"ts":"2026-05-12T10:00:00.000Z","paths":["packages/cli/a.ts","packages/cli/b.ts"]}\n',
    );
  });

  it("silently swallows failures (best-effort write)", () => {
    // Passing a non-string projectRoot would throw inside join(); the hook's
    // try/catch must suppress it.
    expect(() =>
      hook.appendEditCounter(
        "/nonexistent/path/that/cannot/be/created/by/any/process",
        new Date(),
      ),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// truncateSummary / formatEntryLine / renderSummary
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — truncateSummary", () => {
  it("returns short input unchanged", () => {
    expect(hook.truncateSummary("short")).toBe("short");
  });

  it("collapses whitespace runs", () => {
    expect(hook.truncateSummary("a\n  b\t\tc")).toBe("a b c");
  });

  it("truncates with ellipsis past SUMMARY_MAX_LEN", () => {
    const max = hook.CONSTANTS.SUMMARY_MAX_LEN;
    const out = hook.truncateSummary("x".repeat(max + 50));
    expect(out.length).toBe(max);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string for non-string input", () => {
    // @ts-expect-error — defensive path
    expect(hook.truncateSummary(null)).toBe("");
    // @ts-expect-error
    expect(hook.truncateSummary(undefined)).toBe("");
  });
});

describe("knowledge-hint-narrow.cjs — formatEntryLine", () => {
  it("renders [id] (type/maturity) summary shape", () => {
    const line = hook.formatEntryLine(
      makeEntry("KT-DEC-0001", "decision", "proven", "guard auth boundary"),
    );
    expect(line).toBe("  [KT-DEC-0001] (decision/proven) guard auth boundary");
  });

  it("falls back to (no-id)/unknown when fields are missing", () => {
    const line = hook.formatEntryLine({
      id: "",
      type: "",
      maturity: "",
      summary: "",
    });
    expect(line).toBe("  [(no-id)] (unknown/unknown)");
  });
});

describe("knowledge-hint-narrow.cjs — renderSummary", () => {
  it("returns [] (silent) when narrow is empty", () => {
    expect(hook.renderSummary(makeCliPayload([]))).toEqual([]);
  });

  it("emits banner + entry lines + footer when narrow has entries", () => {
    const narrow = [
      makeEntry("KT-DEC-0001", "decision", "proven", "guard auth boundary"),
      makeEntry("KT-PIT-0007", "pitfall", "verified", "do not reorder middleware"),
    ];
    const lines = hook.renderSummary(makeCliPayload(narrow));
    expect(lines[0]).toMatch(
      /\[fabric\] 2 narrow-scoped knowledge entries match your edit targets:/,
    );
    expect(lines[1]).toBe(
      "  [KT-DEC-0001] (decision/proven) guard auth boundary",
    );
    expect(lines[2]).toBe(
      "  [KT-PIT-0007] (pitfall/verified) do not reorder middleware",
    );
    expect(lines[3]).toMatch(/如需重读 broad 决策/);
    expect(lines[3]).toMatch(/fab_plan_context/);
    expect(lines[3]).toMatch(/fabric plan-context-hint --all/);
  });
});

// ---------------------------------------------------------------------------
// main — full hook flow via test seams
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — main (E2 narrow render)", () => {
  it("emits stderr lines when narrow matches > 0 on Edit", () => {
    const root = mkRoot("narrow-main-emit");
    const writes = captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([
        makeEntry("KT-DEC-0001", "decision", "proven", "summary"),
      ]),
    });
    const stderr = writes.join("");
    expect(stderr).toMatch(/narrow-scoped knowledge entries match/);
    expect(stderr).toMatch(/KT-DEC-0001/);
    expect(stderr).toMatch(/如需重读 broad 决策/);
  });

  it("stays silent when narrow matches == 0", () => {
    const root = mkRoot("narrow-main-silent-empty");
    const writes = captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([]),
    });
    expect(writes).toEqual([]);
  });

  it("stays silent when CLI returns null (binary absent / error path)", () => {
    const root = mkRoot("narrow-main-silent-cli-null");
    const writes = captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: null,
    });
    expect(writes).toEqual([]);
  });

  it("stays silent on unrecognized tool name (e.g. Read)", () => {
    const root = mkRoot("narrow-main-silent-unrecognized-tool");
    const writes = captureStderr({
      cwd: root,
      payload: {
        tool_name: "Read",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([
        makeEntry("KT-DEC-0001", "decision", "proven", "should not surface"),
      ]),
    });
    expect(writes).toEqual([]);
  });

  it("stays silent when tool_input has no extractable paths", () => {
    const root = mkRoot("narrow-main-silent-no-paths");
    const writes = captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: {},
      },
      cliResult: makeCliPayload([
        makeEntry("KT-DEC-0001", "decision", "proven", "should not surface"),
      ]),
    });
    expect(writes).toEqual([]);
  });

  it("never throws on malformed payload (defensive try/catch)", () => {
    const root = mkRoot("narrow-main-defensive");
    expect(() =>
      captureStderr({
        cwd: root,
        // @ts-expect-error — feeding garbage to exercise defensive path
        payload: { tool_name: "Edit", tool_input: { file_path: 42 } },
      }),
    ).not.toThrow();
  });

  it("each stderr write ends with a newline", () => {
    const root = mkRoot("narrow-main-newline");
    const writes = captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([
        makeEntry("KT-DEC-0001", "decision", "proven", "summary"),
      ]),
    });
    for (const chunk of writes) {
      expect(chunk.endsWith("\n")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// main — E4 edit-counter behaviour
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — main (E4 edit-counter sidecar)", () => {
  it("appends ONE timestamp line per fire on a matching Edit (regardless of path count)", () => {
    const root = mkRoot("narrow-counter-fire-one-line");
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:00.000Z"),
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([
        makeEntry("KT-DEC-0001", "decision", "proven", "x"),
      ]),
    });
    const contents = readCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    // rc.7 T4: JSON-line shape — line carries ts AND the touched paths so
    // the Stop hook can derive the activity overview for Signal A.
    const parsed = JSON.parse(lines[0] as string);
    expect(parsed.ts).toBe("2026-05-12T10:00:00.000Z");
    expect(parsed.paths).toEqual(["src/foo.ts"]);
  });

  it("appends ONE timestamp line per fire even when MultiEdit touches 3 paths", () => {
    const root = mkRoot("narrow-counter-multi-one-line");
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:00.000Z"),
      payload: {
        tool_name: "MultiEdit",
        tool_input: {
          file_paths: ["a.ts", "b.ts", "c.ts"],
        },
      },
      cliResult: makeCliPayload([]),
    });
    const contents = readCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    // E4 spec: ONE line per fire regardless of path count.
    expect(lines.length).toBe(1);
  });

  it("appends counter line EVEN WHEN narrow set is empty (E4 unconditional)", () => {
    const root = mkRoot("narrow-counter-fire-empty-narrow");
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:00.000Z"),
      payload: {
        tool_name: "Write",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([]),
    });
    const contents = readCounterFile(root) ?? "";
    expect(contents.split("\n").filter((l) => l.length > 0).length).toBe(1);
  });

  it("appends counter line EVEN WHEN CLI returns null (E4 unconditional)", () => {
    const root = mkRoot("narrow-counter-fire-cli-null");
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:00.000Z"),
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: null,
    });
    const contents = readCounterFile(root) ?? "";
    expect(contents.split("\n").filter((l) => l.length > 0).length).toBe(1);
  });

  it("appends counter line EVEN WHEN payload tool is unrecognized (E4 unconditional)", () => {
    // E4 measures every PreToolUse fire — including ones where we don't
    // render an E2 hint. The signal is "edit-attempt cadence", not "useful
    // edit-attempt cadence".
    const root = mkRoot("narrow-counter-fire-unrecognized");
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:00.000Z"),
      payload: {
        tool_name: "Read",
        tool_input: { file_path: "src/foo.ts" },
      },
    });
    const contents = readCounterFile(root) ?? "";
    expect(contents.split("\n").filter((l) => l.length > 0).length).toBe(1);
  });

  it("grows the counter by exactly one line across three sequential fires", () => {
    const root = mkRoot("narrow-counter-three-fires");
    for (let i = 0; i < 3; i += 1) {
      captureStderr({
        cwd: root,
        now: new Date(Date.UTC(2026, 4, 12, 10, 0, i)),
        payload: {
          tool_name: "Edit",
          tool_input: { file_path: `src/foo${i}.ts` },
        },
        cliResult: makeCliPayload([]),
      });
    }
    const contents = readCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(3);
  });

  it("creates .fabric/.cache/ directory on first fire if absent", () => {
    const root = mkRoot("narrow-counter-mkdir-on-fire");
    expect(existsSync(join(root, ".fabric", ".cache"))).toBe(false);
    captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([]),
    });
    expect(existsSync(join(root, ".fabric", ".cache"))).toBe(true);
    expect(
      existsSync(
        join(
          root,
          hook.CONSTANTS.EDIT_COUNTER_DIR_REL,
          hook.CONSTANTS.EDIT_COUNTER_FILE,
        ),
      ),
    ).toBe(true);
  });

  it("env.skipCounter=true bypasses the sidecar (test seam isolation)", () => {
    const root = mkRoot("narrow-counter-skip-seam");
    captureStderr({
      cwd: root,
      skipCounter: true,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([]),
    });
    expect(readCounterFile(root)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rc.6 TASK-021 (E3) — session-hints cache emit-gate
// ---------------------------------------------------------------------------

function readSessionHintsFile(
  projectRoot: string,
  sessionId: string,
): SessionHintsCache | null {
  const file = hook.sessionHintsCachePath(projectRoot, sessionId);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as SessionHintsCache;
}

describe("knowledge-hint-narrow.cjs — resolveSessionId (E3)", () => {
  beforeEach(() => {
    hook.resetSyntheticSessionId();
  });

  it("prefers payload.session_id when present", () => {
    const id = hook.resolveSessionId(
      { session_id: "from-payload" },
      { processEnv: { FABRIC_SESSION_ID: "from-env" } },
    );
    expect(id).toBe("from-payload");
  });

  it("falls back to env.FABRIC_SESSION_ID when payload has no session_id", () => {
    const id = hook.resolveSessionId(
      {},
      { processEnv: { FABRIC_SESSION_ID: "from-env" } },
    );
    expect(id).toBe("from-env");
  });

  it("synthesizes a UUID when neither payload nor env supplies an id", () => {
    const id = hook.resolveSessionId({}, { processEnv: {} });
    // Either a uuidv4 or the pid-time fallback — both are non-empty strings.
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("returns the same synthetic id across calls within a process lifetime", () => {
    const first = hook.resolveSessionId({}, { processEnv: {} });
    const second = hook.resolveSessionId({}, { processEnv: {} });
    expect(first).toBe(second);
  });

  it("regenerates the synthetic id after resetSyntheticSessionId()", () => {
    const first = hook.resolveSessionId({}, { processEnv: {} });
    hook.resetSyntheticSessionId();
    const second = hook.resolveSessionId({}, { processEnv: {} });
    expect(first).not.toBe(second);
  });

  it("ignores empty-string payload.session_id and falls through to env", () => {
    const id = hook.resolveSessionId(
      { session_id: "" },
      { processEnv: { FABRIC_SESSION_ID: "from-env" } },
    );
    expect(id).toBe("from-env");
  });

  it("ignores non-string payload.session_id (defensive)", () => {
    const id = hook.resolveSessionId(
      { session_id: 42 },
      { processEnv: { FABRIC_SESSION_ID: "from-env" } },
    );
    expect(id).toBe("from-env");
  });
});

describe("knowledge-hint-narrow.cjs — computeIndexHash (E3)", () => {
  it("returns empty string for empty narrow set", () => {
    expect(hook.computeIndexHash([])).toBe("");
  });

  it("returns stable hash for same id set in different order", () => {
    const a = hook.computeIndexHash([
      makeEntry("KT-DEC-0001", "decision", "proven", ""),
      makeEntry("KT-PIT-0002", "pitfall", "draft", ""),
    ]);
    const b = hook.computeIndexHash([
      makeEntry("KT-PIT-0002", "pitfall", "draft", ""),
      makeEntry("KT-DEC-0001", "decision", "proven", ""),
    ]);
    expect(a).toBe(b);
    expect(a.length).toBe(64); // sha256 hex
  });

  it("returns different hashes for different id sets", () => {
    const a = hook.computeIndexHash([
      makeEntry("KT-DEC-0001", "decision", "proven", ""),
    ]);
    const b = hook.computeIndexHash([
      makeEntry("KT-DEC-0002", "decision", "proven", ""),
    ]);
    expect(a).not.toBe(b);
  });

  it("returns empty string when all entries have empty ids", () => {
    expect(
      hook.computeIndexHash([makeEntry("", "decision", "proven", "")]),
    ).toBe("");
  });
});

describe("knowledge-hint-narrow.cjs — applyEmitGate (E3)", () => {
  it("renders fresh on null cache (no prior session state)", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const out = hook.applyEmitGate(null, narrow, ["src/foo.ts"], "rev-1");
    expect(out.render).toBe(true);
    expect(out.narrow).toEqual(narrow);
    expect(out.cache.revision_hash).toBe("rev-1");
    expect(out.cache.hinted_paths).toEqual(["src/foo.ts"]);
    expect(out.cache.hinted_stable_ids).toEqual(["KT-DEC-0001"]);
    expect(out.cache.last_emitted_index_hash.length).toBe(64);
  });

  it("renders + drops cache wholesale when revision_hash changes", () => {
    const stale: SessionHintsCache = {
      session_id: "sess-1",
      revision_hash: "rev-OLD",
      hinted_paths: ["src/foo.ts"],
      hinted_stable_ids: ["KT-DEC-0001"],
      last_emitted_index_hash: "stale-hash",
    };
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const out = hook.applyEmitGate(stale, narrow, ["src/foo.ts"], "rev-NEW");
    expect(out.render).toBe(true);
    // Wholesale drop: hinted_paths should NOT include the prior path beyond
    // the current request's contribution (which adds src/foo.ts back fresh).
    expect(out.cache.revision_hash).toBe("rev-NEW");
    expect(out.cache.hinted_paths).toEqual(["src/foo.ts"]);
    expect(out.cache.hinted_stable_ids).toEqual(["KT-DEC-0001"]);
  });

  it("skips emit when every target path is already in hinted_paths", () => {
    const cache: SessionHintsCache = {
      session_id: "sess-1",
      revision_hash: "rev-1",
      hinted_paths: ["src/foo.ts"],
      hinted_stable_ids: [],
      last_emitted_index_hash: "",
    };
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const out = hook.applyEmitGate(cache, narrow, ["src/foo.ts"], "rev-1");
    expect(out.render).toBe(false);
  });

  it("skips emit when current_index_hash matches last_emitted_index_hash", () => {
    const narrow = [
      makeEntry("KT-DEC-0001", "decision", "proven", "x"),
      makeEntry("KT-PIT-0002", "pitfall", "draft", "y"),
    ];
    const lastHash = hook.computeIndexHash(narrow);
    const cache: SessionHintsCache = {
      session_id: "sess-1",
      revision_hash: "rev-1",
      hinted_paths: [], // no path overlap → branch 2 must trigger via hash
      hinted_stable_ids: [],
      last_emitted_index_hash: lastHash,
    };
    const out = hook.applyEmitGate(cache, narrow, ["src/new.ts"], "rev-1");
    expect(out.render).toBe(false);
  });

  it("partial overlap: emits only entries whose stable_id is unseen", () => {
    const cache: SessionHintsCache = {
      session_id: "sess-1",
      revision_hash: "rev-1",
      hinted_paths: [],
      hinted_stable_ids: ["KT-DEC-0001", "KT-PIT-0002"],
      last_emitted_index_hash: "different-hash",
    };
    const narrow = [
      makeEntry("KT-DEC-0001", "decision", "proven", "old"),
      makeEntry("KT-PIT-0002", "pitfall", "draft", "old"),
      makeEntry("KT-DEC-0003", "decision", "proven", "new"),
    ];
    const out = hook.applyEmitGate(cache, narrow, ["src/bar.ts"], "rev-1");
    expect(out.render).toBe(true);
    expect(out.narrow.map((e) => e.id)).toEqual(["KT-DEC-0003"]);
    // Cache should accumulate the new id without dropping the old ones.
    expect(out.cache.hinted_stable_ids).toEqual([
      "KT-DEC-0001",
      "KT-PIT-0002",
      "KT-DEC-0003",
    ]);
  });

  it("skips when filtered narrow is empty (all stable_ids already hinted)", () => {
    const cache: SessionHintsCache = {
      session_id: "sess-1",
      revision_hash: "rev-1",
      hinted_paths: [],
      hinted_stable_ids: ["KT-DEC-0001"],
      last_emitted_index_hash: "different-hash",
    };
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const out = hook.applyEmitGate(cache, narrow, ["src/bar.ts"], "rev-1");
    expect(out.render).toBe(false);
  });
});

describe("knowledge-hint-narrow.cjs — read/write session hints cache (E3)", () => {
  it("readSessionHintsCache returns null when cache file is missing", () => {
    const root = mkRoot("narrow-cache-read-missing");
    expect(hook.readSessionHintsCache(root, "sess-x")).toBeNull();
  });

  it("write+read roundtrip preserves shape", () => {
    const root = mkRoot("narrow-cache-roundtrip");
    const cache: SessionHintsCache = {
      session_id: "sess-rt",
      revision_hash: "rev-rt",
      hinted_paths: ["src/a.ts", "src/b.ts"],
      hinted_stable_ids: ["KT-DEC-0001"],
      last_emitted_index_hash: "deadbeef",
    };
    hook.writeSessionHintsCache(root, cache);
    const out = hook.readSessionHintsCache(root, "sess-rt");
    expect(out).toEqual(cache);
  });

  it("readSessionHintsCache coerces partial / missing fields to safe defaults", () => {
    const root = mkRoot("narrow-cache-partial");
    const sessionId = "sess-partial";
    const file = hook.sessionHintsCachePath(root, sessionId);
    mkdirSync(join(root, hook.CONSTANTS.SESSION_HINTS_DIR_REL), {
      recursive: true,
    });
    // Write a partial cache that lacks several fields.
    writeFileToPath(file, JSON.stringify({ session_id: sessionId }));
    const out = hook.readSessionHintsCache(root, sessionId);
    expect(out).toEqual({
      session_id: sessionId,
      revision_hash: "",
      hinted_paths: [],
      hinted_stable_ids: [],
      last_emitted_index_hash: "",
    });
  });

  it("readSessionHintsCache returns null on malformed JSON (silent recovery)", () => {
    const root = mkRoot("narrow-cache-malformed");
    const sessionId = "sess-bad";
    const file = hook.sessionHintsCachePath(root, sessionId);
    mkdirSync(join(root, hook.CONSTANTS.SESSION_HINTS_DIR_REL), {
      recursive: true,
    });
    writeFileToPath(file, "{ not json");
    expect(hook.readSessionHintsCache(root, sessionId)).toBeNull();
  });

  it("writeSessionHintsCache silently swallows write failures", () => {
    expect(() =>
      hook.writeSessionHintsCache(
        "/nonexistent/path/that/cannot/be/created/by/any/process",
        {
          session_id: "x",
          revision_hash: "y",
          hinted_paths: [],
          hinted_stable_ids: [],
          last_emitted_index_hash: "",
        },
      ),
    ).not.toThrow();
  });
});

function writeFileToPath(path: string, content: string): void {
  // Avoid pulling in fs.writeFileSync at the top — keep the test file's
  // explicit import surface stable.
  require("node:fs").writeFileSync(path, content, "utf8");
}

describe("knowledge-hint-narrow.cjs — main (E3 emit gate end-to-end)", () => {
  it("first fire on fresh session emits + writes cache", () => {
    const root = mkRoot("narrow-e3-first-fire");
    const writes = captureStderr({
      cwd: root,
      payload: {
        session_id: "sess-e3-1",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(
        [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
        { revision_hash: "rev-1" },
      ),
    });
    expect(writes.join("")).toMatch(/KT-DEC-0001/);
    const cache = readSessionHintsFile(root, "sess-e3-1");
    expect(cache).not.toBeNull();
    expect(cache?.revision_hash).toBe("rev-1");
    expect(cache?.hinted_paths).toContain("src/foo.ts");
    expect(cache?.hinted_stable_ids).toContain("KT-DEC-0001");
  });

  it("second fire on same path is silent (cache hit by path)", () => {
    const root = mkRoot("narrow-e3-cache-hit-path");
    const cliPayload = makeCliPayload(
      [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
      { revision_hash: "rev-cache-hit" },
    );
    // First fire seeds the cache.
    captureStderr({
      cwd: root,
      payload: {
        session_id: "sess-hit",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: cliPayload,
    });
    // Second fire reads cache from disk → must stay silent.
    const writes = captureStderr({
      cwd: root,
      payload: {
        session_id: "sess-hit",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: cliPayload,
    });
    expect(writes).toEqual([]);
  });

  it("revision_hash change drops cache and re-emits", () => {
    const root = mkRoot("narrow-e3-revision-flip");
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    // Seed: prior revision rev-A.
    captureStderr({
      cwd: root,
      payload: {
        session_id: "sess-flip",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(narrow, { revision_hash: "rev-A" }),
    });
    // New fire with rev-B → must re-emit, wholesale drop prior cache.
    const writes = captureStderr({
      cwd: root,
      payload: {
        session_id: "sess-flip",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(narrow, { revision_hash: "rev-B" }),
    });
    expect(writes.join("")).toMatch(/KT-DEC-0001/);
    const cache = readSessionHintsFile(root, "sess-flip");
    expect(cache?.revision_hash).toBe("rev-B");
  });

  it("partial overlap: emits only new entries", () => {
    const root = mkRoot("narrow-e3-partial-overlap");
    // Seed cache with two known stable_ids.
    captureStderr({
      cwd: root,
      payload: {
        session_id: "sess-partial",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(
        [
          makeEntry("KT-DEC-0001", "decision", "proven", "a"),
          makeEntry("KT-PIT-0002", "pitfall", "draft", "b"),
        ],
        { revision_hash: "rev-partial" },
      ),
    });
    // Fire with 3 entries (2 known + 1 new) on a new path; expect ONE rendered.
    const writes = captureStderr({
      cwd: root,
      payload: {
        session_id: "sess-partial",
        tool_name: "Edit",
        tool_input: { file_path: "src/bar.ts" },
      },
      cliResult: makeCliPayload(
        [
          makeEntry("KT-DEC-0001", "decision", "proven", "a"),
          makeEntry("KT-PIT-0002", "pitfall", "draft", "b"),
          makeEntry("KT-DEC-0003", "decision", "proven", "c"),
        ],
        { revision_hash: "rev-partial" },
      ),
    });
    const stderr = writes.join("");
    // Only the new id should surface.
    expect(stderr).toMatch(/KT-DEC-0003/);
    expect(stderr).not.toMatch(/KT-DEC-0001/);
    expect(stderr).not.toMatch(/KT-PIT-0002/);
    // Banner reflects filtered count (1), not the raw narrow.length (3).
    expect(stderr).toMatch(/1 narrow-scoped knowledge entries/);
  });

  it("session_id fallback (env FABRIC_SESSION_ID)", () => {
    const root = mkRoot("narrow-e3-env-sessionid");
    const writes = captureStderr({
      cwd: root,
      processEnv: { FABRIC_SESSION_ID: "sess-from-env" },
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(
        [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
        { revision_hash: "rev-env" },
      ),
    });
    expect(writes.join("")).toMatch(/KT-DEC-0001/);
    // Cache file lands under the env-supplied session id.
    const cache = readSessionHintsFile(root, "sess-from-env");
    expect(cache).not.toBeNull();
    expect(cache?.revision_hash).toBe("rev-env");
  });

  it("session_id fallback (synthetic UUID) when payload + env both absent", () => {
    const root = mkRoot("narrow-e3-synth-sessionid");
    hook.resetSyntheticSessionId();
    const writes = captureStderr({
      cwd: root,
      processEnv: {}, // no FABRIC_SESSION_ID
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(
        [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
        { revision_hash: "rev-synth" },
      ),
    });
    expect(writes.join("")).toMatch(/KT-DEC-0001/);
    // Exactly one session-hints file written under .fabric/.cache/.
    const cacheDir = join(root, hook.CONSTANTS.SESSION_HINTS_DIR_REL);
    const files = require("node:fs")
      .readdirSync(cacheDir)
      .filter(
        (n: string) =>
          n.startsWith(hook.CONSTANTS.SESSION_HINTS_FILE_PREFIX) &&
          n.endsWith(hook.CONSTANTS.SESSION_HINTS_FILE_SUFFIX),
      );
    expect(files.length).toBe(1);
  });

  it("edit-counter sidecar still fires on cache-hit-silent path (E4 unchanged)", () => {
    // Regression guard: E3's emit-gate must not skip the E4 counter.
    const root = mkRoot("narrow-e3-counter-still-fires");
    const payload = {
      session_id: "sess-counter-still",
      tool_name: "Edit",
      tool_input: { file_path: "src/foo.ts" },
    };
    const cliPayload = makeCliPayload(
      [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
      { revision_hash: "rev-counter" },
    );
    captureStderr({ cwd: root, payload, cliResult: cliPayload });
    captureStderr({ cwd: root, payload, cliResult: cliPayload }); // silent
    const contents = readCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(2); // both fires recorded
  });

  it("env.skipCacheWrite=true bypasses persistence (test seam isolation)", () => {
    const root = mkRoot("narrow-e3-skip-cache-write");
    captureStderr({
      cwd: root,
      skipCacheWrite: true,
      payload: {
        session_id: "sess-skip",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(
        [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
        { revision_hash: "rev-skip" },
      ),
    });
    expect(readSessionHintsFile(root, "sess-skip")).toBeNull();
  });

  it("env.cacheSeed pre-loads cache without touching disk", () => {
    const root = mkRoot("narrow-e3-cacheseed");
    const seed: SessionHintsCache = {
      session_id: "sess-seed",
      revision_hash: "rev-seed",
      hinted_paths: ["src/foo.ts"],
      hinted_stable_ids: [],
      last_emitted_index_hash: "",
    };
    const writes = captureStderr({
      cwd: root,
      cacheSeed: seed,
      payload: {
        session_id: "sess-seed",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(
        [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
        { revision_hash: "rev-seed" },
      ),
    });
    // Path is already in cache → silent.
    expect(writes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// rc.6 TASK-023 (E6) — hint-silence-counter telemetry
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — appendHintSilenceCounter (E6)", () => {
  it("creates .fabric/.cache/ directory if missing and writes one ISO timestamp", () => {
    const root = mkRoot("narrow-silence-counter-mkdir");
    hook.appendHintSilenceCounter(root, new Date("2026-05-12T10:00:00.000Z"));
    const contents = readSilenceCounterFile(root);
    expect(contents).toBe("2026-05-12T10:00:00.000Z\n");
  });

  it("appends a second line on second call (counter grows monotonically)", () => {
    const root = mkRoot("narrow-silence-counter-append");
    hook.appendHintSilenceCounter(root, new Date("2026-05-12T10:00:00.000Z"));
    hook.appendHintSilenceCounter(root, new Date("2026-05-12T10:00:01.000Z"));
    const contents = readSilenceCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines).toEqual([
      "2026-05-12T10:00:00.000Z",
      "2026-05-12T10:00:01.000Z",
    ]);
  });

  it("silently swallows failures (best-effort write)", () => {
    expect(() =>
      hook.appendHintSilenceCounter(
        "/nonexistent/path/that/cannot/be/created/by/any/process",
        new Date(),
      ),
    ).not.toThrow();
  });
});

describe("knowledge-hint-narrow.cjs — main (E6 silence-counter sidecar)", () => {
  it("silence path (matched-narrow == 0) appends to hint-silence-counter", () => {
    const root = mkRoot("narrow-silence-empty-matches");
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:00.000Z"),
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([]),
    });
    const contents = readSilenceCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(1);
    expect(lines[0]).toBe("2026-05-12T10:00:00.000Z");
    // Edit-counter still fires too — symmetry with TASK-020 E4.
    const editLines =
      (readCounterFile(root) ?? "").split("\n").filter((l) => l.length > 0);
    expect(editLines.length).toBe(1);
  });

  it("emit path (matched-narrow > 0, fresh cache) does NOT append silence-counter", () => {
    const root = mkRoot("narrow-silence-emit-no-append");
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:00.000Z"),
      payload: {
        session_id: "sess-e6-emit",
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload(
        [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
        { revision_hash: "rev-emit" },
      ),
    });
    // Edit-counter fires; silence-counter does NOT (this fire produced an
    // emission, so it's not a silence).
    expect(readCounterFile(root)).not.toBeNull();
    expect(readSilenceCounterFile(root)).toBeNull();
  });

  it("emit-gate filtered-all path (matched but gate suppressed) appends to silence-counter", () => {
    const root = mkRoot("narrow-silence-gate-filtered");
    const payload = {
      session_id: "sess-e6-filtered",
      tool_name: "Edit",
      tool_input: { file_path: "src/foo.ts" },
    };
    const cliPayload = makeCliPayload(
      [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
      { revision_hash: "rev-filtered" },
    );
    // First fire emits + seeds cache.
    captureStderr({ cwd: root, payload, cliResult: cliPayload });
    // Second fire on same path: gate suppresses (allPathsKnown).
    captureStderr({
      cwd: root,
      now: new Date("2026-05-12T10:00:01.000Z"),
      payload,
      cliResult: cliPayload,
    });
    const silenceLines =
      (readSilenceCounterFile(root) ?? "").split("\n").filter((l) => l.length > 0);
    // Only the SECOND fire (gate-suppressed) appended; the first fire was
    // an emission so it must NOT have appended.
    expect(silenceLines.length).toBe(1);
    expect(silenceLines[0]).toBe("2026-05-12T10:00:01.000Z");
  });

  it("CLI returns null does NOT append silence-counter (pre-narrow short-circuit)", () => {
    // The hook bails before the narrow-check branch when the CLI is
    // unavailable. This is a "hook fired but cannot evaluate narrow" case,
    // not a "narrow matched zero" case — we leave silence-counter quiet
    // so the rate stays meaningful.
    const root = mkRoot("narrow-silence-cli-null");
    captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: null,
    });
    expect(readSilenceCounterFile(root)).toBeNull();
  });

  it("silence path creates .fabric/.cache/ directory if absent", () => {
    const root = mkRoot("narrow-silence-mkdir-on-fire");
    expect(existsSync(join(root, ".fabric", ".cache"))).toBe(false);
    captureStderr({
      cwd: root,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([]),
    });
    expect(existsSync(join(root, ".fabric", ".cache"))).toBe(true);
    expect(readSilenceCounterFile(root)).not.toBeNull();
  });

  it("env.skipSilenceCounter=true bypasses the sidecar (test seam isolation)", () => {
    const root = mkRoot("narrow-silence-skip-seam");
    captureStderr({
      cwd: root,
      skipSilenceCounter: true,
      payload: {
        tool_name: "Edit",
        tool_input: { file_path: "src/foo.ts" },
      },
      cliResult: makeCliPayload([]),
    });
    expect(readSilenceCounterFile(root)).toBeNull();
    // But edit-counter still fires (its own seam is independent).
    expect(readCounterFile(root)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// rc.18 TASK-005 — v1-receipt stance (protocol v2 cut).
//
// Stance proof: a CLI payload still carrying the legacy `version: 1` shape is
// silent-skipped (renderSummary returns []) AND emits exactly one stderr
// breadcrumb for operator visibility. A null payload returns [] silently with
// ZERO breadcrumb so the CLI-unavailable path stays quiet.
// ---------------------------------------------------------------------------

describe("knowledge-hint-narrow.cjs — v1-receipt stance (protocol v2 cut)", () => {
  it("returns [] and emits one stderr breadcrumb on version=1 payload", () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      });
    try {
      const lines = hook.renderSummary({
        version: 1,
        revision_hash: "rev-legacy",
        target_paths: ["**"],
        // legacy v1 wire field name — must NOT be read post-v2 cut.
        narrow: [makeEntry("KT-DEC-0001", "decision", "proven", "x")],
        broad_count: 1,
      } as unknown as CliPayload);
      expect(lines).toEqual([]);
      expect(writes.length).toBe(1);
      expect(writes[0]).toMatch(/version=1 unsupported \(expected 2\)/);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns [] and writes ZERO stderr on null payload (no spam)", () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      });
    try {
      // @ts-expect-error — exercising the null-payload silent-skip path
      const lines = hook.renderSummary(null);
      expect(lines).toEqual([]);
      expect(writes).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it("returns [] silently (no breadcrumb) on { version: 2 } with no entries", () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      });
    try {
      // @ts-expect-error — version-matches-but-entries-missing defensive path
      const lines = hook.renderSummary({ version: 2, revision_hash: "x" });
      expect(lines).toEqual([]);
      // Version matches → no breadcrumb (missing entries is a defensive
      // coercion to [], not a protocol drift).
      expect(writes).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

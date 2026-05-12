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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  version: 1;
  revision_hash: string;
  target_paths: string[];
  narrow: NarrowEntry[];
  broad_count: number;
};

type HookEnv = {
  cwd?: string;
  now?: Date;
  payload?: unknown;
  cliResult?: CliPayload | null;
  skipCounter?: boolean;
  stdin?: string;
};

type HookModule = {
  main: (env: HookEnv, stdio: { stderr: { write: (chunk: string) => void } }) => void;
  readPayload: (raw: string) => Record<string, unknown> | null;
  extractToolName: (payload: unknown) => string | null;
  extractToolInput: (payload: unknown) => Record<string, unknown> | null;
  extractPaths: (toolInput: unknown) => string[];
  appendEditCounter: (projectRoot: string, now: Date) => void;
  renderSummary: (payload: CliPayload) => string[];
  truncateSummary: (raw: string) => string;
  formatEntryLine: (entry: NarrowEntry) => string;
  CONSTANTS: {
    CLI_TIMEOUT_MS: number;
    SUMMARY_MAX_LEN: number;
    EDIT_COUNTER_DIR_REL: string;
    EDIT_COUNTER_FILE: string;
    EDIT_TOOL_NAMES: Set<string>;
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
    version: 1,
    revision_hash: opts.revision_hash ?? "rev-narrow-001",
    target_paths: ["**"],
    narrow,
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

describe("knowledge-hint-narrow.cjs — appendEditCounter (E4)", () => {
  it("creates .fabric/.cache/ directory if missing and writes one ISO timestamp", () => {
    const root = mkRoot("narrow-counter-mkdir");
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:00.000Z"));
    const contents = readCounterFile(root);
    expect(contents).toBe("2026-05-12T10:00:00.000Z\n");
  });

  it("appends a second line on second call (counter grows monotonically)", () => {
    const root = mkRoot("narrow-counter-append");
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:00.000Z"));
    hook.appendEditCounter(root, new Date("2026-05-12T10:00:01.000Z"));
    const contents = readCounterFile(root) ?? "";
    const lines = contents.split("\n").filter((l) => l.length > 0);
    expect(lines).toEqual([
      "2026-05-12T10:00:00.000Z",
      "2026-05-12T10:00:01.000Z",
    ]);
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
    expect(lines[0]).toBe("2026-05-12T10:00:00.000Z");
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

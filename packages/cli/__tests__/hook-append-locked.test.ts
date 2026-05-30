/**
 * W1-01 (ISS-011/012): every PreToolUse / Stop / SessionStart hook append to a
 * SHARED, non-session-scoped ledger/counter file must route through the
 * advisory-lock primitive `appendLockedLine` (templates/hooks/lib/injection-log.cjs)
 * rather than a bare appendFileSync. Under multi-window contention a bare append
 * can interleave a partial write and corrupt a line; the lock serializes writers
 * and drops the contended row (best-effort telemetry — matches injection-log).
 *
 * Deterministic test seam (mirrors injection-log.test.ts): place a FRESH
 * `<file>.lock` to simulate a concurrent holder, then drive the exported append
 * helper. If the site is lock-guarded the row is DROPPED (no corruption); a bare
 * appendFileSync would write through and append anyway.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

const injectionLog = require("../templates/hooks/lib/injection-log.cjs") as {
  appendLockedLine?: (path: string, line: string) => void;
};

const narrow = require("../templates/hooks/knowledge-hint-narrow.cjs") as {
  appendEditCounter: (projectRoot: string, now: Date, paths: string[]) => void;
  appendHintSilenceCounter: (projectRoot: string, now: Date) => void;
  appendEditIntentToLedger: (
    projectRoot: string,
    now: Date,
    paths: string[],
    toolName: string,
    sessionId: string | null,
  ) => void;
  CONSTANTS: {
    EDIT_COUNTER_DIR_REL: string;
    EDIT_COUNTER_FILE: string;
    HINT_SILENCE_COUNTER_DIR_REL: string;
    HINT_SILENCE_COUNTER_FILE: string;
    EVENTS_LEDGER_DIR_REL?: string;
    EVENTS_LEDGER_FILE: string;
  };
};

const tempDirs: string[] = [];
afterEach(() => {
  tempDirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "fabric-hooklock-"));
  tempDirs.push(d);
  return d;
}
function lineCount(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").split("\n").filter(Boolean).length;
}

describe("appendLockedLine is exported from injection-log.cjs (shared advisory-lock primitive)", () => {
  it("exports appendLockedLine", () => {
    expect(typeof injectionLog.appendLockedLine).toBe("function");
  });

  it("appends a line, drops under a fresh lock, reclaims a stale lock", () => {
    const root = tmp();
    const path = join(root, "ledger.jsonl");
    const append = injectionLog.appendLockedLine!;
    append(path, "a\n");
    expect(lineCount(path)).toBe(1);

    // fresh lock = concurrent holder → drop
    writeFileSync(`${path}.lock`, "");
    append(path, "b\n");
    expect(lineCount(path)).toBe(1);
    rmSync(`${path}.lock`, { force: true });

    append(path, "c\n");
    expect(lineCount(path)).toBe(2);
  });
});

describe("narrow PreToolUse hook append sites route through the advisory lock", () => {
  const C = narrow.CONSTANTS;

  it("appendEditCounter drops the row under a fresh lock (was a bare appendFileSync)", () => {
    const root = tmp();
    const dir = join(root, C.EDIT_COUNTER_DIR_REL);
    const file = join(dir, C.EDIT_COUNTER_FILE);
    mkdirSync(dir, { recursive: true });
    narrow.appendEditCounter(root, new Date(1), ["a.ts"]);
    expect(lineCount(file)).toBe(1);

    writeFileSync(`${file}.lock`, "");
    narrow.appendEditCounter(root, new Date(2), ["b.ts"]);
    expect(lineCount(file)).toBe(1); // contended → dropped, not interleaved
  });

  it("appendHintSilenceCounter drops the row under a fresh lock", () => {
    const root = tmp();
    const dir = join(root, C.HINT_SILENCE_COUNTER_DIR_REL);
    const file = join(dir, C.HINT_SILENCE_COUNTER_FILE);
    mkdirSync(dir, { recursive: true });
    narrow.appendHintSilenceCounter(root, new Date(1));
    expect(lineCount(file)).toBe(1);

    writeFileSync(`${file}.lock`, "");
    narrow.appendHintSilenceCounter(root, new Date(2));
    expect(lineCount(file)).toBe(1);
  });

  it("appendEditIntentToLedger drops the row under a fresh lock on events.jsonl", () => {
    const root = tmp();
    const fabricDir = join(root, ".fabric");
    mkdirSync(fabricDir, { recursive: true });
    const file = join(fabricDir, C.EVENTS_LEDGER_FILE);
    narrow.appendEditIntentToLedger(root, new Date(1), ["a.ts"], "Edit", "s1");
    expect(lineCount(file)).toBe(1);

    writeFileSync(`${file}.lock`, "");
    narrow.appendEditIntentToLedger(root, new Date(2), ["b.ts"], "Edit", "s1");
    expect(lineCount(file)).toBe(1);
  });
});

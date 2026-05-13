/**
 * Contract tests for templates/hooks/knowledge-hint-broad.cjs
 * (rc.6 TASK-019 / E1 — SessionStart broad-injection hook).
 *
 * Per signal-handler / fabric-hint test policy: in-process invocation only,
 * NO child_process.spawn in CI. We load the .cjs via createRequire so
 * Vitest's ESM resolver does not interfere. The hook's CLI invocation is
 * stubbed via the `env.payload` test seam — every test passes canned
 * plan-context-hint JSON instead of spawning the `fabric` binary.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hookPath = fileURLToPath(
  new URL("../templates/hooks/knowledge-hint-broad.cjs", import.meta.url),
);

type NarrowEntry = {
  id: string;
  type: string;
  maturity: string;
  summary: string;
};

type Payload = {
  version: 1;
  revision_hash: string;
  target_paths: string[];
  narrow: NarrowEntry[];
  broad_count: number;
};

type HookModule = {
  main: (
    env: { cwd?: string; payload?: Payload | null },
    stdio: { stderr: { write: (chunk: string) => void } },
  ) => void;
  renderSummary: (payload: Payload) => string[];
  renderFull: (narrow: NarrowEntry[]) => string[];
  renderTruncated: (narrow: NarrowEntry[]) => string[];
  truncateSummary: (raw: string) => string;
  groupEntries: (narrow: NarrowEntry[]) => {
    typeOrder: string[];
    byType: Map<string, Map<string, NarrowEntry[]>>;
  };
  // rc.7 T8 / T1 helpers exported for unit testing.
  readSessionStartLastHash: (projectRoot: string) => string | null;
  writeSessionStartLastHash: (projectRoot: string, hash: string) => void;
  isImportRequestedSentinelPresent: (projectRoot: string) => boolean;
  CONSTANTS: {
    TRUNCATION_THRESHOLD: number;
    SUMMARY_MAX_LEN: number;
    SESSIONSTART_HASH_CACHE_FILE: string;
  };
};

const hook = require(hookPath) as HookModule;

function makeEntry(
  id: string,
  type: string,
  maturity: string,
  summary: string,
): NarrowEntry {
  return { id, type, maturity, summary };
}

function makePayload(
  narrow: NarrowEntry[],
  opts: { revision_hash?: string; broad_count?: number } = {},
): Payload {
  return {
    version: 1,
    revision_hash: opts.revision_hash ?? "rev-abc123",
    target_paths: ["**"],
    narrow,
    broad_count: opts.broad_count ?? narrow.length,
  };
}

// ---------------------------------------------------------------------------
// truncateSummary
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — truncateSummary", () => {
  it("returns the input unchanged when shorter than SUMMARY_MAX_LEN", () => {
    expect(hook.truncateSummary("short summary")).toBe("short summary");
  });

  it("collapses internal whitespace runs and newlines to single spaces", () => {
    expect(hook.truncateSummary("line one\n  line two\t\tline three")).toBe(
      "line one line two line three",
    );
  });

  it("truncates with an ellipsis when over SUMMARY_MAX_LEN", () => {
    const max = hook.CONSTANTS.SUMMARY_MAX_LEN;
    const long = "x".repeat(max + 20);
    const out = hook.truncateSummary(long);
    expect(out.length).toBe(max);
    expect(out.endsWith("…")).toBe(true);
  });

  it("returns empty string on non-string input", () => {
    // @ts-expect-error — exercising defensive non-string path
    expect(hook.truncateSummary(undefined)).toBe("");
    // @ts-expect-error
    expect(hook.truncateSummary(null)).toBe("");
    // @ts-expect-error
    expect(hook.truncateSummary(42)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// groupEntries — canonical type order, encounter-order fallback
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — groupEntries", () => {
  it("orders types in canonical order regardless of input order", () => {
    const narrow = [
      makeEntry("a", "process", "proven", "p"),
      makeEntry("b", "decision", "proven", "d"),
      makeEntry("c", "guideline", "proven", "g"),
      makeEntry("d", "pitfall", "proven", "pi"),
    ];
    const { typeOrder } = hook.groupEntries(narrow);
    expect(typeOrder).toEqual(["decision", "pitfall", "guideline", "process"]);
  });

  it("appends unknown types after canonical types in encounter order", () => {
    const narrow = [
      makeEntry("a", "custom-x", "proven", "x"),
      makeEntry("b", "decision", "proven", "d"),
      makeEntry("c", "custom-y", "proven", "y"),
    ];
    const { typeOrder } = hook.groupEntries(narrow);
    expect(typeOrder).toEqual(["decision", "custom-x", "custom-y"]);
  });

  it("groups entries by type then by maturity bucket", () => {
    const narrow = [
      makeEntry("a", "decision", "proven", "p"),
      makeEntry("b", "decision", "draft", "d"),
      makeEntry("c", "decision", "proven", "p2"),
    ];
    const { byType } = hook.groupEntries(narrow);
    const dec = byType.get("decision");
    expect(dec).toBeDefined();
    expect(dec?.get("proven")?.length).toBe(2);
    expect(dec?.get("draft")?.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// renderSummary — empty / full / truncated modes
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — renderSummary (empty)", () => {
  it("returns [] (silent) when narrow is empty", () => {
    expect(hook.renderSummary(makePayload([]))).toEqual([]);
  });

  it("returns [] (silent) when payload.narrow is missing", () => {
    // @ts-expect-error — exercising defensive missing-field path
    expect(hook.renderSummary({ version: 1, revision_hash: "x" })).toEqual([]);
  });

  it("returns [] when payload is null", () => {
    // @ts-expect-error
    expect(hook.renderSummary(null)).toEqual([]);
  });
});

describe("knowledge-hint-broad.cjs — renderSummary (full mode, count <= 30)", () => {
  it("emits banner without (truncated) suffix when count <= 30", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const lines = hook.renderSummary(makePayload(narrow));
    expect(lines[0]).toMatch(/Session start — 1 broad-scoped knowledge entries available:/);
    expect(lines[0]).not.toMatch(/truncated/);
  });

  it("emits one full line per entry grouped by type and maturity", () => {
    const narrow = [
      makeEntry("KT-DEC-0001", "decision", "proven", "summary one"),
      makeEntry("KT-DEC-0002", "decision", "draft", "summary two"),
      makeEntry("KT-PIT-0001", "pitfall", "verified", "pitfall summary"),
    ];
    const lines = hook.renderSummary(makePayload(narrow));
    const body = lines.join("\n");
    expect(body).toMatch(/\[decision\] \(proven\):/);
    expect(body).toMatch(/- KT-DEC-0001 · summary one/);
    expect(body).toMatch(/\[decision\] \(draft\):/);
    expect(body).toMatch(/- KT-DEC-0002 · summary two/);
    expect(body).toMatch(/\[pitfall\] \(verified\):/);
    expect(body).toMatch(/- KT-PIT-0001 · pitfall summary/);
  });

  it("includes revision_hash line and `fab_get_knowledge_sections` footer", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const lines = hook.renderSummary(
      makePayload(narrow, { revision_hash: "abc999" }),
    );
    expect(lines.some((l) => l.includes("revision_hash: abc999"))).toBe(true);
    expect(
      lines.some((l) => l.includes("fab_get_knowledge_sections")),
    ).toBe(true);
  });

  it("renders exactly TRUNCATION_THRESHOLD entries in full mode", () => {
    const max = hook.CONSTANTS.TRUNCATION_THRESHOLD;
    const narrow = Array.from({ length: max }, (_, i) =>
      makeEntry(`KT-DEC-${1000 + i}`, "decision", "proven", `s${i}`),
    );
    const lines = hook.renderSummary(makePayload(narrow));
    expect(lines[0]).not.toMatch(/truncated/);
    // 1 banner + 1 group header + 30 entries + revision_hash + footer = 34
    const entryLines = lines.filter((l) => /^\s+- KT-DEC-/.test(l));
    expect(entryLines.length).toBe(max);
  });
});

describe("knowledge-hint-broad.cjs — renderSummary (truncated mode, count > 30)", () => {
  it("emits (truncated) banner when count > 30", () => {
    const max = hook.CONSTANTS.TRUNCATION_THRESHOLD;
    const narrow = Array.from({ length: max + 1 }, (_, i) =>
      makeEntry(`KT-DEC-${1000 + i}`, "decision", "proven", `s${i}`),
    );
    const lines = hook.renderSummary(makePayload(narrow));
    expect(lines[0]).toMatch(/truncated/);
  });

  it("renders proven entries with full lines, verified as inline id list, draft as count", () => {
    // 31 entries total — forces truncation. Per-type per-maturity mix:
    //   decision/proven  : 5 (full lines)
    //   decision/verified: 12 (inline id list)
    //   decision/draft   : 14 (count-only)
    const narrow: NarrowEntry[] = [];
    for (let i = 0; i < 5; i += 1) {
      narrow.push(makeEntry(`KT-DEC-P${i}`, "decision", "proven", `proven-${i}`));
    }
    for (let i = 0; i < 12; i += 1) {
      narrow.push(
        makeEntry(`KT-DEC-V${i}`, "decision", "verified", `verified-${i}`),
      );
    }
    for (let i = 0; i < 14; i += 1) {
      narrow.push(makeEntry(`KT-DEC-D${i}`, "decision", "draft", `draft-${i}`));
    }
    const lines = hook.renderSummary(makePayload(narrow));
    const body = lines.join("\n");

    // Proven: full per-line treatment
    expect(body).toMatch(/\[decision\] proven \(5\):/);
    expect(body).toMatch(/- KT-DEC-P0 · proven-0/);
    expect(body).toMatch(/- KT-DEC-P4 · proven-4/);

    // Verified: inline id list (no summary on the listing line)
    expect(body).toMatch(/\[decision\] verified \(12\): KT-DEC-V0, KT-DEC-V1/);
    expect(body).not.toMatch(/verified-0/); // summary should NOT appear

    // Draft: count-only
    expect(body).toMatch(/\[decision\] draft: 14 entries/);
    expect(body).not.toMatch(/draft-0/);
  });

  it("includes revision_hash and footer in truncated mode too", () => {
    const narrow = Array.from({ length: 35 }, (_, i) =>
      makeEntry(`KT-DEC-${i}`, "decision", "proven", `s${i}`),
    );
    const lines = hook.renderSummary(
      makePayload(narrow, { revision_hash: "rev-truncated" }),
    );
    expect(lines.some((l) => l.includes("revision_hash: rev-truncated"))).toBe(
      true,
    );
    expect(
      lines.some((l) => l.includes("fab_get_knowledge_sections")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// main — stderr integration via test seam (env.payload)
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — main", () => {
  // rc.7 T8: every main() invocation now writes a revision_hash sidecar
  // under cwd. Tests MUST use an isolated tmp cwd to avoid polluting the
  // project working tree.
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "knowledge-hint-broad-main-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function captureStderr(env: { payload?: Payload | null; cwd?: string }): string[] {
    const writes: string[] = [];
    const stderr = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, ...env }, { stderr });
    return writes;
  }

  it("writes nothing when payload is null (CLI unavailable path)", () => {
    expect(captureStderr({ payload: null })).toEqual([]);
  });

  it("writes nothing when narrow is empty", () => {
    expect(captureStderr({ payload: makePayload([]) })).toEqual([]);
  });

  it("writes rendered summary to stderr when narrow has entries", () => {
    const narrow = [
      makeEntry("KT-DEC-0001", "decision", "proven", "summary"),
    ];
    const writes = captureStderr({ payload: makePayload(narrow) });
    expect(writes.length).toBeGreaterThan(0);
    const stderr = writes.join("");
    expect(stderr).toMatch(/Session start — 1 broad-scoped/);
    expect(stderr).toMatch(/KT-DEC-0001/);
    expect(stderr).toMatch(/revision_hash:/);
    expect(stderr).toMatch(/fab_get_knowledge_sections/);
  });

  it("never throws on malformed payload (defensive try/catch)", () => {
    const writes: string[] = [];
    const stderr = { write: (chunk: string) => writes.push(chunk) };
    expect(() =>
      // @ts-expect-error — feeding garbage to exercise defensive path
      hook.main(
        { cwd: tempRoot, payload: { narrow: "not-an-array" } },
        { stderr },
      ),
    ).not.toThrow();
  });

  it("each stderr write ends with a newline (one line per write)", () => {
    const narrow = [
      makeEntry("KT-DEC-0001", "decision", "proven", "summary"),
    ];
    const writes = captureStderr({ payload: makePayload(narrow) });
    for (const chunk of writes) {
      expect(chunk.endsWith("\n")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// rc.7 T8 — SessionStart revision_hash gating (banner-blindness mitigation).
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — readSessionStartLastHash (rc.7 T8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-hash-cache-read-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns null when sidecar is absent", () => {
    expect(hook.readSessionStartLastHash(tempRoot)).toBeNull();
  });

  it("returns null when sidecar is empty", () => {
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    writeFileSync(join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash"), "", "utf8");
    expect(hook.readSessionStartLastHash(tempRoot)).toBeNull();
  });

  it("returns trimmed hash string when sidecar present", () => {
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash"),
      "  rev-abc123\n  ",
      "utf8",
    );
    expect(hook.readSessionStartLastHash(tempRoot)).toBe("rev-abc123");
  });
});

describe("knowledge-hint-broad.cjs — writeSessionStartLastHash (rc.7 T8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-hash-cache-write-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("creates .fabric/.cache/ if missing and writes the hash atomically", () => {
    hook.writeSessionStartLastHash(tempRoot, "rev-new-99");
    const p = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(existsSync(p)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("rev-new-99");
  });

  it("overwrites prior sidecar contents on second write", () => {
    hook.writeSessionStartLastHash(tempRoot, "rev-a");
    hook.writeSessionStartLastHash(tempRoot, "rev-b");
    const p = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(readFileSync(p, "utf8")).toBe("rev-b");
  });

  it("swallows errors on invalid input (empty/non-string hash) without throw", () => {
    expect(() => hook.writeSessionStartLastHash(tempRoot, "")).not.toThrow();
    // @ts-expect-error — defensive type-check path
    expect(() => hook.writeSessionStartLastHash(tempRoot, null)).not.toThrow();
    const p = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(existsSync(p)).toBe(false);
  });
});

describe("knowledge-hint-broad.cjs — main revision_hash gating (rc.7 T8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-gate-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function captureStderr(env: { payload?: Payload | null; cwd?: string }): string[] {
    const writes: string[] = [];
    const stderr = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, ...env }, { stderr });
    return writes;
  }

  it("first run: no cache → emits banner AND writes sidecar with current hash", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-aaa111" }),
    });
    expect(writes.length).toBeGreaterThan(0);
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(existsSync(sidecar)).toBe(true);
    expect(readFileSync(sidecar, "utf8")).toBe("rev-aaa111");
  });

  it("second run with unchanged hash: silent exit AND sidecar unchanged", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload = makePayload(narrow, { revision_hash: "rev-aaa111" });

    // Prime: first run emits + writes.
    captureStderr({ payload });
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    const firstWrite = readFileSync(sidecar, "utf8");

    // Second run with the SAME hash → silent exit.
    const writes2 = captureStderr({ payload });
    expect(writes2).toEqual([]);
    expect(readFileSync(sidecar, "utf8")).toBe(firstWrite);
  });

  it("third run with changed hash: emits banner AND updates sidecar", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];

    // Run 1: rev-a.
    captureStderr({ payload: makePayload(narrow, { revision_hash: "rev-a" }) });
    // Run 2: rev-a (silent).
    expect(
      captureStderr({ payload: makePayload(narrow, { revision_hash: "rev-a" }) }),
    ).toEqual([]);
    // Run 3: rev-b (canonical changed) → emit + update.
    const writes3 = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-b" }),
    });
    expect(writes3.length).toBeGreaterThan(0);
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(readFileSync(sidecar, "utf8")).toBe("rev-b");
  });

  it("empty revision_hash in payload bypasses gating (always emits, never updates sidecar)", () => {
    // No hash → no gating data → always emit, no sidecar update.
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "" }),
    });
    expect(writes.length).toBeGreaterThan(0);
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(existsSync(sidecar)).toBe(false);
  });

  it("empty narrow set + matching revision_hash → silent (no banner, no sidecar churn)", () => {
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    writeFileSync(sidecar, "rev-same", "utf8");

    const writes = captureStderr({
      payload: makePayload([], { revision_hash: "rev-same" }),
    });
    expect(writes).toEqual([]);
    // Cache should not change because gate short-circuited before write.
    expect(readFileSync(sidecar, "utf8")).toBe("rev-same");
  });
});

// ---------------------------------------------------------------------------
// rc.7 T1 — `.fabric/.import-requested` sentinel-override gate.
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — sentinel-override (rc.7 T1)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-sentinel-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function captureStderr(env: { payload?: Payload | null }): string[] {
    const writes: string[] = [];
    const stderr = { write: (chunk: string) => writes.push(chunk) };
    hook.main({ cwd: tempRoot, ...env }, { stderr });
    return writes;
  }

  function plantSentinel(root: string): void {
    mkdirSync(join(root, ".fabric"), { recursive: true });
    writeFileSync(join(root, ".fabric", ".import-requested"), "", "utf8");
  }

  it("isImportRequestedSentinelPresent reports false when sentinel missing", () => {
    expect(hook.isImportRequestedSentinelPresent(tempRoot)).toBe(false);
  });

  it("isImportRequestedSentinelPresent reports true when sentinel present", () => {
    plantSentinel(tempRoot);
    expect(hook.isImportRequestedSentinelPresent(tempRoot)).toBe(true);
  });

  it("sentinel present: appends import-recommendation banner to emitted lines", () => {
    plantSentinel(tempRoot);
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-x" }),
    });
    const stderr = writes.join("");
    expect(stderr).toMatch(/fabric-import|\/fabric-import/);
    expect(stderr).toMatch(/📋 Fabric:/);
  });

  it("sentinel present: bypasses revision_hash gate (emits even when cache matches)", () => {
    plantSentinel(tempRoot);
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    writeFileSync(sidecar, "rev-cached", "utf8");

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-cached" }),
    });
    // Cache match would normally silence — sentinel forces emission.
    expect(writes.length).toBeGreaterThan(0);
    const stderr = writes.join("");
    expect(stderr).toMatch(/fabric-import|\/fabric-import/);
  });

  it("sentinel present + empty narrow: still emits import banner (no broad summary needed)", () => {
    plantSentinel(tempRoot);
    const writes = captureStderr({
      payload: makePayload([], { revision_hash: "rev-empty" }),
    });
    expect(writes.length).toBeGreaterThan(0);
    const stderr = writes.join("");
    expect(stderr).toMatch(/fabric-import|\/fabric-import/);
  });

  it("sentinel present: does NOT update sidecar (so next non-sentinel boot sees prior hash)", () => {
    plantSentinel(tempRoot);
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-while-sentinel" }),
    });
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(existsSync(sidecar)).toBe(false);
  });
});

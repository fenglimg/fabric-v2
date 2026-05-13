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
  // rc.7 T8 helpers exported for unit testing.
  readSessionStartLastHash: (projectRoot: string) => string | null;
  writeSessionStartLastHash: (projectRoot: string, hash: string) => void;
  // rc.8 underseed self-check helpers exported for unit testing.
  countCanonicalNodes: (projectRoot: string) => number;
  readUnderseedThreshold: (projectRoot: string) => number;
  isImportTouched: (
    projectRoot: string,
  ) => "absent" | "in_progress" | "complete" | "error";
  shouldRecommendImport: (projectRoot: string) => boolean;
  CONSTANTS: {
    TRUNCATION_THRESHOLD: number;
    SUMMARY_MAX_LEN: number;
    SESSIONSTART_HASH_CACHE_FILE: string;
    DEFAULT_UNDERSEED_NODE_THRESHOLD: number;
    KNOWLEDGE_CANONICAL_TYPES: string[];
    IMPORT_RECOMMENDATION_BANNER: string;
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
// rc.8 — underseed self-check helpers (countCanonicalNodes /
// readUnderseedThreshold / isImportTouched / shouldRecommendImport).
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — countCanonicalNodes (rc.8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-count-canonical-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns 0 when .fabric/knowledge/ is missing", () => {
    expect(hook.countCanonicalNodes(tempRoot)).toBe(0);
  });

  it("counts only .md files across the five canonical type subdirs", () => {
    for (const type of hook.CONSTANTS.KNOWLEDGE_CANONICAL_TYPES) {
      mkdirSync(join(tempRoot, ".fabric", "knowledge", type), { recursive: true });
    }
    writeFileSync(
      join(tempRoot, ".fabric", "knowledge", "decisions", "a.md"),
      "x",
      "utf8",
    );
    writeFileSync(
      join(tempRoot, ".fabric", "knowledge", "decisions", "b.md"),
      "x",
      "utf8",
    );
    writeFileSync(
      join(tempRoot, ".fabric", "knowledge", "pitfalls", "c.md"),
      "x",
      "utf8",
    );
    // non-md: should be ignored
    writeFileSync(
      join(tempRoot, ".fabric", "knowledge", "guidelines", "ignore.txt"),
      "x",
      "utf8",
    );
    expect(hook.countCanonicalNodes(tempRoot)).toBe(3);
  });
});

describe("knowledge-hint-broad.cjs — readUnderseedThreshold (rc.8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-read-threshold-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns DEFAULT (10) when fabric-config.json is missing", () => {
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(
      hook.CONSTANTS.DEFAULT_UNDERSEED_NODE_THRESHOLD,
    );
  });

  it("returns the override when fabric-config.json carries underseed_node_threshold", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ underseed_node_threshold: 25 }),
      "utf8",
    );
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(25);
  });

  it("returns DEFAULT on malformed config JSON (defensive parse)", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      "not-json{{",
      "utf8",
    );
    expect(hook.readUnderseedThreshold(tempRoot)).toBe(
      hook.CONSTANTS.DEFAULT_UNDERSEED_NODE_THRESHOLD,
    );
  });
});

describe("knowledge-hint-broad.cjs — isImportTouched (rc.8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-import-touched-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  it("returns 'absent' when .import-state.json is missing", () => {
    expect(hook.isImportTouched(tempRoot)).toBe("absent");
  });

  it("returns 'complete' when phase === 'complete'", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: "complete" }),
      "utf8",
    );
    expect(hook.isImportTouched(tempRoot)).toBe("complete");
  });

  it("returns 'in_progress' for any non-complete phase value", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: "P1-done" }),
      "utf8",
    );
    expect(hook.isImportTouched(tempRoot)).toBe("in_progress");

    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: "P2-done" }),
      "utf8",
    );
    expect(hook.isImportTouched(tempRoot)).toBe("in_progress");

    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: 1 }),
      "utf8",
    );
    expect(hook.isImportTouched(tempRoot)).toBe("in_progress");
  });

  it("returns 'error' on unparseable JSON", () => {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      "not-json{{",
      "utf8",
    );
    expect(hook.isImportTouched(tempRoot)).toBe("error");
  });
});

describe("knowledge-hint-broad.cjs — shouldRecommendImport (rc.8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-should-recommend-"));
  });

  afterEach(() => {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function plantMeta(): void {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "agents.meta.json"),
      JSON.stringify({}),
      "utf8",
    );
  }

  function plantCanonical(count: number): void {
    mkdirSync(join(tempRoot, ".fabric", "knowledge", "decisions"), {
      recursive: true,
    });
    for (let i = 0; i < count; i += 1) {
      writeFileSync(
        join(tempRoot, ".fabric", "knowledge", "decisions", `e${i}.md`),
        "x",
        "utf8",
      );
    }
  }

  it("returns false when agents.meta.json is missing (workspace not init'd)", () => {
    plantCanonical(2); // sparse but no meta — no recommendation
    expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
  });

  it("returns true when canonical < threshold AND .import-state.json absent (the target case)", () => {
    plantMeta();
    plantCanonical(3);
    expect(hook.shouldRecommendImport(tempRoot)).toBe(true);
  });

  it("returns false when canonical >= threshold (knowledge graph already seeded)", () => {
    plantMeta();
    plantCanonical(15);
    expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
  });

  it("returns false when import-state.json phase === 'complete' (user already imported)", () => {
    plantMeta();
    plantCanonical(2);
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: "complete" }),
      "utf8",
    );
    expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
  });

  it("returns false when import-state.json phase is in-progress (user actively importing)", () => {
    plantMeta();
    plantCanonical(2);
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: "P1-done" }),
      "utf8",
    );
    expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
  });

  it("respects fabric-config.json underseed_node_threshold override", () => {
    plantMeta();
    plantCanonical(15);
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ underseed_node_threshold: 50 }),
      "utf8",
    );
    // 15 < 50 → recommend
    expect(hook.shouldRecommendImport(tempRoot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rc.8 — main() integration: import-recommendation banner + hash-gate bypass.
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — main underseed banner integration (rc.8)", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-underseed-main-"));
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

  function plantMeta(): void {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "agents.meta.json"),
      JSON.stringify({}),
      "utf8",
    );
  }

  function plantCanonical(count: number): void {
    mkdirSync(join(tempRoot, ".fabric", "knowledge", "decisions"), {
      recursive: true,
    });
    for (let i = 0; i < count; i += 1) {
      writeFileSync(
        join(tempRoot, ".fabric", "knowledge", "decisions", `e${i}.md`),
        "x",
        "utf8",
      );
    }
  }

  it("canonical=3 < 10 + no import-state → emits import banner alongside summary", () => {
    plantMeta();
    plantCanonical(3);

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-fresh" }),
    });
    const stderr = writes.join("");
    expect(stderr).toMatch(/📋 Fabric:/);
    expect(stderr).toMatch(/\/fabric-import/);
    // broad summary body still present (first run, no cache)
    expect(stderr).toMatch(/Session start — 1 broad-scoped/);
  });

  it("canonical=15 >= 10 → NO import banner emitted", () => {
    plantMeta();
    plantCanonical(15);

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-seeded" }),
    });
    const stderr = writes.join("");
    expect(stderr).not.toMatch(/📋 Fabric:/);
    expect(stderr).not.toMatch(/\/fabric-import/);
  });

  it("import-state.json phase='complete' → NO import banner emitted", () => {
    plantMeta();
    plantCanonical(2);
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: "complete" }),
      "utf8",
    );

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-done" }),
    });
    const stderr = writes.join("");
    expect(stderr).not.toMatch(/📋 Fabric:/);
    expect(stderr).not.toMatch(/\/fabric-import/);
  });

  it("import-state.json phase='P1-done' (in-progress) → NO import banner emitted", () => {
    plantMeta();
    plantCanonical(2);
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase: "P1-done" }),
      "utf8",
    );

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-mid" }),
    });
    const stderr = writes.join("");
    expect(stderr).not.toMatch(/📋 Fabric:/);
    expect(stderr).not.toMatch(/\/fabric-import/);
  });

  it("hash unchanged + should-recommend → banner STILL emitted (gate-bypass for banner)", () => {
    plantMeta();
    plantCanonical(2);

    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    writeFileSync(sidecar, "rev-same", "utf8");

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-same" }),
    });
    const stderr = writes.join("");
    // Banner emitted despite cached-hash match
    expect(stderr).toMatch(/📋 Fabric:/);
    expect(stderr).toMatch(/\/fabric-import/);
  });

  it("hash unchanged + should-recommend → broad-summary BODY is NOT re-emitted (regression guard)", () => {
    // Critical regression test: the gate-bypass for the import banner must
    // NOT also re-emit the full broad-summary body. The body remains
    // hash-gated; only the banner line goes out.
    plantMeta();
    plantCanonical(2);

    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    writeFileSync(sidecar, "rev-same", "utf8");

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "summary-text")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-same" }),
    });
    const stderr = writes.join("");

    // Banner is present
    expect(stderr).toMatch(/📋 Fabric:/);
    // But the broad-summary body lines are NOT
    expect(stderr).not.toMatch(/Session start — 1 broad-scoped/);
    expect(stderr).not.toMatch(/KT-DEC-0001/);
    expect(stderr).not.toMatch(/fab_get_knowledge_sections/);
    // And the sidecar was NOT bumped (body suppressed → no hash update)
    expect(readFileSync(sidecar, "utf8")).toBe("rev-same");
  });

  it("hash unchanged + should-NOT-recommend → silent (no banner, no body, no churn)", () => {
    plantMeta();
    plantCanonical(15); // above threshold → no recommendation

    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    mkdirSync(join(tempRoot, ".fabric", ".cache"), { recursive: true });
    writeFileSync(sidecar, "rev-same", "utf8");

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-same" }),
    });
    expect(writes).toEqual([]);
    expect(readFileSync(sidecar, "utf8")).toBe("rev-same");
  });

  it("first run + should-recommend → emits both body and banner; updates sidecar", () => {
    plantMeta();
    plantCanonical(3);

    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const writes = captureStderr({
      payload: makePayload(narrow, { revision_hash: "rev-fresh-1" }),
    });
    const stderr = writes.join("");
    // Both body and banner are emitted on first run
    expect(stderr).toMatch(/Session start — 1 broad-scoped/);
    expect(stderr).toMatch(/📋 Fabric:/);
    // Sidecar is bumped (body went out → hash update follows)
    const sidecar = join(tempRoot, ".fabric", ".cache", "sessionstart-last-hash");
    expect(readFileSync(sidecar, "utf8")).toBe("rev-fresh-1");
  });
});

// ---------------------------------------------------------------------------
// rc.8 — sentinel mechanism removal (regression guard).
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — sentinel surface fully removed (rc.8)", () => {
  it("does NOT export isImportRequestedSentinelPresent or any sentinel constant", () => {
    const exported = hook as unknown as Record<string, unknown>;
    expect(exported.isImportRequestedSentinelPresent).toBeUndefined();
    expect((exported.CONSTANTS as Record<string, unknown>).IMPORT_REQUESTED_SENTINEL_FILE).toBeUndefined();
  });

  it("hook source contains no IMPORT_REQUESTED_SENTINEL_FILE / isImportRequestedSentinelPresent identifiers", () => {
    const src = readFileSync(hookPath, "utf8");
    expect(src).not.toMatch(/IMPORT_REQUESTED_SENTINEL_FILE/);
    expect(src).not.toMatch(/isImportRequestedSentinelPresent/);
    // A reference to the legacy filename is allowed ONLY in the retirement
    // comment — assert there is no live `existsSync(".../.import-requested")`
    // probe or sentinel-keyed branch left in code.
    expect(src).not.toMatch(/existsSync\([^)]*\.import-requested/);
    expect(src).not.toMatch(/sentinelPresent/);
  });
});

describe("knowledge-hint-broad.cjs — fabric-import SKILL.md sentinel cleanup (rc.8)", () => {
  it("Phase 0 'Sentinel Contract' section is removed; Phase 3.4 sentinel-clear step is removed", () => {
    const skillPath = fileURLToPath(
      new URL(
        "../templates/skills/fabric-import/SKILL.md",
        import.meta.url,
      ),
    );
    const md = readFileSync(skillPath, "utf8");
    expect(md).not.toMatch(/### Phase 0 — Sentinel Contract/);
    expect(md).not.toMatch(/rc\.7 T1 sentinel clear/);
    // The retirement note SHOULD be present
    expect(md).toMatch(/sentinel 机制已下线/);
  });
});

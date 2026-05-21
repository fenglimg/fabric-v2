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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
  version: 2;
  revision_hash: string;
  target_paths: string[];
  entries: NarrowEntry[];
  broad_count: number;
  // rc.22 Scope D T-D4 (TASK-011): additive optional auto-heal fields. Server
  // emits these ONLY when planContext() detected meta drift and rebuilt the
  // meta in-place; steady-state payloads omit both.
  auto_healed?: boolean;
  previous_revision_hash?: string;
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
    version: 2,
    revision_hash: opts.revision_hash ?? "rev-abc123",
    target_paths: ["**"],
    entries: narrow,
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

  it("returns [] (silent) when payload.entries is missing", () => {
    // @ts-expect-error — exercising defensive missing-field path
    expect(hook.renderSummary({ version: 2, revision_hash: "x" })).toEqual([]);
  });

  it("returns [] when payload is null", () => {
    // @ts-expect-error
    expect(hook.renderSummary(null)).toEqual([]);
  });
});

// v2.0.0-rc.29 TASK-007 (BUG-F1): TRUNCATION_THRESHOLD lowered from 30 → 12.
// Test groups below reference TRUNCATION_THRESHOLD via hook.CONSTANTS so the
// describe titles intentionally describe the BEHAVIOR ("<= threshold") rather
// than a magic-number cutoff.
describe("knowledge-hint-broad.cjs — renderSummary (full mode, count <= TRUNCATION_THRESHOLD)", () => {
  it("emits banner without (truncated) suffix when count <= TRUNCATION_THRESHOLD", () => {
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
    // 1 banner + 1 group header + max entries + revision_hash + footer.
    const entryLines = lines.filter((l) => /^\s+- KT-DEC-/.test(l));
    expect(entryLines.length).toBe(max);
  });
});

describe("knowledge-hint-broad.cjs — renderSummary (truncated mode, count > TRUNCATION_THRESHOLD)", () => {
  it("emits (truncated) banner when count > TRUNCATION_THRESHOLD", () => {
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
// rc.22 Scope D T-D4 (TASK-011) — meta auto-refresh banner line.
//
// When the server's planContext() detects meta drift and rebuilds the meta
// in-place, the plan-context-hint payload carries `auto_healed: true` plus
// (optionally) `previous_revision_hash`. The hook renderer surfaces ONE
// additional informational line in renderSummary's output, positioned
// BETWEEN the `revision_hash:` line and the `fab_get_knowledge_sections`
// usage-hint footer. Tests below pin that contract.
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — renderSummary auto-heal banner (rc.22 T-D4)", () => {
  // Helpers to assert line ordering — order matters: revision_hash MUST
  // appear before the auto-heal line, and the auto-heal line MUST appear
  // before the fab_get_knowledge_sections footer.
  function indexOf(lines: string[], needle: string): number {
    return lines.findIndex((l) => l.includes(needle));
  }

  it("does NOT emit auto-refresh line when auto_healed is absent", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const lines = hook.renderSummary(makePayload(narrow));
    const body = lines.join("\n");
    expect(body).not.toMatch(/auto-refreshed/);
    expect(body).not.toMatch(/元数据已自动刷新/);
    expect(body).not.toMatch(/🔄 Fabric:/);
  });

  it("does NOT emit auto-refresh line when auto_healed is explicitly false", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload = makePayload(narrow);
    (payload as Payload).auto_healed = false;
    const lines = hook.renderSummary(payload);
    expect(lines.join("\n")).not.toMatch(/🔄 Fabric:/);
  });

  it("emits ONE auto-refresh line with 8-char hash prefixes when both hashes present", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload: Payload = {
      ...makePayload(narrow, {
        revision_hash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
      auto_healed: true,
      previous_revision_hash:
        "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210",
    };
    const lines = hook.renderSummary(payload);
    const matches = lines.filter((l) => l.includes("🔄 Fabric:"));
    // Exactly ONE auto-heal line emitted (not multiple).
    expect(matches.length).toBe(1);
    const line = matches[0];
    // Default fabric_language unset in cwd → zh-CN per back-compat default.
    // Both en + zh-CN templates carry "sha PREV → CUR" with 8-char prefixes.
    expect(line).toMatch(/sha fedcba98 → 01234567/);
    // Ensure the full 64-char hash did NOT leak in.
    expect(line).not.toMatch(/0123456789abcdef0/);
    expect(line).not.toMatch(/fedcba98765/);
  });

  it("positions auto-refresh line BETWEEN revision_hash and the usage-hint footer", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload: Payload = {
      ...makePayload(narrow, { revision_hash: "sha256:aabbccddeeff00112233" }),
      auto_healed: true,
      previous_revision_hash: "sha256:99887766554433221100",
    };
    const lines = hook.renderSummary(payload);
    const idxRev = indexOf(lines, "revision_hash:");
    const idxHeal = indexOf(lines, "🔄 Fabric:");
    const idxFooter = indexOf(lines, "fab_get_knowledge_sections");
    expect(idxRev).toBeGreaterThanOrEqual(0);
    expect(idxHeal).toBeGreaterThan(idxRev);
    expect(idxFooter).toBeGreaterThan(idxHeal);
  });

  it("falls back to generic line (no hash transition) when previous_revision_hash is missing", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload: Payload = {
      ...makePayload(narrow, { revision_hash: "sha256:aabbccddeeff" }),
      auto_healed: true,
      // previous_revision_hash intentionally omitted (defensive T10 edge case).
    };
    const lines = hook.renderSummary(payload);
    const heals = lines.filter((l) => l.includes("🔄 Fabric:"));
    expect(heals.length).toBe(1);
    // Generic variant must NOT include a sha transition.
    expect(heals[0]).not.toMatch(/sha /);
    expect(heals[0]).not.toMatch(/→/);
  });

  it("handles revision_hash WITHOUT the `sha256:` scheme prefix (defensive)", () => {
    // Older / synthesized payloads may carry raw hex without the scheme prefix.
    // The renderer should still produce 8-char prefixes (just slicing from the
    // start of the string).
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload: Payload = {
      ...makePayload(narrow, { revision_hash: "0123456789abcdef0123" }),
      auto_healed: true,
      previous_revision_hash: "fedcba9876543210fedc",
    };
    const lines = hook.renderSummary(payload);
    const heals = lines.filter((l) => l.includes("🔄 Fabric:"));
    expect(heals.length).toBe(1);
    expect(heals[0]).toMatch(/sha fedcba98 → 01234567/);
  });

  it("preserves the substring contracts of existing tests (📋, revision_hash, fab_get_knowledge_sections)", () => {
    // Adding the auto-heal line MUST NOT disturb the existing substring
    // assertions other tests pin against. This guards against accidental
    // reordering that would break the main() integration tests below.
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload: Payload = {
      ...makePayload(narrow, { revision_hash: "sha256:deadbeefcafebabe" }),
      auto_healed: true,
      previous_revision_hash: "sha256:1234567890abcdef",
    };
    const lines = hook.renderSummary(payload);
    const body = lines.join("\n");
    expect(body).toMatch(/Session start — 1 broad-scoped/);
    expect(body).toMatch(/revision_hash: sha256:deadbeefcafebabe/);
    expect(body).toMatch(/fab_get_knowledge_sections/);
  });
});

// ---------------------------------------------------------------------------
// rc.22 Scope D T-D4 (TASK-011) — auto-heal banner i18n variant resolution.
// We plant a .fabric/fabric-config.json with fabric_language=en (resp. zh-CN)
// in an isolated tmp cwd and use the `chdir`-via-tempRoot helper to prove
// that the renderSummary auto-heal line picks up the locale.
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — auto-heal banner i18n variants (rc.22 T-D4)", () => {
  let tempRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempRoot = mkdtempSync(join(tmpdir(), "broad-autoheal-i18n-"));
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    // chdir so renderSummary's process.cwd() picks up the planted config.
    process.chdir(tempRoot);
  });

  afterEach(() => {
    try {
      process.chdir(originalCwd);
    } catch {
      // best-effort
    }
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function plantLanguage(lang: string): void {
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ fabric_language: lang }),
      "utf8",
    );
  }

  it("renders English copy when fabric_language=en", () => {
    plantLanguage("en");
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload: Payload = {
      ...makePayload(narrow, { revision_hash: "sha256:aaaaaaaa11112222" }),
      auto_healed: true,
      previous_revision_hash: "sha256:bbbbbbbb33334444",
    };
    const lines = hook.renderSummary(payload);
    const heal = lines.find((l) => l.includes("🔄 Fabric:"));
    expect(heal).toBeDefined();
    expect(heal!).toContain("meta auto-refreshed");
    // No Chinese characters in en variant.
    expect(heal!).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it("renders Chinese copy when fabric_language=zh-CN", () => {
    plantLanguage("zh-CN");
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const payload: Payload = {
      ...makePayload(narrow, { revision_hash: "sha256:aaaaaaaa11112222" }),
      auto_healed: true,
      previous_revision_hash: "sha256:bbbbbbbb33334444",
    };
    const lines = hook.renderSummary(payload);
    const heal = lines.find((l) => l.includes("🔄 Fabric:"));
    expect(heal).toBeDefined();
    expect(heal!).toContain("元数据已自动刷新");
    // 8-char hex prefixes survive in both variants.
    expect(heal!).toContain("bbbbbbbb");
    expect(heal!).toContain("aaaaaaaa");
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
// rc.8 — main() integration: import-recommendation banner emission.
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

// ---------------------------------------------------------------------------
// rc.18 TASK-005 — v1-receipt stance (protocol v2 cut).
//
// Stance proof: a payload still carrying the legacy `version: 1` shape is
// silent-skipped (returns []) AND emits exactly one stderr breadcrumb so
// operators grepping a stuck-banner report can diagnose the version drift
// without source-diving. A null payload returns [] silently with ZERO
// breadcrumb (no spam on the CLI-unavailable path).
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — v1-receipt stance (protocol v2 cut)", () => {
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
      } as unknown as Parameters<typeof hook.renderSummary>[0]);
      expect(lines).toEqual([]);
      // Exactly one breadcrumb fired, with the canonical wording.
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

  it("returns [] silently (no breadcrumb) when version matches but entries is missing", () => {
    const writes: string[] = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === "string" ? chunk : chunk.toString());
        return true;
      });
    try {
      // @ts-expect-error — version-matches-but-shape-incomplete defensive path
      const lines = hook.renderSummary({ version: 2, revision_hash: "x" });
      expect(lines).toEqual([]);
      // Version matches → no breadcrumb (the missing `entries` is a
      // defensive coercion to [], not a protocol drift).
      expect(writes).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

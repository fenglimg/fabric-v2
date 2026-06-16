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
  // lifecycle-refactor W3-T2 (§7 图谱消费): graph-edge provenance for entries
  // pulled in via a surfaced entry's `related` edge. Optional.
  related_to?: string;
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

function writeProjectConfig(root: string, projectId: string): void {
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify({ project_id: projectId, fabric_language: "en" }),
    "utf8",
  );
}

function writeBindingsSnapshot(
  home: string,
  projectId: string,
  knowledgeStats?: Record<string, unknown>,
): void {
  mkdirSync(join(home, ".fabric", "state", "bindings"), { recursive: true });
  writeFileSync(
    join(home, ".fabric", "state", "bindings", `${projectId}_resolved.json`),
    JSON.stringify({
      version: 1,
      project_id: projectId,
      generated_at: "2026-05-30T00:00:00.000Z",
      read_set: { stores: [] },
      write_target: null,
      ...(knowledgeStats === undefined
        ? {}
        : { knowledge_stats: knowledgeStats }),
    }),
    "utf8",
  );
}

function withIsolatedFabricHome<T>(fn: (home: string) => T): T {
  const home = mkdtempSync(join(tmpdir(), "knowledge-hint-broad-home-"));
  const prevHome = process.env.FABRIC_HOME;
  process.env.FABRIC_HOME = home;
  try {
    return fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.FABRIC_HOME;
    else process.env.FABRIC_HOME = prevHome;
    rmSync(home, { recursive: true, force: true });
  }
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

  it("includes revision_hash line and the single-step `fab_recall` footer (W2-4)", () => {
    const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
    const lines = hook.renderSummary(
      makePayload(narrow, { revision_hash: "abc999" }),
    );
    expect(lines.some((l) => l.includes("revision_hash: abc999"))).toBe(true);
    // W2-4 (KT-DEC-0026): two-step footer retired — single lean fab_recall flow.
    expect(lines.some((l) => l.includes("fab_recall(paths)"))).toBe(true);
    expect(lines.some((l) => l.includes("fab_get_knowledge_sections"))).toBe(false);
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

// v2.2 HK2-degrade (W2-T2): SessionStart injection budget ladder. With a tight
// char budget the rendered body collapses its tail into a single marker, while
// the structural lines (banner / revision_hash / footer) always survive.
describe("knowledge-hint-broad.cjs — HK2 injection budget ladder (W2-T2)", () => {
  it("collapses the body tail into a marker once the char budget is exceeded", () => {
    const narrow = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`KT-DEC-${1000 + i}`, "decision", "proven", `summary number ${i} with some length`),
    );
    // Tiny budget forces a cap after only a couple of body lines.
    const lines = hook.renderSummary(makePayload(narrow, { revision_hash: "budget-rev" }), 80, 120);

    // Banner + revision_hash + footer survive regardless of budget.
    expect(lines[0]).toMatch(/Session start/);
    expect(lines.some((l) => l.includes("revision_hash: budget-rev"))).toBe(true);
    expect(lines.some((l) => l.includes("fab_recall(paths)"))).toBe(true);
    // The overflow marker is present and reports the remaining count.
    expect(lines.some((l) => /more entr(y|ies) omitted \(injection budget 120 chars/.test(l))).toBe(true);
    // Far fewer than 10 entry lines survived under the 120-char body budget.
    const entryLines = lines.filter((l) => /^\s+- KT-DEC-/.test(l));
    expect(entryLines.length).toBeLessThan(10);
  });

  it("is a no-op when budgetChars is 0 or omitted (backward compatible)", () => {
    const narrow = Array.from({ length: 6 }, (_, i) =>
      makeEntry(`KT-DEC-${2000 + i}`, "decision", "proven", `s${i}`),
    );
    const capped = hook.renderSummary(makePayload(narrow), 80, 0);
    const uncapped = hook.renderSummary(makePayload(narrow), 80);
    // 0 budget disables the ladder → identical to no-budget rendering, and no
    // overflow marker appears.
    expect(capped).toEqual(uncapped);
    expect(capped.some((l) => /omitted \(injection budget/.test(l))).toBe(false);
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
    expect(lines.some((l) => l.includes("fab_recall(paths)"))).toBe(true);
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
    const idxFooter = indexOf(lines, "Load full content");
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
    expect(body).toMatch(/fab_recall\(paths\)/);
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

  function captureStderr(env: {
    payload?: Payload | null;
    cwd?: string;
    census?: unknown;
    alwaysBodies?: unknown;
  }): string[] {
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

  it("writes the SessionStart census to stderr when entries exist (unknown client → stderr fallback)", () => {
    // W2-3 (KT-DEC-0029): the human sink is the broad-only census breadcrumb;
    // SessionStart is SILENT about narrow / on-demand knowledge (no on-demand
    // count line). In a unit test no CLAUDE_PROJECT_DIR is set → detectClient()
    // is undefined → emitDualSink falls back to a stderr breadcrumb.
    const narrow = [
      makeEntry("KT-DEC-0001", "decision", "proven", "summary"),
    ];
    const writes = captureStderr({ payload: makePayload(narrow) });
    expect(writes.length).toBeGreaterThan(0);
    const stderr = writes.join("");
    expect(stderr).toMatch(/\[fabric\] SessionStart/);
    // W2-3: the on-demand count line is retired.
    expect(stderr).not.toMatch(/on-demand/);
    expect(stderr).toMatch(/fab_recall/); // next-step nudge
  });

  it("dual-sink: census drives the always-loaded breadcrumb; on-demand + dropped lines are retired (W2-3)", () => {
    const writes = captureStderr({
      payload: makePayload([makeEntry("KT-DEC-0001", "decision", "proven", "s")]),
      census: {
        by_type: { guidelines: 2, models: 1, decisions: 5, pitfalls: 3, processes: 0 },
        by_layer: { team: 9, personal: 2 },
        dropped_other_project: 4,
        total: 11,
      },
    });
    const stderr = writes.join("");
    expect(stderr).toMatch(/always-loaded/);
    expect(stderr).toMatch(/guideline 2 · model 1/);
    expect(stderr).toMatch(/\[team\] 9 · \[personal\] 2/);
    // W2-3 (KT-DEC-0029): the on-demand census count line + dropped-other-project
    // line are retired — SessionStart stays silent about narrow knowledge.
    expect(stderr).not.toMatch(/decision 5 · pitfall 3/);
    expect(stderr).not.toMatch(/已剔除他项目|dropped 4 other-project/);
  });

  it("appends a per-store read-set label from the bindings snapshot (v2.1 P4, F4/S63)", () => {
    // Project config supplies the project_id that keys the snapshot.
    const projectId = "11111111-1111-4111-8111-111111111111";
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ project_id: projectId, fabric_language: "en" }),
      "utf8",
    );
    // Isolated FABRIC_HOME with a CLI-pre-generated snapshot (hook reads THIS,
    // never the store trees).
    const home = mkdtempSync(join(tmpdir(), "knowledge-hint-broad-home-"));
    const prevHome = process.env.FABRIC_HOME;
    process.env.FABRIC_HOME = home;
    mkdirSync(join(home, ".fabric", "state", "bindings"), { recursive: true });
    writeFileSync(
      join(home, ".fabric", "state", "bindings", `${projectId}_resolved.json`),
      JSON.stringify({
        version: 1,
        project_id: projectId,
        generated_at: "2026-05-30T00:00:00.000Z",
        read_set: {
          stores: [
            { store_uuid: "p", alias: "personal", writable: true },
            { store_uuid: "t", alias: "team", writable: true },
          ],
          warnings: [],
        },
        write_target: { store_uuid: "t", alias: "team" },
      }),
      "utf8",
    );
    try {
      const writes = captureStderr({
        payload: makePayload([makeEntry("KT-DEC-0001", "decision", "proven", "s")]),
      });
      const stderr = writes.join("");
      expect(stderr).toContain("read-set stores:");
      expect(stderr).toContain("team (write)");
      expect(stderr).toContain("personal");
    } finally {
      if (prevHome === undefined) delete process.env.FABRIC_HOME;
      else process.env.FABRIC_HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
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

  it("returns 0 when no resolved-bindings snapshot exists (store-only cutover)", () => {
    // No fabric-config binding + no snapshot → store path degrades to 0.
    // The legacy project-local .fabric/knowledge walk is retired.
    expect(hook.countCanonicalNodes(tempRoot)).toBe(0);
  });

  it("ignores project-local canonical leftovers for store-era projects without snapshot stats", () => {
    const projectId = "66666666-6666-4666-8666-666666666666";
    writeProjectConfig(tempRoot, projectId);
    mkdirSync(join(tempRoot, ".fabric", "knowledge", "decisions"), {
      recursive: true,
    });
    writeFileSync(
      join(
        tempRoot,
        ".fabric",
        "knowledge",
        "decisions",
        "KT-DEC-0001--leftover.md",
      ),
      "x",
      "utf8",
    );

    withIsolatedFabricHome(() => {
      expect(hook.countCanonicalNodes(tempRoot)).toBe(0);
    });
  });

  it("reads canonical count from resolved-bindings snapshot for store-era projects", () => {
    const projectId = "77777777-7777-4777-8777-777777777777";
    writeProjectConfig(tempRoot, projectId);
    mkdirSync(join(tempRoot, ".fabric", "knowledge", "decisions"), {
      recursive: true,
    });
    writeFileSync(
      join(
        tempRoot,
        ".fabric",
        "knowledge",
        "decisions",
        "KT-DEC-0001--leftover.md",
      ),
      "x",
      "utf8",
    );

    withIsolatedFabricHome((home) => {
      writeBindingsSnapshot(home, projectId, { canonical_count: 9 });
      expect(hook.countCanonicalNodes(tempRoot)).toBe(9);
    });
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

  // Store-only cutover: the "is fabric-bound" init signal is now a binding id
  // in fabric-config.json (not the legacy .fabric/agents.meta.json probe), and
  // the canonical count comes from the resolved-bindings snapshot (not a
  // project-local .fabric/knowledge walk).
  const PROJECT_ID = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

  function plantBound(overrides: Record<string, unknown> = {}): void {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ project_id: PROJECT_ID, fabric_language: "en", ...overrides }),
      "utf8",
    );
  }

  function plantImportState(phase: string): void {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase }),
      "utf8",
    );
  }

  it("returns false when the workspace is not fabric-bound (no binding)", () => {
    // sparse snapshot but no fabric-config binding → not bound → no recommendation
    withIsolatedFabricHome((home) => {
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 2 });
      expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
    });
  });

  it("returns true when canonical < threshold AND .import-state.json absent (the target case)", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 3 });
      expect(hook.shouldRecommendImport(tempRoot)).toBe(true);
    });
  });

  it("returns false when canonical >= threshold (knowledge graph already seeded)", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 15 });
      expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
    });
  });

  it("returns false when import-state.json phase === 'complete' (user already imported)", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 2 });
      plantImportState("complete");
      expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
    });
  });

  it("returns false when import-state.json phase is in-progress (user actively importing)", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 2 });
      plantImportState("P1-done");
      expect(hook.shouldRecommendImport(tempRoot)).toBe(false);
    });
  });

  it("respects fabric-config.json underseed_node_threshold override", () => {
    withIsolatedFabricHome((home) => {
      plantBound({ underseed_node_threshold: 50 });
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 15 });
      // 15 < 50 → recommend
      expect(hook.shouldRecommendImport(tempRoot)).toBe(true);
    });
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

  // Store-only cutover: bound via fabric-config binding id; canonical count
  // from the resolved-bindings snapshot under an isolated FABRIC_HOME.
  const PROJECT_ID = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";

  function plantBound(): void {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", "fabric-config.json"),
      JSON.stringify({ project_id: PROJECT_ID, fabric_language: "en" }),
      "utf8",
    );
  }

  function plantImportState(phase: string): void {
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    writeFileSync(
      join(tempRoot, ".fabric", ".import-state.json"),
      JSON.stringify({ phase }),
      "utf8",
    );
  }

  it("canonical=3 < 10 + no import-state → emits import banner alongside summary", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 3 });

      const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
      const writes = captureStderr({
        payload: makePayload(narrow, { revision_hash: "rev-fresh" }),
      });
      const stderr = writes.join("");
      expect(stderr).toMatch(/📋 Fabric:/);
      expect(stderr).toMatch(/\/fabric-import/);
      // v2.2 dual-sink: the §3 census banner still present alongside the import nudge.
      expect(stderr).toMatch(/\[fabric\] SessionStart/);
    });
  });

  it("canonical=15 >= 10 → NO import banner emitted", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 15 });

      const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
      const writes = captureStderr({
        payload: makePayload(narrow, { revision_hash: "rev-seeded" }),
      });
      const stderr = writes.join("");
      expect(stderr).not.toMatch(/📋 Fabric:/);
      expect(stderr).not.toMatch(/\/fabric-import/);
    });
  });

  it("import-state.json phase='complete' → NO import banner emitted", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 2 });
      plantImportState("complete");

      const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
      const writes = captureStderr({
        payload: makePayload(narrow, { revision_hash: "rev-done" }),
      });
      const stderr = writes.join("");
      expect(stderr).not.toMatch(/📋 Fabric:/);
      expect(stderr).not.toMatch(/\/fabric-import/);
    });
  });

  it("import-state.json phase='P1-done' (in-progress) → NO import banner emitted", () => {
    withIsolatedFabricHome((home) => {
      plantBound();
      writeBindingsSnapshot(home, PROJECT_ID, { canonical_count: 2 });
      plantImportState("P1-done");

      const narrow = [makeEntry("KT-DEC-0001", "decision", "proven", "x")];
      const writes = captureStderr({
        payload: makePayload(narrow, { revision_hash: "rev-mid" }),
      });
      const stderr = writes.join("");
      expect(stderr).not.toMatch(/📋 Fabric:/);
      expect(stderr).not.toMatch(/\/fabric-import/);
    });
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

// ---------------------------------------------------------------------------
// lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): the broad
// hint renders `related-to-<id>` provenance for entries pulled in by the graph
//二阶召回, and stays an honest no-op (no annotation) for ordinarily-ranked
// entries — graph-empty never synthesizes a fake "related" marker.
// ---------------------------------------------------------------------------

describe("knowledge-hint-broad.cjs — related二阶 provenance rendering (W3-T2)", () => {
  it("tags a graph-pulled entry with (related-to-<id>) and leaves ranked entries clean", () => {
    const narrow: NarrowEntry[] = [
      makeEntry("KT-DEC-0001", "decision", "proven", "ranked entry"),
      { ...makeEntry("KT-DEC-0002", "decision", "proven", "graph neighbour"), related_to: "KT-DEC-0001" },
    ];
    const lines = hook.renderFull(narrow);
    const ranked = lines.find((l) => l.includes("KT-DEC-0001"));
    const pulled = lines.find((l) => l.includes("KT-DEC-0002"));
    expect(pulled).toContain("(related-to-KT-DEC-0001)");
    // The ordinarily-ranked entry never gets a fake provenance tag.
    expect(ranked).not.toContain("related-to");
  });

  it("graph-empty honest no-op: entries with no related_to render no provenance", () => {
    const narrow: NarrowEntry[] = [
      makeEntry("KT-DEC-0001", "decision", "proven", "a"),
      makeEntry("KT-DEC-0002", "decision", "proven", "b"),
    ];
    const lines = hook.renderFull(narrow);
    for (const l of lines) {
      expect(l).not.toContain("related-to");
    }
  });
});

// ---------------------------------------------------------------------------
// v2.2 dual-sink (Goal A) — SessionStart two-channel emit (criteria 1+2).
// Forces a known client via FABRIC_HINT_CLIENT and captures the stdout JSON
// envelope to assert the human systemMessage (§3 census) AND the AI
// additionalContext (always-active bodies + on-demand counts) are both shaped
// per client, plus the budget-degrade + nudge_mode-silent invariant.
// ---------------------------------------------------------------------------
describe("knowledge-hint-broad.cjs — dual-sink SessionStart (Goal A)", () => {
  let tempRoot: string;
  const savedClient = process.env.FABRIC_HINT_CLIENT;
  const savedProjDir = process.env.CLAUDE_PROJECT_DIR;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-dualsink-"));
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    delete process.env.CLAUDE_PROJECT_DIR;
  });
  afterEach(() => {
    if (savedClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
    else process.env.FABRIC_HINT_CLIENT = savedClient;
    if (savedProjDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedProjDir;
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  function writeConfig(cfg: Record<string, unknown>): void {
    writeFileSync(join(tempRoot, ".fabric", "fabric-config.json"), JSON.stringify(cfg), "utf8");
  }

  function capture(env: Record<string, unknown>): { out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    (hook as unknown as { main: (e: unknown, s: unknown) => void }).main(
      { cwd: tempRoot, ...env },
      { stdout: { write: (c: string) => out.push(c) }, stderr: { write: (c: string) => err.push(c) } },
    );
    return { out, err };
  }

  const census = {
    by_type: { guidelines: 1, models: 0, decisions: 4, pitfalls: 2, processes: 0 },
    by_layer: { team: 6, personal: 1 },
    dropped_other_project: 0,
    total: 7,
  };
  const alwaysBodies = [
    { id: "team:KT-GLD-0001", type: "guidelines", layer: "team", summary: "Code style", body: "# Code style\n\nUse 2-space indent." },
  ];

  it("cc client → ONE stdout envelope: systemMessage(human census) + additionalContext(AI always-bodies)", () => {
    process.env.FABRIC_HINT_CLIENT = "cc";
    writeConfig({ fabric_language: "en" });
    const { out } = capture({
      payload: makePayload([makeEntry("KT-DEC-0001", "decision", "proven", "x")]),
      census,
      alwaysBodies,
    });
    expect(out.length).toBe(1);
    const env = JSON.parse(out[0]);
    // Human sink
    expect(env.systemMessage).toMatch(/\[fabric\] SessionStart/);
    expect(env.systemMessage).toMatch(/always-loaded/);
    // AI sink
    expect(env.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(env.hookSpecificOutput.additionalContext).toMatch(/ALWAYS-ACTIVE RULES/);
    expect(env.hookSpecificOutput.additionalContext).toMatch(/team:KT-GLD-0001/);
    expect(env.hookSpecificOutput.additionalContext).toMatch(/Use 2-space indent/);
    // W2-2 (KT-DEC-0027): decision/pitfall/process render as a REFERENCE section
    // (title + must_read_if hook), not an ON-DEMAND count line.
    expect(env.hookSpecificOutput.additionalContext).toMatch(/REFERENCE/);
    expect(env.hookSpecificOutput.additionalContext).toMatch(/\[decision\] KT-DEC-0001/);
    expect(env.hookSpecificOutput.additionalContext).not.toMatch(/ON-DEMAND/);
  });

  it("census labels total as entry COUNT (not 'KB') and surfaces a [project] bucket", () => {
    process.env.FABRIC_HINT_CLIENT = "cc";
    writeConfig({ fabric_language: "en" });
    const { out } = capture({
      payload: makePayload([makeEntry("KT-DEC-0001", "decision", "proven", "x")]),
      census: {
        by_type: { guidelines: 1, models: 0, decisions: 4, pitfalls: 2, processes: 0 },
        by_layer: { team: 4, personal: 1, project: 2 },
        dropped_other_project: 0,
        total: 7,
      },
      alwaysBodies,
    });
    const env = JSON.parse(out[0]);
    // Block 3: `total` is the read-set ENTRY COUNT, labeled entries — never "KB".
    expect(env.systemMessage).toMatch(/SessionStart \(7 entries\)/);
    expect(env.systemMessage).not.toMatch(/\d+ KB/);
    // Block 4: project-scoped entries get their own bucket between team & personal.
    expect(env.systemMessage).toMatch(/\[team\] 4 · \[project\] 2 · \[personal\] 1/);
  });

  it("omits the [project] bucket when no project-scoped entries exist", () => {
    process.env.FABRIC_HINT_CLIENT = "cc";
    writeConfig({ fabric_language: "en" });
    const { out } = capture({
      payload: makePayload([makeEntry("KT-DEC-0001", "decision", "proven", "x")]),
      census, // by_layer.project = 0 (absent)
      alwaysBodies,
    });
    const env = JSON.parse(out[0]);
    expect(env.systemMessage).toMatch(/\[team\] 6 · \[personal\] 1/);
    expect(env.systemMessage).not.toMatch(/\[project\]/);
  });

  it("nudge_mode=silent → AI additionalContext STILL emitted, systemMessage suppressed (D5 invariant)", () => {
    process.env.FABRIC_HINT_CLIENT = "cc";
    writeConfig({ fabric_language: "en", nudge_mode: "silent" });
    const { out } = capture({
      payload: makePayload([makeEntry("KT-DEC-0001", "decision", "proven", "x")]),
      census,
      alwaysBodies,
    });
    expect(out.length).toBe(1);
    const env = JSON.parse(out[0]);
    expect(env.systemMessage).toBeUndefined(); // human muted
    expect(env.hookSpecificOutput.additionalContext).toMatch(/ALWAYS-ACTIVE RULES/); // AI intact
  });

  it("always-body over budget degrades to summary + recall pointer (D10)", () => {
    process.env.FABRIC_HINT_CLIENT = "cc";
    writeConfig({ fabric_language: "en", hint_broad_budget_chars: 30 });
    const bigBodies = [
      { id: "team:KT-GLD-0001", type: "guidelines", layer: "team", summary: "S1", body: "x".repeat(500) },
      { id: "team:KT-MOD-0001", type: "models", layer: "team", summary: "S2", body: "y".repeat(500) },
    ];
    const { out } = capture({
      payload: makePayload([]),
      census,
      alwaysBodies: bigBodies,
    });
    const ai = JSON.parse(out[0]).hookSpecificOutput.additionalContext as string;
    // The second body cannot fit the 30-char budget → degraded to summary + pointer.
    expect(ai).toMatch(/over budget; fab_recall for body/);
  });

  it("reminder_to_context=false → no AI sink, human systemMessage still emitted", () => {
    process.env.FABRIC_HINT_CLIENT = "cc";
    writeConfig({ fabric_language: "en", hint_reminder_to_context: false });
    const { out } = capture({
      payload: makePayload([makeEntry("KT-DEC-0001", "decision", "proven", "x")]),
      census,
      alwaysBodies,
    });
    expect(out.length).toBe(1);
    const env = JSON.parse(out[0]);
    expect(env.systemMessage).toMatch(/\[fabric\] SessionStart/);
    expect(env.hookSpecificOutput).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// W2 — SessionStart spine: type-tiered AI sink + backstop (KT-DEC-0027/0028/0029).
// REFERENCE renders decision/pitfall/process as title + must_read_if hook (never
// the body); narrow entries stay silent; the broad index folds past the backstop.
// ---------------------------------------------------------------------------
describe("knowledge-hint-broad.cjs — W2 spine (KT-DEC-0027/0028/0029)", () => {
  let tempRoot: string;
  const savedClient = process.env.FABRIC_HINT_CLIENT;
  const savedProjDir = process.env.CLAUDE_PROJECT_DIR;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "broad-w2-spine-"));
    mkdirSync(join(tempRoot, ".fabric"), { recursive: true });
    delete process.env.CLAUDE_PROJECT_DIR;
    process.env.FABRIC_HINT_CLIENT = "cc";
  });
  afterEach(() => {
    if (savedClient === undefined) delete process.env.FABRIC_HINT_CLIENT;
    else process.env.FABRIC_HINT_CLIENT = savedClient;
    if (savedProjDir === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = savedProjDir;
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });

  type SpineEntry = {
    id: string;
    type: string;
    maturity: string;
    summary: string;
    relevance_scope?: "broad" | "narrow";
    must_read_if?: string;
  };

  function writeConfig(cfg: Record<string, unknown>): void {
    writeFileSync(join(tempRoot, ".fabric", "fabric-config.json"), JSON.stringify(cfg), "utf8");
  }

  function aiContext(env: Record<string, unknown>): string {
    const out: string[] = [];
    (hook as unknown as { main: (e: unknown, s: unknown) => void }).main(
      { cwd: tempRoot, ...env },
      { stdout: { write: (c: string) => out.push(c) }, stderr: { write: () => {} } },
    );
    if (out.length === 0) return "";
    const parsed = JSON.parse(out[0]);
    return (parsed.hookSpecificOutput && parsed.hookSpecificOutput.additionalContext) || "";
  }

  function makeSpinePayload(entries: SpineEntry[]): Record<string, unknown> {
    return { version: 2, revision_hash: "rev-spine", target_paths: ["**"], entries, broad_count: entries.length };
  }

  it("renders decision/pitfall/process as title + must_read_if hook (KT-DEC-0027)", () => {
    writeConfig({ fabric_language: "en" });
    const ai = aiContext({
      payload: makeSpinePayload([
        { id: "team:KT-DEC-0001", type: "decision", maturity: "draft", summary: "the summary", relevance_scope: "broad", must_read_if: "editing the auth flow" },
      ]),
      alwaysBodies: [],
    });
    expect(ai).toMatch(/REFERENCE/);
    // The must_read_if hook is rendered (NOT the summary, NOT the body).
    expect(ai).toMatch(/\[decision\] team:KT-DEC-0001 — editing the auth flow/);
    expect(ai).not.toMatch(/the summary/);
  });

  it("falls back to summary when must_read_if is absent", () => {
    writeConfig({ fabric_language: "en" });
    const ai = aiContext({
      payload: makeSpinePayload([
        { id: "team:KT-PIT-0001", type: "pitfall", maturity: "verified", summary: "watch the cache flag", relevance_scope: "broad" },
      ]),
      alwaysBodies: [],
    });
    expect(ai).toMatch(/\[pitfall\] team:KT-PIT-0001 — watch the cache flag/);
  });

  it("stays silent about narrow-scoped entries in the spine (KT-DEC-0029)", () => {
    writeConfig({ fabric_language: "en" });
    const ai = aiContext({
      payload: makeSpinePayload([
        { id: "team:KT-DEC-0001", type: "decision", maturity: "draft", summary: "broad one", relevance_scope: "broad", must_read_if: "broad hook" },
        { id: "team:KT-DEC-0009", type: "decision", maturity: "draft", summary: "narrow one", relevance_scope: "narrow", must_read_if: "narrow hook" },
      ]),
      alwaysBodies: [],
    });
    expect(ai).toMatch(/KT-DEC-0001/);
    expect(ai).not.toMatch(/KT-DEC-0009/);
  });

  it("folds the broad index tail past broad_index_backstop + emits the drift marker (KT-DEC-0028)", () => {
    writeConfig({ fabric_language: "en", broad_index_backstop: 20 });
    const entries: SpineEntry[] = Array.from({ length: 30 }, (_, i) => ({
      id: `team:KT-DEC-${1000 + i}`,
      type: "decision",
      maturity: "draft",
      summary: `s${i}`,
      relevance_scope: "broad" as const,
    }));
    const ai = aiContext({ payload: makeSpinePayload(entries), alwaysBodies: [] });
    // 20 reference lines rendered, 10 folded into the drift marker.
    expect(ai).toMatch(/10 more broad entries folded \(broad index > backstop 20; run fabric-audit\)/);
  });

  it("guideline/model body over budget degrades to an index line, never a folded count (KT-DEC-0028)", () => {
    writeConfig({ fabric_language: "en", hint_broad_budget_chars: 30 });
    const ai = aiContext({
      payload: makeSpinePayload([]),
      alwaysBodies: [
        { id: "team:KT-GLD-0001", type: "guidelines", layer: "team", summary: "style rule", body: "x".repeat(500) },
        { id: "team:KT-MOD-0001", type: "models", layer: "team", summary: "domain model", body: "y".repeat(500) },
      ],
    });
    // The over-budget entry stays an individually-visible index line, not a count.
    expect(ai).toMatch(/\[model\] team:KT-MOD-0001 · domain model \(over budget; fab_recall for body\)/);
  });
});

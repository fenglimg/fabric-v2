import { describe, expect, it } from "vitest";

import type { RuleDescription, RuleDescriptionIndexItem } from "@fenglimg/fabric-shared";

import type { ScoringContext } from "./plan-context-scoring.js";
import { proximityBoost, scoreDescriptionItem } from "./plan-context-score-factors.js";

// This module's constants are TUNING KNOBS — pinning their values would just
// make every recalibration a red test. What must not drift is the ORDERING the
// calibration exists to produce, which the source states outright:
//
//   * content leads   — a candidate whose text matches the intent outranks one
//                       merely sitting in the same directory;
//   * locality > recency — a same-file/same-dir hit dominates the recency nudge;
//   * salience last   — a `proven` entry that does not match the intent never
//                       outranks a `draft` entry that does;
//   * under RRF, a structural-only entry stays below every content hit.
//
// Every assertion below is a comparison between two scored candidates, so a
// re-tune that preserves the intent stays green and one that inverts a tier
// goes red.

const NOW = Date.parse("2026-08-10T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function description(overrides: Partial<RuleDescription> = {}): RuleDescription {
  return {
    summary: "",
    intent_clues: [],
    tech_stack: [],
    impact: [],
    must_read_if: "",
    ...overrides,
  };
}

function item(stableId: string, overrides: Partial<RuleDescription> = {}): RuleDescriptionIndexItem {
  return { stable_id: stableId, description: description(overrides) };
}

// A stub BM25 model: raw scores supplied per stable_id, so a test states
// "this candidate matched the query twice as strongly" without constructing a
// corpus. Query terms are ignored — the model IS the fixture.
function bm25Stub(scores: Record<string, number>): ScoringContext["bm25"] {
  return {
    scoreDoc: (id: string) => scores[id] ?? 0,
    __serialized: undefined as never,
  };
}

function context(overrides: Partial<ScoringContext> = {}): ScoringContext {
  return { nowMs: NOW, targetPaths: [], queryTerms: [], ...overrides };
}

describe("scoreDescriptionItem ranking invariants", () => {
  describe("content leads the ranking", () => {
    it("a strong term match outranks a maxed-out structural entry", () => {
      // The source calibrates BM25_WEIGHT so a raw BM25 in the ~2-4 band clears
      // the structural group. 4 is the top of that stated band; the opponent
      // maxes EVERY structural signal at once (same-file + proven + fresh), so
      // this is the strongest form of "content leads".
      const matched = item("KT-DEC-0001");
      const maxStructural = item("KT-DEC-0002", {
        relevance_paths: ["packages/server/src/services/doctor.ts"],
        maturity: "proven",
        created_at: new Date(NOW - DAY).toISOString(),
      });
      const ctx = context({
        queryTerms: ["doctor", "lint"],
        targetPaths: ["packages/server/src/services/doctor.ts"],
        bm25: bm25Stub({ "KT-DEC-0001": 4 }),
      });

      expect(scoreDescriptionItem(matched, ctx)).toBeGreaterThan(
        scoreDescriptionItem(maxStructural, ctx),
      );
    });

    it("no query terms means content contributes nothing, leaving structure to decide", () => {
      const localityHit = item("KT-DEC-0001", { relevance_paths: ["packages/cli/src/index.ts"] });
      const nothing = item("KT-DEC-0002");
      const ctx = context({ targetPaths: ["packages/cli/src/index.ts"] });

      expect(scoreDescriptionItem(localityHit, ctx)).toBeGreaterThan(
        scoreDescriptionItem(nothing, ctx),
      );
    });
  });

  describe("locality tiers, and locality over recency", () => {
    const target = "packages/server/src/services/doctor.ts";
    const ctx = context({ targetPaths: [target] });

    const sameFile = item("KT-DEC-0001", { relevance_paths: [target] });
    const sameDir = item("KT-DEC-0002", {
      relevance_paths: ["packages/server/src/services/audit.ts"],
    });
    const samePackage = item("KT-DEC-0003", { relevance_paths: ["packages/server/README.md"] });
    const unrelated = item("KT-DEC-0004", { relevance_paths: ["docs/notes.md"] });

    it("ranks same-file > same-dir > same-package > unrelated", () => {
      const scores = [sameFile, sameDir, samePackage, unrelated].map((c) =>
        scoreDescriptionItem(c, ctx),
      );

      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      expect(new Set(scores).size).toBe(4);
    });

    it("a same-dir hit outranks a brand-new entry with no path relevance", () => {
      const fresh = item("KT-DEC-0005", {
        created_at: new Date(NOW - DAY).toISOString(),
      });

      expect(scoreDescriptionItem(sameDir, ctx)).toBeGreaterThan(
        scoreDescriptionItem(fresh, ctx),
      );
    });

    it("recency is a 7-day binary bump, not a decay: 6 days old still earns it", () => {
      const sixDays = item("KT-DEC-0006", { created_at: new Date(NOW - 6 * DAY).toISOString() });
      const eightDays = item("KT-DEC-0007", { created_at: new Date(NOW - 8 * DAY).toISOString() });
      const noDate = item("KT-DEC-0008");

      expect(scoreDescriptionItem(sixDays, ctx)).toBeGreaterThan(
        scoreDescriptionItem(eightDays, ctx),
      );
      expect(scoreDescriptionItem(eightDays, ctx)).toBe(scoreDescriptionItem(noDate, ctx));
    });

    it("an unparseable created_at is treated as absent, never as an error", () => {
      const garbage = item("KT-DEC-0009", { created_at: "not-a-date" });

      expect(scoreDescriptionItem(garbage, ctx)).toBe(scoreDescriptionItem(item("KT-DEC-0010"), ctx));
    });
  });

  describe("salience is the finest tie-break", () => {
    const ctx = context({ queryTerms: ["archive"], bm25: bm25Stub({ "KT-DEC-0002": 1 }) });

    it("a proven entry that misses the intent never outranks a draft that matches", () => {
      const provenNoMatch = item("KT-DEC-0001", { maturity: "proven" });
      const draftMatch = item("KT-DEC-0002", { maturity: "draft" });

      expect(scoreDescriptionItem(draftMatch, ctx)).toBeGreaterThan(
        scoreDescriptionItem(provenNoMatch, ctx),
      );
    });

    it("orders proven > verified > draft/absent when everything else ties", () => {
      const tie = context();
      const scores = (["proven", "verified", "draft"] as const).map((maturity) =>
        scoreDescriptionItem(item("KT-DEC-0001", { maturity }), tie),
      );

      expect(scores[0]).toBeGreaterThan(scores[1] as number);
      expect(scores[1]).toBeGreaterThan(scores[2] as number);
      expect(scores[2]).toBe(scoreDescriptionItem(item("KT-DEC-0001"), tie));
    });
  });

  describe("RRF fusion", () => {
    const rrfCtx = (overrides: Partial<ScoringContext> = {}) =>
      context({
        fusion: "rrf",
        queryTerms: ["store", "bind"],
        targetPaths: ["packages/cli/src/store.ts"],
        ...overrides,
      });

    it("keeps a structural-only entry below every content hit", () => {
      // The stated worst case: ONE channel, and the content hit sits far back
      // at rank 24, while the structural-only entry maxes out every tier.
      const ctx = rrfCtx({ bm25Ranks: new Map([["KT-DEC-0001", 24]]) });
      const farBackContentHit = item("KT-DEC-0001");
      const maxStructural = item("KT-DEC-0002", {
        relevance_paths: ["packages/cli/src/store.ts"],
        maturity: "proven",
        created_at: new Date(NOW - DAY).toISOString(),
      });

      expect(scoreDescriptionItem(farBackContentHit, ctx)).toBeGreaterThan(
        scoreDescriptionItem(maxStructural, ctx),
      );
    });

    it("ranks a better content rank higher, and two channels above one", () => {
      const ctx = rrfCtx({
        bm25Ranks: new Map([
          ["KT-DEC-0001", 1],
          ["KT-DEC-0002", 5],
          ["KT-DEC-0003", 1],
        ]),
        vectorRanks: new Map([["KT-DEC-0003", 1]]),
      });

      const rank1 = scoreDescriptionItem(item("KT-DEC-0001"), ctx);
      const rank5 = scoreDescriptionItem(item("KT-DEC-0002"), ctx);
      const dualRank1 = scoreDescriptionItem(item("KT-DEC-0003"), ctx);

      expect(rank1).toBeGreaterThan(rank5);
      expect(dualRank1).toBeGreaterThan(rank1);
    });

    it("falls back to the additive path when the caller supplied no query", () => {
      const noQuery = context({ fusion: "rrf", targetPaths: ["packages/cli/src/store.ts"] });
      const additive = context({ targetPaths: ["packages/cli/src/store.ts"] });
      const candidate = item("KT-DEC-0001", { relevance_paths: ["packages/cli/src/store.ts"] });

      expect(scoreDescriptionItem(candidate, noQuery)).toBe(
        scoreDescriptionItem(candidate, additive),
      );
    });
  });

  describe("credibility age decay", () => {
    // Only active when the caller threads the half-life/floor maps; a bespoke
    // context without them must be an exact no-op.
    const decayCtx = (overrides: Partial<ScoringContext> = {}) =>
      context({
        credibilityHalfLives: { decisions: 30, guidelines: 30, models: 30, pitfalls: 30, processes: 30 },
        credibilityFloors: { draft: 0.2, verified: 0.5, proven: 0.8 },
        targetPaths: ["packages/cli/src/store.ts"],
        ...overrides,
      });

    it("is a no-op when the half-life maps are absent", () => {
      const old = item("KT-DEC-0001", {
        relevance_paths: ["packages/cli/src/store.ts"],
        created_at: new Date(NOW - 900 * DAY).toISOString(),
      });
      const fresh = item("KT-DEC-0002", {
        relevance_paths: ["packages/cli/src/store.ts"],
        created_at: new Date(NOW - 8 * DAY).toISOString(),
      });
      const ctx = context({ targetPaths: ["packages/cli/src/store.ts"] });

      expect(scoreDescriptionItem(old, ctx)).toBe(scoreDescriptionItem(fresh, ctx));
    });

    it("sinks a stale entry below an equivalent fresh one once enabled", () => {
      const ctx = decayCtx();
      const stale = item("KT-DEC-0001", {
        relevance_paths: ["packages/cli/src/store.ts"],
        knowledge_type: "decisions",
        created_at: new Date(NOW - 300 * DAY).toISOString(),
      });
      const recent = item("KT-DEC-0002", {
        relevance_paths: ["packages/cli/src/store.ts"],
        knowledge_type: "decisions",
        created_at: new Date(NOW - 10 * DAY).toISOString(),
      });

      expect(scoreDescriptionItem(stale, ctx)).toBeLessThan(scoreDescriptionItem(recent, ctx));
    });

    it("floors a stale entry by maturity, so endorsement outlives 100 half-lives", () => {
      // Without the per-maturity floor the decay is unbounded: at 3000 days /
      // 30-day half-life the multiplier is 2^-100 ≈ 0, and the entry vanishes
      // from the ranking no matter how endorsed it is. The floor is what keeps
      // an ancient `proven` entry ahead of a merely middle-aged `draft` one.
      const ctx = decayCtx();
      const aged = (id: string, days: number, maturity: RuleDescription["maturity"]) =>
        item(id, {
          relevance_paths: ["packages/cli/src/store.ts"],
          knowledge_type: "decisions",
          maturity,
          created_at: new Date(NOW - days * DAY).toISOString(),
        });

      const ancientProven = scoreDescriptionItem(aged("KT-DEC-0001", 3000, "proven"), ctx);
      const middleAgedDraft = scoreDescriptionItem(aged("KT-DEC-0002", 20, "draft"), ctx);

      expect(ancientProven).toBeGreaterThan(middleAgedDraft);
    });
  });
});

describe("proximityBoost", () => {
  const TEXT_ID = "KT-DEC-0001";
  const candidate = item(TEXT_ID);

  function proximityContext(text: string, queryTerms: string[]): ScoringContext {
    return context({ queryTerms, docTexts: new Map([[TEXT_ID, text]]) });
  }

  it("is zero when the content score is zero or negative", () => {
    const ctx = proximityContext("build pipeline", ["build", "pipeline"]);

    expect(proximityBoost(candidate, ctx, 0)).toBe(0);
    expect(proximityBoost(candidate, ctx, -5)).toBe(0);
  });

  it("is zero for a single-term query — there is no pair to measure", () => {
    const ctx = proximityContext("build pipeline", ["build"]);

    expect(proximityBoost(candidate, ctx, 100)).toBe(0);
  });

  it("is zero when only one query term appears in the text", () => {
    const ctx = proximityContext("build tooling notes", ["build", "pipeline"]);

    expect(proximityBoost(candidate, ctx, 100)).toBe(0);
  });

  it("is zero when the document text is missing or empty", () => {
    expect(proximityBoost(candidate, context({ queryTerms: ["a", "b"] }), 100)).toBe(0);
    expect(proximityBoost(candidate, proximityContext("", ["a", "b"]), 100)).toBe(0);
  });

  it("caps the boost at 15% of the content score when the terms are adjacent", () => {
    const ctx = proximityContext("the build pipeline runs nightly", ["build", "pipeline"]);

    // Adjacent terms are distance 1, not 0 — the cap is the ceiling, never reached
    // by real adjacent text, so assert the bound rather than an exact fraction.
    const boost = proximityBoost(candidate, ctx, 100);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(15);
  });

  it("decreases monotonically as the terms drift apart, and dies at the window edge", () => {
    const filler = (n: number) => Array.from({ length: n }, () => "x").join(" ");
    const boostAtGap = (gap: number) =>
      proximityBoost(
        candidate,
        proximityContext(`build ${filler(gap - 1)} pipeline`, ["build", "pipeline"]),
        100,
      );

    const gaps = [1, 2, 3, 4, 5].map(boostAtGap);
    expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
    expect(new Set(gaps).size).toBe(5);

    // At and beyond the window the boost is gone entirely.
    expect(boostAtGap(6)).toBe(0);
    expect(boostAtGap(12)).toBe(0);
  });

  it("scales with the content score it boosts", () => {
    const ctx = proximityContext("the build pipeline runs nightly", ["build", "pipeline"]);

    expect(proximityBoost(candidate, ctx, 200)).toBeCloseTo(
      proximityBoost(candidate, ctx, 100) * 2,
    );
  });

  it("uses the CLOSEST occurrence pair, not the first one", () => {
    // "build" appears far from the first "pipeline" but adjacent to the second.
    const far = "build x x x x x x x x x x pipeline";
    const alsoClose = "build x x x x x x x x x x pipeline build pipeline";

    expect(proximityBoost(candidate, proximityContext(far, ["build", "pipeline"]), 100)).toBe(0);
    expect(
      proximityBoost(candidate, proximityContext(alsoClose, ["build", "pipeline"]), 100),
    ).toBeGreaterThan(0);
  });
});

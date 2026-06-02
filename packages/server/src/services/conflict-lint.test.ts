// v2.1 ④ conflict-detection (P4): unit tests for conflict-lint.
//
// Covers the three fixture classes from the proposal:
//   - a real conflicting pair (same subject, opposite decision) → candidate;
//     deep judge rules it a conflict (error-class).
//   - an unrelated pair → NOT a candidate.
//   - a similar-but-not-conflicting pair → candidate (acceptable; human/judge
//     decides). Deep judge rules it "similar" (warn-class).
// Plus: the LLM-judge seam is fully injectable (no real model), a throwing
// judge degrades to "unknown", and cross-(type|layer) pairs never compare.

import { describe, expect, it, vi } from "vitest";

import {
  findConflictCandidates,
  lintConflicts,
  DEFAULT_CONFLICT_SIMILARITY_THRESHOLD,
  type ConflictEntry,
  type ConflictJudge,
} from "./conflict-lint.js";

function entry(stable_id: string, text: string, knowledge_type = "decisions", layer = "team"): ConflictEntry {
  return { stable_id, knowledge_type, layer, text };
}

// A near-duplicate pair about the same subject with opposite conclusions.
const AUTH_JWT = entry(
  "KT-DEC-0001",
  "Auth token strategy: use stateless JWT bearer tokens for all API authentication. Sessions are not stored server side.",
);
const AUTH_SESSION = entry(
  "KT-DEC-0002",
  "Auth token strategy: use server-side stateful sessions for all API authentication. JWT bearer tokens are not used.",
);
// Completely unrelated decision.
const UNRELATED = entry(
  "KT-DEC-0003",
  "Build tooling: adopt tsup for bundling the CLI package, with esbuild under the hood for fast incremental builds.",
);

describe("findConflictCandidates", () => {
  it("flags a same-subject opposite-conclusion pair as a candidate", () => {
    const pairs = findConflictCandidates([AUTH_JWT, AUTH_SESSION, UNRELATED]);
    const ids = pairs.map((p) => [p.a, p.b].join("+"));
    expect(ids).toContain("KT-DEC-0001+KT-DEC-0002");
  });

  it("does NOT flag an unrelated pair", () => {
    const pairs = findConflictCandidates([AUTH_JWT, UNRELATED]);
    expect(pairs).toEqual([]);
  });

  it("every candidate is verdict 'unknown' in the cheap pass", () => {
    const pairs = findConflictCandidates([AUTH_JWT, AUTH_SESSION]);
    expect(pairs.length).toBe(1);
    expect(pairs[0].verdict).toBe("unknown");
    expect(pairs[0].similarity).toBeGreaterThanOrEqual(DEFAULT_CONFLICT_SIMILARITY_THRESHOLD);
  });

  it("never compares across different knowledge_type", () => {
    const a = entry("KT-DEC-0001", "Auth uses JWT bearer tokens for all API authentication", "decisions");
    const b = entry("KT-PIT-0001", "Auth uses JWT bearer tokens for all API authentication", "pitfalls");
    expect(findConflictCandidates([a, b])).toEqual([]);
  });

  it("never compares across different layer", () => {
    const a = entry("KT-DEC-0001", "Auth uses JWT bearer tokens for all API authentication", "decisions", "team");
    const b = entry("KP-DEC-0001", "Auth uses JWT bearer tokens for all API authentication", "decisions", "personal");
    expect(findConflictCandidates([a, b])).toEqual([]);
  });

  it("respects an explicit threshold (1.0 → only exact-term-set matches)", () => {
    // A slightly different pair clears the default 0.5 but not 1.0.
    const pairs0 = findConflictCandidates([AUTH_JWT, AUTH_SESSION], { threshold: 0.5 });
    expect(pairs0.length).toBe(1);
    const pairs1 = findConflictCandidates([AUTH_JWT, AUTH_SESSION], { threshold: 1.0 });
    expect(pairs1.length).toBe(0);
  });

  it("a singleton group yields no pairs", () => {
    expect(findConflictCandidates([AUTH_JWT])).toEqual([]);
  });
});

describe("lintConflicts deep mode (injected LLM judge)", () => {
  it("judge ruling isConflict=true → verdict 'conflict' + rationale", async () => {
    const judge: ConflictJudge = vi.fn(async () => ({ isConflict: true, rationale: "JWT vs session — direct contradiction" }));
    const out = await lintConflicts([AUTH_JWT, AUTH_SESSION], { judge });
    expect(out.length).toBe(1);
    expect(out[0].verdict).toBe("conflict");
    expect(out[0].rationale).toContain("contradiction");
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("judge ruling isConflict=false → verdict 'similar' (duplicate, not conflict)", async () => {
    const judge: ConflictJudge = async () => ({ isConflict: false, rationale: "Both about auth but not contradictory" });
    const out = await lintConflicts([AUTH_JWT, AUTH_SESSION], { judge });
    expect(out[0].verdict).toBe("similar");
  });

  it("a throwing judge degrades the pair to 'unknown' (never crashes)", async () => {
    const judge: ConflictJudge = async () => {
      throw new Error("LLM unavailable");
    };
    const out = await lintConflicts([AUTH_JWT, AUTH_SESSION], { judge });
    expect(out[0].verdict).toBe("unknown");
  });

  it("no judge → cheap pass only (all 'unknown'), judge never invoked", async () => {
    const out = await lintConflicts([AUTH_JWT, AUTH_SESSION]);
    expect(out[0].verdict).toBe("unknown");
  });

  it("no candidates → judge never called", async () => {
    const judge: ConflictJudge = vi.fn(async () => ({ isConflict: true, rationale: "x" }));
    const out = await lintConflicts([AUTH_JWT, UNRELATED], { judge });
    expect(out).toEqual([]);
    expect(judge).not.toHaveBeenCalled();
  });
});

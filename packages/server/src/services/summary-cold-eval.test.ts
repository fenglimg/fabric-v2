import { describe, expect, it } from "vitest";

import { buildColdEvalBatch, COLD_EVAL_RUBRIC } from "./summary-cold-eval.js";

// KT-GLD-0006: the review-time cold-eval judge runs offline (maestro delegate),
// so only its deterministic PROTOCOL surface — the batch builder — is unit-tested
// here. The actual zero-context judgment is non-deterministic by design.
describe("summary cold-eval batch builder (KT-GLD-0006)", () => {
  it("pairs judgeable candidates with the zero-context rubric", () => {
    const batch = buildColdEvalBatch([
      { stable_id: "team:KT-DEC-0001", summary: "Recall drops candidates below 0.25× the top score." },
      { stable_id: "team:KT-DEC-0002", summary: "SessionStart injects index lines only, never bodies." },
    ]);
    expect(batch.rubric).toBe(COLD_EVAL_RUBRIC);
    expect(batch.candidates.map((c) => c.stable_id)).toEqual([
      "team:KT-DEC-0001",
      "team:KT-DEC-0002",
    ]);
  });

  it("drops blank / whitespace-only summaries (nothing to judge)", () => {
    const batch = buildColdEvalBatch([
      { stable_id: "team:KT-DEC-0001", summary: "A real act-on thesis line." },
      { stable_id: "team:KT-DEC-0002", summary: "   \n\t  " },
      { stable_id: "team:KT-DEC-0003", summary: "" },
    ]);
    expect(batch.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-0001"]);
  });

  it("returns an empty candidate list when nothing is judgeable (short-circuit)", () => {
    const batch = buildColdEvalBatch([]);
    expect(batch.candidates).toEqual([]);
    // The rubric is still present so callers can short-circuit without a delegate
    // round-trip but keep a stable batch shape.
    expect(batch.rubric).toBe(COLD_EVAL_RUBRIC);
  });

  it("the rubric explicitly withholds the body (the cold-eval invariant)", () => {
    expect(COLD_EVAL_RUBRIC).toMatch(/ZERO-CONTEXT/);
    expect(COLD_EVAL_RUBRIC).toMatch(/never the full entry body|NOT seen the body/);
  });
});

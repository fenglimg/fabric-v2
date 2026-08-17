import { describe, expect, it } from "vitest";

import {
  buildColdEvalBatch,
  COLD_EVAL_RUBRIC,
  COLD_EVAL_RUBRIC_REFERENCE,
  rubricFamilyFor,
} from "./summary-cold-eval.js";

// KT-GLD-0006: the review-time cold-eval judge runs offline (maestro delegate),
// so only its deterministic PROTOCOL surface — the batch builder — is unit-tested
// here. The actual zero-context judgment is non-deterministic by design.
describe("summary cold-eval batch builder (KT-GLD-0006)", () => {
  it("pairs guideline/model candidates with the always-active RULE rubric", () => {
    const batches = buildColdEvalBatch([
      {
        stable_id: "team:KT-GLD-0001",
        summary: "Recall drops candidates below 0.25× the top score.",
        knowledge_type: "guidelines",
      },
      {
        stable_id: "team:KT-MOD-0002",
        summary: "SessionStart injects index lines only, never bodies.",
        knowledge_type: "models",
      },
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.family).toBe("rule");
    expect(batches[0]!.rubric).toBe(COLD_EVAL_RUBRIC);
    expect(batches[0]!.candidates.map((c) => c.stable_id)).toEqual([
      "team:KT-GLD-0001",
      "team:KT-MOD-0002",
    ]);
  });

  it("pairs decision/pitfall/process candidates with the REFERENCE rubric", () => {
    const batches = buildColdEvalBatch([
      { stable_id: "team:KT-DEC-0001", summary: "Vest UI diffs live in code, not prefabs.", knowledge_type: "decisions" },
      { stable_id: "team:KT-PIT-0002", summary: "node.opacity cascades to children.", knowledge_type: "pitfalls" },
      { stable_id: "team:KT-PRO-0003", summary: "Prefab CLI edits are append-only.", knowledge_type: "processes" },
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.family).toBe("reference");
    expect(batches[0]!.rubric).toBe(COLD_EVAL_RUBRIC_REFERENCE);
    expect(batches[0]!.candidates).toHaveLength(3);
  });

  it("splits a mixed set into two batches, rule first", () => {
    const batches = buildColdEvalBatch([
      { stable_id: "team:KT-DEC-0001", summary: "A conclusion line.", knowledge_type: "decisions" },
      { stable_id: "team:KT-GLD-0001", summary: "An operative rule line.", knowledge_type: "guidelines" },
    ]);
    expect(batches.map((b) => b.family)).toEqual(["rule", "reference"]);
    expect(batches[0]!.candidates.map((c) => c.stable_id)).toEqual(["team:KT-GLD-0001"]);
    expect(batches[1]!.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-0001"]);
  });

  it("defaults an unknown/absent type to the REFERENCE bar", () => {
    expect(rubricFamilyFor(undefined)).toBe("reference");
    expect(rubricFamilyFor("decisions")).toBe("reference");
    expect(rubricFamilyFor("guidelines")).toBe("rule");
    expect(rubricFamilyFor("models")).toBe("rule");
  });

  it("drops blank / whitespace-only summaries (nothing to judge)", () => {
    const batches = buildColdEvalBatch([
      { stable_id: "team:KT-DEC-0001", summary: "A real act-on thesis line.", knowledge_type: "decisions" },
      { stable_id: "team:KT-DEC-0002", summary: "   \n\t  ", knowledge_type: "decisions" },
      { stable_id: "team:KT-DEC-0003", summary: "", knowledge_type: "decisions" },
    ]);
    expect(batches).toHaveLength(1);
    expect(batches[0]!.candidates.map((c) => c.stable_id)).toEqual(["team:KT-DEC-0001"]);
  });

  it("returns no batches when nothing is judgeable (short-circuit)", () => {
    expect(buildColdEvalBatch([])).toEqual([]);
  });

  it("both rubrics explicitly withhold the body (the cold-eval invariant)", () => {
    for (const rubric of [COLD_EVAL_RUBRIC, COLD_EVAL_RUBRIC_REFERENCE]) {
      expect(rubric).toMatch(/ZERO-CONTEXT/);
      expect(rubric).toMatch(/never the full entry body|NOT seen the body/);
    }
  });

  it("the reference rubric names the session-minute failure mode explicitly", () => {
    // This is the failure the type exemption used to let through unchecked.
    expect(COLD_EVAL_RUBRIC_REFERENCE).toMatch(/narrates the SESSION/);
    expect(COLD_EVAL_RUBRIC_REFERENCE).toMatch(/states the CONCLUSION/);
  });
});

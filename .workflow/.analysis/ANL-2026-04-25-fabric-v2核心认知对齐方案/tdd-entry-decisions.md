# TDD Entry Decisions

**Session**: ANL-2026-04-25-fabric-v2核心认知对齐方案  
**Date**: 2026-04-25  
**Status**: Final protocol clarifications before TDD planning.

## Locked Decisions

1. **Selection token storage**
   - First version uses in-memory cache with TTL.
   - Rationale: simple, testable, and aligned with local server usage.

2. **Invalid L1 selection**
   - Hard error.
   - If AI submits a stable id that is not in `ai_selectable_stable_ids`, the request must fail.
   - Rationale: this is protocol overreach, not a low-confidence choice.

3. **Missing AI selection reasons**
   - Hard error.
   - If `ai_selected_stable_ids` is non-empty, `ai_selection_reasons` must fully cover those ids.
   - Rationale: complete telemetry is required from the first version.

4. **Audit destination**
   - Write rule selection telemetry to `.fabric/audit.jsonl`.
   - Event type: `rule_selection`.
   - Rationale: avoid adding another state file before the governance model needs it.

5. **Requirement profile visibility**
   - `fab_plan_context` may return a lightweight `requirement_profile`.
   - It must describe the current target, not suggest which L1 rule to choose.
   - It must not contain server-side L1 score, confidence, match reasons, or negative reasons.

6. **Description index minimum schema**
   - First version schema:

```ts
type RuleDescriptionIndexItem = {
  stable_id: string;
  level: "L0" | "L1" | "L2";
  required: boolean;
  selectable: boolean;
  description: {
    summary: string;
    intent_clues: string[];
    tech_stack: string[];
    impact: string[];
    must_read_if: string;
    entities?: string[];
  };
};
```

   - Do not include `score`, `confidence`, `match_reasons`, `negative_reasons`, or `matched_profile_fields`.
   - `RuleDescription` does not include `id`; identity is `stable_id`.

7. **Missing rule section**
   - Return an empty section plus warning diagnostic.
   - Do not fallback to full rule content.
   - Rationale: fallback-to-full-content would break the structured injection boundary.

## Consequence for TDD

The TDD plan should now include tests for:

- token cache creation, lookup, expiration, and invalid token errors
- hard error for invalid L1 stable ids
- hard error for missing or incomplete AI selection reasons
- `.fabric/audit.jsonl` `rule_selection` event append
- neutral `requirement_profile` output without L1 judgment fields
- minimal `description_index` schema
- missing section warning with no full-content fallback

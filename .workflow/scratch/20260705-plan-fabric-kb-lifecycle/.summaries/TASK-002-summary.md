# TASK-002 Summary — wire credibility multiplier into recall scoring

**Status**: completed · **Executor**: main-thread (serial) · **Wave**: 2 · depends_on TASK-001

## Files modified (actual)
- `packages/server/src/services/plan-context.ts`:
  1. import `readCredibilityHalfLives, readCredibilityFloors` from config-loader.
  2. `ScoringContext` type: added optional `credibilityHalfLives` + `credibilityFloors` maps.
  3. `buildScoringContext` (single production construction site): resolve both maps ONCE per call via the readers (never per-candidate).
  4. New `credibilityFactor(item, context)`: `2^(-ageDays/halfLife)` off `created_at`, per-`knowledge_type` half-life, clamped `Math.max(floor, Math.min(1, factor))` by per-`maturity` floor; returns `1` on missing/unparseable/future `created_at` or absent maps.
  5. `scoreDescriptionItem` (:1528): wrapped the fused additive return and `* credibilityFactor(item, context)`.
  6. `scoreBreakdownForItem` (:1585): mirrored — multiplied the same subtotal by the hoisted `credibility` factor and emit `credibility` in the returned `RecallScoreBreakdown`.
- `packages/server/src/services/recall.test.ts`: new fixture — an older entry ranks strictly below an otherwise-identical fresher one; asserts `credibility` monotonic + `< 1` + `final === score` for both. Dates computed relative to `Date.now()` (run-time-stable), chosen outside the 7-day recency window and above the maturity floor's ~238d knee.

## Convergence verification (evidence)
- ✓ `function credibilityFactor` present; `return 1` fallback + `Math.max(floor, Math.min(1, factor))` clamp grep-visible.
- ✓ scoreDescriptionItem return contains `* credibilityFactor`.
- ✓ breakdown multiplies the subtotal by the same factor + emits `credibility` key. NOTE: literal `* credibilityFactor` count is 1 (not 2) because the breakdown hoists `const credibility = credibilityFactor(...)` per the task's step-5 "compute once, reuse"; the SEMANTIC mirror + `final===score` are verified by the passing tests below.
- ✓ config resolved once per call in `buildScoringContext`, threaded via `ScoringContext` (no `readFabricConfig` inside `credibilityFactor`).
- ✓ `pnpm -r exec tsc --noEmit` exits 0.
- ✓ `pnpm --filter @fenglimg/fabric-server test -- recall` — **860 passed / 2 skipped**, including the new stale<fresh fixture AND the existing `recall.test.ts:210/:528` `final===score` parity (now exercising the multiplier).

## Design rationale / deviations
- Multiplier applied to the WHOLE fused return (content + scaled structural + proximity) — a stale entry sinks even on a literal match, floored per maturity so never zeroed (softened "content leads" invariant).
- Orthogonal to `recencyBoost` (additive 7-day bump) and doctor usage-inactivity decay (last-activity age) — this is content-age, so composing never double-penalizes.
- Deviation from a literal reading of the convergence proxy (`>=2` occurrences of `* credibilityFactor`): hoisted to one call for DRY/clarity per task step 5; parity guaranteed by construction and test-verified.
- `created_at` drives age (content_hash + content_changed_at deferred — no sqlite persistence layer). Accepted v1 tradeoff: an in-place-edited entry keeps its authoring date.

# TASK-001 Summary — credibility config + zod schema + interface

**Status**: completed · **Executor**: main-thread (serial) · **Wave**: 1

## Files modified (actual)
- `packages/shared/src/schemas/fabric-config.ts` — added 5 optional `credibility_half_life_<type>_days` (int 1..3650) + 3 optional `credibility_floor_<maturity>` (number 0..1) fields to `fabricConfigSchema`, after the `orphan_demote` block.
- `packages/shared/src/schemas/api-contracts.ts` — added `credibility: z.number().optional()` to the `score_breakdown` zod object (after `proximity`), declared so zod `.strip()` does not drop it at the MCP boundary (KT-PIT-0005).
- `packages/shared/src/types/agents.ts` — added `credibility?: number` to the hand-written `RecallScoreBreakdown` interface (separate from the zod object; required or TASK-002's emit fails tsc).
- `packages/server/src/config-loader.ts` — added `readCredibilityHalfLives()` + `readCredibilityFloors()`, cloning the `readOrphanDemoteThresholdDays` best-effort per-key validated pattern but returning FULL default-filled records.

## Convergence verification (evidence)
- ✓ 8/8 string criteria (node includes): `credibility_half_life_decisions_days`, `credibility_floor_proven`, `credibility: z.number().optional()`, `credibility?: number`, both `export function read…`, defaults `decisions: 180` / `proven: 0.7`.
- ✓ `pnpm --filter @fenglimg/fabric-shared build` exits 0 — dist regenerated (index.d.ts 379KB) so the new `score_breakdown.credibility` field is present in built types.
- ✓ `pnpm -r exec tsc --noEmit` exits 0 (whole workspace).

## Defaults (the feature's tuning policy)
- Half-lives (days): decisions 180 / guidelines 150 / models 150 / pitfalls 120 / processes 120.
- Floors: draft 0.4 / verified 0.55 / proven 0.7.

## Deviations
- None. Readers return a FULL default-filled record (vs `readOrphanDemoteThresholdDays`' Partial) — intended per convergence criterion ("return a full Record"), so the TASK-002 multiplier never handles undefined.

## Design rationale
- Config + schema kept in one foundation task because they are the shared contract the multiplier depends on and both require the same `fabric-shared` dist rebuild before server/cli consume them.

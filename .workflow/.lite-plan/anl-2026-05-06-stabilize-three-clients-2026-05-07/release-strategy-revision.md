# Release Strategy Revision (TASK-040 finding)

## Original plan
Two-release ship: 1.7.1 (deprecation warnings only) cherry-picked to `release/v1.7.1`, then 1.8.0 (full stabilization) on `release/v1.8.0-stabilization`.

## Finding during TASK-040 execution
Cherry-pick of TASK-037 (e8ca6f0) onto `main` (v1.7.0) fails with conflicts on:
- `CHANGELOG.md` — different unreleased section state
- `docs/migration-1.8.md` — doesn't exist on main
- `packages/server/src/services/doctor.ts` — needs FabricError taxonomy (TASK-002) + new ledger event schemas (TASK-013/023/etc.)
- `packages/server/src/services/doctor.test.ts` — same
- `packages/shared/src/schemas/event-ledger.ts` — needs schema additions from many 1.8.0 commits

TASK-038 (i18n) and TASK-039 (action_hint) are simpler and would cherry-pick cleanly, but TASK-037 (deprecation warnings — the centerpiece of 1.7.1) is irrecoverably entangled with 1.8.0 infrastructure.

## Root cause
The original plan assumed 1.7.1 tasks could be developed in isolation on the 1.8.0 branch and cherry-picked. In practice, every 1.7.1 task that touched doctor.ts inherited the FabricError taxonomy + new ledger event types from 1.8.0 commits. Backporting would require either:
- Hand-crafting a parallel 1.7.0-compatible implementation (~half-day work)
- Or dropping the 2-release strategy and shipping everything in 1.8.0

## Decision
**Single 1.8.0 release.** Deprecation warnings ship in 1.8.0 alongside the removals. Users see warnings on first 1.8.0 install and can run `fab doctor --fix` to clean their config — the warning + removal happen in the same version, but the warning fires BEFORE any code path tries to use the legacy keys, so users still get a clean migration path.

## Impact
- TASK-040 (1.7.1 cherry-pick + tag) → SKIPPED (planning gap; documented here)
- TASK-037/038/039 still in 1.8.0 — they're already on `release/v1.8.0-stabilization`
- TASK-042 1.8.0 mega-PR description proceeds as planned
- CHANGELOG: drop the `[1.7.1]` section concept; expand `[1.8.0]` to include the deprecation entries

## Lesson for future plans
When planning cherry-pick releases, audit each task's dependencies on infrastructure that WILL exist on the target branch. If task A depends on infra B that's not on the cherry-pick target, A can't cherry-pick.

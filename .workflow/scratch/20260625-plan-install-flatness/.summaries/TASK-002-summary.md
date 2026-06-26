# TASK-002: Store 双槽模型 (1 personal + 1 team) + required_stores max-1 校验/迁移

Status: completed
Commit: d88df28 (branch feat/install-flatness-w2-store-dualslot)

## Changes
- `packages/shared/src/schemas/fabric-config.ts`: added `isNonPersonalRequiredStore` predicate, `refineMaxOneTeamStore` superRefine (≤1 team store), exported `migrateRequiredStores(config)` (reduces >1 → 1: keep active_write_store's store else first), and `fabricConfigLoadSchema` (refine-free LOAD variant). Applied `.superRefine(refineMaxOneTeamStore)` to the `required_stores` field.
- `packages/shared/src/store/project-config-io.ts`: `loadProjectConfig` now safeParse → on failure falls back to `fabricConfigLoadSchema` (tolerant) so legacy >1-team configs keep loading (backward-compat, R6); `saveProjectConfig` still strict-enforces max-1.
- `packages/shared/src/i18n/locales/en.ts` + `zh-CN.ts`: added 7 parallel `cli.install.store.slot.{personal,team}.*` keys. zh-CN uses `团队库(team 类)`; en uses `team-class`. Real aliases shown, never implying the store must be named `team` (KT-MOD-0001).
- `packages/cli/src/install/pipeline/store.stage.ts`: removed silent full-phase early-return (old :124 `hasWriteStore && unboundStores.length===0 → return`); always renders dual-slot panel. Added `migrateTeamSlotIfNeeded` (raw-read + migrate + re-save before strict load), `renderPersonalSlot` (always-visible personal status via TASK-001 renderer.renderInfo), `renderTeamSlotStatus`, `emitInfo` (renderer-or-console), and `promptTeamSlot` (single-select over ALL team candidates: bound-highlighted + mounted-unbound + join/create/skip; picking current = no-op). Removed old `promptStoreSetup` + orphaned `boundStoreAliases`. Deleted the "implicit + never listed" personal behavior.
- `packages/cli/src/store/store-ops.ts`: added `teamStoreCandidates(projectRoot, globalRoot)` + `TeamStoreCandidate` interface — per-slot team-type lister (bound first, then mounted-unbound). `unboundAvailableStores` kept intact.
- `packages/cli/__tests__/store.stage.dualslot.test.ts` (NEW): migration tests (2→1, active_write_store-preference, $personal-preserve/no-op, stage-level legacy migrate) + already-configured-renders-personal-slot test (asserts renderInfo called, not silent).
- `packages/cli/__tests__/install-v2-pipeline.test.ts`: updated the binds-a-selected-mounted-store assertion to the new `cli.install.store.slot.team.prompt` message.
- `packages/cli/__tests__/store-ops.test.ts`: adapted 2 pre-existing multi-team seeds (switch-write snapshot; missing-required-stores) to the max-1 single-team model.

## Verification (each convergence criterion)
- [x] C1 — refine on required_stores: `grep` shows `required_stores: z.array(requiredStoreEntrySchema).superRefine(refineMaxOneTeamStore).optional()` (fabric-config.ts:179).
- [x] C2 — `never listed` removed: `grep -c 'never listed' store.stage.ts` = 0.
- [x] C3 — silent skip removed: `grep -c 'unboundStores.length === 0' store.stage.ts` = 0.
- [x] C4 — `团队库` in zh-CN: count = 4; new copy uses `团队库(team 类)` / `team-class` wording, no copy forces literal alias `team` as a required name.
- [x] C5 [runtime] — migration test: `store.stage.dualslot.test.ts` feeds `required_stores` with 2 non-personal stores, asserts `migrateRequiredStores` → exactly 1 (PASS).
- [x] C6 [runtime] — already-configured renders personal slot: test asserts `renderer.renderInfo` called with a personal-store status line on a fully-configured project (PASS).

## Tests / Verification command output
Full command: `pnpm --filter @fenglimg/fabric-shared build && cd packages/cli && pnpm exec tsc --noEmit && pnpm test -- store.stage && cd <root> && pnpm test:store-only-e2e`
- [x] shared build: ok (ESM + DTS success)
- [x] cli `tsc --noEmit`: ok (exit 0)
- [x] cli `pnpm test -- store.stage`: 118 files / 1156 tests passed (the `--` arg didn't act as a name filter under this vitest config, so the FULL cli suite ran — all green; includes the 5 new dualslot tests).
- [x] `pnpm test:store-only-e2e`: verdict=pass
- [x] cross-package backward-compat (not in the gate, run defensively): `@fenglimg/fabric-shared test` 630 passed; `@fenglimg/fabric-server` tsc clean + 793 tests passed — existing >1-team / write_routes configs still load via the tolerant fallback.

## Deviations
1. **Tolerant `loadProjectConfig` (added beyond the literal task text).** A hard `superRefine` on the field makes `fabricConfigSchema.parse` throw on ANY pre-dual-slot >1-team config — and `loadProjectConfig` (shared) is used by the server's `cross-store-write` / `resolve-input` / doctor paths, where `write_routes` legitimately routes across >1 store today. Throwing at load would break that existing capability (violates "never break backward compatibility", the exact R6 risk). Fix: keep the refine as the documented contract enforced on `saveProjectConfig` (so no NEW over-bound config is written) + on the install migration path, but make `loadProjectConfig` fall back to a refine-free `fabricConfigLoadSchema` SOLELY when the only failure is the max-1 rule. Migration moves configs forward on next install. This satisfies C1 (refine present) and the migration requirement while preserving backward-compat. Verified: server suite stays fully green.
2. **`migrateTeamSlotIfNeeded` reads raw JSON** (not `loadProjectConfig`) because at phase start a legacy >1-team file must be regularized before any strict consumer touches it; `loadProjectConfig`'s tolerant fallback would also work but the explicit raw read avoids injecting all schema defaults prematurely.
3. **`pnpm test -- store.stage` ran the whole cli suite** rather than a filtered subset (vitest CLI arg passthrough under this config does not act as a path filter). All tests pass, so the gate is satisfied; the targeted dualslot tests were additionally run in isolation (5/5 pass).

## Notes for next task (TASK-004)
- store.stage.ts structure is clean for TASK-004's firstInstall flag + prompt-context labels: the dual-slot flow lives in `execute()` (migrate → renderPersonalSlot → team-slot prompt) + `promptTeamSlot`. TASK-004 only needs to ADD a firstInstall read + label context; no structural change to the slot rendering.
- The unified renderer surface used by the slots is `context.renderer.renderInfo` (via `emitInfo`), falling back to `console.log` on non-TTY — consistent with TASK-001.
- `teamStoreCandidates` in store-ops.ts is the team-slot data source if any later task needs the same candidate list elsewhere.

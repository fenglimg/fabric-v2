# W3-D Refactor — reflection log

> doctor 八合一拆分 + 新 audit 组。分支 `feat/w3d-doctor-split`。

## TASK-001 — new `audit.ts` group + server export
- **Strategy**: mirror `store.ts` subCommands; move the 6 audit-domain renderers from doctor.ts VERBATIM (byte-identical output → existing string/snapshot assertions hold). Added `inspectRetiredReferences` to fabric-server exports for the new `audit retired` surface.
- **Result**: server build + cli tsc green. `audit` group wires up (cite/conflicts/history/descriptions/metrics/retired); `metrics` kept as a thin top-level alias.

## TASK-003 — slim doctor.ts + merge --fix
- **Strategy**: remove the 6 moved arms + the up-front --since validation + the fix/fix-knowledge mutex; merge `--fix` to run BOTH derived-state fixes AND knowledge mutations. Kept the knowledge-mutation safety confirm + honesty (consent computed from a pre-flight report, shown only when plan.totalCount>0 — KT-PIT-0016). doctor.ts 1689 → ~750 lines.
- **Adjustment**: hardened the post-mutation report guards to `!= null` (mocks return `undefined`, not `null`) and `report = fixKnowledgeReport?.report ?? preReport` so a no-op knowledge mock can't crash the renderer.
- **Test status**: cli tsc green; doctor surface snapshot updated (moved flags removed — clean 99-line deletion).

## TASK-005 — test migration (migrate-before-delete)
- **Strategy**: migrated `doctor-cite-coverage.test.ts` → `audit-cite.test.ts` (import `citeCommand`); converted the `--fix-knowledge` block to the merged `--fix` (added `detectUnboundProject` mock since merged --fix now backfills); deleted the mutex test; moved the archive-history + --since coverage into a new `audit.test.ts` covering history/conflicts/descriptions/retired.
- **Result**: doctor.test 16✓, audit-cite 11✓, audit 8✓.

## TASK-005b — migrate-before-delete + retired-reference lint round-trip
- **Strategy**: migrated all agent-surface references (`fabric doctor --cite-coverage` → `fabric audit cite`) in templates (cite-contract.md, cite-policy-evict.cjs) + docs (USER-QUICKSTART) + bootstrap-canonical.ts; registered `doctor --cite-coverage` / `doctor --fix-knowledge` in the W2-2 RETIRED_TOKENS registry.
- **Oracle caught a miss**: running the new `fabric audit retired` against the repo flagged 7 stragglers — including a TRACKED one (`.fabric/AGENTS.md` ← `bootstrap-canonical.ts`) the first sweep missed. Producer→consumer round-trip (KT-PIT-0014) did its job. Migrated bootstrap-canonical + synced `.fabric/AGENTS.md` + updated the two bootstrap tests (canonical assertion + parity protected-token list).
- **Note**: `.claude`/`.codex` dogfood copies are gitignored (W2-1) → regenerate clean on `fabric install`; only tracked sources committed.

## Final verification
- `pnpm -r exec tsc --noEmit` → 0
- shared 625 / server 779 / cli 1143 pass.
- Sole cli failure = `ai-client-policy-drift` reading repo-root `AGENTS.md`, which is deleted in the local working tree (pre-existing, unrelated; AGENTS.md is committed on-branch → CI-green).
- builds: shared / server / cli all build (dist + dts).
- smoke: `fabric audit --help`, `fabric audit retired`, `fabric doctor --help` (slimmed) all correct.

## Key learnings
- Wall-clock-free producer→consumer oracle (the retired-reference lint surfaced as a real CLI command) caught a tracked-source miss that grep-by-known-paths did not — register the token THEN run the consumer against the real workspace.
- Merging two mutation flags with different safety semantics: run the riskier (knowledge, consent-gated) consent FIRST so an abort leaves the workspace fully untouched, then apply derived-state + knowledge.

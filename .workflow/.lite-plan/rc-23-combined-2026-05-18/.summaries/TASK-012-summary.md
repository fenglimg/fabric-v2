# TASK-012: F8a — remove fab scan baseline mechanism entirely

## Changes

- `packages/cli/src/commands/scan.ts`: **DELETED** (1619 lines) — runInitScan / 5 baseline builders (buildTechStack / buildModuleStructure / buildReadmeParagraph / buildBuildConfig / buildCiConfig) / KNOWN_BASELINE_IDS+SLUGS / migrateLegacyBaselineFilenames / BASELINE_TEMPLATES bilingual registry / formatKnowledgeId re-export / `__testing__` builder bundle all gone.
- `packages/cli/src/lib/detect-language.ts`: **NEW** — extracted `detectExistingLanguage` + `ResolvedLanguage` type as a standalone utility (consumed by install.ts:writeDefaultFabricConfig).
- `packages/cli/src/commands/install.ts`: dropped `runInitScan` import + call block (L776-797) + supporting comments. `detectExistingLanguage` import re-pointed to `../lib/detect-language.js`. All `runInitScan` / `fab scan` / `init-scan` references in surrounding comments replaced with rc.23 TASK-012 (F8a) anchors.
- `packages/cli/src/commands/doctor.ts`: dropped `runInitScan` import, `--rescan` flag definition, `args.rescan` parsing, and `if (rescan) await runInitScan(...)` dispatch.
- `.fabric/knowledge/models/KT-MOD-0001--tech-stack.md`, `KT-MOD-0002--module-structure.md`, `KT-MOD-0003--readme-first-paragraph.md`, `.fabric/knowledge/processes/KT-PRO-0001--build-config.md`: **DELETED** (KT-PRO-0002 ci-config did not exist in repo).
- `.fabric/knowledge/.scan-state.json`: **DELETED** (was at `knowledge/`, not `.fabric/` root).
- `packages/cli/__tests__/scan-builders.test.ts`, `packages/cli/__tests__/integration/scan-init.test.ts`: **DELETED**.
- `packages/cli/__tests__/doctor.test.ts`: removed `describe("--rescan flag")` block (2 tests: --rescan invokes runInitScan / default no-call).
- `packages/cli/__tests__/init-atomic.test.ts`: rewrote 2 assertions that depended on init-scan side effects — `events.jsonl contains "install_diff_applied"` (was `"init_scan_completed"`); fresh-init emits zero `.md` files under `.fabric/knowledge/` (was ≥1).
- `packages/cli/__tests__/__snapshots__/cli-surface.test.ts.snap`: removed `rescan` arg entry from doctor command surface snapshot.
- `packages/shared/src/i18n/locales/{en,zh-CN}.ts`: removed `cli.doctor.args.rescan.description` translation key.
- `packages/cli/README.md`: rewrote rc.15 callout — now states rc.23 removed baseline scan; KB sources are Skills only.
- `packages/cli/templates/skills/{fabric-archive,fabric-review}/SKILL.md`: re-pointed `scan.ts:detectExistingLanguage` → `lib/detect-language.ts:detectExistingLanguage`.
- `packages/server/src/services/doctor.ts`: updated inline comments + the `lint-baseline-filename-format` action hint string to remove `fab scan` references (lint remains as defensive detector; resolution now manual deletion).
- `packages/server/src/services/doctor.test.ts`: renamed + adjusted the resolution-references test to assert `delete|manual` action hint shape instead of `fab scan`.

## Verification

- [x] **git grep "runInitScan|KNOWN_BASELINE" packages → 1 hit (≤1 history-comment allowance)**: only `packages/cli/__tests__/doctor.test.ts:543` (a deliberate anchor comment).
- [x] **git grep "fab scan" packages → 0 hits**.
- [x] **No baseline .md files**: `find .fabric/knowledge -name "KT-MOD-000*" -o -name "KT-PRO-000*"` returns empty.
- [x] **scan.ts deleted**: file no longer present.
- [x] **CLI build**: clean (no scan-* chunks in dist).
- [x] **Shared build**: clean.
- [x] **Server build**: clean.
- [x] **doctor.test.ts --rescan suite removed**: confirmed.

## Tests

- [x] `pnpm -F @fenglimg/fabric-shared test`: **346/346 pass**.
- [x] `pnpm -F @fenglimg/fabric-cli test`: **567/567 pass** (41 files; 1 file had 2 pre-existing failures in init-atomic.test.ts now fixed by this task's test rewrites).
- [⚠] `pnpm -F @fenglimg/fabric-server test`: **510/512 pass | 1 skipped | 1 fail**. The single failing test (`tool-contracts > fab-extract-knowledge contract matches snapshot`) is **unrelated to TASK-012** — it's pre-existing drift from rc.23's other tasks (source_session deprecation + warnings field addition on the fab-extract-knowledge tool contract). Server doctor.test.ts alone runs **180/180 green**.

## Deviations

- **detectExistingLanguage was preserved as utility**: install.ts L397 depends on it for `fabric_language` auto-detection on fresh install, so it was extracted to `packages/cli/src/lib/detect-language.ts` rather than deleted (per task spec's contingency rule "若 install.ts 也用…保留它独立成 utility").
- **agents.meta.json not manually edited**: the file already had no KT-MOD-000{1,2,3} / KT-PRO-000{1,2} node entries (they were pruned in earlier auto-heal runs). No manual edit needed; reconcile will continue to function.
- **Server-side `inspectBaselineFilenameFormat` lint retained**: the lint code itself remains as a defensive detector for legacy bare-slug baseline files. The action hint + comments were updated to reflect that no auto-fix exists in rc.23+ (manual deletion is the recovery path). Removing the lint entirely would expand TASK-012's blast radius into server doctor surface — kept minimal per scope discipline.
- **forensic.json scan fields**: searched — `.fabric/forensic.json` has no scan-related fields; nothing to clean.

## Notes

- Next task: F8c (TASK-014) onboard phase should now own the first-install UX gap left by KB being completely empty post-install.
- The `source` enum in `packages/shared/src/schemas/event-ledger.ts` L194 still lists `"init" | "scan" | "doctor_fix" | "doctor-rescan"` — these values are now unused but the enum was not narrowed (optional field; would touch shared schema which is out of TASK-012's CLI scope).
- The unrelated server tool-contracts snapshot drift needs to be addressed by whichever rc.23 task introduced the `source_session` removal + `warnings` field on `fab-extract-knowledge` — re-running `pnpm test -u` from that task's scope will refresh the snapshot.

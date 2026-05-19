# TASK-09: CiteCoverageReport type extension + bilingual i18n locales for contract metrics

## Changes

- `packages/shared/src/schemas/api-contracts.ts`:
  - Added new `citeContractMetricsSchema` (Zod) + exported `CiteContractMetrics` type — mirrors `packages/server/src/services/doctor.ts` TASK-08 runtime type verbatim (7 fields: `decisions_cited`, `pitfalls_cited`, `contract_with`, `contract_missing`, `hard_violated`, `cite_id_unresolved`, `skip_count: Record<string, number>`).
  - Added `citeLayerTypeBreakdownSchema` + `CiteLayerTypeBreakdown` type. Outer keys `team`/`personal`; inner `Record<string, number>` keyed by SINGULAR knowledge_type literals (`decision` / `pitfall` / `model` / `guideline` / `process` / `unresolved`) — open-keyed so a future type addition extends cleanly.
  - Added `citeCoverageReportSchema` + `CiteCoverageReport` type. Includes ALL rc.20 fields (`status`, `marker_ts`, `marker_emitted_now`, `since_ts`, `client_filter`, `metrics`, `per_client`, `dismissed_reason_histogram`, `none_reason_histogram`, `generated_at`) PLUS rc.24 TASK-08 additions: `layer_filter?` (enum `team` | `personal` | `all`), `contract_metrics_status?` (3-value enum: `ok` / `skipped:bootstrap_drift` / `awaiting_marker`), `contract_metrics?`, `per_layer_type?`, `contract_marker_ts?`. All TASK-08 additions optional to preserve rc.20 wire-compat.
  - Schema placed BEFORE the existing API contract block, with header comment cross-referencing `doctor.ts` as the runtime source-of-truth.

- `packages/shared/src/i18n/locales/zh-CN.ts`:
  - Added 27 new `cite-coverage.*` keys (block inserted directly after the existing rc.20 `doctor.cite.*` block, before `cli.doctor.args.target.description`).
  - Header comment cross-references TASK-09 + the canonical schema export.

- `packages/shared/src/i18n/locales/en.ts`:
  - Mirrored the same 27 keys in English, preserving key order.

- `packages/shared/test/api-contracts.test.ts`:
  - Added imports for `citeContractMetricsSchema`, `citeCoverageReportSchema`, `citeLayerTypeBreakdownSchema`, `zhCNMessages`, `enMessages`.
  - Added `CITE_COVERAGE_TASK09_KEYS` canonical array (27 entries) — this is the single source the renderer (TASK-10) should reference.
  - Added new `describe("CiteCoverageReport (rc.24 TASK-09 contract metrics schema)")` block with 7 it() cases:
    1. roundtrips a report with full `contract_metrics` and `per_layer_type` (status='ok')
    2. accepts a rc.20-shaped report without any TASK-08 additive fields
    3. roundtrips `per_layer_type` cross-tab with all six singular type keys
    4. rejects an invalid `contract_metrics_status` enum value
    5. accepts each of the three `contract_metrics_status` enum values (`ok` / `skipped:bootstrap_drift` / `awaiting_marker`)
    6. rejects invalid `layer_filter` (e.g. `"both"` — the rc.20 plan-context vocabulary differs from rc.24 cite-coverage)
    7. preserves open-keyed `skip_count` vocabulary (operator-author extensible per B1 grill-me lock)
  - Added new `describe("CiteCoverageReport i18n key parity (rc.24 TASK-09)")` block with 3 it() cases:
    1. zh-CN exports every canonical TASK-09 key (with non-empty value)
    2. en exports every canonical TASK-09 key (with non-empty value)
    3. zh-CN and en `cite-coverage.*` key sets are byte-identical (sorted equality + superset against canonical list — catches future drift in EITHER direction)

## Canonical i18n key list (27 keys — `CITE_COVERAGE_TASK09_KEYS`)

For TASK-10 renderer — these are the EXACT keys the renderer must look up via `t(...)`:

```
cite-coverage.contract.header
cite-coverage.contract.decisions_cited
cite-coverage.contract.pitfalls_cited
cite-coverage.contract.with
cite-coverage.contract.missing
cite-coverage.contract.hard_violated
cite-coverage.contract.cite_id_unresolved
cite-coverage.contract.skip_count
cite-coverage.contract.status.ok
cite-coverage.contract.status.skipped_bootstrap_drift
cite-coverage.contract.status.awaiting_marker
cite-coverage.contract.type.decision         ← singular (matches KnowledgeTypeSchema literal)
cite-coverage.contract.type.pitfall          ← singular
cite-coverage.contract.type.model            ← singular
cite-coverage.contract.type.guideline        ← singular
cite-coverage.contract.type.process          ← singular
cite-coverage.contract.type.unresolved       ← 6th bucket (cite_id absent from idTypeMap)
cite-coverage.layer.team
cite-coverage.layer.personal
cite-coverage.layer.team_review
cite-coverage.layer.personal_fyi
cite-coverage.skip.sequencing
cite-coverage.skip.conditional
cite-coverage.skip.semantic
cite-coverage.skip.aesthetic
cite-coverage.skip.architectural
cite-coverage.skip.other
```

**Renderer guidance for TASK-10**:
- For `per_layer_type.<layer>.<type>` cross-tab, look up `cite-coverage.contract.type.<type>` directly (singular). Fall back to the raw `<type>` key if the lookup misses — accommodates a future `KnowledgeType` enum addition that ships before the i18n catches up.
- For `skip_count` keys, look up `cite-coverage.skip.<key>` and fall back to the raw key for unknown buckets (operator-author-controlled vocabulary).
- For `contract_metrics_status`, the colon-delimited status `'skipped:bootstrap_drift'` maps to i18n key `cite-coverage.contract.status.skipped_bootstrap_drift` (dot-replaced) — keep this transform local to the renderer.

## Verification

- [x] `api-contracts.ts CiteCoverageReport schema contains 'contract_marker_ts', 'contract_metrics_status', 'contract_metrics', 'per_layer_type', 'layer_filter'` — all 5 present (verified via `grep -c` returning 11 matches across schema + type + comments).
- [x] `contract_metrics_status enum has all 3 values: 'ok', 'skipped:bootstrap_drift', 'awaiting_marker'` — exact tuple `z.enum(["ok", "skipped:bootstrap_drift", "awaiting_marker"])` in the schema; verified by test "accepts each of the three contract_metrics_status enum values".
- [x] `contract_metrics shape contains all 7 sub-fields per spec` — `decisions_cited`, `pitfalls_cited`, `contract_with`, `contract_missing`, `hard_violated`, `cite_id_unresolved`, `skip_count`. Verified by full-roundtrip test.
- [x] `zh-CN.ts contains ≥27 new cite-coverage.* keys` — `grep -c '"cite-coverage\.' = 27`. (Spec asked ≥18; delivered 27 per user-provided expanded plan.)
- [x] `en.ts contains identical key set to zh-CN` — `grep -c '"cite-coverage\.' = 27`; key parity test asserts byte-identical sorted key sets.
- [x] `api-contracts.test.ts adds ≥4 new roundtrip cases` — 10 new tests added (7 schema + 3 i18n parity). Schema-specific cases alone are 7, comfortably exceeding the ≥4 floor.
- [x] `pnpm --filter @fenglimg/fabric-shared test exits 0` — 396/396 tests pass across 26 test files in 1.05s.
- [x] TypeScript: `pnpm exec tsc --noEmit` from `packages/shared/` exits 0.
- [x] Commit message convention: `feat(rc24): CiteCoverageReport contract fields + bilingual i18n (TASK-09)`.

## Tests

- [x] `pnpm --filter @fenglimg/fabric-shared test api-contracts` — 57/57 pass (was 47 pre-TASK-09 → 10 net new). 284ms total.
- [x] `pnpm --filter @fenglimg/fabric-shared test` — 396/396 pass across 26 files; no regression.
- [x] `tsc --noEmit` in `packages/shared/` — clean.

## Deviations

- **Cross-package type duplication intentional.** The runtime `CiteCoverageReport` lives in `packages/server/src/services/doctor.ts` (TASK-08); the Zod schema in shared mirrors but does not import it (would create a circular package dep). The api-contracts header documents this explicitly and the roundtrip tests guard against drift. If a future rc moves the runtime type into shared, the doctor.ts type alias can re-import from shared without breaking consumers.
- **`layer_filter` rejects `"both"` (rc.20 vocabulary).** The rc.20 `planContextInputSchema.layer_filter` accepts `"team" | "personal" | "both"` but the rc.24 `CiteCoverageReport.layer_filter` is `"team" | "personal" | "all"`. This mirrors the TASK-08 runtime type verbatim — the cite-coverage audit semantics use "all" (meaning "no filter, count everything") rather than "both" (meaning "union of two enumerated values"). Test case 6 pins this distinction. Documented for TASK-10 renderer wiring.
- **Schema additive only.** Zero rc.20 fields renamed or removed; all TASK-08 fields optional (`.optional()`) so any pre-rc.24 caller continues to parse byte-for-byte the same payloads.

## Notes for TASK-10 (CLI renderer)

- Import the canonical key list from `packages/shared/test/api-contracts.test.ts` for cross-test reuse — or copy the `CITE_COVERAGE_TASK09_KEYS` constant into the renderer-side source if the renderer wants to defend against locale drift at runtime.
- The `t()` translator (Translator type from `packages/shared/src/i18n/types.ts`) is open-keyed (`Record<string, string>`); a misspelled key returns the key itself, not a TypeScript error. The parity tests catch this at test-time; the renderer should hard-code the keys defensively but doesn't need a typed lookup table.
- For `contract_metrics_status` rendering: `"skipped:bootstrap_drift"` → i18n key `"cite-coverage.contract.status.skipped_bootstrap_drift"` (replace `:` with `_`). Local transform — keep it in the renderer.
- `skip_count` is open-keyed (operator-extensible). For unknown reasons, fall back to the raw key. The bootstrap-canonical vocabulary covers `sequencing` / `conditional` / `semantic` / `aesthetic` / `architectural` / `other`.

## Status

completed

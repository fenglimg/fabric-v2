# TASK-10: CLI doctor --layer flag + bilingual contract report renderer

## Changes

- `packages/cli/src/commands/doctor.ts`:
  - **DoctorArgs**: added `layer?: string` field (citty surfaces strings via raw arg shape).
  - **citty args definition**: added new `layer` arg with:
    - `type: "string"`
    - `description: t("cli.doctor.args.layer.description")` → "Filter cite contract audit by KB layer (team|personal|all)" (en) / "按知识层过滤 cite 合约审计 (team|personal|all)" (zh-CN)
    - `default: "all"`
    - `valueHint: "team|personal|all"`
  - **--cite-coverage branch**: after the existing client-filter validation, added explicit `layer` validation: rejects anything outside `{'team','personal','all'}` with `cli.doctor.errors.invalid-layer` and `process.exitCode = 1`. Explicitly rejects `"both"` (the rc.20 plan-context vocabulary — the test surface pins this distinction). Validated `layerFilter` is then passed through to `runDoctorCiteCoverage` as the `layer` option.
  - **isValidLayerFilter type guard** + `CITE_COVERAGE_LAYER_FILTERS` Set added next to the existing `isValidClientFilter` helper (consistent shape with rc.20 precedent).
  - **renderCiteCoverageReport**: added a new `appendContractSection(lines, report)` helper invoked once at the end (after the rc.23 KB:none histogram). The helper:
    1. Returns early if `contract_metrics_status === undefined` (pre-TASK-08 server payload — graceful degrade for byte-for-byte rc.20 compat).
    2. Suppresses the entire contract section when `status === 'awaiting_marker'` AND every contract counter is zero (per convergence criterion — avoids visual noise during the "fresh marker, no qualifying turns yet" gap).
    3. On `status === 'skipped:bootstrap_drift'`: emits a single warning line using `cite-coverage.contract.status.skipped_bootstrap_drift` (the i18n string already carries the "run `fab install`" remediation hint).
    4. On `status === 'ok'` (or `awaiting_marker` with non-zero counts): emits a full block with:
       - `### Contract check` header (`cite-coverage.contract.header`)
       - `status` line + `since` (from `contract_marker_ts`) + `layer filter` (from `report.layer_filter`)
       - 4 contract counter lines (`decisions_cited`, `pitfalls_cited`, `with`, `missing`)
       - **hard_violated line with layer suffix**: uses `[team — review]` when `layer_filter ∈ {team, all}`, `[personal — fyi]` when `layer_filter === 'personal'` (only rendered when `hard_violated > 0`)
       - **per-layer × type cross-tab**: iterates `per_layer_type.team` then `per_layer_type.personal`, emits one row per non-zero singular knowledge_type key (`decision/pitfall/model/guideline/process/unresolved`). Empty layers collapse to nothing.
       - **skip_count histogram**: looks up `cite-coverage.skip.<reason>` via i18n; unknown reasons (operator-extensible vocab) pass through the raw key (translator returns key when no entry exists).
       - **cite_id_unresolved tail line**: rendered as a separate `⚠` line only when `cite_id_unresolved > 0`.

- `packages/shared/src/i18n/locales/zh-CN.ts` + `packages/shared/src/i18n/locales/en.ts`:
  - Added 2 new keys per locale: `cli.doctor.args.layer.description` + `cli.doctor.errors.invalid-layer`. Bilingual parity preserved.

- `packages/cli/__tests__/integration/doctor-cite-coverage.test.ts` (NEW FILE):
  - 11 integration test cases (well above the ≥7 floor):
    1. `--layer=team` passes through to `runDoctorCiteCoverage` (call-arg inspection)
    2. `--layer=invalid` rejects with `process.exitCode=1` + stderr mentions `--layer` + the bad input. **Explicitly tests `"both"` rejection** to pin the rc.20-vocabulary distinction.
    3. Renderer emits contract header + decisions_cited + with labels when `status='ok'` with non-zero counts
    4. Renderer emits `skipped_bootstrap_drift` message when status is the drift discriminator
    5. Renderer applies `[team — review]` suffix when `layer_filter='team'` and `hard_violated>0`; asserts `[personal — fyi]` does NOT appear
    6. Renderer applies `[personal — fyi]` suffix when `layer_filter='personal'`
    7. Renderer emits `skip_count` histogram with translated `sequencing` + `architectural` labels AND falls back to the raw key `experimental-feature-flag` for unknown buckets
    8. Renderer suppresses the entire contract section when `status='awaiting_marker'` AND all counts zero (rc.20 section still renders)
    9. Renderer emits per-layer × type cross-tab using singular keys (`decision`, `pitfall`) + both layer labels
    10. Renderer emits `cite_id_unresolved` as a tail `⚠` line carrying the count
    11. Bilingual mode honors locale config — zh-CN and en yield different `contract.header`, `skip.sequencing`, and `layer.team_review` strings

## Verification

- [x] **doctor.ts contains arg `layer` with citty schema** — verified at line ~138 (`layer: { type: "string", description: ..., default: "all", valueHint: "team|personal|all" }`).
- [x] **doctor.ts validates layer value against `['team','personal','all']`** — verified via `isValidLayerFilter` type-guard helper + explicit rejection path with `cli.doctor.errors.invalid-layer` (test case 2).
- [x] **doctor.ts passes layer option to runDoctorCiteCoverage** — verified by test case 1 mock spy.
- [x] **Renderer emits `cite-coverage.contract.header` section when `contract_metrics_status === 'ok'` AND any count > 0** — verified by test case 3.
- [x] **Renderer suppresses contract section when status='awaiting_marker' AND all counts 0** — verified by test case 8 (asserts `not.toContain(contract.header)`).
- [x] **Renderer emits "skipped (bootstrap drift — run `fab install`)" when status='skipped:bootstrap_drift'** — verified by test case 4 (i18n string includes the remediation hint).
- [x] **`doctor-cite-coverage.test.ts` adds ≥7 new integration cases** — 11 cases delivered.
- [x] **`pnpm --filter @fenglimg/fabric-cli test doctor-cite-coverage` exits 0** — 11/11 pass in 130ms.
- [x] **Commit msg: `feat(rc24): doctor --layer flag + contract report renderer (TASK-10)`** — applied.

## Tests

- [x] `pnpm --filter @fenglimg/fabric-cli test doctor-cite-coverage` — 11/11 pass (130ms).
- [x] `pnpm --filter @fenglimg/fabric-cli test` — 618/619 pass. **The single failure is `cli-surface.test.ts` snapshot drift** which is EXPECTED and is the explicit mandate of TASK-11 (regenerate the CLI surface snapshot to include `--layer`). The drift diff exactly matches the new arg shape:
  ```
  + "default": "all",
  + "description": "Filter cite contract audit by KB layer (team|personal|all)",
  + "name": "layer",
  + "type": "string",
  ```
- [x] `pnpm --filter @fenglimg/fabric-shared test` — 396/396 pass; i18n parity preserved across zh-CN + en (28 cite-coverage keys per locale + 2 new TASK-10 CLI keys per locale).
- [x] `pnpm --filter @fenglimg/fabric-shared test api-contracts` — 57/57 pass (no schema-side regression).
- [x] `pnpm exec tsc --noEmit` in `packages/cli/` — clean (after rebuilding server `dist/` to surface TASK-08's CiteCoverageReport type additions).

## Renderer-shape decisions (for TASK-11 snapshot regeneration)

### CLI surface (--help / introspection)

The `--layer` arg appears in the citty `args` array sorted alphabetically (between `json` and ... wait — actually between `fix-knowledge` and `since` per the snapshot's current order). The snapshot regen MUST insert the following block at the alphabetical position:

```json
{
  "alias": undefined,
  "default": "all",
  "description": "Filter cite contract audit by KB layer (team|personal|all)",
  "name": "layer",
  "negativeDescription": undefined,
  "required": undefined,
  "type": "string",
},
```

Wording chosen for stability:
- Mirrors the structure of the existing `client` arg description (`"Filter cite coverage by client (cc|codex|cursor|all)"`).
- The valueHint `team|personal|all` is NOT in the citty surface snapshot (citty drops valueHint from the descriptor in the surface dump — same as the existing `client` arg). The "description" carries the value vocabulary inline.

### Line-ordering inside the contract section

The renderer emits (within the contract block) the following stable order:
1. `### Contract check` (or i18n equivalent)
2. `status: <translated status>` + `since: <ISO timestamp>` + `layer filter: <layer>`
3. `decisions_cited` / `pitfalls_cited` / `with` / `missing` (4 lines, always)
4. `hard_violated` line with `[team — review]` or `[personal — fyi]` suffix (only when > 0)
5. blank line + `#### team × personal` heading + per-layer-type rows (only when any non-zero cell)
6. blank line + `#### Skip bucket` heading + skip rows (only when skip_count non-empty)
7. blank line + `⚠ Unresolved cite IDs: N` (only when > 0)

### Empty-section handling

- Skip bucket histogram is fully suppressed (no header) when `Object.keys(skip_count).length === 0`.
- Per-layer × type table is fully suppressed (no header) when every cell across both layers is zero.
- The `since:` and `layer filter:` lines are conditionally omitted when the corresponding field is undefined (defensive for pre-rc.24 server payloads).

## Deviations

- **per_layer_type does NOT include `hard_violated` as an inner key** (per TASK-08 contract — inner keys are singular knowledge_type + `unresolved`). The hard-violation count is only aggregated at `contract_metrics.hard_violated`. The renderer therefore picks the layer suffix from `report.layer_filter` rather than splitting hard violations into two lines. When `layer_filter === 'all'` the default is `[team — review]` (conservative — team violations require review). A future rc that surfaces per-layer hard_violated counters can split this line; the current shape gives one stable interpretation. **Flagged for future** if operators want a split view.
- **`appendContractSection` is a free function (not nested inside `renderCiteCoverageReport`)** to keep cyclomatic complexity per function low; mirrors the rc.7 T11 helper extraction precedent (`computeFixKnowledgePlan`).
- **Test case 11 uses the static translator directly** to assert bilingual key parity rather than running the command in two locale modes. Rationale: the locale-switching plumbing is exercised by `banner-i18n.test.ts` + `i18n.test.ts` (which are passing); pinning the cite-coverage strings via the static translator gives faster feedback and avoids fragile env-var manipulation.

## Notes for TASK-11

- The `--help` snapshot regeneration is straightforward: run `pnpm --filter @fenglimg/fabric-cli test -u` to update the snapshot. The expected diff is the 7-line block shown above inserted between `fix-knowledge` and `since` (alphabetical).
- After snapshot regen, `cli-surface.test.ts` should report 1 failed → 0 failed; full CLI suite returns to all-green.
- The `cli.doctor.args.layer.description` wording is operator-facing; TASK-12 (CHANGELOG + migration note) may want to surface `--layer` under the rc.24 release notes' "New flags" section.

## Status

completed

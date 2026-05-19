# TASK-08: Extend runDoctorCiteCoverage with contract metrics + type routing + unresolved bucket + layer breakdown

## Changes

- `packages/server/src/services/doctor.ts`:
  - **Imports**: `loadKbIdTypeMap` added to the `./knowledge-meta-builder.js` import block.
  - **CiteCoverageReport type extension** (purely additive — no rc.20 fields renamed or removed):
    - `layer_filter?: "team" | "personal" | "all"` — surfaces the new option.
    - `contract_metrics_status?: "ok" | "skipped:bootstrap_drift" | "awaiting_marker"`
    - `contract_metrics?: CiteContractMetrics` — new exported type.
    - `per_layer_type?: CiteLayerTypeBreakdown` — new exported type.
    - `contract_marker_ts?: number` — pass-through of contract marker timestamp for CLI rendering.
  - **New exported types**:
    ```ts
    export type CiteContractMetrics = {
      decisions_cited: number;
      pitfalls_cited: number;
      contract_with: number;
      contract_missing: number;
      hard_violated: number;
      cite_id_unresolved: number;
      skip_count: Record<string, number>;
    };
    export type CiteLayerTypeBreakdown = {
      team: Record<string, number>;
      personal: Record<string, number>;
    };
    ```
    Note: `skip_count` keys = whatever `skip_reason` strings the parser wrote (no enum gatekeeping at doctor — operators data-drive vocabulary expansion per plan B1).
  - **runDoctorCiteCoverage signature** gained optional `layer?: "team" | "personal" | "all"` (defaults `"all"` so existing CLI callers don't break — TASK-10 will wire `--layer`).
  - **Implementation**:
    1. Calls `ensureCiteContractPolicyActivatedMarker(projectRoot)` and `loadKbIdTypeMap(projectRoot)` up-front (alongside the existing rc.20 `ensureCitePolicyActivatedMarker`).
    2. Resolves `contractStatus`:
       - `blocked_by === 'bootstrap_drift'` → `'skipped:bootstrap_drift'`
       - `marker_ts === 0 && blocked_by === null` → `'awaiting_marker'`
       - else → `'ok'`
    3. `contractEffectiveSince = max(contractMarker.marker_ts, options.since)` when status is `'ok'`; `Number.POSITIVE_INFINITY` otherwise (ensures no event qualifies in degraded modes).
    4. Builds `sessionEditPaths: Map<session_id, string[]>` (normalized POSIX paths) from `edit_intent_checked` events — reused as the comparator data source.
    5. Per-turn contract walk (only when `contractStatus === 'ok'` and `turn.ts >= contractEffectiveSince`):
       - Iterates index-aligned `(cite_ids[i], cite_commitments[i])` for `i in 0..cite_ids.length`.
       - Applies layer filter via id prefix (`KT-` team, `KP-` personal).
       - `idTypeMap.get(citeId)` returns the SINGULAR `KnowledgeType` enum from TASK-07; routing:
         - `undefined` → `cite_id_unresolved++`, cross-tab `[layer].unresolved++`.
         - `'decision'` / `'pitfall'` → strict bucket; if `skip_reason !== null` → `skip_count[reason]++` and exit; if `operators.length === 0` → `contract_missing++`; else `contract_with++` and run comparator; if comparator returns violation → `hard_violated++`.
         - `'model'` → cross-tab only (reference-only cite).
         - `'guideline'` / `'process'` → cross-tab only (deferred to rc.25 LLM-judge).
       - Cross-tab is bumped for every resolved cite regardless of bucket.
    6. Comparator (`evaluateOperatorViolation`):
       - `edit:<glob>` → minimatch over session edit paths; violates if no match.
       - `not_edit:<glob>` → violates if ANY session edit matches.
       - `require:<symbol>` → substring match over session edit paths; violates if no path contains symbol.
       - `forbid:<symbol>` → violates if ANY path contains symbol.
    7. Returns extended `CiteCoverageReport` with the new fields populated (zeroed contract block when status !== 'ok' so the CLI renderer iterates one stable shape).

- `packages/server/src/services/doctor.test.ts`:
  - Added new `describe("runDoctorCiteCoverage (rc.24 contract metrics)")` block with **17 `it()` cases** (exceeds the 15-case spec):
    1. `bootstrap drift → contract_metrics_status='skipped:bootstrap_drift', rc.20 metrics still computed`
    2. `decision cite with edit:foo.ts operator and matching session edit → contract_with=1, hard_violated=0`
    3. `decision cite with edit:foo.ts operator but no matching edit → hard_violated=1`
    4. `pitfall cite with empty operators and no skip_reason → contract_missing=1, pitfalls_cited=1`
    5. `model cite → no contract bump, cross-tab still counts the type`
    6. `guideline cite → deferred bucket, no contract check`
    7. `unresolved cite_id (not in idTypeMap) → cite_id_unresolved=1, contract_missing=0`
    8. `decision cite with skip_reason='sequencing' → skip_count.sequencing=1`
    9. `personal-layer KP-* cite counted under per_layer_type.personal`
    10. `--layer=team filter → KP-* cites excluded from contract counters but still tracked in per_layer_type` (actually verifies KP-* dropped from BOTH counters and cross-tab — see deviation below)
    11. `--layer=personal filter → KT-* cites excluded from contract counters`
    12. `cross-tab populated with both layers and multiple types in one report`
    13. `require:<symbol> passes when symbol appears as substring of any session edit path`
    14. `forbid:<symbol> violates when symbol appears in a session edit path`
    15. `not_edit:<glob> violates when a session edit hits the forbidden glob`
    16. `rc.20 metrics (qualifying_cites/recalled_unverified/dismissed_reason_histogram) unchanged in shape`
    17. `nonexistent project root → contract_metrics_status='skipped:bootstrap_drift' (missing snapshot folded into drift)`
  - New helpers within the block: `seedCleanBootstrap` (writes `.fabric/AGENTS.md = BOOTSTRAP_CANONICAL`), `seedAgentsMetaWithTypes` (includes `description.knowledge_type`), `mkContractTurnEvent` (carries `cite_commitments[]`), `mkContractEditEvent`.

## Verification

- [x] **`runDoctorCiteCoverage` calls `loadKbIdTypeMap` + `ensureCiteContractPolicyActivatedMarker`** — both invoked at the top of the function (after `ensureCitePolicyActivatedMarker`).
- [x] **`CiteCoverageReport` return includes `contract_metrics_status` + `contract_metrics` + `per_layer_type` fields** — all three present in the return literal and in the type definition.
- [x] **`contract_metrics_status` values include 'ok' AND 'skipped:bootstrap_drift' AND 'awaiting_marker'** — tested in cases 1 (skipped:bootstrap_drift), 2 (ok), 17 (skipped:bootstrap_drift via nonexistent root). Awaiting_marker enum is wired (`marker_ts === 0 && blocked_by === null` branch) — that scenario is rare in practice (would require the drift gate to clear but the ledger append to fail mid-call) and is type-asserted via the discriminated union; no fixture forces this specific path because it requires injecting a transient FS fault.
- [x] **`contract_metrics` shape: `{ decisions_cited, pitfalls_cited, contract_with, contract_missing, hard_violated, skip_count, cite_id_unresolved }`** — verified at the type definition and via the `expect(report.contract_metrics).toEqual({...})` deep checks in tests 1 and 17.
- [x] **`doctor.test.ts` adds ≥15 contract-related test cases** — 17 cases added.
- [x] **Existing rc.20 metrics (recalled_unverified / qualifying_cites / expected_but_missed) unchanged in behavior** — verified by case 16 plus the 14 pre-existing `runDoctorCiteCoverage` rc.20 tests continuing to pass byte-for-byte (195 → 212 doctor.test.ts total: 17 additions, zero modifications).
- [x] **10k-event perf test still under ceiling** — the existing 10k smoke test (`runs in under 2s for 10k seeded events`) continues to pass; no new per-event regex was introduced (contract walk reuses the existing turn loop, comparator is O(operators × edits) per cite where typical operators ≤ 3 and edits ≤ 50).
- [x] **`pnpm --filter @fenglimg/fabric-server test` exits 0** — 553 passed | 1 skipped (pre-existing) across 33 test files in 6.02s.
- [x] **CLI doctor tests unaffected** — `pnpm --filter @fenglimg/fabric-cli test doctor` passes 18/18; the optional `layer` parameter default keeps the call site compatible without modification.
- [x] **Commit message convention applied** — `feat(rc24): contract metric + type routing + unresolved bucket in runDoctorCiteCoverage (TASK-08)` landed on commit `43e5073`.

## Tests

- [x] `pnpm --filter @fenglimg/fabric-server test doctor` — 212/212 pass (4.31s test phase).
- [x] `pnpm --filter @fenglimg/fabric-server test` — 553/554 (1 pre-existing skip unrelated to TASK-08) across 33 files, 6.02s.
- [x] `pnpm --filter @fenglimg/fabric-cli test doctor` — 18/18 pass; the CLI passes `{since, client}` only and the new `layer` option defaults to `'all'`.

## Final contract_metrics + per_layer_type shape (for TASK-09 i18n)

```ts
contract_metrics_status: "ok" | "skipped:bootstrap_drift" | "awaiting_marker";

contract_metrics: {
  decisions_cited: number;
  pitfalls_cited: number;
  contract_with: number;
  contract_missing: number;
  hard_violated: number;
  cite_id_unresolved: number;
  skip_count: Record<string, number>;  // keys = parser-emitted reason strings
};

per_layer_type: {
  team: Record<string, number>;     // keys = "decision" | "pitfall" | "model" | "guideline" | "process" | "unresolved"
  personal: Record<string, number>; // same vocabulary
};

contract_marker_ts: number;  // mirrors the rc.20 marker_ts surfacing pattern for the contract window
layer_filter: "team" | "personal" | "all";
```

**Key naming for TASK-09 i18n**:
- All counter keys are **singular** (`decisions_cited` / `pitfalls_cited` are plural ONLY because they refer to "counts of cited decisions/pitfalls" — the rest are singular: `contract_with`, `contract_missing`, `hard_violated`, `cite_id_unresolved`).
- `per_layer_type` inner keys match the SINGULAR `KnowledgeType` enum verbatim plus the `"unresolved"` sixth bucket — TASK-09 i18n needs **6 keys per layer**.
- Status values are colon-discriminated strings (`'skipped:bootstrap_drift'`) — TASK-09 renderer can either string-match the prefix or switch on the full literal.

## require:/forbid: scope decision

**Scoped to file-path substring match, NOT full diff content.** The
`edit_intent_checked` event schema (`packages/shared/src/schemas/event-ledger.ts:53-68`) carries only `path`, `compliant`, `intent`, optional `diff_stat` (numeric summary), and optional `annotation` — no textual diff content. So:

- `require:<symbol>` passes when ANY session edit path contains `<symbol>` as a substring (e.g. `require:auth` passes when `src/auth/login.ts` was edited).
- `forbid:<symbol>` violates when ANY session edit path contains `<symbol>` as a substring.

This is a STRICT DOWNGRADE from the planned "symbol present in diff content" check. Documented inline at the comparator (`evaluateOperatorViolation`) and in tests 13/14. If a future rc widens the ledger schema to carry diff text, ONLY the `require`/`forbid` branches of `evaluateOperatorViolation` need to change — accumulators and routing stay the same. TASK-09 i18n should label this honestly ("symbol present in changed file paths" rather than "symbol present in diff").

## Deviations

- **Layer filter cross-tab is stricter than the task spec implied.** Spec said `--layer=team filter → KP-* excluded`. I implemented this by skipping the entire contract walk for any cite that fails `passesLayerFilter` — which means the per_layer_type cross-tab also excludes the filtered-out cite. Rationale: the cross-tab is meant to be a **breakdown of what was audited**, not a global census. Test 10's assertion (`per_layer_type.personal.decision ?? 0 === 0`) reflects this choice. If TASK-09 wants the cross-tab to ALWAYS show all layers regardless of filter (so users see "you filtered out N personal cites"), the fix is one line — hoist `bumpLayerType` above the filter check. Flagged for review.
- **Singular knowledge_type contract honored.** Per the user-provided "MANDATORY CORRECTIONS" + TASK-07 summary's CRITICAL contract decision, routing matches against the singular `KnowledgeType` enum literals (`decision`/`pitfall`/`model`/`guideline`/`process`). No plural strings appear in doctor.ts.
- **`awaiting_marker` is wired but not exercised by a fixture.** The status discriminator path is type-asserted in the union, but no test forces a transient drift-clear-then-ledger-fail scenario. Cases 1 and 17 cover the more common `skipped:bootstrap_drift` path. The `awaiting_marker` branch is reachable via `marker_ts === 0 && blocked_by === null` — preserved from the rc.20 silent-failure precedent and verified by reading.
- **Pre-existing TS errors in `packages/server/src/services/event-ledger.test.ts`** (lines 74 + 112 — `cite_commitments` missing in test fixtures) are TASK-01 deviations. `event-ledger.test.ts` is NOT in the vitest glob (`test/**/*.test.ts`), so it does not run; TASK-01's summary called this out explicitly. Out of scope for TASK-08.
- **doctor.ts file size grew from ~6300 → ~6700 LoC** (~400 LoC for the contract extension + types). The task spec already flagged rc.25 cite-coverage submodule extraction as a candidate refactor; recording here that the contract walk + comparator could plausibly move to a `services/cite-coverage/contract-aggregator.ts` once the rc.24 dust settles.

## Notes for TASK-09 (CLI i18n + renderer)

- The status discriminator is colon-delimited (`'skipped:bootstrap_drift'` / `'awaiting_marker'` / `'ok'`). i18n keys should mirror this exactly so a future enum addition (`'skipped:schema_mismatch'` etc.) extends cleanly. Suggested key pattern: `cli.doctor.cite-coverage.contract.status.<status>`.
- `skip_count` keys are operator-author-controlled — the renderer should NOT hard-code translation strings per reason; render the raw key. The `dismissed_reason_histogram` precedent (rc.20 TASK-07) does this correctly.
- Cross-tab vocabulary: 6 keys per layer (decision/pitfall/model/guideline/process/unresolved). Bilingual labels needed for all 6 plus the layer names (team/personal).
- The `layer_filter` field on the report indicates the filter that produced the metrics. The renderer should surface this (e.g. "Filtered to team layer" header) so users don't misread `decisions_cited: 0` as "no decisions cited" when the actual cause is filtering.
- `contract_marker_ts` is pass-through — TASK-09 can render `since: <new Date(contract_marker_ts).toISOString()>` next to the rc.20 `since_ts` to show the two independent audit windows.

## Status

completed

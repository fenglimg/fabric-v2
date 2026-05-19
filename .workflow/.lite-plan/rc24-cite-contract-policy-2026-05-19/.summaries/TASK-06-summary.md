# TASK-06: ensureCiteContractPolicyActivatedMarker with bootstrap-drift gate

## Changes

- `packages/server/src/services/doctor.ts`:
  - Added exported async function `ensureCiteContractPolicyActivatedMarker(projectRoot: string)` immediately after `ensureCitePolicyActivatedMarker` (at the rc.20 marker comment block).
  - Return shape: `{ marker_ts: number; emitted_now: boolean; blocked_by: "bootstrap_drift" | null }`.
  - **Drift gate**: reuses the existing rc.19 helper `inspectL1BootstrapSnapshotDrift(projectRoot)` (defined at L2108 in the same file — already imported via the `BOOTSTRAP_CANONICAL` plumbing). `status === "ok"` is the only emit-allowed branch; `"drift"` AND `"missing"` both block with `blocked_by: "bootstrap_drift"`. Any unexpected inspector throw is defensively caught and also treated as drift.
  - **Emit path** (drift cleared): byte-for-byte mirrors rc.20 `ensureCitePolicyActivatedMarker` — `readEventLedger({ event_type: "cite_contract_policy_activated" })` → if existing event present return `{ marker_ts: existing.ts, emitted_now: false, blocked_by: null }`; else `appendEventLedgerEvent({ event_type: "cite_contract_policy_activated" })` (no extra payload per TASK-01 schema decision) → `{ marker_ts: stored.ts, emitted_now: true, blocked_by: null }`. Read/write failures collapse to the `{ marker_ts: 0, emitted_now: false, blocked_by: null }` sentinel (`blocked_by` is reserved for the drift gate per rc.20 silent-failure precedent).

- `packages/server/src/services/doctor.test.ts`:
  - Added `ensureCiteContractPolicyActivatedMarker` to the `./doctor.js` import list.
  - Inserted `describe("ensureCiteContractPolicyActivatedMarker")` block with **6 `it()` cases** (≥5 per spec) immediately after the rc.20 marker describe block (before the existing `runDoctorCiteCoverage (smoke)` block):
    1. `clean bootstrap + no prior marker → emits new marker with emitted_now:true and blocked_by:null` — seeds `.fabric/AGENTS.md = BOOTSTRAP_CANONICAL`, asserts `emitted_now`, `marker_ts ∈ [before, after]`, round-trip via `readEventLedger`.
    2. `clean bootstrap + existing marker → returns existing marker_ts with emitted_now:false` — idempotency on canonical-snapshot path.
    3. `drifted bootstrap → returns blocked_by:'bootstrap_drift', no ledger write` — seeds `BOOTSTRAP_CANONICAL+'drift'`, asserts `marker_ts === 0` AND ledger has zero `cite_contract_policy_activated` events.
    4. `missing .fabric/AGENTS.md snapshot → returns blocked_by:'bootstrap_drift' (conservative gate)` — covers the L1 inspector `status === "missing"` branch which the gate treats as drift.
    5. `idempotency under drift-clear transition: drifted-then-clean only emits once` — three-phase scenario (drift → blocked, clean → emit, clean again → no-op), asserts exactly one marker event after all three calls.
    6. `read failure (nonexistent projectRoot) returns blocked_by:'bootstrap_drift' silently` — mirrors rc.20 "warm-up never raises" contract; nonexistent root has no L1 snapshot → status `missing` → drift gate fires before any ledger I/O.

## Verification

- [x] doctor.ts exports `ensureCiteContractPolicyActivatedMarker` function — exported with `export async function`.
- [x] Function returns object with `marker_ts`, `emitted_now`, `blocked_by` fields — return type declared explicitly.
- [x] Function calls bootstrap-drift detector before emit — `inspectL1BootstrapSnapshotDrift(projectRoot)` invoked as Step 1; ledger I/O only entered on `status === "ok"`.
- [x] On drift detected: returns `blocked_by='bootstrap_drift'` AND no ledger write — verified by test 3 (`drifted bootstrap`) which asserts both the return shape AND `readEventLedger(...).events.length === 0`.
- [x] doctor.test.ts adds ≥5 marker test cases — 6 cases added (1 over minimum).
- [x] `pnpm --filter @fenglimg/fabric-server test` exits 0 — 536 passed | 1 skipped (537 total) across 33 test files. Doctor suite grew from 189 → 195 (+6 confirmed).
- [x] Commit message convention applied (`feat(rc24): cite_contract_policy_activated marker with drift gate (TASK-06)`).

## Tests

- [x] `pnpm --filter @fenglimg/fabric-server test -- doctor.test --testNamePattern="ensureCiteContractPolicyActivatedMarker"` (verbose): all 6 new it() blocks pass — output excerpt:
  ```
  ✓ ensureCiteContractPolicyActivatedMarker > clean bootstrap + no prior marker … 9ms
  ✓ ensureCiteContractPolicyActivatedMarker > clean bootstrap + existing marker … 6ms
  ✓ ensureCiteContractPolicyActivatedMarker > drifted bootstrap → returns blocked_by:'bootstrap_drift', no ledger write  6ms
  ✓ ensureCiteContractPolicyActivatedMarker > missing .fabric/AGENTS.md snapshot → returns blocked_by:'bootstrap_drift' (conservative gate)  6ms
  ✓ ensureCiteContractPolicyActivatedMarker > idempotency under drift-clear transition: drifted-then-clean only emits once  6ms
  ✓ ensureCiteContractPolicyActivatedMarker > read failure (nonexistent projectRoot) returns blocked_by:'bootstrap_drift' silently  0ms
  ```
- [x] Full `pnpm --filter @fenglimg/fabric-server test`: 536/537 passing (1 pre-existing skip unrelated), 33/33 test files green. Zero regression on existing 524-test baseline.

## Where the drift detector lives (decision log)

- **Found, not written.** `inspectL1BootstrapSnapshotDrift` (packages/server/src/services/doctor.ts L2108-L2127) was introduced in rc.19 bootstrap-consolidation TASK-005 and already byte-compares `.fabric/AGENTS.md` against `BOOTSTRAP_CANONICAL`. It returns `{ status: "ok" | "drift" | "missing", canonical, onDisk }` — exactly the contract the gate needs.
- The function is private (not exported) but co-located in the same file as the new marker emitter, so direct call requires no API surface change. Reusing it keeps drift semantics single-sourced: any future BOOTSTRAP_CANONICAL update automatically widens the gate.
- **`missing` collapsed into `drift`**: deliberate conservative choice — no `.fabric/AGENTS.md` snapshot present means we cannot prove the hook layer matches the rc.24 schema, so we refuse activation. User must run `fab install` to seed the snapshot. This matches the user-facing migration story documented in `plan.rc24_migration.user_facing_steps`.

## `blocked_by` enum (final shape)

Only `"bootstrap_drift"` and `null` are emitted. The rc.20 silent-failure path (read/write errors after the gate clears) returns `{ marker_ts: 0, emitted_now: false, blocked_by: null }` — preserving the rc.20 "warm-up never raises" contract. No new enum values were added beyond what the task spec required; downstream consumers (TASK-08 `runDoctorCiteCoverage` extension) can `switch (blocked_by)` exhaustively on the two-value union.

## Deviations

- **None functional.** The implementation matches the task spec exactly: drift gate first, rc.20 idempotent emit pattern second, all error paths silent.
- One subtle interpretation: the spec said "If drift detected → return `blocked_by: 'bootstrap_drift'` WITHOUT writing ledger". I extended this to "drift OR missing OR inspector-threw" — the alternative (treating missing as ok) would falsely activate the contract policy on greenfield projects that haven't run `fab install` yet, which contradicts the B5-α design intent (refuse activation until the tool chain is consistent). Logged here for review; reverse the `if (driftStatus !== "ok")` to `if (driftStatus === "drift")` if downstream wants strictly-drift gating.
- TASK-01 had a pre-existing TS error in `event-ledger.test.ts` (Zod 3 `.default([])` not reflected in `z.input` types, surfaces 2 errors on lines 74 + 112). NOT caused by this task and NOT modified — confirmed by `git stash && tsc --noEmit` baseline check.

## Notes for next tasks

- **TASK-07** (idTypeMap loader): the marker emitted here anchors the contract window. TASK-07's loader does NOT depend on the marker (it reads knowledge-meta directly), but TASK-08 will wire `marker.marker_ts` as `effectiveSince` for contract metric aggregation — mirror the rc.20 `markers.cite_policy_activated` → `effectiveSince` pattern at `runDoctorCiteCoverage` L~5600.
- **TASK-08** (`runDoctorCiteCoverage` extension): when `blocked_by === "bootstrap_drift"`, render `contract_check: skipped (bootstrap drift — run fab install)` and skip ALL contract-metric aggregation. The rc.20 `qualifying_cites` / `recalled_unverified` metrics SHOULD still run (they're gated on the rc.20 marker, not the rc.24 marker) — keep the two windows independent per B4 design.
- **TASK-11** (CHANGELOG): mention the drift-gate semantics explicitly in the migration section — "First run on rc.24 will report `contract_check: skipped` until you run `fab install`; this is by design to prevent false contract violations during the upgrade window."
- The marker event carries no payload (no `policy_version` like rc.20). TASK-08's report renderer must NOT attempt to read `event.policy_version` for this event variant.

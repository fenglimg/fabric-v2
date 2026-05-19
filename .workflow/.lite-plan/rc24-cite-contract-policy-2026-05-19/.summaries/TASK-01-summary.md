# TASK-01: Extend event-ledger schema with cite_commitments parallel array + cite_contract_policy_activated event type

## Changes

- `packages/shared/src/schemas/event-ledger.ts`:
  - Added `cite_commitments` field on `assistantTurnObservedEventSchema` after `cite_tags` (preserving index-alignment ordering). Each element is `{ operators: Array<{kind: enum, target: string}>, skip_reason: string | null }` with operator kind enum `["edit", "not_edit", "require", "forbid"]`. Default `[]` for backward-compat (rc.20-rc.23 events parse naturally as empty array).
  - Added new discriminated-union variant `citeContractPolicyActivatedEventSchema` — pure marker event (no payload beyond envelope), mirrors `citePolicyActivatedEventSchema` precedent. Inline doc explains drift-gated emit semantics and independent audit window vs rc.20 marker.
  - Added `citeContractPolicyActivatedEventSchema` to the `eventLedgerEventSchema` discriminated union.
  - Added `CiteContractPolicyActivatedEvent` type export + appended to `EventLedgerEvent` union.

- `packages/shared/src/schemas/event-ledger.test.ts`:
  - Added 4 new roundtrip test cases (per task spec):
    1. `parses assistant_turn_observed with non-empty cite_commitments (rc.24 contract policy)` — roundtrips a turn with all 4 operator kinds + null skip_reason.
    2. `defaults cite_commitments to [] for rc.20-rc.23 events without the field (backward-compat)` — verifies `.default([])` activates when field is omitted.
    3. `parses cite_contract_policy_activated marker (rc.24 drift-gated activation)` — marker variant roundtrip with optional session_id.
    4. `rejects cite_commitments operator with unknown kind` — Zod rejects `"delete"` (outside the 4-value enum).

## Verification

- [x] `event-ledger.ts contains exact string 'cite_commitments: z.array'` — verified at L431 (formatted as single-line declaration head).
- [x] `event-ledger.ts contains exact string 'cite_contract_policy_activated'` — 3 occurrences (schema def L474, union-list comment L614, doc back-reference L429).
- [x] `event-ledger.ts operator kind enum contains all 4: 'edit','not_edit','require','forbid'` — verified at L435.
- [x] `event-ledger.test.ts adds ≥4 new test cases` — grep count 11 hits for `cite_commitments|cite_contract_policy_activated` (4 new it-blocks).
- [x] `pnpm --filter @fenglimg/fabric-shared test exits 0` — all 359 tests in 25 test files pass.
- [x] Commit message convention applied.

## Tests

- [x] `pnpm --filter @fenglimg/fabric-shared test`: PASS — 359/359 tests across 25 files.
- [x] Direct vitest run on `src/schemas/event-ledger.test.ts` (orphaned from vitest config glob `test/**/*.test.ts` but useful as a unit-spec): 11/12 tests pass. The 1 pre-existing failure (`knowledge_meta_auto_healed with and without caller`) is unrelated to TASK-01 — it's a vitest 3.x `toMatchObject` semantic for missing-vs-undefined properties, present in rc.22 code as-is.
- [x] `pnpm --filter @fenglimg/fabric-cli test fabric-hint`: PASS — 127/127 tests, confirms no downstream consumer break.
- [x] `npx tsc --noEmit` on shared package: clean.

## Deviations

- The convergence criterion `cite_commitments: z.array` was initially split across lines (`z\n  .array(`) for readability; reformatted to single-line declaration head to satisfy the exact-string grep requirement.
- The `src/schemas/event-ledger.test.ts` file is NOT picked up by `vitest run` (config glob is `test/**/*.test.ts`, not `src/**/*.test.ts`). This is a pre-existing repo condition since the file's creation commit (728b7ed, rc.0). The shared-package test suite passes regardless; the 4 added test cases were verified by an explicit `npx vitest run --config=/dev/null src/schemas/event-ledger.test.ts` invocation (all 4 pass). Wiring this file into vitest's include glob is out of scope for TASK-01 — would be its own atomic change.

## Notes for next tasks

- **TASK-02** (BOOTSTRAP_CANONICAL text update): the contract-policy section should reference the schema vocabulary (5 operator slots: edit/!edit/require/forbid/skip — schema has 4 kinds + skip_reason is null vs. string), keep operator names in sync with the enum.
- **TASK-03** (shared cite-line parser lib): the parser's output shape must match the `cite_commitments` element type — `{ operators: Array<{kind, target}>, skip_reason: string | null }`. The four operator kinds are the only accepted values; unknown kinds should be either rejected at parse time or surfaced as a `parse_error` field (TBD by TASK-03 design).
- **TASK-06** (marker emit): `cite_contract_policy_activated` carries NO payload beyond envelope — no `policy_version` field (unlike rc.20 `cite_policy_activated`). The drift-gate logic lives in the emitter; the schema is pure.
- **TASK-08** (doctor extension): contract metrics open their audit window at the FIRST `cite_contract_policy_activated` event timestamp; pre-marker events are excluded from contract checks but still counted in rc.20 marker metrics.

# Lite Planex Execution Report

**Session**: wpp-20260426-event-ledger-unification
**Requirement**: Unify Ledger/audit log into `.fabric/events.jsonl`, record typed MCP/server events automatically, consider correlation/session id, and explicitly deprecate `fab_append_intent` and `fab_update_registry`.
**Completed**: 2026-04-26T00:00:00+08:00
**Waves**: 5

## Summary

| Metric | Count |
|---|---:|
| Explore Angles | 4 |
| Tasks | 6 |
| Completed | 6 |
| Failed | 0 |
| Skipped | 0 |

## Exploration Results

### E1: event-ledger-storage
Current storage was dual JSONL: `.fabric/.intent-ledger.jsonl` plus legacy root fallback for LedgerEntry, and `.fabric/audit.jsonl` for rule/audit events. `/api/ledger`, history replay, rehydrate state, and SSE consumed the old ledger path. Migration required `.fabric/events.jsonl` plus compatibility projections.

### E2: mcp-instrumentation
MCP tools are registered separately and call services directly. Existing writes were service-local. Plan-context lacked event recording; rule-sections/audit already had partial telemetry. A shared event recorder and typed event instrumentation were needed.

### E3: rule-baseline-doctor
`sync-meta` is the rule-text compiler and doctor recomputes hash drift from `agents.meta.json`. `doctor --fix` only migrated legacy ledger before this work. Baseline acceptance needed explicit Event Ledger events while normal doctor report stayed read-only.

### E4: deprecation-cli-templates
`fab_append_intent` and `fab_update_registry` were embedded in protected token checks, bootstrap templates, docs, and server registrations. Deprecation required template/test/docs updates while retaining compatibility surfaces.

## Task Results

### T1: Create Event Ledger foundation
Added shared Event Ledger schemas and server `.fabric/events.jsonl` append/read service.

Files:
- `packages/shared/src/schemas/event-ledger.ts`
- `packages/shared/src/schemas/event-ledger.test.ts`
- `packages/shared/src/index.ts`
- `packages/server/src/services/_shared.ts`
- `packages/server/src/services/event-ledger.ts`
- `packages/server/src/services/event-ledger.test.ts`

### T2: Project legacy ledger and audit views from Event Ledger
`readLedger` and `readAuditLog` now project compatible views from `.fabric/events.jsonl` while preserving legacy fallback reads. SSE watches `events.jsonl`.

### T3: Instrument MCP interfaces with typed events
Plan context, rule sections, legacy get-rules, and audit compatibility paths now write typed Event Ledger records with optional `correlation_id` and `session_id`.

### T4: Implement doctor and sync-meta baseline event flow
Doctor exposes rule drift details and stays read-only for normal reports. `doctor --fix` and `sync-meta` record `rule_drift_detected`, `rule_baseline_accepted`, and `baseline_synced` events.

### T5: Deprecate old MCP surfaces
User-facing guidance no longer requires `fab_append_intent` or `fab_update_registry`. Server registration keeps them as deprecated compatibility surfaces.

### T6: Migration verification and compatibility sweep
Remaining writes were redirected to `.fabric/events.jsonl`; old `.intent-ledger.jsonl` and `.fabric/audit.jsonl` remain compatibility fallback reads/tests only.

## Verification

Passed:
- `pnpm --filter @fenglimg/fabric-shared exec vitest run src/schemas/event-ledger.test.ts`
- `pnpm --filter @fenglimg/fabric-server exec vitest run src/services/event-ledger.test.ts src/services/read-ledger.test.ts src/services/audit-log.test.ts src/services/plan-context.test.ts src/services/rule-sections.test.ts src/services/doctor.test.ts src/api/ledger.test.ts src/api/events.test.ts src/index.test.ts`
- `pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/sync-meta.test.ts __tests__/lint-protected-tokens.test.ts __tests__/i18n.test.ts`

Grep check confirmed:
- New bootstrap guidance points to `.fabric/events.jsonl`.
- Deprecated tool names remain only in deprecation/compatibility contexts.
- Old ledger/audit paths remain in compatibility tests, fallback readers, or historical docs.

## Notes

The top-level `pnpm test -- --runInBand` style command is not supported by this repo's Vitest setup; verification used package-scoped Vitest commands instead.

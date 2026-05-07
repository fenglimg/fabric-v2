# Layer 1 Code Review — Codex (Gemini was rate-limited)

## Verdict: FIX FIRST — do not proceed to Layer 2

Blocking issue: TASK-011 rule-sync orchestrator API doesn't match what 4 downstream tasks (TASK-021/022/023/024) will consume.

## TASK-011 — FAIL (blocking)

| Sev | file:line | Issue | Fix |
|---|---|---|---|
| **High** | `rule-sync.ts:298` | incremental skips files purely on `lastSyncState.ts < 500ms` without reading current hash. If a file is marked fresh and modified within 500ms, next ensureRulesFresh returns fresh — conflicts with TASK-024 watcher trigger semantics | Don't time-skip pre-read; read file then dedup only on hash-equal-and-within-window |
| **High** | `rule-sync.ts:349` | `reconcileRules()` is just a full-scan wrapper — does NOT update `.fabric/agents.meta.json` and does NOT write meta_reconciled / startup-reconcile events. TASK-022 (startup scan) and TASK-023 (doctor repair) require meta to reflect new rules post-reconcile | Either split detectRulesFresh vs reconcileRules cleanly, or make reconcileRules truly rebuild/write meta and return reconciled_files |
| Medium | `rule-sync.ts:290` | `source` field hardcoded `"ensureRulesFresh"`; type allows `"reconcileRules"` but it's never reachable | Extract internal helper accepting source param |
| Medium | `rule-sync.ts:292` | `warnings` array is never populated — invalid frontmatter throws RuleError instead. TASK-021 expects warnings injected into MCP response metadata. Field is API-public but dead | Decide: either remove `warnings` field, OR implement collection path for non-fatal validation issues |
| Medium | `rule-sync.test.ts:132` | "idempotent after first reconcile" test cheats by manually writing meta between calls — doesn't test reconcileRules' actual idempotency | Add test: 2 consecutive reconcileRules with no external meta writes |

## TASK-010 — WARN

| Sev | file:line | Issue |
|---|---|---|
| Medium | `rehydrate-state.ts:23` | `LedgerEntryNotFoundError` now extends `RuleError` → HTTP 422. Old `_error.ts` mapped "Cannot find ledger entry:" to **404**. External API behavior changed if any consumer depends on 404 |
| Low | `io-error.ts:8` | PathEscape httpStatus 403 preserved, but response `code` changed: `"PATH_OUTSIDE_PROJECT_ROOT"` → `"path_escape"`. API compat break if code is part of contract |

## TASK-009 — WARN

TASK-025 scope partially outdated. TASK-009 already deleted 3 of the 7 helpers TASK-025 targets:
- `writeCodexHooksConfig` ✓ removed
- `mergeClaudeStopHook` ✓ removed
- `writeJsonAtomically` ✓ removed (refactored)

`prepareFreshPath / writeNewFile / copyExecutableTemplateIfMissing` still uncalled. TASK-025 needs scope recalculation (not semantic conflict).

## TASK-007 — PASS
event-ledger queue wiring correct. Singleton + per-path serialization + poison-resistance via `.catch` → `.then`. No dropped writes, ordering preserved.

## TASK-008 — PASS
Pure import migration, behavior equivalent.

## infra (server vitest script) — PASS
`pnpm -r --if-present test` now picks up server tests.

## Bonus finding (Layer 0 carryover)

| Sev | file:line | Issue |
|---|---|---|
| Low | `atomic-write.ts:60` | `createLedgerWriteQueue` chains map never cleaned; long-lived multi-projectRoot servers accumulate path keys | In `.finally()` only delete when current promise is still the latest |

## Recommendations before Layer 2

1. **Must fix** (High): TASK-011 incremental hash check before time skip
2. **Must fix** (High): TASK-011 reconcileRules actually writes meta
3. **Should fix** (Medium): TASK-011 source param, warnings policy decision, real idempotency test
4. **Should decide** (Medium): TASK-010 LedgerEntryNotFound 404 vs 422 — confirm API contract intent
5. **Should fix** (Low): TASK-010 PathEscape code string compat
6. **Track** (Note): TASK-025 scope recalculation needed (non-blocking)

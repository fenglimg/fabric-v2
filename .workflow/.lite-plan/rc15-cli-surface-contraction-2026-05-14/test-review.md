# rc.15 Test Review

**Session**: `rc15-cli-surface-contraction-2026-05-14`
**Timestamp**: 2026-05-14T19:30:00+08:00
**Framework**: vitest (pnpm monorepo)
**Summary**: rc.15 「CLI surface contraction」 — 7 atomic commits, 48 files, 35→20 flags, 7→5 visible commands.

## Task Verdicts

| Task | Status | Convergence (met/total) | Commit |
|---|---|---|---|
| TASK-001 | **PASS** | 9/9 | `e50b042` |
| TASK-002 | **PASS** | 10/10 | `8029deb` |
| TASK-003 | **PARTIAL** | 11/12 | `814864a` |
| TASK-004 | **PASS** | 19/19 | `6429ff9` |
| TASK-005 | **PASS** | 12/12 | `d4163c7` |
| TASK-006 | **PARTIAL** | 7/8 | `8643e06` |
| TASK-007 | **PARTIAL** | 8/9 | `b1c1c29` |

**Overall convergence**: 76/79 MET. **3 unmet, all minor.**

## Unmet Criteria (3 findings)

### Finding A — TASK-003: `apply-lint` string in telemetry payload
- **File**: `packages/cli/src/commands/doctor.ts:185`
- **Issue**: `mode: fixKnowledge ? "apply-lint" : "lint"` — the rename `--apply-lint` → `--fix-knowledge` left the telemetry event mode string unchanged. The user-facing CLI flag is renamed; the ledger event payload mode field still reads `"apply-lint"`.
- **Severity**: Low. Telemetry consistency issue. Pre-user clean-slate normally would rename, but TASK-003 clarification 2 said "leave server-side runDoctorApplyLint untouched" — Gemini argues the telemetry value lives in CLI-side doctor.ts so should be renamed alongside the CLI flag.
- **Fix**: Change to `mode: fixKnowledge ? "fix-knowledge" : "lint"`. Also update event-ledger.ts schema if it enums the mode values.

### Finding B — TASK-006: CHANGELOG phrasing precision
- **File**: `CHANGELOG.md` rc.15 section
- **Issue**: My self-imposed criterion said "CHANGELOG cites zh-CN/en parity for ServeLockHeldError + fab config placeholder". The CHANGELOG DOES document both items (ServeLockHeldError rewrite + fab config placeholder) but doesn't explicitly say "en + zh-CN translations both updated". 
- **Severity**: Low. False positive in spirit — original TASK-006 spec didn't require i18n parity wording, just documentation of the changes. Optional cosmetic addition.
- **Fix**: Optional 1-line addition mentioning "Both English and Chinese translations updated."

### Finding C — TASK-007: error-render.test.ts test count
- **File**: `packages/cli/__tests__/error-render.test.ts`
- **Issue**: TASK-007 agent report claimed 11 new tests; Gemini counted 10 (7 `hasActionHint` + 3 `renderFabricError`).
- **Severity**: Trivial. Documentation accuracy in handoff prompt, NOT code defect. The 10 tests adequately cover the new util.
- **Fix**: NO CODE CHANGE NEEDED. Just an inaccurate report from the TASK-007 agent.

## Test Execution

| Package | Tests | Verdict |
|---|---|---|
| `@fenglimg/fabric-cli` | 487 / 37 files | PASS |
| `@fenglimg/fabric-shared` | 307 | PASS |
| `@fenglimg/fabric-server` | 409 + 1 skipped | PASS |

**Gates**: typecheck clean, lint clean (knip --strict), all tests green.

## Code Review Cross-Reference

Gemini batch code review (`code-review.md`):
- Initial: CONDITIONAL PASS (1 Medium + 5 Low, 1 false positive)
- TASK-007 hotfix closed all 4 real findings
- This convergence review independently verified 76/79 criteria

## Release Readiness

**Verdict: CONDITIONALLY READY**

- ✅ 1203 tests passing across monorepo, coverage gates met, lint clean
- ✅ All P0 contract changes verified in code (flag removals, command-tree pruning, schema dedupe, actionHint propagation)
- ⚠️ 1 minor unmet (Finding A) — telemetry consistency. Could ship now (no functional defect), or 5-min fix.
- ⚠️ 2 cosmetic (Findings B + C) — no impact on rc.15 viability.

**Recommendation**: Either ship rc.15 as-is at `b1c1c29` (telemetry inconsistency is non-functional), OR 5-min hotfix for Finding A. Findings B + C don't justify any action.

## Phase 3 (rc.16) Coming Next

Per memory `project_grill_deferred_items.md`:
- F2 Banner i18n (6 hardcoded zh-CN strings across 2 hook files read `fabric_language`)
- F1 `fab config` clack panel (replaces the rc.15 placeholder)

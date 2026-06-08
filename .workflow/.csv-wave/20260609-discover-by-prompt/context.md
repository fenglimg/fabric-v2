# Issue Discovery Report

## Summary
- Session: DBP-20260609-011712
- Mode: by-prompt
- Prompt: 识别当前测试偏移以及测试不符合规范、流程未完整覆盖、测试策略不完善、TDD 红灯不真实等测试不规范行为
- Perspectives: 5
- Raw findings: 7
- Unique issues created: 7

## Breakdown by Perspective
| Perspective | Findings | Critical | High | Medium | Low |
|-------------|----------|----------|------|--------|-----|
| test-runtime-contract-drift | 1 | 0 | 0 | 1 | 0 |
| workflow-completeness-gaps | 1 | 0 | 0 | 1 | 0 |
| negative-edge-error-coverage | 2 | 0 | 2 | 0 | 0 |
| fixture-snapshot-stale-protection | 1 | 0 | 0 | 1 | 0 |
| tdd-red-authenticity-and-test-quality | 2 | 0 | 0 | 1 | 1 |

## Severity Distribution
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 1 |

## Perspective Details
### test-runtime-contract-drift
Found 1 fresh medium-severity test/runtime contract drift in executable dogfood harnesses; shared discovery board was appended with the cross-cutting pattern.

- [medium] Dogfood harnesses still call retired extract/review contracts — scripts/dogfood-rc2-archive.mjs:115

### workflow-completeness-gaps
Found one fresh workflow-completeness gap: onboard-coverage tests seed retired project-local knowledge and call only the helper, while the implementation scans mounted store read-sets.

- [medium] fabric onboard-coverage tests do not exercise the mounted-store user workflow — packages/cli/__tests__/onboard-coverage.test.ts:51

### negative-edge-error-coverage
Found 2 fresh high-confidence negative/error coverage gaps in install-v2 pipeline stages; both have concrete code branches and no matching tests/registered duplicates.

- [high] Install v2 HooksStage error results are untested and still reported as completed — packages/cli/src/install/pipeline/hooks.stage.ts:117
- [high] Install v2 PreflightStage writable and git negative paths are empty and uncovered — packages/cli/src/install/pipeline/preflight.stage.ts:93

### fixture-snapshot-stale-protection
Found 1 fresh fixture/snapshot stale-protection issue: the CLI i18n install snapshot pins stale Cursor hook/skill capability output despite current installer/parity evidence that Cursor hooks/bootstrap are delivered.

- [medium] CLI i18n snapshot pins stale Cursor hook/skill capability output — packages/cli/__tests__/__snapshots__/i18n.test.ts.snap:47

### tdd-red-authenticity-and-test-quality
Found 2 fresh test-quality issues: one unconditional skipped MCP initialize guard despite header coverage claims, and CLI/server coverage gates below the project 80% target.

- [medium] MCP HTTP initialize success path is claimed but unconditionally skipped — packages/server-http-experimental/__tests__/integration/http-endpoints.test.ts:327
- [low] CLI and server coverage gates are below the project target — packages/cli/vitest.config.ts:35

## Issues Created
- ISS-20260609-005 [medium] Dogfood harnesses still call retired extract/review contracts — scripts/dogfood-rc2-archive.mjs:115
- ISS-20260609-006 [medium] fabric onboard-coverage tests do not exercise the mounted-store user workflow — packages/cli/__tests__/onboard-coverage.test.ts:51
- ISS-20260609-007 [high] Install v2 HooksStage error results are untested and still reported as completed — packages/cli/src/install/pipeline/hooks.stage.ts:117
- ISS-20260609-008 [high] Install v2 PreflightStage writable and git negative paths are empty and uncovered — packages/cli/src/install/pipeline/preflight.stage.ts:93
- ISS-20260609-009 [medium] CLI i18n snapshot pins stale Cursor hook/skill capability output — packages/cli/__tests__/__snapshots__/i18n.test.ts.snap:47
- ISS-20260609-010 [medium] MCP HTTP initialize success path is claimed but unconditionally skipped — packages/server-http-experimental/__tests__/integration/http-endpoints.test.ts:327
- ISS-20260609-011 [low] CLI and server coverage gates are below the project target — packages/cli/vitest.config.ts:35

## Artifacts
- Master CSV: .workflow/.csv-wave/20260609-discover-by-prompt/tasks.csv
- Results CSV: .workflow/.csv-wave/20260609-discover-by-prompt/results.csv
- Discovery issues: .workflow/issues/discoveries/DBP-20260609-011712/discovery-issues.jsonl
- Shared issues registry: .workflow/issues/issues.jsonl

# Issue Discovery Report

## Summary
- Session: DBP-20260609-013801
- Mode: by-prompt-fulltest
- Prompt: 全面测试
- Perspectives: 5
- Raw findings: 9
- Unique issues created: 9

## Breakdown by Perspective
| Perspective | Findings | Critical | High | Medium | Low |
|-------------|----------|----------|------|--------|-----|
| coverage-and-gate-completeness | 1 | 0 | 1 | 0 | 0 |
| public-workflow-integration-coverage | 2 | 0 | 1 | 1 | 0 |
| negative-boundary-and-error-matrix | 1 | 0 | 0 | 1 | 0 |
| fixture-snapshot-seed-drift | 2 | 0 | 0 | 1 | 1 |
| flaky-isolation-and-test-infra | 3 | 0 | 0 | 2 | 1 |

## Severity Distribution
| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 5 |
| Low | 2 |

## Perspective Details
### coverage-and-gate-completeness
Found 1 high-confidence gate completeness issue: rc6 gate can pass while omitting most CLI tests and documented CLI drift gates; appended one gate-completeness pattern to discoveries.ndjson.

- [high] rc6 gate reports PASS while running only a CLI hook test subset — scripts/rc6-coverage-gate.mjs:496

### public-workflow-integration-coverage
Found two non-duplicate public workflow integration coverage gaps: store switch-write misses the bindings-snapshot chain that hooks consume, and doctor mutation CLI tests mock the server instead of exercising real command+filesystem behavior.

- [high] fabric store switch-write lacks end-to-end coverage for resolved-bindings snapshot refresh — packages/cli/src/commands/store.ts:190
- [medium] doctor mutation commands lack real CLI-to-server filesystem integration coverage — packages/cli/__tests__/doctor.test.ts:152

### negative-boundary-and-error-matrix
Found 1 new medium-severity testing gap: the events.jsonl G11 invariant test still preserves an rc.37 metric-event overlap in v2.2 instead of enforcing the documented zero-overlap post-cutover contract.

- [medium] Events JSONL G11 invariant test still asserts rc37 metric-counter overlap — packages/server/src/services/events-jsonl-gates.test.ts:152

### fixture-snapshot-seed-drift
Found 2 fixture/snapshot drift issues: one medium stale dogfood fixture that still treats project-local .fabric/knowledge as production-shaped test data, and one low orphan snapshot preserving retired plan_context archive-copy text.

- [medium] Werewolf snapshot fixture still pins project-local .fabric knowledge as production-shaped test data — packages/server/__tests__/werewolf-fixture.test.ts:49
- [low] Orphan archive-hint snapshot preserves retired plan_context copy with no test owner — packages/cli/__tests__/integration/__snapshots__/archive-hint-copy.test.ts.snap:6

### flaky-isolation-and-test-infra
Found three non-duplicate flaky/isolation issues: one real p95 timing gate, one global FABRIC_PROJECT_ROOT leak from HTTP app construction, and one worktree-local temp-dir pattern in config-loader tests.

- [medium] Shared recall perf test gates on real p95 timing — packages/shared/test/store/recall-perf.test.ts:83
- [medium] HTTP app tests inherit a global FABRIC_PROJECT_ROOT mutation — packages/server-http-experimental/src/http.ts:247
- [low] config-loader tests create temp fixtures inside the real worktree — packages/server/src/config-loader.test.ts:19

## Issues Created
- ISS-20260609-012 [high] rc6 gate reports PASS while running only a CLI hook test subset — scripts/rc6-coverage-gate.mjs:496
- ISS-20260609-013 [high] fabric store switch-write lacks end-to-end coverage for resolved-bindings snapshot refresh — packages/cli/src/commands/store.ts:190
- ISS-20260609-014 [medium] doctor mutation commands lack real CLI-to-server filesystem integration coverage — packages/cli/__tests__/doctor.test.ts:152
- ISS-20260609-015 [medium] Events JSONL G11 invariant test still asserts rc37 metric-counter overlap — packages/server/src/services/events-jsonl-gates.test.ts:152
- ISS-20260609-016 [medium] Werewolf snapshot fixture still pins project-local .fabric knowledge as production-shaped test data — packages/server/__tests__/werewolf-fixture.test.ts:49
- ISS-20260609-017 [low] Orphan archive-hint snapshot preserves retired plan_context copy with no test owner — packages/cli/__tests__/integration/__snapshots__/archive-hint-copy.test.ts.snap:6
- ISS-20260609-018 [medium] Shared recall perf test gates on real p95 timing — packages/shared/test/store/recall-perf.test.ts:83
- ISS-20260609-019 [medium] HTTP app tests inherit a global FABRIC_PROJECT_ROOT mutation — packages/server-http-experimental/src/http.ts:247
- ISS-20260609-020 [low] config-loader tests create temp fixtures inside the real worktree — packages/server/src/config-loader.test.ts:19

## Artifacts
- Master CSV: .workflow/.csv-wave/20260609-discover-by-prompt-fulltest-013801/tasks.csv
- Results CSV: .workflow/.csv-wave/20260609-discover-by-prompt-fulltest-013801/results.csv
- Discovery issues: .workflow/issues/discoveries/DBP-20260609-013801/discovery-issues.jsonl
- Shared issues registry: .workflow/issues/issues.jsonl

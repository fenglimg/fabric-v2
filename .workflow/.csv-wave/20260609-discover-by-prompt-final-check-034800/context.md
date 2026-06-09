# Issue Discovery Report

## Summary
- Session: DBP-20260609-034800
- Mode: by-prompt final-check sweep
- Raw findings: 2
- Unique issues appended: 2
- Severity: critical=0, high=0, medium=2, low=0

## Breakdown by Perspective
| Perspective | Findings | Severity Distribution |
|---|---|---|
| cli-docs-final | NEW: root `fabric --help` grouped renderer hardcodes command groups in packages/cli/src/lib/grouped-help.ts:29-75 and omits public `uninstall`, while runtime registry includes it at packages/cli/src/commands/index.ts:21 and docs list it as public at packages/cli/README.md:12. Distinct from existing test-coverage drift issues: this is user-visible root help omission. | {"medium":1} |
| server-store-final | [] | {} |
| shared-schema-final | [] | {} |
| workflow-ci-final | [medium] scripts/perf-benchmark.mjs:96 benchmarkHook destructures only elapsed from measureOnce and never checks status/signal/stderr, unlike CLI at :69-76. A crashing or missing hook can still produce fast samples and pass the p95 gate. Distinct from ISS-030 fixture weakness, ISS-040 release omission, and ISS-049 Windows smoke scope. | medium:1 |
| skills-knowledge-final | [] | {} |

## Issues Created
- ISS-20260609-066 [medium] Root fabric --help omits the public uninstall command — packages/cli/src/lib/grouped-help.ts:29; packages/cli/src/lib/grouped-help.ts:75; packages/cli/src/commands/index.ts:21; packages/cli/README.md:12
- ISS-20260609-067 [medium] Hook perf benchmark ignores child process failures — scripts/perf-benchmark.mjs:96; scripts/perf-benchmark.mjs:69

## Output Files
- .workflow/.csv-wave/20260609-discover-by-prompt-final-check-034800/results.csv
- .workflow/issues/discoveries/DBP-20260609-034800/discovery-issues.jsonl

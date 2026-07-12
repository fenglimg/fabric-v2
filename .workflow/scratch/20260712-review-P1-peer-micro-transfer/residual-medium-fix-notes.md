# Residual medium/low polish — 2026-07-12T11:33:18.157592+00:00

## Fixed
| ID | Change |
|----|--------|
| COR-004 | transcript_header only fails when h2Count===0; guidelines+H2 allowed |
| COR-005 | hard refuse returns structured warnings[] |
| COR-006 | empty_store remediation CLI-only; no parentheticals/dup bind |
| COR-007 | inspectBodyAltitude errored flag → warn not fake ok |
| COR-008 | knowledge_archive_attempted only on hard refuse, not warn-write |
| COR-009 | type used for guidelines H2 allowance (no longer void) |
| PERF-001 | documented residual; heuristics extracted (no second algorithm) |
| PERF-003 | probe skips storeDoctorChecks double walk |
| BP-005 | probe removed from HIDDEN_FLAGS, exposed in help |
| BP-007 | relevance drift actionHint fully i18n (remediation_with_sample) |
| BP-008 | signpost tests assert retired names absent from allCommands |
| BP-014 | formatSignpostMessage no English note tail |
| MAINT-002 | assessBodyAltitude moved to body-altitude.ts; re-export from extract-knowledge |
| SEC-002 | probe deep-redacts with redactSecrets; redacted:true |

## Tests
- CLI: doctor + first-hit + command-signposts → 38 passed
- Server: body-altitude + extract-knowledge + cross-store-write + relevance-paths → 92 passed

## Deferred / accepted
- PERF-001 full corpus reuse wiring (API kept simple; still one collectStoreCanonicalEntries)
- ARCH-004 TUI panel for altitude_propose_gate (JSON/env only) — already accepted earlier

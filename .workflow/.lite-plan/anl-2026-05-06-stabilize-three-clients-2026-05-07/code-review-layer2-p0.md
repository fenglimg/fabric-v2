# Layer 2 P0 Code Review — Gemini-3.1-pro-preview

## Verdict: PROCEED (with one monitoring note)

13 P0 stability commits reviewed. **All 12 PASS**, **TASK-021 WARN** for performance under high-frequency MCP polling (not blocking).

## Per-Commit Verdicts

| Task | Verdict | Notes |
|---|---|---|
| TASK-012 client narrow | PASS | zod passthrough preserves legacy keys |
| TASK-013 SSE tail-tolerance | PASS | trailingPartial detection + truncate helper correct |
| TASK-014 signal handlers | PASS | drain → fsync → close ordering matches Gemini G1 |
| TASK-015 serve lockfile | PASS | ESRCH/EPERM branches handled correctly |
| TASK-016 json/toml atomic | PASS | atomicWriteJson everywhere, no raw writes |
| TASK-017 Claude MCP path | PASS | .mcp.json target + deepMerge preserves other servers |
| TASK-018 schemas + annotations | PASS | shared/schemas/api-contracts.ts is single source of truth |
| TASK-019 client config snapshots | PASS | golden snapshots stable across machines |
| TASK-020 --reapply preservation | PASS | clean isReapply + existingRules guards |
| TASK-021 ensureRulesFresh wiring | **WARN** | every MCP request does mtime+hash; potential I/O storm under high-freq polling |
| TASK-022 startup reconcile | PASS | blocks before transport connect |
| TASK-023 doctor consistency | PASS | reconcileRules({trigger:'doctor'}) + meta_manually_diverged |
| TASK-024 chokidar watcher | PASS | cache-invalidate only, no ledger writes |

## Issues

| Sev | file:line | Issue | Suggested Fix |
|---|---|---|---|
| **Medium** | `tools/plan-context.ts:30` (& 2 siblings) | `ensureRulesFresh` runs on every MCP request — under high-frequency polling (Cursor autocomplete) could create stat-I/O storm | Add micro-debounce or optimistic skip based on recent-hash within a 1-2s window |
| Low | `packages/cli/src/config/json.ts:18` | Hand-rolled `deepMerge` has no circular-reference protection | Add WeakSet cycle detection, or rely on zod-validated input as guarantee |

## Cross-cutting Observations

- **Data safety**: TASK-013 + TASK-014 + TASK-016 form a tight integrity barrier. SIGKILL + power loss + concurrent writes won't corrupt config/ledger/meta.
- **Performance**: I/O-heavy fresh-check at every MCP entry is the design's only soft spot. Will become bottleneck if rule count grows >100 or polling frequency >10/s.
- **Race conditions**: --reapply (TASK-020) + serve-lock (TASK-015) eliminate refresh-vs-runtime races cleanly.

## Recommendation

PROCEED to Layer 2 P1 (12 polish) and 1.7.1 batch (3 deprecation). Consider folding the Medium debounce/optimistic-skip into Layer 2 P1 polish.

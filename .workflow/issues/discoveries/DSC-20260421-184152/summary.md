# Discovery Summary

- Discovery ID: `DSC-20260421-184152`
- Scope: full repository (`**/*`, 210 tracked files)
- Perspectives selected: bug, ux, test, quality, security, performance, maintainability, best-practices
- Findings: 6
- Candidate issues: 4

## Highest-value findings

1. `packages/server/src/services/audit-log.ts:164`
   Cursor-based audit reads only return the newly appended tail after the first call. This can create false compliance violations inside the configured audit window.
2. `packages/server/src/tools/update-registry.ts:14`
   `fab_update_registry` accepts numeric `priority`, but the persisted registry schema requires `high|medium|low`.
3. `packages/cli/src/commands/ledger-append.ts:118`
   Duplicate suppression checks only the final JSONL line, which breaks when HTTP-mode MCP events share `.intent-ledger.jsonl`.
4. `packages/server/src/http.ts:137`
   The cache invalidation watcher has no shutdown path and can outlive the HTTP server lifecycle.

## Notes

- Recent workflow context already covered broader MCP/event-chain optimization work. This discovery focused on concrete, file-level defects and missing coverage that remain visible in the current tree.
- No business code was modified. Outputs were written under `.workflow/issues/discoveries/DSC-20260421-184152/`.

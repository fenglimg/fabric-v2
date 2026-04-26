# Requirement

按已确认规格更新分析文档/计划，规划代码删除和 doctor 重构。

## Confirmed Target Command Surface

Public user entry:

- `fabric init`
- `fabric scan`
- `fabric doctor`
- `fabric doctor --json`
- `fabric doctor --strict`
- `fabric doctor --fix`
- `fabric serve`

Delete public commands and MCP tools:

- `fabric update`
- `fabric bootstrap install`
- `fabric config install`
- `fabric hooks install`
- `fabric approve`
- `fabric pre-commit`
- `fabric human-lint`
- `fabric ledger-append`
- `fabric sync-meta`
- MCP `fab_append_intent`
- MCP `fab_update_registry`

## Target `.fabric/` State

Keep/generate:

- `.fabric/bootstrap/README.md`
- `.fabric/INITIAL_TAXONOMY.md`
- `.fabric/forensic.json`
- `.fabric/init-context.json` (only init skill writes it)
- `.fabric/rules/` (rule source of truth)
- `.fabric/agents.meta.json` (machine index)
- `.fabric/rule-test.index.json` (derived by `doctor --fix`)
- `.fabric/events.jsonl` (only event ledger)

Stop generating and do not keep compatibility:

- `.fabric/human-lock.json`
- `.fabric/agents/`
- `.fabric/.intent-ledger.jsonl`
- `.fabric/audit.jsonl`

No legacy migration logic is required because the product has no user compatibility burden.

## Doctor Target Semantics

`fabric doctor` is read-only diagnosis. It should focus on target-state MCP readiness:

- `.fabric/agents.meta.json` is valid
- each `content_ref` points to an existing `.fabric/rules/*` file
- rule sections are parseable
- `.fabric/events.jsonl` exists, is writable, and is parseable
- bootstrap, forensic, init-context, and INITIAL_TAXONOMY exist and are valid enough for their roles
- `.fabric/rule-test.index.json` is present and fresh, or reported as fixable drift

Report categories:

- `fixable_errors`
- `manual_errors`
- `warnings`

`fabric doctor --fix` only repairs deterministic derived state:

- rebuild `.fabric/agents.meta.json`
- rebuild `.fabric/rule-test.index.json`
- create missing `.fabric/events.jsonl`
- rebuild missing bootstrap README when deterministic
- fix stale meta hashes
- fix stale/missing rule-test index
- write typed events such as `baseline_synced` / `rule_baseline_accepted`

It must not repair semantic or human-confirmation problems:

- missing rule sections
- rule semantic conflicts
- missing or incomplete init-context user confirmation
- MCP client local config issues
- business code versus rule mismatch
- any human judgment issue

Post-fix acceptance:

- rerunning `fabric doctor` reports no fixable drift
- `.fabric/agents.meta.json` aligns with `.fabric/rules`
- `.fabric/rule-test.index.json` aligns with current `@fabric-verify` declarations


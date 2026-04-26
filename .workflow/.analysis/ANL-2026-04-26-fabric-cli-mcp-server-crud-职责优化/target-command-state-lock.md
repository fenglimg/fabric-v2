# Target Command And State Lock

Date: 2026-04-26

This document supersedes earlier command-surface recommendations in this analysis session for the doctor command-surface refactor.

## Public CLI Surface

Only these commands are public user entry points:

- `fabric init`
- `fabric scan`
- `fabric doctor`
- `fabric serve`

`fab` remains a permanent alias. Public docs must not recommend stage-rerun or compatibility commands as user workflows.

## Doctor Modes

`fabric doctor` is read-only by default and reports:

- `fixable_errors`
- `manual_errors`
- `warnings`

Supported public modes:

- `fabric doctor --json`
- `fabric doctor --strict`
- `fabric doctor --fix`

`--fix` only repairs deterministic derived state: `.fabric/agents.meta.json`, `.fabric/rule-test.index.json`, missing `.fabric/events.jsonl`, deterministic `.fabric/bootstrap/README.md`, and stale hashes. It must not repair semantic rule conflicts, missing rule sections, incomplete `.fabric/init-context.json` confirmation, MCP client local config issues, or business-code-versus-rule mismatch.

## Target `.fabric/` State

Keep or generate:

- `.fabric/bootstrap/README.md`
- `.fabric/INITIAL_TAXONOMY.md`
- `.fabric/forensic.json`
- `.fabric/init-context.json`
- `.fabric/rules/`
- `.fabric/agents.meta.json`
- `.fabric/rule-test.index.json`
- `.fabric/events.jsonl`

`.fabric/rules/` is the rule source of truth. `.fabric/agents.meta.json` and `.fabric/rule-test.index.json` are derived indexes. `.fabric/events.jsonl` is the only ledger.

## Removed Public Surface

Do not describe the following as public commands, migration paths, or compatibility recommendations:

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

No target-state docs should instruct users to keep `.fabric/human-lock.json`, `.fabric/agents/`, `.fabric/.intent-ledger.jsonl`, root `.intent-ledger.jsonl`, or `.fabric/audit.jsonl`.

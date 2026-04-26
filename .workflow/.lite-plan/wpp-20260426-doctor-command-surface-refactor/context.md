# Lite Plan Context

Session: `wpp-20260426-doctor-command-surface-refactor`

Requirement: update analysis docs/plan and plan code deletion plus doctor refactor for the confirmed target command/state model.

## Exploration Summary

### E1 command-surface

CLI public surface is centralized in `packages/cli/src/commands/index.ts`. Removing commands from `allCommands` removes public dispatch/help, but helper implementations used by `init` must be retained or relocated. Docs, templates, tests, and i18n still mention removed commands.

### E2 doctor-sync-meta

`sync-meta` contains useful agents.meta/rule-test index logic but is bound to `.fabric/agents`. `doctor` currently mixes target checks with human-lock, legacy ledger migration, and audit completeness. A rules-based builder over `.fabric/rules` should replace sync-meta and be called by `doctor --fix`.

### E3 fabric-state-model

Current init/templates still generate `.fabric/human-lock.json` and `.fabric/agents` guidance. Target state keeps bootstrap, INITIAL_TAXONOMY, forensic, init-context, rules, agents.meta, rule-test index, and events. Docs/dashboard/templates must stop exposing human-lock, approve, sync-meta, `.fabric/agents`, and old ledger paths.

### E4 mcp-server-surface

MCP server still registers `fab_append_intent` and `fab_update_registry`. Current replacement event instrumentation exists in `plan-context`, `rule-sections`, `event-ledger`, and HTTP MCP event store. Removing deprecated tools also requires pruning tests and legacy read/projection code.

## Planned Waves

Wave 1:

- T1 document target spec
- T2 introduce rules-based meta/rule-test builder

Wave 2:

- T3 refactor doctor service and CLI modes

Wave 3:

- T4 prune public CLI command surface
- T5 remove deprecated MCP write tools and legacy compatibility
- T6 align init outputs, skills, templates, dashboard

Wave 4:

- T7 final integration and regression cleanup


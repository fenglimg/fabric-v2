# Planning Context: @fenglimg/fabric-cli v1.1.0 — 8-item fix bundle

## Source Evidence

### Binary Rename (IMPL-001)
- `packages/cli/package.json:L5-L7` — bin field: `{ "fab": "dist/index.js" }` — add `"fabric"` key pointing to same dist
- `packages/cli/src/index.ts:L14` — `meta.name: 'fab'` — change to `'fabric'`; this is the USAGE header in help
- `templates/husky/pre-commit` — contains `FAB_BIN=` idempotency check — needs update if bin is renamed
- `exploration-patterns.json` (fab_to_fabric_cost): rename is a two-file atomic change; citty has no root-command alias mechanism

### Claude Client Fix (IMPL-002)
- `packages/cli/src/commands/config.ts:L13-L31` — `CLIENT_ALIASES` map; `"claude"` key absent, only `"claudecli"`, `"claudecodecli"` etc.
- `packages/cli/src/commands/config.ts:L47-L49` — `parseClientFilter` throws "unknown client" when `"claude"` is passed
- `packages/cli/src/config/writer.ts:L1-L8` — `ClientKind` union already has `ClaudeCodeCLI`; no new type needed
- `exploration-architecture.json` (CLIENT_ALIASES, L13-L31): fix is one-line add of `"claude": "ClaudeCodeCLI"` in config.ts CLIENT_ALIASES

### --force Flag (IMPL-003)
- `packages/cli/src/commands/init.ts:L140-L149` — three `existsSync` ABORT guards; primary injection points
- `packages/cli/src/commands/init.ts:L273-L279` — `writeNewFile()` throws ABORT if file exists; needs force bypass
- `packages/cli/src/commands/init.ts:L281-L289` — `copyTemplateIfMissing()` returns skip; already benign, needs force overwrite
- `packages/cli/src/commands/init.ts:L301-L359` — `mergeClaudeStopHook()` returns 'skipped' if hook present; needs force re-merge
- `packages/cli/src/commands/init.ts:L59-L115` — `initCommand.args` schema; add `force: { type: 'boolean', default: false }` here
- `packages/shared/src/i18n/locales/en.ts:L104` — `cli.init.errors.abort-existing` key already defined but unused in code
- `packages/shared/src/i18n/locales/en.ts:L87` — pattern for flag description key: `cli.init.args.<flag>.description`
- `packages/cli/__tests__/init-nondestructive.test.ts` — existing test pattern: createWerewolfFixtureRoot + writeFixtureFile + expect toThrow
- `packages/cli/__tests__/helpers/init-test-utils.ts` — shared test helpers; no new helpers needed for --force tests

### Integrated Init Flow (IMPL-004)
- `packages/cli/src/commands/bootstrap.ts:L151-L165` — `installBootstrap()` is an exported function; already overwrite-friendly
- `packages/cli/src/commands/bootstrap.ts:L40-L47` — `CLIENT_TEMPLATE_MAP` maps client keys to templates/bootstrap/*
- `packages/cli/src/commands/hooks.ts:L36-L96` — `hooksCommand.run` installs husky; skip check: `FAB_BIN=` in hook file
- `packages/cli/src/config/resolver.ts:L29-L83` — `resolveClients()` auto-detects installed AI clients by filesystem presence
- `exploration-integration-points.json` (init_artifact_catalog): init does NOT call config install; MCP is a separate step
- `exploration-integration-points.json` (GAP-2): to absorb config install, init must call `resolveClients()` and writers

### MCP Install Scope (IMPL-005)
- `packages/cli/src/commands/config.ts:L71-L74` — `resolveServerPath()` uses `import.meta.resolve('@fenglimg/fabric-server')`
- `packages/cli/src/config/writer.ts:L22-L27` — `createServerEntry()` creates `{command: process.execPath, args: [serverPath]}`
- `packages/cli/src/config/json.ts:L99-L110` — `ClaudeCodeCLIWriter.defaultPath()` always writes to project-scoped `.claude/settings.json`
- `exploration-integration-points.json` (global_vs_local_install): no current mechanism to detect local vs global context; `FAB_SERVER_PATH` env is the only escape hatch

### CLI Simplification (IMPL-006)
- `packages/cli/src/commands/index.ts:L1-L13` — `allCommands` registry with all 11 subcommands
- `packages/cli/src/index.ts:L12-L19` — root `defineCommand` with `subCommands: allCommands`
- `exploration-patterns.json` (citty_subcommand_registration): citty does not have a `hidden` flag in subcommand metadata; hiding requires wrapper pattern or README-only approach

## Understanding

**Current State**: CLI ships as `fab` only; init is non-destructive with hard abort guards; config/bootstrap/hooks are separate commands; `fabric config install --clients=claude` errors; no local vs global MCP install mode.

**Problems**:
1. Binary name is `fab`; `fabric` never registered in package.json bin
2. `claude` alias missing from CLIENT_ALIASES in config.ts
3. `initFabric()` has no options param and no --force flag
4. Init does not auto-invoke bootstrap/config-install/hooks stages
5. No mechanism for project-local vs global MCP server install
6. bootstrap/config/hooks commands prominently listed alongside init in help

**Approach**: Wave 1 addresses all 6 self-contained fixes; Wave 2 (shared-port /mcp/:projectId model + project registry + dashboard switcher) deferred as a follow-up architectural epic.

## Key Decisions

- Decision: Keep `fab` bin entry permanently | Rationale: user clarified "permanent alias, no deprecation" | Evidence: clarification Round 1
- Decision: --force overwrites all 5 layers unconditionally | Rationale: user clarified "overwrite all 5 layers" | Evidence: clarification Round 1
- Decision: initFabric() accepts `options: { force?, skipBootstrap?, skipMcp?, skipHooks? }` | Rationale: user clarified signature in Round 2; backward-compatible (options optional) | Evidence: clarification Round 2
- Decision: `--mcp-install=<global|local>` flag for IMPL-005 | Rationale: user wants explicit choice via flag or prompt; default=global matches current behavior | Evidence: clarifications Round 2
- Decision: Wave 2 (shared-port MCP model) deferred | Rationale: architectural scope too large for this plan; keep plan shippable | Evidence: scoping decision in task description

## Dependencies

- IMPL-001, IMPL-002: fully independent, parallel-safe
- IMPL-003: independent; prerequisite for IMPL-004 (options param contract)
- IMPL-004: depends on IMPL-003 (needs force + skipX flags wired into options)
- IMPL-005: depends on IMPL-004 (MCP stage lives inside integrated init flow)
- IMPL-006: depends on IMPL-004 (hiding commands is safe only after integration is in place)

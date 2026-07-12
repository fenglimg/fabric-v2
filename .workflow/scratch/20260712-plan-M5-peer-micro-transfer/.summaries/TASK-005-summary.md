# TASK-005 Summary — P1-5 CLI signposts

## Status
completed

## Files changed
- packages/cli/src/lib/command-signposts.ts — RETIRED_COMMAND_SIGNPOSTS (metrics→audit metrics, context→inspect, whoami/status→info)
- packages/cli/src/index.ts — pre-citty tombstone exit 1
- packages/cli/src/commands/index.ts — comment points at signposts (no silent aliases)
- packages/shared i18n cli.signpost.retired
- packages/cli/__tests__/command-signposts.test.ts

## Convergence
- [x] signpost table with metrics + context
- [x] allCommands does not re-add silent aliases
- [x] tests assert successor strings

## Tests
pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/command-signposts.test.ts

# @fenglimg/fabric-cli

`fabric` is the primary CLI binary for Fabric. `fab` is a permanent alias, so you can use either binary.

## Quick Start

1. Install dependencies from the monorepo root with `pnpm install`.
2. Build the CLI with `pnpm --filter @fenglimg/fabric-cli build`.
3. Run `fabric init` in the target project for the one-shot setup flow.
4. Start `fabric serve` and verify `fab_get_rules` in your client.

`fabric init` auto-runs `bootstrap install`, `config install`, and `hooks install`. Use them standalone only for targeted re-runs.

## Common Commands

- `fabric init`
- `fabric serve`
- `fabric doctor --audit`

## Advanced Commands

- `fabric bootstrap install`
- `fabric config install`
- `fabric hooks install`

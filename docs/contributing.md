# Contributing to Fabric

This guide covers local development prerequisites, the recommended pnpm workflow, and the environment details that were moved out of the README so npm users can keep the landing page focused on product onboarding.

## Prerequisites

- Node.js 20 or newer
- pnpm 9 or newer
- Git
- At least one MCP client for local verification: Claude Code, Cursor, Windsurf, Roo Code, Gemini CLI, or Codex CLI

Install workspace dependencies from the repository root:

```bash
pnpm install
```

## Development Environment

Build the workspace before testing CLI flows:

```bash
pnpm -r build
```

Use the monorepo development loop when iterating on package code:

```bash
pnpm dev
```

Useful focused commands:

```bash
pnpm --filter @fenglimg/fabric-cli test
pnpm --filter @fenglimg/fabric-server build
pnpm --filter @fenglimg/fabric-dashboard build
```

## `FAB_SERVER_PATH` for Local Development

`fab config install` resolves the packaged server entry automatically. When you are testing from this monorepo and want client configs to point at a locally built server, set `FAB_SERVER_PATH` explicitly:

```bash
export FAB_SERVER_PATH="$PWD/packages/server/dist/index.js"
```

Preview config writes before modifying any client config:

```bash
FAB_SERVER_PATH="$FAB_SERVER_PATH" pnpm --filter @fenglimg/fabric-cli exec fab config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
```

Then install the Fabric MCP config:

```bash
FAB_SERVER_PATH="$FAB_SERVER_PATH" pnpm --filter @fenglimg/fabric-cli exec fab config install --clients claude,cursor,windsurf,roo,gemini,codex
```

If the file does not exist, rebuild the server package first:

```bash
pnpm --filter @fenglimg/fabric-server build
```

## Contribution Workflow

1. Create a branch for one focused change.
2. Read the relevant docs and command implementations before editing.
3. Make small, reviewable commits that preserve existing client config and repo state.
4. Run tests and validation commands before opening a PR.
5. Update documentation when behavior or expected CLI output changes.

## Validation Checklist

Run the narrowest checks that cover your change, then rerun broader workspace checks before release-sensitive merges:

```bash
pnpm test
pnpm -r build
```

For doc-driven onboarding changes, also verify the key entry points:

```bash
rg -n "Placeholder workflow|FAB_SERVER_PATH" README.md docs
```

## Release-Sensitive Areas

Be conservative when editing:

- `README.md` and `docs/getting-started.md`: npm-facing onboarding path
- `packages/cli/src/commands/*.ts`: user-visible command behavior and output
- `packages/server/src/**`: MCP runtime behavior
- `packages/cli/templates/**`: bootstrap and hook compatibility across clients

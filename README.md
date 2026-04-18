# Fabric v2.0

Fabric v2.0 is an MCP-first, cross-client AGENTS.md protocol for six AI clients: Claude Code, Cursor, Windsurf, Roo Code, Gemini CLI, and Codex CLI. It keeps AGENTS.md as the human-maintained source of truth, distributes rules through a local MCP server, and adds git-level defenses so behavior stays consistent across clients without compiling client-specific rule files first.

## Architecture

- Regulation: AGENTS.md layers define the human-readable rule system.
- Metadata: `.fabric/agents.meta.json` stores machine-oriented routing and revision data.
- Intent: `.intent-ledger.jsonl` records append-only task intent history.
- Distribution: the Fabric MCP server serves scoped rules to supported clients on demand.
- Defense: pre-commit enforcement protects `@HUMAN` boundaries, metadata integrity, and workflow hygiene.

## Quick Start

Placeholder workflow:

```bash
pnpm install
pnpm -r build
pnpm dlx @modelcontextprotocol/inspector node packages/server/dist/index.js
```

## Roadmap

See [docs/roadmap.md](./docs/roadmap.md) for the deferred v1.1 maintenance milestone, including `drift-check`, `fab migrate`, `fab doctor`, and the Copilot fallback path.

## Day 7 Validation

- [Inner-track stub E2E runbook](./docs/day7-inner-track.md)
- [Outer-track real-project runbook](./docs/day7-outer-track.md)
- [Kill switch tracking sheet](./docs/day7-kill-switch-tracking.md)
- [Quickstart](./docs/quickstart.md)

## Status

v1.0 MVP follows the 7-day plan in `.workflow/.lite-plan/`. GitHub Copilot is explicitly not a Fabric v1.0 target client; see [docs/roadmap.md](./docs/roadmap.md) for the possible v1.1 fallback path.

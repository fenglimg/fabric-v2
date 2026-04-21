<p align="center">
  <img src="./assets/brand/fabric-wordmark.svg" alt="fabric wordmark" width="220">
</p>

# Fabric v1.0

人机协作的语义共识平面

The Consensus Plane for AI-Human Collaboration

Fabric v1.0 is an MCP-first, cross-client AGENTS.md protocol for six AI clients: Claude Code, Cursor, Windsurf, Roo Code, Gemini CLI, and Codex CLI. It keeps AGENTS.md as the human-maintained source of truth, distributes rules through a local MCP server, and adds git-level defenses so behavior stays consistent across clients without compiling client-specific rule files first.

> **v1.1 — Shadow Mirroring (current)**: all AI rules now live under `.fabric/agents/` as a 1:1 source mirror plus a `_cross/` subtree for cross-cutting concerns; business directories contain zero rule files. Bootstrap protocol mandates `fab_get_rules(path=...)` before any code reading, architecture planning, or logic modification. See [`CHANGELOG.md`](./CHANGELOG.md#110---2026-04-19) for the full feature list and migration notes.

```text
AI Agent <-> Fabric Ledger <-> Human Developer
   asks        records rules        approves
   acts        preserves intent     maintains truth
```

## Architecture

- Regulation: AGENTS.md layers define the human-readable rule system.
- Metadata: `.fabric/agents.meta.json` stores machine-oriented routing and revision data.
- Intent: `.intent-ledger.jsonl` records append-only task intent history.
- Distribution: the Fabric MCP server serves scoped rules to supported clients on demand.
- Defense: pre-commit enforcement protects `@HUMAN` boundaries, metadata integrity, and workflow hygiene.

## Quick Start

1. Install Fabric and build once if you are validating from this monorepo.
2. Run `fabric init` in the target project for the one-shot setup flow.
3. Start `fabric serve` and verify `fab_get_rules` in your client.

`fab` is a permanent alias, so you can use either binary. The docs use `fabric` as the primary command.
`fabric init` auto-runs `bootstrap install`, `config install`, and `hooks install`. Use those standalone commands only when you want a targeted re-run.

Use the canonical onboarding guide for the full 7-stage walkthrough, expected CLI output, and MCP activation checks: [docs/getting-started.md](./docs/getting-started.md).

## Initialization Guide

`fabric init` now does more than create a scaffold. It writes the evidence pack in `.fabric/`, installs the Claude handoff files under `.claude/`, and leaves a safe fallback `AGENTS.md` for non-Claude flows. Start with the canonical onboarding guide at [docs/getting-started.md](./docs/getting-started.md), then use [docs/initialization.md](./docs/initialization.md) for the deep-dive state machine and `agents-md-init` interview flow.

## Compliance Audit

Enable compliance telemetry reporting in `fabric.config.json`:

```json
{
  "auditMode": "warn"
}
```

Run `fabric doctor --audit` to cross-check AI edit intents against prior `fab_get_rules` calls in the last 5 minutes. `warn` prints violations but keeps exit code `0`, `strict` prints violations and exits non-zero, and `off` keeps the audit disabled by default unless you request a manual preview with `--audit`.

## Roadmap

See [docs/roadmap.md](./docs/roadmap.md) for the deferred v1.1 maintenance milestone, including `drift-check`, `fabric migrate`, `fabric doctor`, and the Copilot fallback path.

## Advanced Commands

Use these only when you need a targeted re-run outside the default `fabric init` flow:

- `fabric bootstrap install`
- `fabric config install`
- `fabric hooks install`

## Day 7 Validation

- [Inner-track stub E2E runbook](./docs/day7-inner-track.md)
- [Outer-track real-project runbook](./docs/day7-outer-track.md)
- [Kill switch tracking sheet](./docs/day7-kill-switch-tracking.md)
- [Getting Started](./docs/getting-started.md)

## Status

v1.0 MVP follows the 7-day plan in `.workflow/.lite-plan/`. GitHub Copilot is explicitly not a Fabric v1.0 target client; see [docs/roadmap.md](./docs/roadmap.md) for the possible v1.1 fallback path.

<p align="center">
  <img src="./assets/brand/fabric-wordmark.svg" alt="fabric wordmark" width="220">
</p>

# Fabric v1.5.0

人机协作的语义共识平面

The Consensus Plane for AI-Human Collaboration

Fabric v1.5.0 is an MCP-first, cross-client AGENTS.md protocol for six AI clients: Claude Code, Cursor, Windsurf, Roo Code, Gemini CLI, and Codex CLI. It keeps Fabric rule state inside `.fabric/`, distributes scoped rules through a local MCP server, and adds git-level defenses so behavior stays consistent across clients without compiling client-specific rule files first.

> **Current release: v1.5.0**. Fabric now adds CLI human-lock approval, richer TechProfile detection, activation-tiered rule loading, the `/api/rules/context` endpoint, and the Dashboard Rule Topology module. See [`CHANGELOG.md`](./CHANGELOG.md#150---2026-04-23) for the release notes and [`docs/initialization.md`](./docs/initialization.md) for the updated init flow.

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
2. Run `fabric init` in the target project. In a TTY it opens the guided wizard by default.
3. Start `fabric serve` and verify `fab_get_rules` in your client.

`fab` is a permanent alias, so you can use either binary. The docs use `fabric` as the primary command.
`fabric init` is now the canonical installer surface:

- `fabric init` launches the TTY wizard and then executes the selected plan.
- `fabric init --yes` accepts the current CLI flag plan and runs non-interactively.
- `fabric init --plan` prints the install plan without writing files.
- `fabric init --reapply --yes` forcefully reapplies Fabric-managed scaffold files and follow-up stages over an existing setup.

`fabric init` still auto-runs bootstrap, MCP config, and git hooks. Use the standalone commands only when you want a narrowly targeted re-run outside the main init flow.

Use the canonical onboarding guide for the full 7-stage walkthrough, expected CLI output, and MCP activation checks: [docs/getting-started.md](./docs/getting-started.md).

## Initialization Guide

`fabric init` now does more than create a scaffold. It builds an installation plan, lets TTY users confirm or reshape that plan through the wizard, writes the evidence pack in `.fabric/`, installs Claude/Codex follow-up assets, and keeps the bootstrap guide inside `.fabric/bootstrap/README.md` instead of generating root-level bootstrap docs. Start with [docs/getting-started.md](./docs/getting-started.md), then use [docs/initialization.md](./docs/initialization.md) for the deep-dive state machine, canonical flags, bootstrap protocol, and `agents-md-init` / `fabric-init` handoff flow.

## Compliance Audit

Enable compliance telemetry reporting in `fabric.config.json`:

```json
{
  "auditMode": "warn"
}
```

Run `fabric doctor --audit` to cross-check AI edit intents against prior `fab_get_rules` calls in the last 5 minutes. `warn` prints violations but keeps exit code `0`, `strict` prints violations and exits non-zero, and `off` keeps the audit disabled by default unless you request a manual preview with `--audit`.

## Human-Lock Approval

When a protected region drifts intentionally, approve the new hash from the CLI:

```bash
fabric approve --interactive
fabric approve --all
```

`fabric approve` only updates drifted entries from `.fabric/human-lock.json`; use interactive mode when reviewing each protected range and `--all` only after an external review has already confirmed the drift.

## Rule Topology Dashboard

`fabric serve` now exposes `/api/rules/context?path=<file>` and the Dashboard opens on Rule Topology. The view shows directory coverage inferred from `scope_glob` plus the exact L1/L2 rules and description-only stubs loaded for a sample path.

## Roadmap

See [docs/roadmap.md](./docs/roadmap.md) for the planned follow-up milestones, including `drift-check`, `fabric migrate`, `fabric doctor`, and the Copilot fallback path.

## Advanced Commands

Use these only when you need a targeted re-run outside the default `fabric init` flow:

- `fabric bootstrap install`
- `fabric config install`
- `fabric hooks install`

Canonical `init` variants:

- `fabric init --plan`
- `fabric init --yes`
- `fabric init --reapply --yes`
- `fabric approve --interactive`
- `fabric approve --all`

`fabric bootstrap install` now refreshes the internal bootstrap guide at `.fabric/bootstrap/README.md`. It no longer emits root `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.

## Validation

- [Getting Started](./docs/getting-started.md)
- [Initialization Guide](./docs/initialization.md)
- [Release Smoke Checklist](./docs/smoke-v1.0.md)
- [Release Checklist](./RELEASING.md)

## Status

The current stable line is `v1.5.0`. Historical launch planning remains in `.workflow/`, while the maintained public entry points are this README, the docs under `docs/`, and the tag-driven release flow in `.github/workflows/release.yml`.

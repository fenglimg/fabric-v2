# Fabric

> Fabric — cross-client knowledge for AI agents.

AI coding agents work without persistent project context. Each session re-learns the
codebase from scratch and re-argues the same architecture decisions. The things you
actually want them to remember — why we picked Postgres over Mongo, the auth bug that
bit us last quarter, the deploy step that breaks in CI — live scattered across Slack
threads, PR comments, and `AGENTS.md` forks that drift between `CLAUDE.md`,
`.cursor/rules`, and Codex configs. Fabric is one MCP-first knowledge layer every
supported client reads and writes through.

```text
                ┌─────────────────────────┐
                │  Fabric MCP Server      │
                │  (4 tools, 1 protocol)  │
                └────────────┬────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
  Claude Code              Cursor              Codex CLI
        │                    │                    │
        └────────────────────┼────────────────────┘
                             ▼
                  ┌──────────────────────┐
                  │  .fabric/            │
                  │  ├── knowledge/      │
                  │  │   ├── decisions/  │
                  │  │   ├── pitfalls/   │
                  │  │   ├── guidelines/ │
                  │  │   ├── models/     │
                  │  │   └── processes/  │
                  │  ├── pending/        │
                  │  ├── .archive/       │
                  │  ├── agents.meta.json│
                  │  └── events.jsonl    │
                  └──────────────────────┘
```

## Why Fabric

The name has outlived its first metaphor. Fabric started as a *rule-binder* — one place
to keep agent rules so they stopped drifting across clients. Then `AGENTS.md` standardised
the surface: a single Markdown file every client could read, but with no schema, no
lifecycle, no review. v2.0 takes the next step: Fabric is now a *knowledge-sustainment
protocol* — woven from many threads (decisions, pitfalls, guidelines, models, processes),
maintained over time, not a static rulebook.

What changes in v2.0:

- **Typed knowledge.** Five entry types with crisp semantics: `decisions/` (we chose X
  over Y because…), `pitfalls/` (this bit us, here's the fix), `guidelines/` (the way
  we do it here), `models/` (data shapes, domain entities), `processes/` (multi-step
  flows). One type per file, one stable id per entry.
- **Maturity tiers.** Every entry is `draft`, `endorsed`, or `stable`. New proposals
  start as draft; review promotes them; lint demotes the ones that go cold.
- **Dual-root layout.** Team knowledge lives at `<repo>/.fabric/` (committed,
  reviewed). Personal knowledge lives at `$FABRIC_HOME/.fabric/` (your scratchpad,
  never pushed). The same MCP tools serve both.
- **Lifecycle is the moat.** `fabric doctor --lint` finds orphaned entries, stale
  archives, overdue pending items, layer-mismatch corruption, index drift. Knowledge
  decays without maintenance — Fabric makes the decay visible and auditable.
- **MCP-first, cross-client.** Four MCP tools, one protocol. Claude Code, Cursor, and
  Codex CLI all read and write through the same server. No more compiling
  client-specific rule files.
- **Append-only audit trail.** Every promotion, demotion, archive, and review goes to
  `.fabric/events.jsonl`. You can replay what happened to any entry, ever.

## Quick Start

```bash
# In your project repo:
pnpm dlx @fenglimg/fabric-cli init
```

`init` scans your repo (tech stack, build config, code style, CI), installs the
fabric-archive / fabric-review / fabric-import Skills + Stop hooks for each detected
client, and writes a baseline `.fabric/` tree with 4–7 seed entries. After it
finishes, run `fabric doctor` — a healthy install reports zero fixable findings.

Supported clients: **Claude Code**, **Cursor**, **Codex CLI**.

## How It Works

Fabric exposes four MCP tools and three Skills.

**MCP tools** (called by clients, served by the local Fabric MCP server):

- `fab_plan_context` — given the current task, return a candidate pool of relevant
  rules and a `selection_token`. This is the cheap, neutral first call every session
  makes automatically.
- `fab_get_rule_sections` — drill into specific rule sections via the
  `selection_token`. L1/L2 progressive disclosure: you get only the sections you ask
  for, not the whole file.
- `fab_extract_knowledge` — propose a new entry from the current session into
  `.fabric/pending/`. This is the write side; nothing lands in canonical knowledge
  without review.
- `fab_review` — list, search, approve, reject, modify, or defer pending entries.
  Promotion moves a file from `pending/` into the canonical `knowledge/<type>/<layer>/`
  tree and emits a `knowledge_promoted` event.

**Skills** (LLM-side prose templates installed into each client):

- `fabric-archive` — triggered by a Stop hook signal at the end of a session;
  proposes new pending entries from session learnings.
- `fabric-review` — curates the pending queue. Mode is inferred from context (queue
  drain vs. by-topic vs. health overview vs. revisit existing); only genuine choices
  go through `AskUserQuestion`.
- `fabric-import` — cold-start enrichment. Mines `git log` and existing docs (`docs/`,
  `README.md`, `CHANGELOG.md`) into proposed entries, deduping against canonical via
  `fab_review action: search`. Resumable via `.fabric/.import-state.json`.

**Stop hooks** install per client (`.claude/`, `.cursor/`, `.codex/`) but point at a
single Node script. One implementation, three configs.

**Lifecycle** — `fabric doctor --lint` reports orphan demotion candidates (90/30/14
day decay thresholds for stable/endorsed/draft), stale archive candidates, overdue
pending entries, stable-id duplicates, layer-mismatch corruption, and index drift.
`--apply-lint` performs the mutations and writes `knowledge_demoted` /
`knowledge_archived` events. Default mode is report-only.

## Documentation

- [Knowledge Types](./docs/knowledge-types.md) — semantic definitions of the 5 entry
  types, decision criteria, examples.
- [Initialization](./docs/initialization.md) — what `fabric init` does, what it
  produces, how to re-run safely.
- [Roadmap](./docs/roadmap.md) — v2.0 (released), v2.1 (team-knowledge.git +
  permissions), v2.x (semantic search, federated teams).
- [Changelog](./CHANGELOG.md) — release history.

## Project Layout

This is a pnpm monorepo:

- `packages/cli` — the `fabric` / `fab` CLI (`init`, `scan`, `doctor`, `serve`).
- `packages/server` — the MCP server (4 tools) and the lifecycle service (review,
  doctor, lint).
- `packages/shared` — schemas (event ledger, api contracts, knowledge frontmatter)
  shared between CLI and server.
- `packages/cli/templates/skills/` — the three Skill templates (`fabric-archive`,
  `fabric-review`, `fabric-import`) shipped to clients on `init`.

Contributors: clone, `pnpm install`, `pnpm -r build`, `pnpm -r test`.

## Status

**v2.0** — released. Stable line. See [CHANGELOG.md](./CHANGELOG.md) for what changed
since v1.x and how to upgrade.

Repository: https://github.com/fenglimg/fabric

## Acknowledgments

The early Fabric design borrowed the cross-client `AGENTS.md` framing from Andrej
Karpathy's gist on agent rule files. The v2.0 knowledge-sustainment direction is
informed by methodology writeups from the Anthropic, Letta, and Tencent AI Team
communities — credit to those teams for naming the lifecycle problem clearly. The
specific shape of Fabric (4 MCP tools, 5 typed knowledge entries, 3-tier maturity,
dual-root layout, lint-driven decay) is original to this project.

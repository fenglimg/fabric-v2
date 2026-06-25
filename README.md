# Fabric

[![npm version](https://img.shields.io/npm/v/@fenglimg/fabric-cli.svg)](https://www.npmjs.com/package/@fenglimg/fabric-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

> **New here?** Start with [`docs/USER-QUICKSTART.md`](./docs/USER-QUICKSTART.md) (5 min) — mental model, the 4-step flow, and first-30-min troubleshooting.

> Fabric — cross-client knowledge sustainment for AI coding agents.

AI coding agents work without persistent project context. Each session re-learns
the codebase from scratch and re-argues the same architecture decisions. The
things you actually want them to remember — why we picked Postgres over Mongo,
the auth bug that bit us last quarter, the deploy step that breaks in CI — live
scattered across Slack threads, PR comments, and `AGENTS.md` forks that drift
between `CLAUDE.md` and Codex configs. Fabric is one
MCP-first knowledge layer every supported client reads and writes through, with
a hook-driven reminder layer so the knowledge actually fires when it matters.

```text
                ┌─────────────────────────────┐
                │  fabric-knowledge-server    │
                │  (MCP, 4 tools, stdio only) │
                └──────────────┬──────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        ▼                                             ▼
  Claude Code                                     Codex CLI
        │                                             │
        └──────────────────────┬──────────────────────┘
                               ▼
                  ┌────────────────────────┐
                  │  ~/.fabric/stores/     │
                  │  ├── <store>/knowledge │
                  │  │   ├── decisions/    │
                  │  │   ├── pitfalls/     │
                  │  │   ├── guidelines/   │
                  │  │   ├── models/       │
                  │  │   ├── processes/    │
                  │  │   └── pending/      │
                  │  └── events/metrics    │
                  │  <repo>/.fabric anchors│
                  │  policy + config only  │
                  └────────────────────────┘
```

## Why Fabric

AI agents forget. Static rule files (`AGENTS.md`,
`CLAUDE.md`) stop the bleeding for one client but drift across clients within a
week. Generic doc engines index everything and surface nothing. Fabric is
narrowly scoped to the one job that matters: keeping a small, typed,
maturity-graded knowledge base alive across sessions and across clients,
without polluting agent context.

### 8 truly differentiated features

1. **Cross-client MCP-first surface.** One server (`fabric-knowledge-server`),
   four tools (`fab_recall`, `fab_propose`, `fab_archive_scan`,
   `fab_review`), two clients reading and writing
   through the same protocol via stdio. Knowledge stops being a per-client artifact.

2. **Harness-agnostic by design.** No 16-stage workflow state machine, no
   IDE-vendor lock-in. Fabric integrates via the surfaces every modern agent
   harness already exposes — MCP tools, Stop hooks, SessionStart hooks,
   PreToolUse hooks, Skill templates — so it works under Claude Code
   and Codex CLI without per-harness adapters.

3. **Single-step lean recall.** `fab_recall(paths)` returns candidate
   DESCRIPTIONS plus native READ PATHS in one call — no body delivery over MCP,
   no multi-step fetch round-trip. The agent reads a body on demand via a
   native Read of the returned file path, so recall stays cheap and context
   only grows with what the agent actually opens.

4. **Async-review primitive.** `fab_propose` writes to `pending/`;
   nothing reaches canonical knowledge without `fab_review`. Promotion,
   rejection, deferral, and modification are all auditable actions, not
   side-effects of session end. Knowledge proposals can sit overnight without
   blocking the session that produced them.

5. **Path-decoupled stable_id + layer-flip audit.** Entries have stable
   identifiers independent of file path, so renames and moves don't break
   citations. `fab_review.modify` detects narrow-team-to-personal layer flips
   and auto-degrades scope to broad (personal knowledge crosses projects,
   paths don't generalize), emitting `knowledge_scope_degraded` to the event
   ledger.

6. **Narrow vs broad scope with `relevance_paths` filtering.** Frontmatter
   `relevance_scope: narrow|broad` plus `relevance_paths: string[]` lets each
   entry declare where it applies. `fab_recall` returns broad entries
   unconditionally and narrow entries whose globs match the current path.
   Three lint checks (`narrow_no_paths` #23, `relevance_paths_dangling` #24,
   `relevance_paths_drift` #25) keep the bindings honest as the code moves.

7. **Cross-client hook reminder layer.** A single `fabric-hint.cjs` Stop hook
   ships with parity configs for Claude Code and Codex CLI. It emits
   structured JSON with three signals — `archive` (24h since last
   `knowledge_proposed`), `review` (pending queue depth), `underseed`
   (`nodes<10 AND time_since_init>=24h`) — and a `recommended_skill` field so
   the agent knows which Skill to run next without polluting the user's
   transcript.

8. **Doctor as unified lifecycle engine.** `fabric doctor` runs 48 lint checks
   in one pass: orphan demotion (now driven by `last_consumed_at` derived
   from `knowledge_consumed` events, not last-referenced heuristics), stale
   archive, overdue pending with `--fix-knowledge` auto-archive, stable-id
   duplicates, layer-mismatch corruption, index drift, relevance-aware lints
   #23-#25, underseed lint #22. One command, one report, one place to fix
   knowledge health.

### Filesystem-edit fallback

Every Fabric mutation has a plain-text path. `pending/` and the canonical
`knowledge/<type>/` trees are markdown with frontmatter. Reviewing means
editing files. Archiving means `git mv` into `.archive/`. The MCP tools and
Skills are conveniences; nothing is locked inside an opaque database. If the
server is offline, you can still curate the knowledge base with `$EDITOR`.

### What Fabric deliberately is NOT

1. **Not a 5-layer storage taxonomy.** The Tencent-article-style 5-layer model
   (system / project / module / file / function) was rejected as non-moat.
   Fabric stays two-layer — team (`<repo>/.fabric/`) and personal
   (`~/.fabric/`) — because the layer-mismatch corruption surface that adds
   real value lives at the team/personal boundary, not at depth.

2. **Not an independent team-knowledge.git.** Sharing knowledge across
   repositories via a separate Git remote is a v2.1 concern. Today, team
   knowledge ships in-repo with the code it documents, reviewed via the same
   PR flow you already trust.

3. **Not a 16-stage workflow injection.** Fabric is harness-agnostic. The
   article's per-workflow-phase injection model assumes you own the agent
   harness. Fabric instead binds to events every harness already emits
   (`SessionStart`, `Stop`, `PreToolUse`) and lets the harness keep its own
   workflow model.

4. **Not remote control / cross-device handoff.** Knowledge sync across
   machines is an IDE infrastructure problem (settings sync, cloud profiles).
   Fabric stays a local-first toolchain and lets the IDE vendor handle the
   transport.

### MCP vs CLI — adapters, not redundancy

`planContext()` is the engine. It computes the candidate set, applies the
`relevance_paths` filter, and builds the candidate description index. Two
adapters expose it to different callers:

- **MCP** (`fab_recall` on `fabric-knowledge-server`) — for the agent.
  Pull-mode call during a session: mid-session topic switches, post-compaction
  re-grounding, cross-file reasoning that the path-aware hook can't predict.
  Returns candidate descriptions + native read paths; bodies are read on
  demand via a native Read.
- **CLI** (`fabric plan-context-hint --paths <p> | --all`) — for hook
  scripts. Hooks run in client subprocesses without `node_modules`, can't
  speak MCP, and need a stable JSON contract on stdout. The CLI subcommand
  imports `planContext()` directly and emits versioned JSON
  (`{version:1, revision_hash, target_paths, narrow:[...], broad_count}`).

Both call the same function. Neither is a fallback for the other.

### Position vs the Tencent AI-team article

Fabric shares genes with the methodology writeup from the Tencent AI team that
helped name this problem space: five typed knowledge entries, three maturity
tiers (`draft` / `verified` / `proven`), lint-driven decay discipline, and the
core thesis that *knowledge sustainment, not knowledge capture, is the moat*.

Where Fabric diverges:

| Axis | Tencent article | Fabric |
|---|---|---|
| Harness coupling | 16-stage workflow injection | Harness-agnostic via hooks + MCP |
| Storage depth | 5-layer (system / project / module / file / function) | 2-layer (team + personal) |
| Surface | Workflow phases inject context | MCP-first, hook reminders, Skill writes |
| Team sharing | Implicit per-environment | In-repo today; team-knowledge.git in v2.1 |
| Path binding | Implicit via layer | Explicit `relevance_paths` + 3 lints |

Genes are shared. The architecture is original to this project.

## Three surfaces

Fabric splits cleanly across three entry points; pick by who's in the loop:

- **CLI** — terminal, no AI in loop: `fabric install`, `fabric doctor`,
  `fabric store`, `fabric sync`, `fabric info`, `fabric metrics`,
  `fabric plan-context-hint`.
- **Skill** — AI is in the conversation and needs to judge content:
  `/fabric-archive`, `/fabric-review`, `/fabric-import`.
- **MCP** — primitives the above use internally: `fab_recall`,
  `fab_propose`, `fab_archive_scan`, `fab_pending`, `fab_review`.

→ See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
[`docs/RUNTIME-CONTRACTS.md`](./docs/RUNTIME-CONTRACTS.md) for the current
surface boundary and code-backed contract entry points.

## Quick Start

```bash
# In your project repo:
pnpm dlx @fenglimg/fabric-cli install
```

`install` prepares the project for Fabric: it writes the managed bootstrap,
configures client MCP stdio entries, installs hook and Skill templates, and
guides store binding. Knowledge entries live in mounted stores under
`~/.fabric/stores/`; new entries are proposed through Fabric Skills and reviewed
before promotion.

```bash
fabric install                    # install hooks + Skills + bootstrap + MCP client config
fabric doctor                     # run 48 lints, report only (--fix applies auto-fixable)
fabric metrics                    # text dashboard from .fabric/metrics.jsonl (rc.37 NEW-34)
fabric uninstall                  # remove Fabric-managed artifacts (mounted stores are never touched)
```

A healthy install reports zero fixable findings from `fabric doctor`. The MCP
server runs over **stdio transport only** — `fabric install` writes each
client's MCP config so the client spawns `node packages/server/dist/index.js`
on session start; there is no separate `fabric serve` process to run. The
v1.8-era HTTP server was quarantined to `packages/server-http-experimental/`
in v2.0.0-rc.37.

**Restart the client after `fabric install`** — already-running Claude Code /
Codex CLI sessions won't pick up the new MCP config until restart;
new sessions autoload it.

Supported clients (v2.0):

- **Claude Code** — managed bootstrap + SessionStart/PreToolUse/PostToolUse/Stop/SessionEnd hooks + Skill templates + MCP stdio
- **Codex CLI** — managed `AGENTS.md` bootstrap + SessionStart/PreToolUse/PostToolUse/Stop/SessionEnd hooks + Skill templates + MCP stdio

## How It Works

Fabric exposes four MCP tools and eight Skill templates: the `fabric` router plus
`fabric-archive`, `fabric-review`, `fabric-import`, `fabric-store`,
`fabric-sync`, `fabric-connect`, and `fabric-audit`.

**MCP tools** (called by clients, served by `fabric-knowledge-server`):

- `fab_recall` — the single-step recall path. Given target paths and optional
  intent, returns candidate DESCRIPTIONS filtered by `relevance_paths` plus a
  native READ PATH for each entry. It does not deliver bodies over MCP; the
  agent reads a body on demand via a native Read of the returned file path.
- `fab_propose` — propose new pending entries from the current
  session. Entries land under the active write store's
  `knowledge/pending/<type>/` tree. Nothing reaches canonical knowledge without
  review.
- `fab_archive_scan` — scan recent work/session history for archive-worthy
  candidates before a Skill decides what to persist.
- `fab_pending` — read-only list / search of pending and canonical entries
  (browse the backlog, dedupe against canonical). Honest `readOnlyHint:true`.
- `fab_review` — write-only approve, reject, modify, modify-content,
  modify-layer, defer of pending and canonical entries. `modify` works on both
  layers and detects narrow-team to personal flips, auto-degrading scope to broad.

**Skills** (LLM-side prose templates installed into each client):

- `fabric-archive` — triggered by Stop-hook signal. Phase 0.5 viability gate
  checks for archive-worthy signals before proposing. Phase 1.5 scope
  decision (narrow vs broad). Generates `relevance_paths` from
  `tool_use ∈ {Edit, Write, MultiEdit}` paths via public-prefix
  generalization (depth ≤ 2, minGroupSize = 2, glob blacklist).
- `fabric-review` — curates the pending queue. Mode is inferred from context;
  only genuine choices go through `AskUserQuestion`.
- `fabric-import` — cold-start enrichment. Mines `git log` and existing docs
  into proposed entries (default `relevance_scope: broad`, narrowing deferred
  to review). Resumable via `.fabric/.import-state.json`.

**Hooks** install per client but point at shared Node scripts copied into each
client's hook directory. `fabric-hint.cjs` owns Stop-time backlog nudges;
SessionStart, PreToolUse, PostToolUse, and SessionEnd use their own shared
scripts so both clients see the same lifecycle.

**Lifecycle** — `fabric doctor` runs 48 checks in one pass: orphan demotion
driven by `last_consumed_at` (from `knowledge_consumed` events), stale archive,
overdue pending (auto-archive with `--fix-knowledge`), stable-id duplicates,
layer-mismatch corruption, index drift, narrow/broad bindings (#23-#25),
underseed (#22). Mutations emit events to `.fabric/events.jsonl`; default mode
is report-only.

## Documentation

- [Quickstart](./docs/USER-QUICKSTART.md) — 5 minute user onboarding.
- [Architecture](./docs/ARCHITECTURE.md) — current package / surface / install
  pipeline map.
- [Runtime Contracts](./docs/RUNTIME-CONTRACTS.md) — CLI, MCP, schema and
  config contract entry points.
- [Testing](./docs/TESTING.md) — test strategy, drift gates and test seed role.
- [Changelog](./CHANGELOG.md) — release history.

## Project Layout

This is a pnpm monorepo:

- `packages/cli` — the `fabric` CLI (`install`, `store`, `sync`, `info`,
  `doctor`, `uninstall`, `config`, `metrics`).
- `packages/server` — the MCP server `fabric-knowledge-server` (4 tools, stdio)
  plus the lifecycle service (review, doctor, lint, event ledger, metrics).
- `packages/shared` — schemas (event ledger, api contracts, knowledge
  frontmatter) shared between CLI and server.
- `packages/server-http-experimental` — the v1.8-era HTTP/REST/SSE server +
  Dashboard package, quarantined v2.0.0-rc.37. Not built / not tested; restoration
  recipe in its README.
- `packages/cli/templates/skills/` — the Fabric Skill templates
  (`fabric-archive`, `fabric-review`, `fabric-import`) shipped to clients on
  `fabric install`.
- `packages/cli/templates/hooks/` — `fabric-hint.cjs` + `knowledge-hint-broad.cjs`
  + `knowledge-hint-narrow.cjs` + `cite-policy-evict.cjs` plus per-client hook
  configs (`claude-code.json`, `codex-hooks.json`).

Contributors: clone, `pnpm install`, `pnpm -r build`, `pnpm -r test`.

## Status

**v2.2.0-rc.5** — active development line. See [docs/UPGRADE.md](./docs/UPGRADE.md)
for supported upgrade notes and [CHANGELOG.md](./CHANGELOG.md) for release history.

Repository: https://github.com/fenglimg/fabric

## Acknowledgments

The early Fabric design borrowed the cross-client `AGENTS.md` framing from
Andrej Karpathy's gist on agent rule files. The v2.0 knowledge-sustainment
direction is informed by methodology writeups from the Anthropic, Letta, and
Tencent AI Team communities — credit to those teams for naming the lifecycle
problem clearly. The specific shape of Fabric (4 MCP tools, 5 typed knowledge
entries, 3-tier maturity, dual-root layout, `relevance_paths` filtering,
hook reminder layer, lint-driven decay) is original to this project.

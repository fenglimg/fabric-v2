# Fabric

[![npm version](https://img.shields.io/npm/v/@fenglimg/fabric-cli.svg)](https://www.npmjs.com/package/@fenglimg/fabric-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

**English** | [简体中文](./README.zh-CN.md)

> **New here?** Start with [`docs/USER-QUICKSTART.md`](./docs/USER-QUICKSTART.md) (5 min) — mental model, the 4-step flow, and first-30-min troubleshooting.

> Fabric — cross-client knowledge sustainment for AI coding agents.

## From AGENTS.md to a knowledge loop

AI coding agents are strong, but they don't *remember*. Every new session
re-learns the codebase from scratch and re-argues the same decisions. The things
you actually want them to keep — why we picked Postgres over Mongo, the auth bug
that bit us last quarter, the deploy step that breaks in CI — end up scattered
across Slack threads, PR comments, and `AGENTS.md` files that drift between
`CLAUDE.md` and Codex configs.

`AGENTS.md` is a great starting point: it tells an agent *what to read*. But it
doesn't solve *how knowledge is captured, reviewed, governed, and reused* over
time. A rule file is static, drifts across clients, and has no lifecycle — is a
note a one-off, or a proven rule? Is it stale? Should it be promoted, demoted,
or archived?

Fabric is the layer that closes that loop. It is **one MCP-first knowledge layer
every supported client reads and writes through**, plus a hook-driven reminder
layer so the knowledge actually fires when it matters — without polluting agent
context.

```text
                ┌───────────────────────────────┐
                │   fabric-knowledge-server     │
                │   (MCP · 5 tools · stdio)     │
                └───────────────┬───────────────┘
        ┌───────────────────────┴───────────────────────┐
        ▼                                                ▼
   Claude Code                                       Codex CLI
        │     CLI  ·  Hooks  ·  Skills  ·  MCP           │
        └───────────────────────┬───────────────────────┘
                                 ▼
              ┌──────────────────────────────────────┐
              │  ~/.fabric/stores/<store>/            │
              │    knowledge/{decisions, pitfalls,    │
              │      guidelines, models, processes}   │
              │    + pending/   + events / metrics    │
              │  mounted globally, bound per repo     │
              │  <repo>/.fabric = policy + config     │
              └──────────────────────────────────────┘
```

## What you borrow, what you skip

Fabric shares genes with the Tencent AI-team methodology writeup that helped name
this problem space, and keeps the parts that compound:

- **Typed knowledge** — five types: `decisions`, `pitfalls`, `guidelines`,
  `models`, `processes` (plural dirs, enforced by a schema enum).
- **Maturity** — exactly three tiers: `draft` → `verified` → `proven`.
- **Lifecycle** — entries are proposed, reviewed, promoted, demoted, archived.
- **On-demand consumption** — the agent pulls an index first, reads a body only
  when relevant.

And it deliberately drops the heavy shell around that core: no mandatory
16-stage workflow, no IDE lock-in. The thesis: *knowledge sustainment, not
knowledge capture, is the moat.*

## One substrate, four surfaces

Fabric is one **knowledge substrate** (where knowledge lives + who/when it
surfaces) exposed through **four surfaces**: CLI (for humans/scripts), MCP (for
the agent at runtime), Hooks (to remind at the right moment), and Skills (to let
the AI make judgment calls).

### Substrate: mountable stores + a 3-axis scope

The biggest evolution from early versions. Knowledge no longer lives in a fixed
`.fabric/` + `~/.fabric/` dual root — it lives in **stores**:

- A store carries an intrinsic, immutable UUID in its own git tree, so its
  identity survives remote/alias changes. Stores are **mounted** into
  `~/.fabric/fabric-global.json` and **bound per repo** via `fabric store bind`.
  Not bound → not read.
- Because a store can carry a git remote (`fabric store create/bind --remote`)
  and `fabric sync` rebases + pushes it, **a team store is shared across repos
  out of the box** — the original "team-knowledge.git" idea, already shipped.
- A repo's local `.fabric/knowledge/` is no longer a runtime source; it is only
  one-time import input. The mounted store is the source of truth.

Whether an entry surfaces to the agent is decided by **three orthogonal axes**:

| Axis | Values | Decides |
|---|---|---|
| `semantic_scope` (audience) | `team` / `project:<id>` / `personal` | who sees it (personal stays in a personal store — a schema-enforced privacy line) |
| `relevance_scope` (timing) | `broad` / `narrow` | always-on vs surfaced only when you edit a matching path (derived from `relevance_paths`) |
| `store` (physical) | a mounted store | whether it is read at all |

When something doesn't show up, `fabric audit why-not-surfaced <id>` diagnoses
which axis blocked it.

### CLI — deterministic, no LLM in the loop

```bash
fabric install                 # scan project, install hooks/skills/client config
fabric store bind <id>         # declare which knowledge store this repo uses
fabric store switch-write <a>  # set the default write target (per scope)
fabric sync                    # git sync mounted stores (pull --rebase + push)
fabric doctor [--fix]          # health check (+ deterministic repair)
fabric audit cite|conflicts|retired|why-not-surfaced|metrics
fabric info [--global|--recall]  # identity / project / recall-engine status
fabric inspect                 # show exactly what SessionStart injected
fabric uninstall               # symmetric removal (mounted stores untouched)
```

`store` / `sync` are new with the multi-store architecture; the old `serve` was
quarantined to an experimental package; `whoami` / `status` / `scope-explain`
folded into `info`; the audit flags split out of `doctor` into `audit`.

### MCP — the agent's runtime protocol (5 tools)

```text
fab_recall         # agent-direct: recall relevant knowledge before editing
fab_propose        # propose a pending entry
fab_archive_scan   # scan session history for archive-worthy candidates
fab_pending        # read-only browse / search of pending + canonical
fab_review         # write: approve / reject / modify / defer
```

**Lean recall.** `fab_recall(paths)` returns candidate *descriptions + native
read paths* in one call — it does not ship bodies over MCP. The agent reads a
body on demand from the path. Eager bodies are a permanent per-recall context
tax; a needed body is one cheap `Read` away. This is the same shape as Claude
Code's own Memory (`MEMORY.md` index + read-on-demand files) — the code even
calls the return a "Memory-style shape".

**Hybrid retrieval.** Ranking fuses two signals: BM25 lexical (with CJK
tokenization) plus an optional dense-vector semantic pass (cosine over a small
CPU embedding model, Chinese default `fast-bge-small-zh`). Vectors are **on by
default but degrade gracefully** — `fastembed` is an *optional* dependency; if
it can't build, is disabled, or throws, recall falls back to pure
BM25 + recency + locality + salience with no behavior change.

### Hooks — remind at the right moment (Claude Code + Codex CLI)

- `knowledge-hint-broad.cjs` — SessionStart: list broad knowledge + scope census.
- `knowledge-pretooluse.cjs` — PreToolUse (Edit/Write/MultiEdit): narrow,
  path-relevant hints + edit-count side ledger.
- `cite-policy-evict.cjs` — PreToolUse: soft nudge if you edit without a recall.
- `post-tooluse-mutation.cjs` — PostToolUse: record `file_mutated` and
  `knowledge_body_read` (closing the surfaced → cited → edited funnel).
- `fabric-hint.cjs` — Stop: nudge archive / review / cold-start backfill.
- `session-end-marker.cjs` — SessionEnd: a session-end breadcrumb.

Hooks only remind and keep books — they never block, and the judgment is left to
the AI that just lived through the context.

### Skills — let the AI make judgment calls (4)

- `fabric-archive` — extract worth-keeping knowledge from sessions into
  `pending` via `fab_propose`. Its *source mode* cold-starts an old project by
  mining `git log` + docs (absorbed the former `fabric-import`).
- `fabric-review` — review pending/canonical knowledge via `fab_review`
  (approve/reject/modify/defer), plus `retire` (deprecate stale/orphaned entries,
  "demote & rescue before delete") and `relate` (add `related` edges on request).
- `fabric-store` / `fabric-sync` — thin routers from natural-language intent to
  the `fabric store` / `fabric sync` CLI; the CLI does the work and guards the
  rails.

Knowledge files stay plain Markdown with frontmatter (`semantic_scope`,
`relevance`, `maturity`) under each store — git-managed, diffable, never locked
in an opaque database.

## Design principles

These few principles explain most of "why Fabric doesn't do X":

- **store-only** — knowledge lives only in mounted stores; no project-local
  runtime fallback, so there is one source of truth.
- **body-on-demand** — recall returns descriptions + paths; bodies are read on
  demand (lean recall).
- **never-block** — every Fabric action is advisory; nudges, not gates.
- **minimal-install** — no mandatory heavy infra (no vector DB, no SQLite, no
  graph DB; vector similarity is in-process cosine + an LRU cache). The only
  embedder (`fastembed`) is an *optional* dependency with a full text fallback.
- **dual-sink injection** — knowledge flows through SessionStart + PreToolUse,
  with separate channels for the AI and for the human.
- **clean-slate** — no legacy carried forward (the experimental HTTP server is
  quarantined to its own package).
- **honesty iron law** — under-report rather than over-report; no auto edge
  building, no auto maturity promotion, no usage-based ranking.
- **agent-native** — built for agents, not a human web UI.

## Quick Start

```bash
# In your project repo:
pnpm dlx @fenglimg/fabric-cli install
```

```bash
npm install -g @fenglimg/fabric-cli        # stable
npm install -g @fenglimg/fabric-cli@next   # preview

fabric install                 # hooks + Skills + bootstrap + MCP client config
fabric store bind <id>         # bind the knowledge store this repo uses
fabric doctor                  # health check (--fix applies auto-fixable)
fabric uninstall               # remove managed artifacts (stores untouched)
```

The MCP server runs over **stdio only** — `fabric install` writes each client's
MCP config so the client spawns the server on session start; there is no
separate `fabric serve` to run. **Restart the client after `fabric install`**:
running sessions won't pick up the new MCP config until restart; new sessions
autoload it.

Supported clients:

- **Claude Code** — managed bootstrap + SessionStart/PreToolUse/PostToolUse/Stop/SessionEnd hooks + Skill templates + MCP stdio
- **Codex CLI** — managed `AGENTS.md` bootstrap + the same hooks + Skill templates + MCP stdio

## What Fabric deliberately is NOT

- **Not a 5-layer storage taxonomy.** The system/project/module/file/function
  depth model was rejected. Fabric scopes knowledge by three orthogonal axes
  (audience / timing / store), not by nesting depth.
- **Not a 16-stage workflow injection.** Fabric is harness-agnostic. It binds to
  events every harness already emits (`SessionStart`, `Stop`, `PreToolUse`,
  `PostToolUse`) and lets the harness keep its own workflow model.
- **Not a permissioned team platform — yet.** Git-backed cross-repo store
  sharing already works; a role model (admin / contributor / reader) and deeper
  org-level federation are deliberately left for later.
- **Not a heavy retrieval stack.** No vector database, no always-on embedding
  infra; the vector pass is optional and degrades to lexical search.

## Position vs the Tencent AI-team article

Genes shared; architecture original.

| Axis | Tencent article | Fabric |
|---|---|---|
| Harness coupling | 16-stage workflow injection | Harness-agnostic via hooks + MCP |
| Storage | 5-layer depth taxonomy | Mountable multi-store + 3-axis scope |
| Surface | Workflow phases inject context | MCP-first, hook reminders, Skill writes |
| Retrieval | — | BM25 + optional vector (default-on, degrade-safe) |
| Team sharing | Implicit per-environment | Git-backed shared stores today; role model later |

## How it works (lifecycle)

```text
fabric install + store bind
  ↓
AI develops normally
  ↓
SessionStart / PreToolUse hooks surface knowledge
  ↓
agent calls fab_recall → descriptions + read paths; Reads a body on demand
  ↓
Stop hook detects archive / review signals
  ↓
fabric-archive → fab_propose writes to the active store's pending/
  ↓
fabric-review → approve assigns a stable id, promotes to canonical
  ↓
fabric doctor / fabric audit keep the base healthy
  ↓
next task reuses it automatically
```

`fabric doctor` runs the knowledge-health lints in one pass (orphan demotion,
stale archive, overdue pending, stable-id duplicates, layer/scope mismatch,
index drift, relevance bindings, underseed). Maturity promotion and demotion are
**detection-only** — they surface candidates; the actual change goes through
`fabric-review` (human in the loop). Default mode is report-only.

## Documentation

- [Quickstart](./docs/USER-QUICKSTART.md) — 5-minute user onboarding.
- [Architecture](./docs/ARCHITECTURE.md) — package / surface / install pipeline map.
- [Runtime Contracts](./docs/RUNTIME-CONTRACTS.md) — CLI, MCP, schema, config entry points.
- [Testing](./docs/TESTING.md) — test strategy, drift gates, test seed role.
- [Upgrade](./docs/UPGRADE.md) — supported upgrade notes.
- [Changelog](./CHANGELOG.md) — release history.

## Project layout

A pnpm monorepo:

- `packages/cli` — the `fabric` CLI (`install`, `store`, `sync`, `info`,
  `doctor`, `audit`, `config`, `inspect`, `uninstall`).
- `packages/server` — the MCP server `fabric-knowledge-server` (5 tools, stdio)
  plus the lifecycle service (recall, review, doctor, lint, event ledger, metrics).
- `packages/shared` — schemas (event ledger, api contracts, knowledge
  frontmatter, store + scope) shared between CLI and server.
- `packages/server-http-experimental` — the v1.8-era HTTP/REST/SSE + Dashboard
  package, quarantined in v2.0.0-rc.37. Not built / not tested.
- `packages/cli/templates/skills/` — the Fabric Skill templates (`fabric-archive`,
  `fabric-review`, `fabric-store`, `fabric-sync`) shipped on `fabric install`.
- `packages/cli/templates/hooks/` — the shared hook scripts + per-client configs
  (`claude-code.json`, `codex-hooks.json`).

Contributors: clone, `pnpm install`, `pnpm -r build`, `pnpm -r test`.

## Status

**v2.3.0-rc.3** — active development line. See [docs/UPGRADE.md](./docs/UPGRADE.md)
for upgrade notes and [CHANGELOG.md](./CHANGELOG.md) for release history.

Repository: https://github.com/fenglimg/fabric

## Acknowledgments

The early Fabric design borrowed the cross-client `AGENTS.md` framing for agent
rule files. The knowledge-sustainment direction is informed by methodology
writeups from the Anthropic, Letta, and Tencent AI Team communities — credit to
those teams for naming the lifecycle problem clearly. The specific shape of
Fabric (5 MCP tools, 5 typed knowledge entries, 3-tier maturity, mountable
multi-store + 3-axis scope, lean recall, hybrid retrieval, hook reminder layer,
lint-driven decay) is original to this project.

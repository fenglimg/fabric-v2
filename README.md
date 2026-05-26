# Fabric

> Fabric — cross-client knowledge sustainment for AI coding agents.

AI coding agents work without persistent project context. Each session re-learns
the codebase from scratch and re-argues the same architecture decisions. The
things you actually want them to remember — why we picked Postgres over Mongo,
the auth bug that bit us last quarter, the deploy step that breaks in CI — live
scattered across Slack threads, PR comments, and `AGENTS.md` forks that drift
between `CLAUDE.md`, `.cursor/rules`, and Codex configs. Fabric is one
MCP-first knowledge layer every supported client reads and writes through, with
a hook-driven reminder layer so the knowledge actually fires when it matters.

```text
                ┌─────────────────────────────┐
                │  fabric-knowledge-server    │
                │  (MCP, 4 tools, 1 protocol) │
                └──────────────┬──────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
  Claude Code                Cursor                Codex CLI
        │                      │                      │
        └──────────────────────┼──────────────────────┘
                               ▼
                  ┌────────────────────────┐
                  │  .fabric/   (team)     │
                  │  ~/.fabric/ (personal) │
                  │  ├── knowledge/        │
                  │  │   ├── decisions/    │
                  │  │   ├── pitfalls/     │
                  │  │   ├── guidelines/   │
                  │  │   ├── models/       │
                  │  │   └── processes/    │
                  │  ├── pending/          │
                  │  ├── .archive/         │
                  │  ├── agents.meta.json  │
                  │  └── events.jsonl      │
                  └────────────────────────┘
```

## Why Fabric

AI agents forget. Static rule files (`AGENTS.md`, `.cursor/rules`,
`CLAUDE.md`) stop the bleeding for one client but drift across clients within a
week. Generic doc engines index everything and surface nothing. Fabric is
narrowly scoped to the one job that matters: keeping a small, typed,
maturity-graded knowledge base alive across sessions and across clients,
without polluting agent context.

### 8 truly differentiated features

1. **Cross-client MCP-first surface.** One server (`fabric-knowledge-server`),
   four tools (`fab_plan_context`, `fab_get_knowledge_sections`,
   `fab_extract_knowledge`, `fab_review`), three clients reading and writing
   through the same protocol. Knowledge stops being a per-client artifact.

2. **Harness-agnostic by design.** No 16-stage workflow state machine, no
   IDE-vendor lock-in. Fabric integrates via the surfaces every modern agent
   harness already exposes — MCP tools, Stop hooks, SessionStart hooks,
   PreToolUse hooks, Skill templates — so it works under Claude Code, Cursor,
   and Codex CLI without per-harness adapters.

3. **Two-stage cold-start with degenerate single-stage fallback.**
   `fab_plan_context` returns a candidate index with `selection_token` when the
   knowledge base has >30 entries (cheap first call, then targeted fetch via
   `fab_get_knowledge_sections`). When ≤30 entries, it skips the round-trip
   and inlines `candidates_full_content` — fresh installs feel instant, mature
   bases stay scalable.

4. **Async-review primitive.** `fab_extract_knowledge` writes to `pending/`;
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
   entry declare where it applies. `fab_plan_context` returns broad entries
   unconditionally and narrow entries whose globs match the current path.
   Three lint checks (`narrow_no_paths` #23, `relevance_paths_dangling` #24,
   `relevance_paths_drift` #25) keep the bindings honest as the code moves.

7. **Cross-client hook reminder layer.** A single `fabric-hint.cjs` Stop hook
   ships with parity configs for Claude Code, Cursor, and Codex CLI. It emits
   structured JSON with three signals — `archive` (24h since last
   `knowledge_proposed`), `review` (pending queue depth), `underseed`
   (`nodes<10 AND time_since_init>=24h`) — and a `recommended_skill` field so
   the agent knows which Skill to run next without polluting the user's
   transcript.

8. **Doctor as unified lifecycle engine.** `fabric doctor` runs 25 lint checks
   in one pass: orphan demotion (now driven by `last_consumed_at` derived
   from `knowledge_consumed` events, not last-referenced heuristics), stale
   archive, overdue pending with `--apply-lint` auto-archive, stable-id
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
`relevance_paths` filter, builds the `description_index`, and decides
single-stage vs two-stage mode. Two adapters expose it to different callers:

- **MCP** (`fab_plan_context` on `fabric-knowledge-server`) — for the agent.
  Pull-mode call during a session: mid-session topic switches, post-compaction
  re-grounding, cross-file reasoning that the path-aware hook can't predict.
- **CLI** (`fabric plan-context-hint --paths <p> | --all`) — for hook
  scripts. Hooks run in client subprocesses without `node_modules`, can't
  speak MCP, and need a stable JSON contract on stdout. The CLI subcommand
  imports `planContext()` directly and emits versioned JSON
  (`{version:1, revision_hash, target_paths, narrow:[...], broad_count}`).

Both call the same function. Neither is a fallback for the other.

### Position vs the Tencent AI-team article

Fabric shares genes with the methodology writeup from the Tencent AI team that
helped name this problem space: five typed knowledge entries, three maturity
tiers (`draft` / `endorsed` / `stable`), lint-driven decay discipline, and the
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
  `fabric plan-context-hint`.
- **Skill** — AI is in the conversation and needs to judge content:
  `/fabric-archive`, `/fabric-review`, `/fabric-import`.
- **MCP** — primitives the above use internally: `fab_extract_knowledge`,
  `fab_plan_context`, `fab_get_knowledge_sections`, `fab_review`.

→ See [`docs/surfaces.md`](./docs/surfaces.md) for the full table, decision
rule, and flow examples.

## Quick Start

```bash
# In your project repo:
pnpm dlx @fenglimg/fabric-cli init
```

`init` scans your repo (tech stack, build config, code style, CI), installs
the `fabric-archive` / `fabric-review` / `fabric-import` Skills + Stop hooks
for each detected client, and writes a baseline `.fabric/` tree with 4-7 seed
entries.

```bash
fabric install                    # install hooks + Skills + bootstrap
fabric serve                      # start the MCP server
fabric doctor                     # run all 25 lints, report only
fabric doctor --apply-lint        # apply auto-fixable lints
fabric plan-context-hint --all    # JSON snapshot for hook scripts
fabric hooks install              # re-install hooks for all clients
fabric uninstall                  # remove Fabric-managed artifacts (knowledge stays unless --purge; ~/.fabric/knowledge/ is never touched)
```

A healthy install reports zero fixable findings from `fabric doctor`.

Supported clients:

- **Claude Code** — Stop hook + Skill templates
- **Cursor** — Stop hook + Skill templates
- **Codex CLI** — Stop hook (via `codex` hook config) + Skill templates

## How It Works

Fabric exposes four MCP tools and three Skills.

**MCP tools** (called by clients, served by `fabric-knowledge-server`):

- `fab_plan_context` — given the current task and optional path hints, return
  a candidate pool filtered by `relevance_paths`. When ≤30 candidates,
  returns full content inline (single-stage). When >30, returns a
  `description_index` plus `selection_token` for a targeted follow-up.
- `fab_get_knowledge_sections` — drill into specific sections via the
  `selection_token`. Emits one `knowledge_consumed` event per fetched
  `stable_id` (deduped within a request) so decay metrics use real consumption,
  not bare references.
- `fab_extract_knowledge` — propose new pending entries from the current
  session. Personal-layer entries land in `~/.fabric/knowledge/pending/<type>/`;
  team entries land in `<repo>/.fabric/knowledge/pending/<type>/`. Nothing
  reaches canonical knowledge without review.
- `fab_review` — list, search, approve, reject, modify, defer pending and
  canonical entries. `modify` works on both layers and detects narrow-team to
  personal flips, auto-degrading scope to broad.

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

**Hooks** install per client but point at a single Node script
(`fabric-hint.cjs`). One implementation, three configs.

**Lifecycle** — `fabric doctor` runs 25 lints in one pass: orphan demotion
driven by `last_consumed_at` (from `knowledge_consumed` events), stale archive,
overdue pending (auto-archive with `--apply-lint`), stable-id duplicates,
layer-mismatch corruption, index drift, narrow/broad bindings (#23-#25),
underseed (#22). Mutations emit events to `.fabric/events.jsonl`; default mode
is report-only.

## Documentation

- [Knowledge Types](./docs/knowledge-types.md) — semantic definitions of the 5
  entry types, decision criteria, examples.
- [Initialization](./docs/initialization.md) — what `fabric install` does, what
  it produces, how to re-run safely.
- [Roadmap](./docs/roadmap.md) — v2.0 (current), v2.1 (team-knowledge.git +
  permissions), v2.x (semantic search, federated teams).
- [Changelog](./CHANGELOG.md) — release history.

## Project Layout

This is a pnpm monorepo:

- `packages/cli` — the `fabric` CLI (`init`, `serve`, `doctor`,
  `hooks`, `scan`, `plan-context-hint`).
- `packages/server` — the MCP server `fabric-knowledge-server` (4 tools) plus
  the lifecycle service (review, doctor, lint, event ledger).
- `packages/shared` — schemas (event ledger, api contracts, knowledge
  frontmatter) shared between CLI and server.
- `packages/cli/templates/skills/` — the three Skill templates
  (`fabric-archive`, `fabric-review`, `fabric-import`) shipped to clients on
  `init`.
- `packages/cli/templates/hooks/` — `fabric-hint.cjs` plus per-client hook
  configs (`claude-code.json`, `cursor-hooks.json`, `codex-hooks.json`).

Contributors: clone, `pnpm install`, `pnpm -r build`, `pnpm -r test`.

## Status

**v2.0.0** — release-candidate line (`v2.0.0-rc.N` toward `v2.0.0` stable).
See [CHANGELOG.md](./CHANGELOG.md) for what changed since v1.x.

Repository: https://github.com/fenglimg/fabric

## Acknowledgments

The early Fabric design borrowed the cross-client `AGENTS.md` framing from
Andrej Karpathy's gist on agent rule files. The v2.0 knowledge-sustainment
direction is informed by methodology writeups from the Anthropic, Letta, and
Tencent AI Team communities — credit to those teams for naming the lifecycle
problem clearly. The specific shape of Fabric (4 MCP tools, 5 typed knowledge
entries, 3-tier maturity, dual-root layout, `relevance_paths` filtering,
hook reminder layer, lint-driven decay) is original to this project.

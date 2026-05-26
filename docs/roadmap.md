# Fabric Roadmap

Fabric organizes its public direction into three tiers: **Released**,
**Planned**, and **Exploration**. Released describes what shipped (with
RC-level detail in [CHANGELOG.md](../CHANGELOG.md)). Planned describes
work with concrete design intent. Exploration describes open questions —
language is deliberate ("we are exploring", "under consideration") so this
page does not become a promise registry.

> Cross-references: [README.md](../README.md) · [docs/initialization.md](./initialization.md) · [docs/knowledge-types.md](./knowledge-types.md) · [CHANGELOG.md](../CHANGELOG.md)

## v2.0 — Released (2026-Q2)

**Theme:** *Knowledge Sustainment Loop*

v2.0 is a clean rebrand from v1.x. Fabric's mission shifted from
"MCP-first AGENTS.md sync" to "MCP-first knowledge sustainment". The
deliverable is the full archive → review → promote → lint → archive loop,
hardened across three AI clients.

**Release signal.** `fab install` on a clean repo produces a 4–7 entry
baseline; the agent's Stop hook eventually prompts archival; the
`fabric-review` Skill drains `pending/`; `fab doctor --lint` keeps the
tree healthy.

### Shipped

- **4 MCP tools**:
  - `fab_plan_context` — context-shaped rule retrieval (carried from v1.x).
  - `fab_get_rule_sections` — structured section fetch (carried from v1.x).
  - `fab_extract_knowledge` — archive new entries with `(source_session,
    type, slug)` idempotency; evidence-append on duplicate.
  - `fab_review` — 6 actions (list / approve / reject / modify / search /
    defer) with path-traversal sandbox.
- **3 Skills** (installed to `.claude/skills/` and `.codex/skills/`):
  - `fabric-archive` — 5-type extraction prompt + layer classification
    heuristic.
  - `fabric-review` — mode-inferred review loop + per-mode flow + semantic
    check.
  - `fabric-import` — 3-phase LLM-driven enrichment with
    `.import-state.json` checkpoint.
- **Stop hooks** for Claude Code and Codex CLI (Cursor: tracked in v2.1).
  Single `archive-hint.cjs` script serves both clients via identical
  stdout JSON shape.
- **`fab doctor --lint`** — 6 deterministic checks: orphan demote,
  stale archive, stable_id duplicate, layer mismatch, index drift,
  pending overdue. Plus 1 filesystem-edit fallback (synthesizes
  `knowledge_promoted` for canonical files lacking provenance).
- **`fab doctor --apply-lint`** — applies fixes and emits
  `knowledge_demoted` / `knowledge_archived` events.
- **Late-bind id allocation** — `KP-` (personal) / `KT-` (team) prefix +
  type code (`DEC` / `PIT` / `GLD` / `MOD` / `PRO`) + monotonic counter
  envelope in `agents.meta.json`.
- **Schema cube**: 5 types × 3 maturity tiers × 2 layers, every entry
  occupies exactly one cell.
- **Dual-root layout**: `~/.fabric` for personal, `<repo>/.fabric` for
  team.
- **Init-time deterministic scan** producing 4–7 baseline entries from
  package.json / README / build config / lint config / CI yaml /
  forensic.json.

### Out of v2.0 scope (deferred to v2.1)

- Cursor Stop-hook support (no API surface as of 2026-05).
- Team-knowledge git remote sync (currently filesystem-only).
- 3-role permission model (currently flat: any contributor reviews).

### RC milestones — see [CHANGELOG.md](../CHANGELOG.md)

- **rc.1** — clean rebrand + init scan + new schemas.
- **rc.2** — archive loop (`fab_extract_knowledge` + `fabric-archive`
  Skill + Stop hooks).
- **rc.3** — review loop (`fab_review` + `fabric-review` Skill +
  filesystem-edit fallback + path-traversal sandbox).
- **rc.4** — lint + import (`doctor --lint` + `fabric-import` Skill +
  README rewrite + `docs/{knowledge-types,initialization,roadmap}.md`).

---

## v2.1 — Planned (2026-Q3)

**Theme:** *Team Distribution + Permission Boundaries*

v2.1 extends the loop from "single repo, single team" to "shared team
knowledge across machines/repos with explicit roles". The work is
designed but not yet implemented; APIs may shift before release.

### Planned features

- **`team-knowledge.git`** — a separate git repository for team-layer
  entries, synced via standard git pull/push primitives instead of the
  filesystem only. Personal layer stays in `~/.fabric/`. Initial design
  uses `<repo>/.fabric/team-knowledge` as a submodule pointing at the
  team-knowledge.git remote.
- **3-role permission model** —
  - `admin`: can edit `agents.meta.json` and lint thresholds.
  - `contributor`: can author entries, propose review actions.
  - `reader`: read-only consumption (CI bots, dashboards).
  - Roles encoded in a new `.fabric/team.json` config; enforced at the
    MCP boundary (server checks role before mutation).
- **Event-ledger schema unlock** —
  - `knowledge_layer_change_started` event (rc.3 deferred). Pairs with
    existing `knowledge_layer_changed` to capture the start of layer
    flip operations for crash recovery.
  - `agents_meta_repaired` event (when `doctor --fix` rebuilds the
    counter envelope).
- **API rename** — `pending_path` → `target_path` in `fab_review.modify`
  (rc.3 deferred). The current name leaks the implementation detail
  that approved entries used to live in `pending/`; the new name is
  layer-agnostic.
- **Cursor Stop-hook support** — pending Cursor exposing a Stop-hook
  surface. When the API lands, Fabric will add `.cursor/hooks/`
  install path mirroring `.claude/hooks/` and `.codex/hooks/`.

### Release signal

`fab install --team-remote <git-url>` clones the team-knowledge.git
submodule; `fab review` enforces role checks; new event types appear
in `events.jsonl`.

---

## v2.x — Exploration

These are open questions under consideration. Each has plausible value
but unsettled design. Inclusion here is **not** a commitment.

- **Semantic search** — vector embeddings + a local vector index in
  `.fabric/.embeddings/`. Currently knowledge retrieval is keyword and
  tag based; semantic search would unlock "find entries near this
  concept" queries. Open questions: which embedding model (local
  vs API); index format; refresh policy.
- **Federated teams** — multiple teams sharing subsets of their
  knowledge across organizational boundaries via signed knowledge
  bundles. Open questions: trust model; bundle format; selective
  sync (which entries leak to which partners).
- **LLM-driven semantic checks server-side** — currently semantic
  consistency checks live in Skill prose (LLM client-side). Moving
  the check server-side could improve performance and consistency.
  Open question: which checks are deterministic enough to lift out of
  the Skill.
- **Web UI for review** — `fab_review` is currently CLI/Skill only.
  A web UI (extension of the existing Dashboard) could lower the
  barrier for non-CLI reviewers. Open question: scope drift toward
  Notion/Obsidian competition (rejected as Boundary C in v2.0; would
  need a sharper rationale to revisit).
- **Decay threshold configurability** — `doctor --apply-lint`
  currently uses fixed thresholds (30 days for orphan demote, 180
  days for stale archive, 14 days for pending overdue). Per-team
  configurability (in `.fabric/team.json`) is a natural extension.

---

## Out of scope

To keep direction honest, items the Fabric roadmap explicitly does
**not** include:

- **SaaS hosting** — Fabric is a local-first tool. No hosted
  back-end, no managed knowledge service. The team-knowledge.git
  approach in v2.1 keeps sync inside standard git infrastructure
  (GitHub / GitLab / Gitea / self-hosted) without Fabric running a
  service.
- **LLM hosting** — Fabric does not provide LLM inference. All LLM
  calls happen via the user's MCP-connected client (Claude Code,
  Cursor, Codex CLI). Server-side semantic checks (v2.x) would call
  out via standard MCP, not host a model.
- **UI dashboard rebuild** — the existing v1.x dashboard stays MVP.
  No plan to rebuild it as a fully-featured product. The web-review
  UI in v2.x is a focused extension, not a rebuild.
- **Cross-language ports** — Fabric is Node.js. No plan to port the
  CLI or server to other runtimes; the MCP protocol provides language
  interop where it matters.

## How to track progress

- **What shipped** → [CHANGELOG.md](../CHANGELOG.md) (Keep a Changelog
  format, reverse chronological).
- **What is planned** → this document, v2.1 section.
- **What is being explored** → this document, v2.x section.
- **Active execution** → `.workflow/.lite-plan/` planning sessions in
  the repo (each rc has its own session directory with task DAGs and
  dogfood evidence).

Roadmap updates ship with each minor release.

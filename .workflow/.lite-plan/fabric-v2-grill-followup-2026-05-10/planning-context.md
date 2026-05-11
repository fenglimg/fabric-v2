# Planning Context — Fabric v2 grill-me Follow-up Engineering Landing

## Source Context

**Prior grill-me session**: `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/` (Q1-Q7 grill cycle, all 7 questions answered with locked decisions)
**Prior lite-plan (rc.2-prep, shipped)**: `.workflow/.lite-plan/fabric-v2-rc2-prep-2026-05-10/` (commits da80d5e..97103ab on `main`)
**Memory constraints**:
- Fabric supports only Claude Code / Cursor / Codex CLI (Windsurf/Roo Code/Gemini CLI dropped)
- Pre-user clean-slate preference — zero migration tax, hard-delete v1 artifacts, no shims

**Scope boundary**: This plan is the **engineering landing of grill-locked decisions**. It must complete BEFORE rc.2 implementation begins (i.e., before `fab_extract_knowledge` MCP / `fabric-archive` skill / Stop hooks). All 10 tasks here are deterministic schema/docs/rename work; nothing depends on a new MCP tool or skill landing.

**Execution mode (locked by user)**:
- Coding executor: Agent (code-developer = Claude Code), every task `recommended_execution: "Agent"`
- Per-commit review: Gemini Review (plan-level `code_review_tool: "Gemini Review"`)
- Coverage / convergence: Agent writes tests, ≥90% new-code coverage
- Commit messages: 1 atomic commit per task, conventional commits style, executor authors message
- Per-commit gate: Gemini diff review → issues → Claude fixes → next task

## Grill-Me Decisions Locked (Q1–Q7)

User confirmed all 7 recommendations across grill-me session. Each maps to concrete tasks below.

### Q1 — Filename convention (LOCKED)
`<id>--<slug>.md` (id prefix + slug suffix). Example: `KT-DEC-0001--boundary-b-async-review.md`. Layer-flip via `git mv` (KT prefix → KP prefix); slug rename via plain `git mv` keeping id stable.

### Q2 — Pending stage layout (LOCKED)
`pending/<type>/<slug>.md` layout. **Late-bind id**: counter increments only on `approve` action; frontmatter has NO `id` field during pending stage; on approve, MCP injects assigned `id` into frontmatter and `git mv` to canonical path.

### Q3 — Language policy (LOCKED, "M3 style")
EN headings + zh-CN body + EN technical terms preserved. fabric-config gets new field:
- `knowledge_language: "match-existing" | "zh-CN" | "en"` default `"match-existing"`
- fabric-monorepo's own `.fabric/fabric-config.json` explicitly sets `"zh-CN"` (dogfood declaration)
- "match-existing" mode: scan repo's existing prose (README/docs/) to detect majority language; default to `"en"` on empty repo

### Q4 — Topology (LOCKED)
- Per-type flat layout (sub-dirs allowed for future)
- Personal layer (KP-*) fully mirrors team layer (KT-*) structure
- **Independent counters per layer** + independent meta files: `~/.fabric/agents.meta.json` maintains KP counters, repo `.fabric/agents.meta.json` maintains KT counters
- Strict separation: `docs/` is for human-narrative documentation, `.fabric/knowledge/` is for agent-consumed knowledge (no cross-contamination)
- Cache rename: `.fabric/rule-test.index.json` → `.fabric/.cache/knowledge-test.index.json`

### Q5 — Sync contract (LOCKED)
- `.md` is authoritative source of truth; meta is derived cache
- Write-time sync (immediate) + watcher fallback (eventual consistency)
- `meta.revision = sha256(sorted(stable_id + ":" + frontmatter_hash))` — recomputed after any meta change
- A2+A1 transactional 2-phase event sequence: `promote_started` → (success) `promoted` OR (failure) `promote_failed`
- Layer flip = explicit `git mv` (slug rename) + frontmatter id prefix update (KT↔KP)

### Q6 — Existing-MCP adaptation (LOCKED)
- Tags injected into `description_index` (already-shipped tags field from rc.2-prep is reused)
- `layer_filter?: "team" | "personal" | "both"` input field on `fab_plan_context`; default `"both"`
- Plan-context honors `default_layer_filter` config field as fallback
- `redirect_to: { stable_id }` error shape on `fab_get_rule_sections` — fired when post-layer-flip stable_id no longer matches
- `near_duplicate` diagnostic — same slug across layers is flagged
- ENOENT on entry read → 1 meta-rebuild retry, then bubble error

### Q7 — New-MCP contracts (LOCKED, rc.2/3/4 protocol pre-lock)
- **Thin MCP / thick Skill** principle: MCP tools are deterministic CRUD; LLM-end skills carry decision logic
- `fab_extract_knowledge` semi-thick input: `{ source_session, recent_paths[], user_messages_summary }` — Skill summarizes, MCP persists
- Idempotency key: `(source_session, type, slug)` — repeat call same key = no-op (returns existing pending entry)
- `fab_review` `approve` action uses `pending_paths[]` (matches Q2 late-bind: pending entries don't have ids yet)
- Layer-flip: `fab_review modify { layer: "team"|"personal" }` action — NOT a separate `fab_review flip` action
- Defer expiry detected by `doctor` (not by MCP) — pending entries deferred >N days flagged in `doctor --lint`
- Docs split: `docs/data-schema.md` (data shape) + `docs/mcp-contracts.md` (API contracts) — replaces single `docs/schema.md`

## Engineering Actions (10 tasks)

| # | Title | Files | Atomic Commit |
|---|---|---|---|
| 001 | discussion-followup.md (decision-tree archive) | `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/discussion-followup.md` | `docs(anl): grill-me follow-up decision tree (Q1-Q7)` |
| 002 | fabric-config schema additions | `packages/shared/src/schemas/fabric-config.ts` + tests | `feat(schema): add knowledge_language + default_layer_filter to fabric-config` |
| 003 | api-contracts schema additions (rc.2/3 protocol pre-lock) | `packages/shared/src/schemas/api-contracts.ts` + tests | `feat(schema): rc.2/rc.3 MCP protocol lock — extract_knowledge + review + tags + layer_filter` |
| 004 | event-ledger 11 new event types | `packages/shared/src/schemas/event-ledger.ts` + fixtures | `feat(schema): pre-register knowledge.* event types for rc.2/3/4` |
| 005 | rename rule-test.index.json → .cache/knowledge-test.index.json | grep packages/, update path constants, update .gitignore | `refactor(cache): rename rule-test.index.json → .cache/knowledge-test.index.json (v2 vocabulary)` |
| 006 | docs split — data-schema.md + mcp-contracts.md | DELETE `docs/schema.md`; CREATE 2 new docs | `docs: split data schema + MCP contracts (replaces docs/schema.md)` |
| 007 | zh-CN rewrite — 13 dogfood entries | 8 KT-DEC + 5 init-scan baseline files | `docs(dogfood): rewrite knowledge entries in zh-CN narrative (M3 style)` |
| 008 | init-scan bilingual templates | `packages/cli/src/commands/init.ts` + tests | `feat(init): bilingual baseline templates driven by knowledge_language config` |
| 009 | fabric-monorepo own fabric-config sets zh-CN | `.fabric/fabric-config.json` (create or update) | `chore(dogfood): set knowledge_language=zh-CN for fabric-monorepo` |
| 010 | Day-1 gate verification + plan summary | none (verification only) | none (no source change) |

## Dependencies & Parallelism

```
TASK-001 ──┐ (independent — first, doc-only)
TASK-002 ──┼── parallel (no shared files)
TASK-003 ──┤
TASK-004 ──┤
TASK-005 ──┘

TASK-006 ◄── 002, 003, 004 (docs reference schema field names)
TASK-007 ◄── 006 (canonical naming/language guidelines must be locked first)
TASK-008 ◄── 002 (reads knowledge_language config field)
TASK-009 ◄── 008 (validates config-flow through init template)
TASK-010 ◄── ALL (final gate verification)
```

**Parallel-safe groups**: `[TASK-002, TASK-003, TASK-004, TASK-005]` (4-way fan-out after TASK-001).

## Day-1 Gate (TASK-010 enumerates these)

```bash
# v1 cache vocabulary purged
! grep -rE "rule-test\.index|rule_baseline|baseline_synced|legacy_client_path_present" packages/  # exits 1 = pass
test ! -f .fabric/rule-test.index.json
test -f .fabric/.cache/knowledge-test.index.json

# Schema additions present
grep -q "knowledge_language" packages/shared/src/schemas/fabric-config.ts
grep -q "default_layer_filter" packages/shared/src/schemas/fabric-config.ts
grep -q "layer_filter" packages/shared/src/schemas/api-contracts.ts
grep -q "redirect_to" packages/shared/src/schemas/api-contracts.ts
grep -q "FabExtractKnowledgeInput" packages/shared/src/schemas/api-contracts.ts
grep -q "FabReviewInput" packages/shared/src/schemas/api-contracts.ts
grep -cE "knowledge_(proposed|promoted|promote_started|promote_failed|layer_changed|slug_renamed|demoted|archived|archive_attempted|deferred|rejected)" \
  packages/shared/src/schemas/event-ledger.ts | awk '$1 >= 11'

# Docs split landed
test -f docs/data-schema.md
test -f docs/mcp-contracts.md
test ! -f docs/schema.md

# Dogfood config landed
jq -r .knowledge_language .fabric/fabric-config.json | grep -q zh-CN

# Build green
pnpm build && pnpm test && pnpm lint
```

## Time Budget

| Task | Estimate |
|---|---|
| 001 discussion-followup.md | 30-45 min |
| 002 fabric-config schema | 30-45 min |
| 003 api-contracts schema | 60-90 min |
| 004 event-ledger 11 types | 45-60 min |
| 005 cache rename | 30-45 min |
| 006 docs split (2 new files) | 90-120 min |
| 007 zh-CN rewrite (13 files) | 90-120 min |
| 008 init bilingual templates | 60-90 min |
| 009 fabric-config zh-CN | 10-15 min |
| 010 Day-1 gate verification | 15-30 min |
| **Total** | **8-12 hours (~1.5-2 work days)** |

## Out of Scope

- `fab_extract_knowledge` MCP tool **implementation** (rc.2 — only the Zod schema lands here)
- `fab_review` MCP tool **implementation** (rc.3 — only the Zod schema lands here)
- `fabric-archive` skill template (rc.2)
- `fabric-review` skill template (rc.3)
- Stop hook scripts + 3-client configs (rc.2)
- Doctor `--lint` 6 deterministic checks (rc.4)
- `fabric-import` skill template (rc.4)
- Full README rewrite + `docs/knowledge-types.md` + `docs/initialization.md` + `docs/roadmap.md` (rc.4)
- npm publish (deferred to 2.0.0 stable)

## Convergence (plan-level)

- All 10 tasks completed with green CI (build + test + lint)
- Day-1 gate (TASK-010) all checks pass
- 10 commits on main, each Gemini-reviewed
- New code coverage ≥ 90%

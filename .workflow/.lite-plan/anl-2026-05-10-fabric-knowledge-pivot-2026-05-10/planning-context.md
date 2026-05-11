# Planning Context: Fabric v2.0 rc.1 — Clean Rebrand Foundation

## Source Evidence

### Primary Inputs
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/handoff.json` — implementation_scope[0] defines rc.1 boundary: 12 target_files, 9 acceptance_criteria, change_summary
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/discussion.md:711-722` — rc.1 Plan Checklist (9 bullets)
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/exploration-codebase.json` — 24 relevant_files map of v1.x architecture; confidence 0.93

### Code Anchors (current v1.x state)
- `packages/server/src/services/rule-meta-builder.ts:709-792` — hand-rolled regex frontmatter parser (flat scalars + flow arrays only, NOT YAML)
- `packages/server/src/services/rule-meta-builder.ts:748-762` — `extractDescriptionFromFrontmatter` reads summary/intent_clues/tech_stack/impact/must_read_if/entities. Must extend for v2.0 fields (id/type/maturity/layer/layer_reason/created_at) but stays flat.
- `packages/shared/src/schemas/agents-meta.ts:79-91` — `withDerivedAgentsMetaNodeDefaults` derives stable_id from path. v2.0 must persist explicit counter from agents.meta.json instead of regenerating on path change.
- `packages/shared/src/schemas/agents-meta.ts:93-101` — `deriveAgentsMetaStableId` is path-derived. v2.0 keeps as fallback only; path-decoupled KP-/KT- counter is the new primary mechanism.
- `packages/server/src/index.ts:106-107` — only 2 MCP tools registered (fab_plan_context, fab_get_rule_sections). rc.1 keeps this list intact, adapts both tools to new schema.
- `packages/server/src/services/plan-context.ts:70-91` — selection-token state machine + path-based filtering. Will need scanning rules for new dual-root + 5-type subdirectory layout.
- `packages/server/src/services/doctor.ts:285-305` — 19 checks in additive list pattern. rc.1 only adapts existing checks (taxonomy_missing, rules_dir_unindexed, stable_id_collision, bootstrap_missing) to new layout — does NOT add new lint checks (those are rc.4).
- `packages/cli/src/commands/init.ts:521,548,1390` — `buildInitFabricPlan` writes v1.x scaffold; `buildInitialTaxonomyMarkdown` generates structural L0/L1/L2 taxonomy. rc.1 deletes the latter and rewrites the former.

## Understanding

### Current State (v1.x)
- `.fabric/rules/*.md` is the production knowledge surface, indexed in `.fabric/agents.meta.json` with path-derived stable_ids.
- Frontmatter schema = summary + intent_clues + tech_stack + impact + must_read_if + entities. No type/maturity/layer_reason/created_at.
- INITIAL_TAXONOMY.md generated from forensic.json key_dirs — purely L0/L1/L2 structural topology, zero overlap with knowledge-type taxonomy.
- Single-root layout (`.fabric/` in repo only). No personal/team separation.
- Init flow runs 3 stages (bootstrap, mcp, hooks). No deterministic content scan — `.fabric/rules/` is created empty.
- Doctor's `bootstrap_missing` and `taxonomy_missing` reference v1.x artifacts.

### Problem (what v2.0 rc.1 must change)
1. **Path-derived stable_id** breaks ledger replay when files move between directories. Need path-decoupled KP-/KT- counter persisted in agents.meta.json.
2. **No type/maturity dimension** — all rules are unclassified. Need 5-type (decisions/pitfalls/guidelines/models/processes) × 3-maturity (proposed/validated/deprecated implied) × 2-layer (KT team / KP personal) schema baked into frontmatter.
3. **Single-root layout** — gitignore can't discriminate by frontmatter, so personal knowledge must live physically separate at `~/.fabric/`. Dual-root requires scanner to merge two trees at runtime.
4. **Empty knowledge base post-init** — no users will manually populate. Need 4-7 deterministic baseline entries (tech stack, module structure, build config, code style, CI, README first paragraph) generated from existing `forensic.json` data.
5. **Legacy artifacts** (`.fabric/rules/`, `INITIAL_TAXONOMY.md`, `.fabric/bootstrap/`) carry v1.x semantics that conflict with v2.0 positioning. User confirmed clean delete (no `.fabric-v1-archive/`).

### Approach (rc.1 boundary)
- **Schema-first**: define new frontmatter contract + agents.meta.json counter mechanism in `packages/shared/src/schemas/` BEFORE touching readers/writers. This is the contract under which everything else reads/writes.
- **Reader before writer**: update `rule-meta-builder.ts` parser to extract new fields, update `plan-context.ts` + `rule-sections.ts` to scan new directory tree, BEFORE rewriting init flow that produces those files. This avoids the chicken-and-egg of "init writes files no consumer can read".
- **Independent delete**: legacy delete (Task 1) is data-only and can run in parallel with schema design (Task 2). Both unblock everything else.
- **Init scan as new internal stage**: `cli/src/commands/scan.ts` becomes the deterministic-baseline producer. Init invokes it as a 4th stage between mcp and hooks, AFTER new layout is created.
- **Defer everything write-cycle/audit-cycle**: no `fab_extract_knowledge` (rc.2), no `fab_review` (rc.3), no `doctor --lint` (rc.4), no `fabric-import` skill (rc.4), no Stop hooks (rc.2), no archive/review skill installation (rc.2/3).

## Key Decisions

- **Decision: 8 tasks total, grouped by deliverable** | Rationale: matches the suggested 8-task structure in input prompt; each task = 30-90 min substantive work; clear ownership boundaries (delete/schema/id/parser/MCP/doctor/scan/init). Evidence: input prompt "Suggested task structure" + acceptance_criteria 1:1 mapping.
- **Decision: Schema (TASK-002) is foundation; parser (TASK-004) and stable_id (TASK-003) consume it** | Rationale: `rule-meta-builder.ts` parser cannot extract fields it doesn't know about; stable_id counter type must be defined in schema before persistence code. Evidence: `agents-meta.ts:44-64` agentsMetaNodeBaseSchema is the contract surface.
- **Decision: TASK-001 (delete legacy) has no dependencies and runs first/parallel** | Rationale: data-only operation, doesn't touch code paths under modification. Reduces risk of "delete after refactor breaks intermediate state". Evidence: target_files include `.fabric/rules/`, `.fabric/INITIAL_TAXONOMY.md`, `.fabric/bootstrap/` as plain paths.
- **Decision: MCP adaptation (TASK-005) depends on parser (TASK-004), not directly on schema (TASK-002)** | Rationale: MCP services consume RuleDescription objects produced by rule-meta-builder; schema change is invisible to them through the parser interface. Evidence: `plan-context.ts:73` two-call workflow uses parsed nodes, not raw frontmatter.
- **Decision: Doctor adaptation (TASK-006) depends on schema (TASK-002), not parser (TASK-004)** | Rationale: doctor checks structural state (file existence, agents.meta.json shape, dir layout), not parsed content. taxonomy_missing → "knowledge dir missing" rename. Evidence: `doctor.ts:285-305` checks reference path and meta file shape.
- **Decision: Scan command (TASK-007) is new but isolated; depends on schema + dual-root knowledge of what to write** | Rationale: scan produces files that conform to v2.0 frontmatter; needs schema (TASK-002) but doesn't need parser/MCP. Evidence: scan output is text files; consumers parse them later via TASK-004's parser.
- **Decision: Init flow update (TASK-008) is the convergence point — depends on 1, 2, 3, 7** | Rationale: init flow must (a) NOT regenerate deleted artifacts (depends on 1), (b) write v2.0 layout (depends on 2 schema, 3 stable_id), (c) invoke scan to produce baseline (depends on 7). MCP/parser/doctor are runtime concerns, not init concerns. Evidence: `init.ts:521` buildInitFabricPlan composes 3 stages; rc.1 makes it 4.
- **Decision: Stable_id counter lives in agents.meta.json `counters: {KP: number, KT: number}` envelope** | Rationale: existing agents.meta.json is the durable source-of-truth for derived state; reuses save/load infrastructure. file mv only updates `nodes` mapping, never increments counter. Evidence: `agents-meta.ts:74-77` agentsMetaSchema has revision + nodes; counter envelope is additive.
- **Decision: Only adapt existing 4 doctor checks to new layout in rc.1; defer all 6 lint checks to rc.4** | Rationale: rc.4 lists doctor --lint as new feature with 6 checks (orphan demote / stale archive / id duplicate / layer mismatch / index drift / pending overdue); those use schema fields not yet finalized in rc.1. rc.1 just keeps doctor green on new layout. Evidence: handoff.json implementation_scope[3] for rc.4.

## Dependencies

### Inside rc.1 (this plan)
- TASK-001 (delete) → independent, blocks nothing structural but feeds intent of TASK-008
- TASK-002 (schema) → blocks TASK-003 (counter type), TASK-004 (parser fields), TASK-006 (doctor types), TASK-007 (scan output shape), TASK-008 (init writes)
- TASK-003 (stable_id counter logic) → blocks TASK-007 (scan must allocate ids), TASK-008 (init must initialize counter)
- TASK-004 (parser update) → blocks TASK-005 (MCP services consume parsed nodes)
- TASK-007 (scan command) → blocks TASK-008 (init invokes scan)

### Provides for (rc.2-4)
- rc.2 fab_extract_knowledge consumes pending/ directory structure (created in rc.1 TASK-008)
- rc.2/3 skill install path uses dual-root layout (defined in rc.1 TASK-008)
- rc.3 fab_review modify-action layer flip uses KP-/KT- counter mechanism (built in rc.1 TASK-003)
- rc.4 doctor --lint checks consume layer/maturity/created_at fields (defined in rc.1 TASK-002)
- rc.4 fabric-import skill consumes init-scan baseline as P1 phase (built in rc.1 TASK-007)

## Convergence Criteria Mapping (acceptance_criteria → tasks)

| # | rc.1 acceptance_criterion | Task |
|---|---|---|
| 1 | Old `.fabric/rules/` + `INITIAL_TAXONOMY.md` + `bootstrap/` deleted | TASK-001 |
| 2 | New `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes}/` + `pending/` structure created by `fabric init` | TASK-008 |
| 3 | `~/.fabric/knowledge/` auto-created on first personal write | TASK-005, TASK-008 |
| 4 | Frontmatter schema includes id (KP-/KT- + type code + counter), type (5 enum), maturity (3 enum), layer (2 enum), layer_reason, created_at | TASK-002 |
| 5 | stable_id counter persisted in agents.meta.json; file git mv does NOT regenerate id | TASK-003 |
| 6 | Init-time deterministic scan produces 4-7 baseline entries | TASK-007 |
| 7 | Existing fab_plan_context + fab_get_rule_sections work against new schema | TASK-004, TASK-005 |
| 8 | doctor existing checks adapted to new schema (no false positives on new layout) | TASK-006 |
| 9 | `fabric init` runs clean on empty repo and creates v2.0 layout | TASK-008 |

## Out of Scope (explicit non-goals for rc.1)

- fab_extract_knowledge MCP tool (rc.2)
- fabric-archive skill template (rc.2)
- Stop hook scripts and configs (rc.2)
- fab_review MCP tool (rc.3)
- fabric-review skill template (rc.3)
- doctor --lint with 6 deterministic checks (rc.4)
- fabric-import skill template (rc.4)
- README rewrite, docs/knowledge-types.md, docs/initialization.md, docs/roadmap.md (rc.4)
- New event types like knowledge.proposed / knowledge.promoted / knowledge.layer_changed (rc.2/3 introduce these as needed)
- Any LLM-driven extraction or review logic (rc.2/3/4)

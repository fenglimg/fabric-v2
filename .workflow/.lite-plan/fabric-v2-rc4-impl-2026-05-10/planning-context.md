# Planning Context: Fabric v2.0 rc.4 — Lint + Import + README + Docs + v2.0.0 Release

## Source Evidence

### Bridged from rc.2 + rc.3 (codebase mostly understood)
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/explorations-manifest.json` — 3 angle bridge: integration-points, patterns, testing
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/exploration-integration-points.json` — MCP tool registration + service signature + event-ledger emission contract + install pipeline
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/exploration-patterns.json` (via manifest) — service-pure-function shape, idempotency precedents
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/exploration-testing.json` — vitest 3.2.4, tmpdir helper, json-summary coverage parsing
- `.workflow/.lite-plan/fabric-v2-rc3-impl-2026-05-10/code-review.md` — rc.3 final gate verdict + 5 deferred items list (3 in scope for rc.4, 2 defer to v2.1)
- `.workflow/.lite-plan/fabric-v2-rc3-impl-2026-05-10/plan.json` — rc.3 task DAG + atomic-commit-per-task convention
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/handoff.json` — rc.4 implementation_scope[3] with 12 acceptance criteria + 13th orchestrator-added per-file >=90% coverage gate

### rc.4-specific code anchors
- `packages/server/src/services/doctor.ts:285-305` — additive checks list pattern; rc.3 added check #15 (filesystem-edit fallback synthesizing knowledge_promoted) at commit 0bc92a1; rc.4 adds checks #16-21 (target: 21 total checks; 6 lint-mode-gated)
- `packages/shared/src/schemas/event-ledger.ts:230, 238` — `knowledge_demoted` and `knowledge_archived` event types ALREADY pre-locked in schema (zero shared-schema work for rc.4 lint events; doctor only emits them)
- `packages/cli/src/install/skills-and-hooks.ts` (rc.3 8ad3ac3) — installFabricArchiveSkill / installFabricReviewSkill / addArchiveSkillPointer / addReviewSkillPointer pattern; rc.4 extends with installFabricImportSkill + addImportSkillPointer
- `packages/cli/templates/skills/fabric-archive/SKILL.md` (rc.2 8dfa018) + `packages/cli/templates/skills/fabric-review/SKILL.md` (rc.3 49e8917) — pattern reference for prose structure (frontmatter, mode/flow blocks, decision tree, AskUserQuestion locked to genuine choices)
- `packages/server/src/services/review.ts:923-929` (rc.3) — `quoteIfNeeded` helper missing newline escape; rc.3 deferred Medium item — rc.4 IN SCOPE (cheap fix)
- `packages/server/src/services/review.ts:339-393` (rc.3 approveOne) — orphan-on-partial-failure window between canonical write and pending unlink; rc.3 deferred Low item — rc.4 IN SCOPE (cheap slug-prefix collision check before allocate)
- `README.md` (line ~1-5; current 5-line v2 banner from commit fab90d4 is rc.1 placeholder) — rc.4 fully replaces with v2.0 narrative
- `CHANGELOG.md` (331 lines; partial RC entries) — rc.4 adds entries for rc.1/rc.2/rc.3/rc.4 + final v2.0.0 release notes
- `docs/initialization.md` (466 lines, exists, written for v1.x flow) — rc.4 UPDATES for v2.0 init flow (scan → install skills + hooks)
- `docs/roadmap.md` (50 lines, exists, pre-v2 content) — rc.4 UPDATES with v2.0 + v2.1 + v2.x sections
- `docs/knowledge-types.md` — does NOT exist; rc.4 creates NEW with 5-type semantic definitions, examples, decision criteria
- `scripts/rc2-coverage-gate.mjs`, `scripts/rc3-coverage-gate.mjs` — ALLOWLIST + DIFF_SCOPE pattern; rc.4 copies to `scripts/rc4-coverage-gate.mjs` with new-file allowlist
- `packages/*/package.json` — currently 2.0.0-rc.1; rc.4 final task bumps to 2.0.0 stable (drop -rc suffix)

### Locked decisions
- **6 deterministic + 2 semantic split**: 6 deterministic checks live in doctor (rc.4); 2 semantic checks (LLM-assisted dup detection) live in fabric-review skill (rc.3 already shipped)
- **Decay thresholds**: 90 days (stable) / 30 days (endorsed) / 14 days (draft) for orphan-demote check; 90 days additional inactivity for stale-archive check; 14 days for pending-overdue flag
- **doctor --lint default = report only**; **--apply-lint required for actual mutation + event emission** (audit safety > convenience)
- **fabric-import default layer**: team (project artifacts are team-level; matches handoff)
- **fabric-import 3-phase pipeline**: P1 = init-scan (already lands in rc.1 — Skill REFERENCES the existing init-scan output as Phase 1, does not re-implement); P2 = LLM-driven git log + .md mining → propose pending entries via fab_extract_knowledge; P3 = LLM-driven dedup against canonical via fab_review action: search → reject obvious duplicates, modify-to-merge marginal duplicates
- **`.fabric/.import-state.json` checkpoint**: phase, last_completed_step, processed_commits[], processed_docs[], pending_proposals[]; resume reads file, skips completed steps
- **README**: tagline B' "Fabric — cross-client knowledge for AI agents."; pain-point opening (3-5 sentences); ASCII architecture diagram in first 100 words; Why Fabric section explaining metaphor evolution from AGENTS.md era to knowledge-sustainment era
- **v2.0.0 stable release**: tag local-only (annotated `v2.0.0`); NPM publish deferred per Q5 — user publishes manually
- **rc.3 deferred items disposition**:
  - knowledge_layer_change_started event type → DEFER to v2.1 (event-ledger schema breaking change)
  - Multiline-safe quoteIfNeeded → IN SCOPE rc.4 (cheap helper fix)
  - Orphan-on-partial-failure (slug-prefix collision check) → IN SCOPE rc.4 (cheap pre-allocate guard)
  - pending_path → target_path rename → DEFER to v2.1 (api-contracts breaking change)
  - created_after / date filter for search → IN SCOPE rc.4 (low-effort filter on existing list pipeline; no schema change required if added as optional input field — verify schema permits before commit)

## Understanding

### Current State (post-rc.3 on main)
- doctor.ts has 15 checks (after rc.3 added filesystem-edit fallback at commit 0bc92a1)
- 4 MCP tools registered: fab_plan_context, fab_get_rule_sections, fab_extract_knowledge, fab_review (all 6 actions)
- 2 Skills installed: fabric-archive (rc.2), fabric-review (rc.3); pointers in CLAUDE.md / AGENTS.md / .cursor/rules
- archive-hint.cjs hook handles both archive (write side) + review (pending overflow) signals
- KnowledgeIdAllocator wired into pending→canonical promotion; layer-flip is the only legal stable_id mutation
- Event-ledger schema includes knowledge_demoted + knowledge_archived (pre-locked, ready for rc.4 emission)
- README has 5-line v2 banner (rc.1 placeholder); CHANGELOG has partial RC entries
- 2.0.0-rc.1 tag is the latest; rc.2/rc.3 commits land on main but with rc.3 local annotated tag only (per convergence)
- v1.x .fabric/rules/ already deleted in rc.1 clean rebrand
- 6 doctor lint checks NOT yet implemented; fabric-import skill NOT yet authored; README + 3 docs files NOT yet rewritten
- 5 rc.3 deferred items: 3 IN SCOPE for rc.4, 2 DEFER to v2.1

### Problem (what rc.4 closes)
- **Lifecycle gap**: pending entries can be promoted (rc.3 review loop) but canonical entries with no fetches never decay; stale knowledge accumulates forever; no audit trail for orphan demotion or stale archival; index drift uncatchable; layer-mismatch corruption (KT prefix in personal/) goes undetected.
- **Cold-start gap**: new projects adopting Fabric have no automated path to mine git history + existing docs into pending entries; users must hand-author or rely solely on rc.1 init-scan (which produces only 4-7 baseline structural entries).
- **Positioning gap**: README still has v1.x narrative blended with rc.1 banner; no v2.0 story; no architecture diagram; no metaphor explanation; no roadmap of v2.1+ direction.
- **Documentation gap**: 5-type semantic definitions live only in handoff.json + skill prose; no human-readable reference for users authoring new entries; v1.x initialization.md describes deleted .fabric/rules/ tree.
- **Release gap**: -rc.1 suffix on package versions blocks v2.0.0 stable usage signal; CHANGELOG missing rc.2/rc.3/rc.4 detailed entries.

### Approach (rc.4 closes the loop)

1. **Doctor lint (TASK-001 + TASK-002 + TASK-003)** — 6 deterministic checks split across 2 author tasks (same file, sequential), then a 3rd task wires --apply-lint mutation behavior + event emission:
   - **TASK-001**: lint checks #16-18 (orphan-demote, stale-archive, pending-overdue) — read-side checks; orphan-demote computes maturity-tier-keyed inactivity threshold (90/30/14d); stale-archive scans demoted entries with additional 90d quiet; pending-overdue flags pending >14d (no mutation)
   - **TASK-002**: lint checks #19-21 (stable_id-duplicate, layer-mismatch, index-drift) — integrity checks; stable_id-duplicate aborts on collision (loud error); layer-mismatch detects KT prefix in personal/ tree (or KP in team/) → loud error; index-drift compares agents.meta.json counter to highest existing id and fixes counter to max+1
   - **TASK-003**: --apply-lint flag + actual mutations (orphan demote = lower maturity field via atomicWriteText, stale archive = move file to `.fabric/.archive/<type>/`, index drift = atomicWriteJson updated agents.meta.json) + emit knowledge_demoted / knowledge_archived events; --lint default = report only
2. **fabric-import skill (TASK-004)** — new SKILL.md template at packages/cli/templates/skills/fabric-import/ with:
   - Frontmatter `allowed-tools` mirrors fabric-archive (Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge, mcp__fabric__fab_review)
   - 3-phase pipeline prose: P1 references init-scan output (`.fabric/agents.meta.json` + `.fabric/knowledge/team/`); P2 enumerates `git log --oneline -n 200` + `find docs/ -name "*.md" -maxdepth 3` + extract knowledge proposals; P3 uses `fab_review action: search` to find matching canonical entries → reject obvious dups, modify-to-merge marginal dups
   - `.fabric/.import-state.json` schema + resume logic prose (state shape, atomic-write convention, idempotent-restart contract)
   - Default layer: team (per handoff)
3. **Install wiring (TASK-005)** — extend skills-and-hooks.ts with `installFabricImportSkill` (mirrors `installFabricReviewSkill`) + `addImportSkillPointer` (extends `addArchiveSkillPointer` / `addReviewSkillPointer`); init.ts + hooks.ts call sites updated; integration tests extended
4. **rc.3 deferred fixes (TASK-006)** — cheap-fix batch:
   - Multiline-safe quoteIfNeeded in services/review.ts:923-929 — escape `\n` (and `\r`) by replacing with `\\n` literal escape and emit single-line YAML scalar; add round-trip test
   - Orphan-on-partial-failure hardening — services/review.ts approveOne: BEFORE allocate, scan target canonical dir for files starting with `<slug>--` AND having matching maturity-prefix; if found, call recovery path (re-attach existing canonical, skip allocate, emit knowledge_promote_resumed reason) — if event type not in schema, use knowledge_promoted with reason='[resumed]' prefix per rc.3 convention
   - Date filter for search — extend services/review.ts list/search action with optional `created_after?: string` filter (ISO date); requires verifying api-contracts.ts FabReviewSearchInput schema accepts the field; if schema rejects, the field is added at runtime via .passthrough() OR added explicitly with .optional() (verify with read of api-contracts.ts at TASK-006 start; if schema unlock required → DEFER and document in test plan)
5. **README rewrite (TASK-007)** — full replacement of current 120-line README:
   - L1 tagline: `# Fabric — cross-client knowledge for AI agents.`
   - L3-7 pain-point opening (3-5 sentences: AGENTS.md era → fragile rule walls → "I told you that 3 sessions ago" frustration → Fabric's knowledge sustainment answer)
   - L9-30 ASCII architecture diagram (clients CC/Cursor/Codex → MCP server → .fabric tree with knowledge/{decisions,pitfalls,guidelines,models,processes}/{team,personal}/ + pending/ + .archive/ + agents.meta.json + events.jsonl)
   - L32-50 Why Fabric (metaphor evolution: rule-binder era → AGENTS.md era → knowledge-sustainment era; what Fabric does differently)
   - L52-58 Quick start: single command `pnpm dlx @fenglimg/fabric-cli init`
   - L60-75 What you get section (4 MCP tools + 3 Skills + Stop hooks + dual-root layout + lifecycle/lint)
   - L77-90 Links to docs/knowledge-types.md, docs/initialization.md, docs/roadmap.md, CHANGELOG.md
   - L92-end Status badge + license + repo link
6. **Documentation files (TASK-008)** — 4 file batch:
   - docs/knowledge-types.md (NEW; ~150 lines): 5-type semantic definitions (decisions/pitfalls/guidelines/models/processes); per-type examples; decision criteria (when to use which type); maturity tiers (draft/endorsed/stable); layer classification (team/personal)
   - docs/initialization.md (UPDATE; replaces v1.x flow): v2.0 init flow narrative (scan → install skills + hooks); reference fabric init command + sub-steps; link to knowledge-types.md
   - docs/roadmap.md (UPDATE; current 50 lines pre-v2): v2.0 (released) section with all 4 RC milestone summary; v2.1 (team-knowledge.git + 3-role permissions) section; v2.x (semantic search, federated teams) section
   - CHANGELOG.md (UPDATE; ~150 LOC additions): rc.1 detailed entry (clean rebrand foundation), rc.2 (archive loop), rc.3 (review loop + path-traversal fix), rc.4 (lint + import + README + docs), v2.0.0 final release notes (stable signal, what changed since v1.x, how to upgrade)
7. **Dogfood (TASK-009)** — self-repo execution:
   - Run `node scripts/dogfood-rc4-doctor.mjs` (NEW; mirrors rc2/rc3 dogfood scripts) — invokes doctor --lint then doctor --apply-lint on .fabric/ tree; produces orphan-demote / stale-archive / pending-overdue / index-drift findings; --apply-lint emits knowledge_demoted + knowledge_archived events
   - Capture evidence in `.workflow/.lite-plan/fabric-v2-rc4-impl-2026-05-10/dogfood-evidence.md`: events.jsonl tail showing demoted+archived events, doctor --lint report, before/after agents.meta.json counter
   - Verify fabric-import installs cleanly via re-running `fabric init --reinstall-skills` in a tmpdir copy
8. **Final gate + v2.0.0 release (TASK-010)** — batched at end (per user MEMORY.md):
   - Pipe full rc.4 diff (HEAD~9..HEAD) + key sources to Gemini via `cat /tmp/rc4-review-prompt.md | gemini --model gemini-2.5-pro`
   - Run `node scripts/rc4-coverage-gate.mjs` with ALLOWLIST scoped to NEW source files only (services/doctor.ts new lint checks #16-21 region; helpers in review.ts modified by TASK-006)
   - Address Critical issues; document Medium/Low dispositions
   - Bump packages/*/package.json versions: @fenglimg/fabric-cli 2.0.0-rc.1 → 2.0.0; @fenglimg/fabric-server 2.0.0-rc.1 → 2.0.0; @fenglimg/fabric-shared 2.0.0-rc.1 → 2.0.0; @fenglimg/fabric-web (if applicable) 2.0.0-rc.1 → 2.0.0
   - Run pnpm scripts/sync-versions.mjs (if used in repo); pnpm install to update lockfile
   - Final CHANGELOG entry (v2.0.0 release section with date)
   - `git tag -a v2.0.0 -m "..."` (annotated, local-only — no push per convergence)

## Key Decisions

| Decision | Rationale | Evidence |
|---|---|---|
| TASK-001 + TASK-002 + TASK-003 split (lint authoring split across same file) | doctor.ts already 1593 LOC; landing 6 checks in one PR is unreviewable; mutation behavior (TASK-003) needs both checks groups present | doctor.ts wc -l 1593; rc.3 plan precedent of staging within service file |
| Single fabric-import SKILL.md (not split into multiple skills) | Phase boundaries are pipeline-internal; pipeline must be atomic; matches fabric-archive/review template | skill template pattern; handoff Q4 |
| --lint = report only by default; --apply-lint required for mutations | Audit safety > convenience; matches doctor --fix vs doctor convention; explicitly in handoff acceptance | handoff acceptance #3; user clarification (none — auto mode); CCW Instructions |
| Decay thresholds 90/30/14 days hardcoded (NOT configurable in rc.4) | Single-repo low-frequency use justified per article 1/4 ratio; configurability adds complexity without v2.0 user evidence | handoff rationale; decision_context |
| `.fabric/.archive/<type>/` for stale archive (NOT delete) | Audit history preservation; matches rc.3 reject-keeps-file convention; future doctor can prune | rc.3 reject behavior; handoff Q-archive |
| 3 rc.3 deferred items IN SCOPE for rc.4; 2 DEFER to v2.1 | Cheap fixes land alongside rc.4; schema-breaking changes wait for major | rc.3 code-review.md disposition |
| date filter for search verified at TASK-006 start (schema permits → IN SCOPE; otherwise DEFER) | Schema unlock vs runtime extension is the deciding factor | rc.3 Medium 5 disposition |
| README rewrite is rc.4 (not rc.1) | rc.1 fab90d4 5-line banner was acknowledged placeholder; full v2.0 narrative needs all 4 RC features to describe truthfully | handoff decision_context; commit fab90d4 |
| Tag v2.0.0 local-only (no push, no NPM publish) | Per Q5 decision; user publishes manually if desired; avoids accidental release | handoff decision_context; user clarification (none — auto mode = follow Q5) |
| Batched Gemini review at end (TASK-010), not per-task | User MEMORY.md feedback_review_batching.md preference for multi-task lite-plan chains | user MEMORY |
| Per-file >=90% coverage gate scoped to NEW rc.4 source code only | Avoid re-gating rc.1/rc.2/rc.3 already-passed code; doctor.ts new lint check region computed via diff scope | rc2/rc3-coverage-gate.mjs ALLOWLIST pattern |

## Dependencies

- **Depends on**: rc.3 deliverables on main — fab_review tool, fabric-review Skill, archive-hint.cjs second signal, doctor filesystem-edit fallback, install pipeline foundation; all confirmed present in working tree
- **Provides for**: v2.1 (team-knowledge.git + 3-role permissions, semantic search) and v2.x (federated teams) — roadmap.md documents this

## Out of Scope (DEFER to v2.1 or later)

- knowledge_layer_change_started event type (event-ledger schema unlock — breaking)
- pending_path → target_path rename (api-contracts schema unlock — breaking)
- 2 semantic lint checks (LLM-assisted dup/contradiction — already shipped in rc.3 fabric-review skill, not duplicated in doctor)
- NPM publish (user-driven post-release)
- team-knowledge.git remote sync (v2.1)
- 3-role permission model (v2.1)
- Semantic search (v2.x)
- Federated teams (v2.x)
- doctor --apply-lint configurability of decay thresholds (v2.x if user demand)
- doctor --apply-lint dry-run mode (already covered by --lint without --apply-lint)

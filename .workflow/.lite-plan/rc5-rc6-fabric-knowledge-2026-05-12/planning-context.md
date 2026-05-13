# Planning Context: Fabric v2.0.0 rc.5 + rc.6

## Source Evidence

### Structured Handoff (Primary)
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/rc5-rc6-handoff.json` — Authoritative `implementation_scope[]` array with two release-level items (rc.5 + rc.6), each carrying target_files[], acceptance_criteria[], code_anchors[], key_findings[], decision_context[]
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/rc5-rc6-scope.md` — Human-readable item-level breakdown (A1-A4, B1-B4, C1-C7, D1-D2 for rc.5; E1-E6 for rc.6), Section 8 wave ordering, Section 4 boundary rules, Section 5 event-ledger types, Section 7 Q&A resolutions

### Codebase Exploration
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/exploration-codebase.json` — Module map covering MCP server entry, tools, schemas, services, CLI commands, dashboard package, doctor lint inventory

### Critical Code Anchors (from rc5-rc6-handoff.json#code_anchors)
- `packages/server/src/services/plan-context.ts:47,109,229,244-245,298,383-392` — L0/L1/L2 dead branches; A1+A3 removal target
- `packages/server/src/services/plan-context.ts:338-360` — Cocos hardcoding (inferDomains/tokenizeIntent/inferImpactHints); A3 removal target
- `packages/server/src/services/plan-context.ts:226-254` — buildDescriptionIndex; C3 relevance_paths filter site
- `packages/server/src/services/rule-meta-builder.ts:309,640-645` — KNOWLEDGE_SUBDIRS literal + computeRevision; C7 pending exclusion site
- `packages/server/src/services/extract-knowledge.ts:18` — PENDING_BASE constant; B1 dual-root pivot site
- `packages/server/src/index.ts:106-107,112` — MCP tool registration + server name; A1 rename site
- `packages/server/src/services/doctor.ts:285-305` — Lint checks #1-#21 additive list; rc.5 #22-#25 + rc.6 #26 extension site
- `packages/cli/templates/hooks/archive-hint.cjs:1-20` — Existing thresholds; B3+C6 rework site
- `packages/cli/templates/hooks/configs/cursor-hooks.json` — empty/missing; B4 fill site
- `packages/cli/templates/skills/fabric-archive/SKILL.md` — current 3-phase; C2 Phase 0.5 + Phase 1.5 insertion site
- `packages/server/src/services/review.ts:74-106` — reviewKnowledge dispatcher over 6 actions; C3 modify extension site

## Understanding

### Current State (post-v2.0 commit f351ffb/9356cd3, locally tagged not published)
- v2.0 pivot landed knowledge-sustainment protocol (5 types × 3 maturity × 2 layers) but left v1.x wire residue: L0/L1/L2 protocol, intent-ledger compliance, dashboard package, root /templates, Cocos hardcoding, selection_policy dead fields
- Functional boundaries fuzzy: single pending root, stale-pending ownership overlap (hook B / lint #21 / review reject), hook naming `archive-hint.cjs`, no onboarding underseed signal, empty Codex/Cursor hook configs
- Article-vs-Fabric differentiation gaps: no knowledge consumption tracking (article's `last_referenced` loop), no active injection layer (article's workflow-phase injection equivalent), README narrative doesn't surface 8 真特色

### Proposed Approach
- **rc.5 (17 items)**: Cleanup + narrow schema + consumption tracking — 4 sub-categories (A1-A4 v1.x residue removal, B1-B4 boundary fixes, C1-C7 narrow schema + consumption, D1-D2 CLI/docs); shipped as v2.0.0-rc.5 with `scripts/rc5-coverage-gate.mjs` gate
- **rc.6 (6 items)**: Active injection layer (E1 SessionStart broad hook, E2 PreToolUse narrow hook, E3 session-hints cache, E4 edit-counter sidecar, E5 Signal A 24h-OR-20-edits upgrade, E6 lint #26 + silence telemetry); shipped as v2.0.0-rc.6 with `scripts/rc6-coverage-gate.mjs` gate
- **Wave ordering** (Section 8): rc.5 Wave 1 (foundations, parallel) → Wave 2 (wire + schema, sequential rename) → Wave 3 (boundaries + lifecycle) → Wave 4 (docs + gate); rc.6 sequential E1 → E2+E4 → E3 → E5 → E6 → gate

## Key Decisions

| Decision | Rationale | Evidence |
|---|---|---|
| Continue v2.0.0 RC chain (rc.5..N → v2.0.0) | v2.0.0 commit tagged locally but never published; clean-slate preference (memory) makes rc.5 cheaper than v2.0.1 patch line | scope.md §1; user memory `project_v2_rc_continuation.md` |
| Retire L0/L1/L2 protocol entirely | All 16 nodes are L1 in v2.0 data; required/selectable booleans static; selection_policy dead | scope.md §7 Q1; exploration-codebase.json#metadata.critical_falsifications |
| Delete intent-ledger compliance regime | 31/31 audit.jsonl entries have matched_get_rules_ts=null (zero adoption) | scope.md §2.A2; handoff.json#decision_context |
| Dual pending root by layer | personal→`~/.fabric/`, team→repo `.fabric/`; mirrors layer storage discipline | scope.md §7 Q5 |
| Single signal source (edit_paths only) for relevance_paths | rc.5 simplicity; multi-signal (read_paths + body regex + symbols) deferred to rc.7 if recall insufficient | scope.md §7 Q13; handoff.json#decision_context |
| Default broad in archive Skill Phase 1.5 | Safe偏置; narrow requires explicit single-module evidence | scope.md §7 Q14 |
| narrow team → personal flip auto-degrades to broad | Personal knowledge crosses projects; paths don't generalize | scope.md §7 Q15 |
| rc.5 Signal A = 24h time-only | Drop plan_context count (auto-fire makes count unreliable); Edit count requires PreToolUse sidecar deferred to rc.6 | scope.md §7 Q11; handoff.json#decision_context |
| revision_hash excludes pending | Required for rc.6 PreToolUse cache invalidation correctness (pending adds shouldn't thrash cache) | scope.md §7 Q17; rc5-rc6-handoff.json#code_anchors |
| PreToolUse silent on zero narrow match | Hook silence is feature not bug; >95% silence rate over 30d triggers fabric-import recommendation | scope.md §7 Q12; handoff.json#decision_context |
| CLI plan-context-hint emits versioned JSON to stdout | Decoupled evolution from hook renderer (hook→stderr) | scope.md §7 Q16 |
| fabric-import writes broad + [] for all imports | LLM-driven (not session-driven), cannot generate accurate paths from git history | scope.md §7 Q20 |

## Wave Structure

### rc.5 Wave 1 (parallel, no behavior change visible to Agent)
- TASK-001 (A2): Intent-ledger compliance regime removal
- TASK-002 (A4): Physical residue deletion (dashboard, templates/, 思路.md, werewolf-stub)
- TASK-003 (C7): computeRevision excludes pending
- TASK-004 (D1): fabric plan-context-hint CLI subcommand

### rc.5 Wave 2 (blocked by Wave 1; mostly sequential due to file renames)
- TASK-005 (A1): Full tool/file/server rename pass — rule-* → knowledge-*
- TASK-006 (C1): Frontmatter schema additions — relevance_scope + relevance_paths
- TASK-007 (A3): plan-context refactor — strip Cocos + ≤30 degenerate mode

### rc.5 Wave 3 (blocked by Wave 2)
- TASK-008 (B1): Dual pending root
- TASK-009 (B2): Pending auto-archive >30d
- TASK-010 (B3+B4): fabric-hint rename + Signal C + hook configs cross-client
- TASK-011 (C2): archive Skill Phase 0.5 viability gate + Phase 1.5 scope decision + edit_paths generation
- TASK-012 (C3): plan_context filter + review.modify canonical + layer-flip auto-degrade
- TASK-013 (C4): Lint #23 + #24 + #25
- TASK-014 (C5): Consumption tracking + knowledge_consumed event + orphan_demote pivot
- TASK-015 (C6): fabric-hint Signal A 24h-only
- TASK-016 (fabric-import broad default): Skill update for broad + []

### rc.5 Wave 4 (blocked by all of Wave 3)
- TASK-017 (D2): README 8 真特色 rewrite
- TASK-018 (Coverage gate): scripts/rc5-coverage-gate.mjs + dogfood test

### rc.6 (blocked by ALL rc.5 tasks)
- TASK-019 (E1): SessionStart knowledge-hint-broad.cjs
- TASK-020 (E2+E4): PreToolUse knowledge-hint-narrow.cjs + edit-counter sidecar
- TASK-021 (E3): Session-hints cache
- TASK-022 (E5): fabric-hint Signal A 24h-OR-20-edits upgrade
- TASK-023 (E6): Lint #26 narrow_too_few + hint-silence-counter telemetry
- TASK-024 (rc.6 coverage gate): scripts/rc6-coverage-gate.mjs + dogfood

## Dependencies
- Depends on: v2.0.0 commit f351ffb/9356cd3 (locally tagged, never published)
- Provides for: v2.0.0 stable release (post rc.6 stabilization), rc.7 follow-ups (symbol binding, body_referenced_paths, LLM monthly refresh)

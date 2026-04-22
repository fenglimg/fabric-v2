# Planning Context: fab init Shadow Mirroring Refactor

## Source Evidence

- `.workflow/.analysis/ANL-fab-init-heuristic-discovery-2026-04-19/conclusions.json` — Round 3 Delta user committed to pure Shadow Mirroring: abandon colocated AGENTS.md and .claude/rules/; all semantic docs in .fabric/agents/ 1:1 mirror + _cross/ subtree
- `.workflow/.analysis/ANL-fab-init-heuristic-discovery-2026-04-19/conclusions.json:round3_delta` — reversed R2 hybrid topology; CQ1-CQ4 all chose pure Zero-Pollution direction; MCP-only dispatch
- `packages/shared/src/schemas/forensic-report.ts:47` — `recommendations_for_skill: string[]` is the primary upgrade target → ForensicAssertion[]
- `packages/cli/src/scanner/forensic.ts:294-323` — `buildSkillRecommendations()` generates natural-language strings; must be replaced by `buildAssertions()` + `buildCandidateFiles()`
- `packages/cli/src/scanner/forensic.ts:249-267` — `inferPatternHint()` returns a single string; must be upgraded to structured confidence/evidence output
- `packages/shared/src/schemas/agents-meta.ts:3-9` — `agentsMetaNodeSchema` missing `layer` and `topology_type`; topology_type must become `mirror|cross-cutting` per R3 (not `colocated|rules-frontmatter` per R2)
- `packages/cli/src/commands/sync-meta.ts:113-141` — `findAgentsFiles()` scans for `AGENTS.md` everywhere; must be refactored to scan only `.fabric/agents/**/*.md`
- `templates/claude-skills/agents-md-init/SKILL.md:16-92` — current 3-Phase passive interview; full rewrite to Phase 0 active recon + Phase 1 single-round Architecture Review + Phase 2 auto-construct writing to `.fabric/agents/` only
- `templates/claude-skills/agents-md-init/SKILL.md:90` — `NEVER infer unconfirmed invariants` conflicts with Matcha implicit-accept; must split DISPLAY/WRITE rules
- `templates/bootstrap/CLAUDE.md:7` — current rule: `Before editing any file`; upgrade scope to `Before any code reading, architecture planning, or logic modification`
- `packages/server/src/tools/get-rules.ts:28-29` — fab_get_rules already registered as MANDATORY; Shadow Mirroring deepens this, not paradigm shift
- `packages/server/src/services/get-rules.ts:38` — minimatch decouples physical location from scope_glob; Shadow Mirroring has near-zero tech cost
- `examples/werewolf-minigame-stub/AGENTS.md:1-60` — current AGENTS.md has Scope Map/Hard Rules/Semantic Roster embedded; must simplify to Bootstrap Protocol + migrate semantic content to `.fabric/agents/`
- `packages/shared/src/schemas/init-context.ts:9-18` — `InitContextInvariant` missing `confidence_snapshot`; `InitContextDomainGroup` missing `topology_type`

## Understanding

- **Current State**: fab init uses a 3-Phase passive interview SKILL that asks 5-7 questions before writing AGENTS.md files colocated in business directories (src/, packages/). sync-meta scans all AGENTS.md files. bootstrap templates only mandate fab_get_rules before file edits.
- **Problem**: (1) SKILL cannot distinguish HIGH/MEDIUM/LOW confidence to make implicit-accept decisions — ForensicAssertion[] is the missing data contract. (2) Shadow Mirroring requires business dirs have ZERO rule files — SKILL must write only to `.fabric/agents/`. (3) Bootstrap templates allow code reading/planning without first calling fab_get_rules, creating a "perception-phase vacuum". (4) sync-meta scans wrong locations after Shadow Mirroring topology change.
- **Approach**: Data-contract-first (Rec#1 schema upgrade enables all downstream), then SKILL behavior (Rec#2 rewrites Phase 0/1/2), then infrastructure (Rec#3 agents-meta + sync-meta refactor), then protocol hardening (Rec#7 bootstrap + Rec#8 root AGENTS.md), then supporting layers (Rec#4 init-context schema, Rec#5 fixture tests, Rec#6 docs, optional Rec#9/#10).

## Key Decisions

- Decision: Shadow Mirroring pure topology (.fabric/agents/ only, zero colocated) | Rationale: User R3 explicit commitment; CQ2 abandons non-MCP fallback completely | Evidence: conclusions.json:round3_delta.verdict
- Decision: topology_type values = `mirror|cross-cutting` (not `colocated|rules-frontmatter`) | Rationale: R2 hybrid approach reversed in R3; pure Shadow Mirroring has no colocated type | Evidence: conclusions.json:round3_delta.new_technical_solutions[2]
- Decision: Bootstrap hard rule upgrade scope: `Before any code reading, architecture planning, or logic modification` | Rationale: Perception-phase vacuum addressed via protocol not bridge artifacts (CQ4) | Evidence: conclusions.json:round3_delta.decisions[0]
- Decision: SKILL writes ONLY to `.fabric/agents/` mirror tree, does NOT generate colocated AGENTS.md, does NOT write `.claude/rules/`, does NOT write @import | Rationale: Pure Zero-Pollution (R3-CQ2/CQ4); DISPLAY/WRITE split resolves conflict with Matcha implicit accept | Evidence: handoff-spec Rec#2 acceptance criteria
- Decision: Confidence formula: HIGH = ratio≥0.8 + co_occurring≥2 OR AST-level (e.g. @ccclass); MEDIUM = 0.5-0.8 OR single pattern; LOW = <0.5 OR conflict | Rationale: Quantified thresholds prevent "file exists ≠ pattern obeyed" false positives; enables HIGH implicit accept | Evidence: conclusions.json:key_conclusions[2]
- Decision: ForensicAssertion[] replaces recommendations_for_skill: string[] (deprecated for one version) | Rationale: SKILL cannot make Matcha batch Check without structured confidence + evidence anchors | Evidence: conclusions.json:recommendations[0]
- Decision: candidate_files total ≤ 12; sampling_budget = {max_files: 15, max_lines_per_file: 100} | Rationale: Token budget must be predictable and testable; CLI prepackaging pushes inference cost to CLI where it is cheap | Evidence: conclusions.json:decision_trail Q2/Q6
- Decision: Rec#9 (fab_plan_context) and Rec#10 (compliance telemetry) marked optional | Rationale: Independent of core Shadow Mirroring refactor; user may skip to ship faster | Evidence: handoff-spec Task Grouping Rules #5

## Dependencies

- TASK-001 (ForensicReport schema + forensic.ts) is foundational — all downstream tasks depend on ForensicAssertion type being defined
- TASK-002 (SKILL.md rewrite) soft-depends on TASK-001 — SKILL must consume ForensicAssertion[]; can be written in parallel but tested after TASK-001
- TASK-003 (agents-meta + sync-meta) is independently refactorable but must agree on topology_type values from R3
- TASK-004 (init-context schema) is light and orthogonal; can pair with TASK-001 in same PR cadence
- TASK-005 (bootstrap upgrade) is independent of schema work; pure text/template change
- TASK-006 (root AGENTS.md + werewolf fixture) loosely depends on TASK-005 for terminology consistency
- TASK-007 (e2e fixture tests) depends on TASK-001 + TASK-002 + TASK-003; must come after core schema work
- TASK-008 (docs) can start early and update iteratively; final version after TASK-002 stabilizes
- TASK-009 (fab_plan_context MCP tool) — optional, independent
- TASK-010 (compliance telemetry) — optional, depends on TASK-009 conceptually

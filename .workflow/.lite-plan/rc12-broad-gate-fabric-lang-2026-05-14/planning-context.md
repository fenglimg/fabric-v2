# Planning Context: rc.12 broad-gate-fabric-lang refactor

## Source Evidence

- `exploration-dependencies.json` — 64-file dependency map; 3 biggest ripple findings (gate removal ~17+ tests, knowledge_language ~50 files / ~115-135 textual replacements with three-mirror invariant, fab init → fab install ~30+ i18n keys + 8 action_hint strings + 2 snapshots)
- `packages/cli/templates/hooks/knowledge-hint-broad.cjs:86-138,534-571,587-607` — gate epicenter: SESSIONSTART_HASH_CACHE_FILE const, readSessionStartLastHash/writeSessionStartLastHash helpers, bodySuppressed branch, module.exports test seam
- `packages/cli/__tests__/knowledge-hint-broad.test.ts:46-77,381-544,908-984` — three dedicated gate describe blocks (17+ tests) + HookModule type signature; ALL must delete in sync with hook source
- `packages/shared/src/schemas/fabric-config.ts:27,45` — Zod source of truth for knowledge_language; per user clarification, hard rename, no z.preprocess alias
- `packages/cli/src/commands/init.ts:234-236,402,409,472` — file targeted for rename to install.ts; initCommand symbol + name:'init' + knowledge_language write site
- `packages/cli/src/commands/index.ts:2` — allCommands.init dispatch — citty-unknown-command on legacy invocation per user hard-cut decision
- `packages/cli/src/install/skills-and-hooks.ts:170-190,440-502` — three POINTER_LINE constants + POINTER_TARGETS array + addArchiveSkillPointer function (to be replaced with marker-delimited section writer)
- `packages/cli/src/install/uninstall-skills-and-hooks.ts:12-15,253-305` — symmetric inverse stripArchiveSkillPointers; section-delimited strip replacement
- `packages/cli/templates/skills/{fabric-archive,fabric-review,fabric-import}/SKILL.md` + `.claude/skills/<same>/SKILL.md` + `.codex/skills/<same>/SKILL.md` — nine-file three-mirror byte-identity invariant (per `.fabric/knowledge/pending/pitfalls/skill-template-mirror-drift.md`)
- `docs/cross-client-visibility.md:47-55,84-85,122-128` — three blocks advertising T8 gate as a feature; must rewrite
- `packages/cli/__tests__/__snapshots__/cli-surface.test.ts.snap:78-194+` and `i18n.test.ts.snap:5,63` — snapshot regeneration required after rename

## Understanding

- **Current State**: rc.11 ships a SessionStart revision_hash gate (cooldown-sidecar suppresses re-emission of broad menu on unchanged knowledge graph), uses `knowledge_language` as the Zod-validated config field, and registers `fab init` as the primary install command. POINTER_LINE constants append three skill-pointer lines to CLAUDE.md/AGENTS.md/.cursor/rules during install.
- **Problem**: The gate degrades discoverability (compact/clear re-fires SessionStart but the gate suppresses the menu — banner-blindness mitigation actually defeats progressive disclosure). The `knowledge_language` field name doesn't match the broader product brand. `fab init` conflicts with developer expectations that `init` is for scaffolding new projects rather than installing into existing ones. POINTER_LINE substring matching is fragile and pollutes target files with three top-level lines instead of one managed section.
- **Approach**: Six-task structural refactor split by file-locality and dependency order. Schema rename (TASK-003) is the foundation that TASK-004/005/006 depend on; command rename (TASK-002) is required by TASK-006. Gate removal (TASK-001) is fully independent. Per user's batch-review preference (memory: feedback_review_batching), ONE Gemini review + coverage runs after all six tasks complete, NOT per-task.

## Key Decisions

- **Decision**: Hard rename `knowledge_language → fabric_language` with no z.preprocess alias | Rationale: zero users (project_v2_rc_continuation), clean-slate preference (feedback_clean_slate) | Evidence: user clarification + memory:feedback_clean_slate
- **Decision**: Hard cut `fab init → fab install` (citty unknown-command on legacy invocation) | Rationale: user explicitly confirmed in grilling | Evidence: User Clarifications section (#1)
- **Decision**: Add `zh-CN-hybrid` enum value (Chinese narration + English protected technical tokens) | Rationale: matches actual UX expectations in CJK-detected projects; existing strict no-mix rule blocks technical accuracy | Evidence: spec proposal in task description
- **Decision**: HTML-comment-wrapped markdown section `<!-- fabric:knowledge-base:begin --> ## Fabric Knowledge Base <!-- fabric:knowledge-base:end -->` | Rationale: idempotent replace, invisible-in-rendered-MD delimiter, follows shields.io/standard managed-section pattern | Evidence: user clarification (#2) + exploration clarification_needs[#3].recommended
- **Decision**: Three-mirror lockstep edits — packages/cli/templates/skills/<name>/SKILL.md + .claude/skills/<name>/SKILL.md + .codex/skills/<name>/SKILL.md all in TASK-004 single transaction | Rationale: byte-identity invariant from `.fabric/knowledge/pending/pitfalls/skill-template-mirror-drift.md`; drift breaks Skill loading on Codex client | Evidence: exploration patterns + pitfall doc
- **Decision**: Orphaned `.fabric/.cache/sessionstart-last-hash` sidecar is left as-is; only a comment is added in the hook explaining the orphan history | Rationale: clean-slate (zero users) means no migration tooling burden; harmless dead state | Evidence: user clarification (#4)
- **Decision**: Batch review at end (single Gemini review + coverage) rather than per-task | Rationale: memory:feedback_review_batching explicitly preferred for multi-task lite-plan chains | Evidence: memory directive

## Dependencies

- **TASK-001 (gate removal)**: depends on []  — fully self-contained in knowledge-hint-broad.cjs + its test file + cross-client-visibility.md
- **TASK-002 (fab init → install)**: depends on [] — file/symbol/snapshot rename, independent of schema
- **TASK-003 (schema rename + new enum)**: depends on [] — foundational schema change
- **TASK-004 (three Skill template docs × three-mirror)**: depends on [TASK-003] — Skill prompts reference the new fabric_language key + new zh-CN-hybrid enum
- **TASK-005 (scan.ts CJK detection)**: depends on [TASK-003] — detectExistingLanguage returns the new enum value
- **TASK-006 (install-end UX + Fabric Knowledge Base section + uninstall symmetric strip)**: depends on [TASK-002, TASK-003] — install-end message lives in renamed install.ts; references fabric_language key

- **Provides for**: rc.12 release candidate with cleaner SessionStart UX (unconditional menu), brand-consistent fabric_language config field, intuitive `fab install` command name, and managed-section pointer writes that survive user edits to the surrounding doc.

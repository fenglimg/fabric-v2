# Planning Context: Fabric Three-Skill Contract Fix + Optimization

## Source Evidence

### From exploration-integration-points.json
- `packages/shared/src/schemas/api-contracts.ts:397-453` — `_FabExtractKnowledgeInputBaseSchema` is the modify-target; lacks `relevance_scope`/`relevance_paths` (review's modify schema at L518-L533 has them — pattern to mirror)
- `packages/server/src/services/extract-knowledge.ts:78-84` — sha256 idempotency formula `{source_session, type, slug}` is LOAD-BEARING; relevance fields MUST NOT enter the hash (preserves rc.5→rc.7 collision detection)
- `packages/server/src/services/extract-knowledge.ts:217-263` — `renderFreshEntry` YAML frontmatter assembly; relevance lines must follow scan.ts L1042-L1060 flow-style emit pattern
- `packages/server/src/services/review.ts:725-739` — canonical `knowledge_scope_degraded` emit shape: `event_type='knowledge_scope_degraded', from_scope='narrow', to_scope='broad', reason='personal-implies-broad'` — extract-knowledge must produce wire-identical events
- `packages/shared/src/schemas/event-ledger.ts:288-296` — `knowledgeScopeDegradedEventSchema` already exists; `stable_id` is `z.string()` — pending entries have no id (Q2 late-bind), so use `pending:<idempotency_key>` sentinel
- `packages/server/src/services/knowledge-meta-builder.ts:1007-1021` — already defaults missing relevance_scope to 'broad'/paths to []; migration is hygiene NOT correctness
- `packages/cli/templates/skills/fabric-archive/SKILL.md` — uses `scope:` in MCP call but contract field is `relevance_scope:` (rename required across three mirrors)
- `packages/cli/src/commands/scan.ts:586-644` — `detectExistingLanguage` CJK ratio probe (README + docs/*.md, ratio>0.3 → zh-CN); reusable for init-time language fixation
- `packages/cli/src/commands/init.ts:392-470` — `writeDefaultFabricConfig` early-returns if file exists; idempotent; modify-target for language fixation + 10 new tunables in defaults dict
- `packages/shared/src/schemas/fabric-config.ts:35-101` — base config schema; current 14 fields all optional+default+rc-version comment; pattern to extend; NOT `.strict()` (lenient per decision #7)

### From exploration-dependencies.json
- `packages/cli/src/install/skills-and-hooks.ts:76-89` — `SKILL_DESTINATIONS` is the ONLY three-mirror sync mechanism (template → .claude + .codex, no .cursor); no prebuild script exists
- `packages/cli/__tests__/integration/install-skills-and-hooks.test.ts` — three-mirror parity test (bytecode-equal assertion)
- `packages/server/__tests__/__snapshots__/tool-contracts.test.ts.snap` — golden snapshot will drift on schema extension; `pnpm test -u` required
- `packages/server/src/services/doctor.ts:627-628` — `RELEVANCE_SCOPE_LINE_PATTERN`/`RELEVANCE_PATHS_LINE_PATTERN` regexes define the wire YAML format; new lint #26 + `--apply-lint` mutation arm goes here
- `packages/cli/src/commands/uninstall.ts:1-90` — pattern reference for new doctor lint mutation (defineCommand + plan/yes/atomic-write skeleton)
- `packages/shared/src/i18n/protected-tokens.ts` — protected token registry; SKILL.md edits must preserve fab_extract_knowledge / fab_review / MUST / NEVER / .fabric/knowledge/ verbatim
- `packages/server/src/services/extract-knowledge.ts:414-424` + `review.ts:1127-1136` — duplicated `emitEventBestEffort` helper (best-effort try/catch around appendEventLedgerEvent); reuse local copy, don't hoist (out of scope)

## Understanding

### Current State
- fab_extract_knowledge MCP input **rejects** `relevance_scope`/`relevance_paths` (zod silently drops); both fabric-import and fabric-archive SKILL.md already write them in their MCP calls but the service never persists them
- Pending entries lack stable_id (Q2 late-bind); existing canonical entries default to broad+[] via knowledge-meta-builder fallback
- fabric-archive SKILL.md uses `scope:` (wrong) instead of `relevance_scope:` — bug
- fabric-config.ts has 14 tunables; multiple skill hardcodes (`--since="2 months ago"`, `-n 200`, `cap 10/50`) bypass user config
- Three mirrors (template → .claude → .codex) currently DESYNCED for multiple SKILL.md files
- knowledge_language is `'match-existing'` literal; never fixated at init
- Five i18n classes (roll-up template, error warnings, confirm prompts, dry-run headers, AskUserQuestion) are English-only

### Problem
- Schema gap = Skill writes data the service silently drops → doctor lint #23 false-positives on entries users believed were correctly scoped
- Hardcoded pagination + thresholds = no user customization knob
- Three-mirror desync = user-facing skill behavior diverges from in-repo template after `fab init`

### Approach
- **Phase A (TASK-001 to TASK-003)**: Schema + service contract extension + doctor lint #26 hygiene migration; preserves rc.5→rc.7 idempotency by keeping new fields OUT of sha256 hash
- **Phase B (TASK-004, TASK-005)**: Config schema +10 tunables + skill MCP.md "Config Load" Phase 0.5 chapter; delete hardcoded numbers
- **Phase C (TASK-006, TASK-007)**: Init-time CJK probe to fixate knowledge_language + 5-class bilingual rendering per knowledge_language
- **Phase D (TASK-008)**: Protected tokens + idempotency note sync across three mirrors
- **Phase E (TASK-009, TASK-010)**: fabric-review "Narrowing Imported Entries" chapter (detects `fabric-import-` prefixed source_sessions) + fabric-import proposed_reason inference upgrade
- **Phase F (TASK-011)**: state file atomic write (.tmp → mv) + events.jsonl single-line<4KB constraint comments + corruption-recovery chapter

## Key Decisions

| Decision | Rationale | Evidence |
|---------|-----------|----------|
| `pending:<idempotency_key>` sentinel for stable_id | Pending entries have no id (Q2 late-bind); review.ts uses newStableId post-promotion | event-ledger.ts:288-296 |
| Doctor lint #26 + --apply-lint (not standalone script) | Reuses tested mutation machinery; emits lint events | exploration-deps clarification rec #1 |
| Migration scope: pending entries ONLY | Canonical entries get scope via review.modify naturally; meta-builder fallback covers correctness | knowledge-meta-builder.ts:1007-1021 |
| Caller-undefined → don't write YAML line | Matches doctor default-broad fallback; cleaner diffs | exploration-deps clarification rec #2 |
| Reuse scan.ts detectExistingLanguage as-is | README+docs CJK ratio; package.json would skew English | scan.ts:586-644 |
| Three-mirror sync = always overwrite | Skills are generated artifacts; user fabric-config.json is the user-editable surface | exploration-ints clarification rec #4 |
| fabric-config lenient (no .strict()) | Preserves forward-compat with stale user keys; matches existing 7-key minimal config | fabric-config.ts:35-101 |
| Aggregate `relevance_migration_run` event | Quieter ledger vs one-event-per-file; matches rc.5→rc.7 precedent | exploration-deps clarification rec #3 |

## Dependencies (Task Graph)
- TASK-001 (schema + service) unblocks → TASK-002 (archive field rename), TASK-009 (review narrowing chapter)
- TASK-004 (config +10 tunables) unblocks → TASK-005 (skills read config), TASK-007 (i18n needs knowledge_language stable)
- TASK-006 (init language fixation) unblocks → TASK-007 (i18n reads language)
- TASK-003, TASK-008, TASK-010, TASK-011 — independent (parallel-safe)

## Constraints
- HARD: sha256 idempotency formula at extract-knowledge.ts:78 must not change
- HARD: three-mirror byte-identity post-install (install-skills-and-hooks.test.ts catches drift)
- HARD: protected tokens preserved (lint-protected-tokens.ts enforces via lefthook pre-commit)
- HARD: YAML wire format matches doctor.ts:627-628 regexes verbatim
- SOFT: schema additive-optional only (back-compat with user's 7-key minimal config)

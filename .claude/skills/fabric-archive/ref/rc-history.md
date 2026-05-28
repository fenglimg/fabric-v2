# rc-history — version landmarks for fabric-archive

> **Loaded on demand.** SKILL.md hot path does NOT need this file. It exists so when you encounter an inline comment like `(rc.25 TASK-01)` and wonder "what changed then?", you can `Read` here without polluting routine archive invocations.

## v2.0.0-rc.7 (T5)

Cross-session digest mechanism introduced. Stop hook writes per-session digest to `.fabric/.cache/session-digests/<session_id>.md`. fabric-archive Phase 1 reads these to stitch context across sessions since the last `knowledge_proposed` event.

## v2.0.0-rc.20 (TASK-02 / TASK-03)

`assistant_turn_observed` event + cite-policy observability landed. KB-line parsing surfaces `cite_ids` / `cite_tags`. fabric-archive doesn't directly consume — see fabric-hint for the parser.

## v2.0.0-rc.23 (F8c / a-C2)

- **F8c**: Phase 1.5 first-run onboard phase added. S5 slots (`tech-stack-decision`, `architecture-pattern`, `code-style-tone`, `build-system-idiom`, `domain-vocabulary`) baseline the workspace tone for plan_context retrieval.
- **a-C2**: knowledge_enriched event for description-grade frontmatter back-fill.

## v2.0.0-rc.24 (TASK-01 / TASK-04)

`cite_contract_policy_activated` marker + per-cite `cite_commitments` parallel array. CJS twin of shared cite-line-parser shipped to hooks.

## v2.0.0-rc.25 (TASK-01 / E4 / Q3.3 / Q3.4)

Major fabric-archive overhaul:

- **TASK-01**: `session_archive_attempted` event — drives Phase 1 cross-session digest rescan filter (outcome state machine: proposed / viability_failed / user_dismissed / skipped_no_signal).
- **TASK-05**: 5-entry model (E1 hook / E2 explicit / E3 AI-self / E4 user-range / E5 cron). Phase 0 Range Resolution parses time-window + topic-keyword hints into a `session_id[]` scope filter. Anti-loop constants (12h cooldown, normative-keyword scan) landed here.
- **Q3.4**: outcome-based rescan suppression — `user_dismissed` permanently skips a session.

## v2.0.0-rc.27 (TASK-007 / TASK-011 / TASK-012)

- **TASK-007**: Phase 4.5 dry-run override path (Codex audit §2.25).
- **TASK-011** (Codex review fix): cite_commitments index-aligned with cite_ids on multi-id parses (audit §2.18 follow-up).
- **TASK-012** (Codex review fix): dropped stale "no dry-run mode" prose that conflicted with TASK-007.

## v2.0.0-rc.28 (this release)

SKILL.md split into entry (hot path) + `ref/` (this file + i18n-policy + phase-1-5-onboard + worked-examples + e5-cron-recap). 1343 → ~950 lines for the hot path (~29% reduction). Active flow logic unchanged; reference-only content (almost-never-loaded i18n class taxonomy, Phase 1.5 onboard, end-to-end examples, E5 cron setup) moved out.

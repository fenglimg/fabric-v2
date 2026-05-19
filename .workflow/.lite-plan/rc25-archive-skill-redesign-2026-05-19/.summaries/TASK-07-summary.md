# TASK-07: fabric-archive SKILL.md — silent-skip path + write session_archive_attempted event

## Changes

- `packages/cli/templates/skills/fabric-archive/SKILL.md`:
  - Rewrote Phase 0.5 `#### On gate FAIL` subsection with `entry_point` branching: E1_hook / E3_ai_self_trigger / E5_cron → SILENT-SKIP (no gate-FAIL message, no AskUserQuestion, exit silently). E2_explicit / E4_user_range → existing zh-CN/en gate-FAIL message preserved. BOTH branches still emit `session_archive_attempted` via Phase 2.5. Legacy `knowledge_archive_aborted` event kept as optional supplement for transition window.
  - Added new H3 `### Phase 2.5 — Persist Archive Attempt` between Phase 2 and `## Hard Rules`. Sections: (1) what to emit (JSON shape on events.jsonl), (2) outcome decision matrix with 4 rows (proposed / viability_failed / user_dismissed / skipped_no_signal), (3) covered_through_ts watermark, (4) multi-session emission rule (one event per session_id), (5) 4KB-safe Bash echo append pattern + fail-tolerant rule (best-effort, stderr log), (6) worked example for E5 cron silent-skip path.

## Verification

- [x] convergence.criteria[0] `silent-skip`: grep hits L1080 (Phase 2.5 prose), L1108 (matrix row 4), L1139 (worked example heading).
- [x] convergence.criteria[1] `IF entry_point ∈`: L721 in rewritten Phase 0.5 gate-FAIL branching.
- [x] convergence.criteria[2] `### Phase 2.5 — Persist Archive Attempt`: L1078, inserted between Phase 2 (ends L1076) and `## Hard Rules` (now L1158).
- [x] convergence.criteria[3] Outcome decision matrix 4 rows: matrix at L1103-1108 has rows for `proposed` / `viability_failed` / `user_dismissed` / `skipped_no_signal`.
- [x] convergence.criteria[4] `covered_through_ts` in Phase 2.5: L1095 (JSON shape), L1115 (watermark heading), L1118 (formula), L1125 (multi-session rule), L1151+L1155 (worked example).
- [x] convergence.criteria[5] Multi-session emission rule documented: L1123 heading + L1125 prose ("emit ONE session_archive_attempted event PER session_id").
- [x] convergence.criteria[6] Commit message format matches.

## Tests

- No automated tests defined for SKILL.md prose change. Convergence verified via grep above.

## Deviations

- None. Preserved zh-CN/en gate-FAIL message wording exactly for the E2/E4 user-active branch. Did NOT touch Phase -0.5, Phase 0.0 step 4.5, or Phase 0.4 Trigger Gate (Wave 2 predecessor scope). Phase 2 `fab_extract_knowledge` call shape untouched — Phase 2.5 is purely additive after it.

## Notes

- Phase 2.5's `Bash echo` pattern explicitly references the existing Phase 0.5 `events.jsonl Constraint Note` (4KB POSIX atomic write rule) so the contract stays consistent.
- Legacy `knowledge_archive_aborted` event kept as optional supplement; the new `session_archive_attempted` is the canonical signal for the Q3.4 outcome state machine. rc.26+ can deprecate the legacy event once consumers migrate.
- `knowledge_proposed_ids` carries idempotency_keys (not stable_ids — pending entries have no stable_id until promotion). This matches the schema field documentation in `event-ledger.ts:584-591`.
- The next downstream consumer (TASK-08 — `doctor --archive-history` renderer) will read these events directly. No further SKILL.md changes expected for rc.25.

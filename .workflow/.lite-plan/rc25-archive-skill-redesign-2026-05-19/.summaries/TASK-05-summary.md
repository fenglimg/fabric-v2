# TASK-05: fabric-archive SKILL.md — Phase 0.0 outcome-based re-scan filter + 12h anti-loop

## Changes
- `packages/cli/templates/skills/fabric-archive/SKILL.md`:
  - Inserted new step **4.5 "Filter via session_archive_attempted ledger (rc.25 TASK-05)"** between current step 4 (Load digests) and step 5 (Build cross-session context) within Phase 0.0.
  - Documented the full 5-rule state machine (a/b/c/d/e) for filtering candidate `session_id[]` against the most-recent `session_archive_attempted` event.
  - Documented three constants verbatim:
    - `ANTI_LOOP_HOURS = 12` (with rationale: 心智对齐 hook cooldown `stop_hook_cooldown_hours = 12`)
    - `HIGH_VALUE_EVENT_TYPES = ['knowledge_context_planned', 'edit_paths_recorded']`
    - `NORMATIVE_KEYWORDS = ['以后','always','never','from now on','下次','记一下','永远不要']`
  - Added 3 worked examples (Session X user_dismissed → permanent skip; Session Y proposed 6h ago → cooldown skip; Session Z viability_failed 14h ago + 3 new plan_context → keep for re-scan).
  - Extended graceful-degradation paragraph: pre-rc.25 ledger or rotation-trimmed events → rule (e) applies uniformly, filter degrades to legacy "scan everything since anchor" semantics.

## Verification
- [x] **Criterion 1** — "Filter via session_archive_attempted ledger" present (grep count: 1).
- [x] **Criterion 2** — "ANTI_LOOP_HOURS = 12" present (grep count: 1).
- [x] **Criterion 3** — "HIGH_VALUE_EVENT_TYPES" present (grep count: 3 — constant declaration + 1 cross-ref in rule (d) + 1 in worked example Z).
- [x] **Criterion 4** — "NORMATIVE_KEYWORDS" present (grep count: 2 — constant declaration + 1 cross-ref in rule (d)).
- [x] **Criterion 5** — "user_dismissed" (count: 3) AND "permanent skip" (count: 1) both present in rule (b) and example X.
- [x] **Criterion 6** — graceful-degradation paragraph mentions "pre-rc.25 ledger" (count: 1).
- [x] **Criterion 7** — Commit message: `feat(rc25): Phase 0.0 outcome-based re-scan filter (TASK-05)`.

## Tests
- No unit tests (pure SKILL.md prose change per task spec; LLM interprets at runtime).
- Manual checks per `test.manual_checks` are deferred to dogfood validation when full rc.25 chain lands.

## Deviations
- None. All directives from `files[].change` and `implementation[]` followed verbatim.

## Notes
- TASK-06/07 will edit the same SKILL.md. Phase 0.0 now spans approximately L330-L443; Phase 0.4 has shifted from L369 to ~L450. Subsequent tasks should re-grep `### Phase X` to locate sections.
- The new step 4.5 sits between step 4 and step 5 of Phase 0.0; it does NOT disturb step numbering of step 5 (kept as "5" for backward continuity with rc.7 T5 design).
- Step 4.5 algorithm is pure prose — no JS/TS code embedded; LLM reads events.jsonl via Bash at runtime.
- HIGH_VALUE_EVENT_TYPES references `edit_paths_recorded` (the canonical event type name); TASK-06/07 may need to confirm if a sibling event name is used elsewhere.

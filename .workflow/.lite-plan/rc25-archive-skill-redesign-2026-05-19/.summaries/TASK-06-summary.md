# TASK-06: fabric-archive SKILL.md — Phase 0.4 onboard trigger gate (E2-only execution)

## Changes

- `packages/cli/templates/skills/fabric-archive/SKILL.md` — Inserted a new H4 `#### Phase 0.4 Trigger Gate (rc.25 — entry-context aware)` subsection at the top of Phase 0.4 (between the H3 header `### Phase 0.4 — First-run Onboard Phase (rc.23 F8c)` at L448 and the `After F8a removed...` paragraph). The new subsection contains:
  - Intro paragraph explaining the gate's purpose
  - Cross-reference to Phase -0.5 (TASK-04) for `context.entry_point` determination
  - 5-row entry-context detection table (E1 hook_passive / E2 explicit_user_invoke / E3 ai_self_trigger / E4 user_range_rollback / E5 cron)
  - Gate decision pseudocode (PROCEED if E2/E4, SKIP otherwise)
  - Rationale paragraph using the exact phrase "Non-user-active entries" + "interrupt the user mid-work"
  - Tradeoff note for hook-only users
  - Two worked examples: E5 cron (SKIP) and E2 explicit (PROCEED)

## Verification

- [x] **C1 — Phase 0.4 contains exact string 'Phase 0.4 Trigger Gate'**: Grep found at L450, L511, L522 (header + 2 worked-example mentions).
- [x] **C2 — Entry-context table has E1, E2, E3, E4, E5 detection rules**: Grep `^\| \*\*E[12345]\*\*` matched all 5 rows at L467-471.
- [x] **C3 — Contains 'Non-user-active entries' OR 'non-user-active entries'**: Grep matched at L455 and L488.
- [x] **C4 — Rationale paragraph about interrupting user mid-work**: Grep `interrupt the user mid-work` matched at L489.
- [x] **C5 — Commit message matches `feat(rc25): Phase 0.4 onboard trigger gate (E2-only) (TASK-06)`**: see commit hash below.

## Tests

- None defined in `test.commands` (pure prose change). Manual dogfood checks deferred to integration validation post-RC.

## Deviations

- None. Pure prose insertion at the documented location. Existing Phase 0.4 Step 1-4 (Check coverage / Decide / Prompt user / Tour-and-propose) verified untouched at L542 / L561 / L570 / L597. Phase -0.5 (TASK-04) and Phase 0 step 4.5 (TASK-05) not modified.

## Notes for TASK-07

- New Phase 0.4 Trigger Gate occupies L450-526 (added ~77 lines).
- Phase 0 header is now at L612 (was L584 before this task); Phase 0.5 header is at L625 (was L597).
- TASK-07 will continue to edit the same SKILL.md — line offsets must be re-grep'd before insertion.

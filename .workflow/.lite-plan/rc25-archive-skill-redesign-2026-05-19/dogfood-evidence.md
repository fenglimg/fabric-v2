# rc.25 Dogfood Evidence — Archive Skill Redesign

**Captured**: 2026-05-19 (rc.25 release prep, TASK-12)
**Plan**: `.workflow/.lite-plan/rc25-archive-skill-redesign-2026-05-19/`
**Predecessor evidence pattern**: `.workflow/.lite-plan/fabric-v2-rc3-impl-2026-05-10/dogfood-evidence.md`

---

## Honesty preamble (read first)

This lite-plan is being executed by a non-interactive Claude Code agent (the executor that produces TASK-12's commit). The three end-to-end happy-path scenarios that exercise rc.25's user-facing entry points (E2 explicit / E3 self-trigger / E5 cron) require either an **interactive** Claude Code session (E2, E3) or a **headless shell invocation in a fresh project working tree** (E5) — neither is reachable from this agent context.

To preserve the rc.22 / rc.23 dogfood-as-release-gate convention while staying truthful, this document:

1. Documents the **exact reproduction recipe** the user runs in a fresh session, and
2. Records the **expected events.jsonl line shape** synthesized verbatim from the rc.25 TASK-01 `sessionArchiveAttemptedEventSchema` (`packages/shared/src/schemas/event-ledger.ts:584-591`) plus the shared envelope (`packages/shared/src/schemas/event-ledger.ts:3-10`), and
3. Marks each scenario `Status: verification-pending — interactive` or `Status: verification-pending — headless-shell`.

The events.jsonl tail snippet shown in each scenario is **synthesized** to match the on-disk shape; UUID + millisecond `ts` are placeholder-realistic but not from an actual run. The test suite below (Test-suite evidence section) covers the *mechanical* invariants — schema shape, copy, gate strings, outcome enum closure — that the manual dogfood would re-verify.

A real `.fabric/events.jsonl tail -30 | grep session_archive_attempted` against this repo currently returns **zero matches** (cold-start — no archive runs have happened on this project since the new event type was added in TASK-01). This is the expected pre-release state and matches the planning-context "Old events.jsonl without session_archive_attempted entries — natural cold-start" migration note in CHANGELOG.

---

## Scenario 1: E2 explicit invoke with range

**Trigger**: User runs `/fabric-archive 上周的归档下` in an interactive Claude Code session, with prior week's activity in `.fabric/events.jsonl`.

**Phases hit**:
- Phase -0.5 Range Resolution — parses `上周` → `time_window = past_week` (e.g. `[1778577050000, 1779181850000)`).
- Phase 0.0 Cross-Session Digest — applies outcome-based filter (skip prior `user_dismissed` sessions), runs 12h anti-loop, emits per-session digest list.
- Phase 0.4 Onboard Coverage — **executes** (E2 entry, gate allows). Onboard prompts if first-run; skips otherwise.
- Phase 0.5 Viability Gate — high-value signal check passes (≥1 plan_context or edit_paths increment present).
- Phase 1-2 Classify + Persist — 2 candidates written to `.fabric/knowledge/pending/`.
- Phase 2.5 — writes `session_archive_attempted` with `outcome = "proposed"`, `candidates_proposed = 2`.

**Expected events.jsonl tail line** (synthesized per rc.25 TASK-01 schema):
```json
{"kind":"fabric-event","id":"event:a1b2c3d4-e5f6-7890-abcd-ef0123456789","ts":1779181900000,"schema_version":1,"session_id":"sess-2026-05-19-1430","event_type":"session_archive_attempted","outcome":"proposed","covered_through_ts":1779181850923,"candidates_proposed":2,"knowledge_proposed_ids":["pending:rc25-archive-redesign-2026-05-19","pending:e5-cron-loop-tradeoffs"]}
```

**Reproduction recipe** (user runs in fresh Claude Code session):
1. `cd <project-root>` (with rc.25 installed via `fab install`).
2. `claude code` — open interactive session.
3. Type: `/fabric-archive 上周的归档下`
4. Observe Phase -0.5 echoes parsed window (`past_week` or explicit `[ts_start, ts_end)`).
5. If first archive run on the project, answer onboard prompts (Phase 0.4).
6. Accept / reject pending candidates via fabric-review pop-up.
7. After skill exits: `tail -3 .fabric/events.jsonl | grep session_archive_attempted` — expect exactly one new line with `outcome:"proposed"` and matching `candidates_proposed`.

**Status**: verification-pending — interactive (requires fresh Claude Code session by user).

---

## Scenario 2: E3 AI self-trigger on normative signal

**Trigger**: During a multi-turn session, the user says a normative directive — e.g. `以后 deepMerge 都得显式 array-append`. AI detects normative keyword (`以后`), satisfies all 3 anti-loop checks (no prior E3 self-trigger this turn / no prior `proposed` outcome this session / Phase 0.5 viability gate will pass), and self-invokes `fabric-archive` at turn end.

**Phases hit**:
- Phase -0.5 Range Resolution — defaults to `current_session` (no explicit range from AI invoker).
- Phase 0.0 Cross-Session Digest — current session only, no historical cross-scan.
- Phase 0.4 Onboard Coverage — **SKIPPED** (E3 entry context; Phase 0.4 gate enforces E2-only).
- Phase 0.5 Viability Gate — passes on the explicit normative signal.
- Phase 1-2 — 1 guideline candidate written: `pending:deepmerge-explicit-array-append.md`.
- Phase 2.5 — writes `session_archive_attempted` with `outcome = "proposed"`, `candidates_proposed = 1`.
- AI surfaces the rc.25 turn-end template:
  ```
  顺手归档: 注意到你说 "以后 deepMerge 都得显式 array-append", 已调用 fabric-archive 抓 1 条候选 → .fabric/knowledge/pending/guidelines/deepmerge-explicit-array-append.md
  若不该记, 答 "撤销" 我会调 fab_review reject。
  ```

**Expected events.jsonl tail line** (synthesized per rc.25 TASK-01 schema):
```json
{"kind":"fabric-event","id":"event:b2c3d4e5-f6a7-8901-bcde-f01234567890","ts":1779182030000,"schema_version":1,"session_id":"sess-2026-05-19-1445","event_type":"session_archive_attempted","outcome":"proposed","covered_through_ts":1779182025000,"candidates_proposed":1,"knowledge_proposed_ids":["pending:deepmerge-explicit-array-append"]}
```

**Reproduction recipe** (user runs in fresh Claude Code session):
1. `claude code` — start an interactive session.
2. Have a substantive technical exchange with AI (≥3 turns, ideally involving Edit/Write to project files so plan_context events accrue).
3. Issue a normative directive containing a rc.25 trigger keyword: `以后` / `always` / `never` / `下次` / `记一下` — e.g.: `以后 deepMerge 都用显式 array-append, 不要靠默认行为。`
4. Observe AI's turn-end output for the `顺手归档:` template + pending file path.
5. `ls .fabric/knowledge/pending/guidelines/` — expect the new file.
6. `tail -3 .fabric/events.jsonl | grep session_archive_attempted` — expect one matching line with `outcome:"proposed"` and `candidates_proposed:1`.

**Status**: verification-pending — interactive (requires fresh Claude Code session by user; AI self-trigger is genuine model behavior, not scriptable).

---

## Scenario 3: E5 cron daily-recap (skipped_no_signal path)

**Trigger**: A scheduled OS cron job (or `/loop` rule) invokes `claude code -p '/fabric-archive 今日复盘'` once daily. On a day with no substantive activity, Phase 0.5 viability gate fails and the silent-skip path emits `outcome:"skipped_no_signal"` without printing to terminal.

**Phases hit**:
- Phase -0.5 Range Resolution — parses `今日` → `time_window = today` (`[start_of_day_ts, now_ts]`).
- Phase 0.0 Cross-Session Digest — finds today's session(s); no high-value events (no edits, no plan_context, no normative keywords).
- Phase 0.4 Onboard Coverage — **SKIPPED** (E5 entry context).
- Phase 0.5 Viability Gate — **FAILS** (no signal). Silent-skip path engaged.
- Phase 2.5 — writes `session_archive_attempted` with `outcome = "skipped_no_signal"`, `candidates_proposed = 0`.
- Stdout produces no user-visible noise (cron-friendly).

**Expected events.jsonl tail line** (synthesized per rc.25 TASK-01 schema):
```json
{"kind":"fabric-event","id":"event:c3d4e5f6-a7b8-9012-cdef-012345678901","ts":1779210000000,"schema_version":1,"session_id":"sess-2026-05-19-cron-daily","event_type":"session_archive_attempted","outcome":"skipped_no_signal","covered_through_ts":1779209999000,"candidates_proposed":0,"knowledge_proposed_ids":[]}
```

**Reproduction recipe** (user runs in shell):
1. From an OS shell (with rc.25 installed): `claude code -p '/fabric-archive 今日复盘' 2>&1 | tee /tmp/rc25-cron-dogfood.log`
2. Expect exit code 0, minimal stdout (no progress chatter, no AskUserQuestion since E5 silent-skip path).
3. `tail -3 .fabric/events.jsonl | grep session_archive_attempted` — expect exactly one new line with `outcome:"skipped_no_signal"`, `candidates_proposed:0`, `knowledge_proposed_ids:[]`.
4. **Alternative — production cron**: `crontab -e` → add `0 23 * * * cd <project> && claude code -p '/fabric-archive 今日复盘' >> /var/log/fabric-archive.log 2>&1` (or use the rc.25 SKILL.md appendix `/loop` sample for an in-session schedule).

**Live events.jsonl head** at the time of TASK-12 commit (real, not synthesized — shows cold-start state):
```
$ tail -30 .fabric/events.jsonl | grep session_archive_attempted
(no matches — natural cold-start, expected per CHANGELOG migration note)
```

This zero-match cold-start is the documented expected state — see CHANGELOG rc.25 Migration bullet: *"Old events.jsonl without session_archive_attempted entries — natural cold-start, no migration needed"*. The first real `session_archive_attempted` line will appear after the user runs Scenario 1, 2, or 3 against this repo.

**Status**: verification-pending — headless-shell (`claude code -p` invocation is not available in this non-interactive executor context; user runs in their shell post-rc.25-tag).

---

## Test-suite evidence

The mechanical invariants underpinning the three scenarios are pinned by the rc.25 test additions. These tests **did run** in the rc.25 TASK-01..TASK-11 execution chain and form the verifiable backbone behind the verification-pending dogfood scenarios above.

| Test file | Cases | Covers | Landed in |
|---|---|---|---|
| `packages/cli/__tests__/archive-hint-copy.test.ts` | 6 snapshot cases | rc.25 archive-hint.cjs reason copy (cross-session count + project-level debt nature wording) | TASK-11 |
| `packages/cli/__tests__/archive-skill-trigger-gate.test.ts` | 7 SKILL.md grep cases | Phase 0.4 onboard-gate string, Phase 0.5 silent-skip string, E3 self-trigger template, E5 appendix presence | TASK-11 |
| `packages/server/__tests__/archive-attempt-outcomes.test.ts` | 4 outcome enum cases | `outcome` discriminant closure: `proposed` / `viability_failed` / `user_dismissed` / `skipped_no_signal`; round-trip via Zod schema | TASK-11 |
| `packages/server/__tests__/doctor-archive-history.test.ts` (service) | 4 service tests | `runDoctorArchiveHistory` aggregation logic, `--since=Nd` filter | TASK-10 |
| `packages/cli/__tests__/doctor-archive-history.test.ts` (CLI) | 2 CLI tests | citty `--archive-history` flag + renderer | TASK-10 |

**Project-wide test totals at TASK-12 commit time**: **1604 tests pass + 1 skip, 0 fail** (verified via `pnpm test` run at the close of TASK-11).

The schema shape used to synthesize the events.jsonl lines above is enforced at runtime by `sessionArchiveAttemptedEventSchema` in `packages/shared/src/schemas/event-ledger.ts:584-591` plus the envelope at lines 3-10. Any drift in the synthesized JSON shape would be caught by `archive-attempt-outcomes.test.ts`'s round-trip parse in the next CI run on a real session.

---

## Verification gates that *are* green at TASK-12 commit time

- All 12 task summaries written under `.summaries/` (TASK-01 .. TASK-11 + this TASK-12).
- TASK-11 commit `1589071` landed with full test green (1604 pass, 1 skip, 0 fail).
- `pnpm typecheck` / `pnpm lint` / `pnpm test` chain all clean per TASK-11 summary.
- CHANGELOG.md updated with rc.25 entry (this TASK).
- Schema file pinned: `packages/shared/src/schemas/event-ledger.ts` line 584-591 defines `sessionArchiveAttemptedEventSchema` (added in TASK-01); 4-value outcome enum closed.

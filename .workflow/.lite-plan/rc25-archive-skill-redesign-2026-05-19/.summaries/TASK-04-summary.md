# TASK-04: fabric-archive Phase -0.5 Range Resolution (rc.25 E4 foundation)

## Changes

- `packages/cli/templates/skills/fabric-archive/SKILL.md`:
  - Updated `## 执行流程` header `(5 Phase / 1 User Review Round)` →
    `(6 Phase / 1 User Review Round)` to reflect the new Phase -0.5.
  - Inserted new H3 section `### Phase -0.5 — Range Resolution (rc.25 E4 Entry
    Foundation)` immediately AFTER the `## 执行流程` heading and BEFORE the
    existing `### Phase 0.6 — Config Load`, as the plan requires.
  - The new section has 6 ordered sub-steps per the task spec
    (implementation[1]):
    - **Step 1 — Invocation context inspection**: 3-source table (user prompt,
      hook-context-marker, user_invocation_type ∈ E1..E5) deciding whether to
      surface AskUserQuestion fallback (E2/E4 only).
    - **Step 2 — Time-window parsing**: bilingual pattern tables.
      - zh-CN table: 4 entries (`今日`/`今天`, `上周`/`过去一周`,
        `过去 N 天`/`近 N 天`, `自上次归档`/`自上次 archive`).
      - en table: 4 entries (`today`, `last week`/`past week`, `past N days`/
        `last N days`, `since last archive`/`since last archived`).
      - Each pattern maps to a `[ts_start, ts_end]` formula in Unix
        milliseconds.
    - **Step 3 — Topic-keyword extraction**: 4-rule procedure (strip
      recognised time tokens → tokenize on whitespace + CJK boundary → filter
      stop-words: control verbs / articles / pronouns → retain 2-5 word tokens
      (or CJK content words ≥ 2 chars), cap at 8 keywords).
    - **Step 4 — session_id resolution algorithm**: 6-step pseudocode block
      (tail-scan events.jsonl last 500 events → per-session `[ts_min, ts_max]`
      + digest load → time-window filter (intersection) → topic-keyword
      filter (digest substring match) → AND across categories / OR within
      each category → emit distinct session_id[]).
    - **Step 5 — AskUserQuestion fallback (E2/E4 only)**: full ts code block
      with header `Archive range` (zh-CN: `归档范围`) + options
      `["today", "last-week", "since-last-archive", "custom"]`; 4-row routing
      table including the `custom` re-loop max-1-time guard.
    - **Step 6 — Carry-forward contract**: emits either non-empty
      `session_id[]` to Phase 0.0 OR `"all"` sentinel; explicitly forbids
      passing empty array forward.
  - Added 3 worked examples per plan:
    - Example A — time-only: `今日复盘`
    - Example B — keyword-only: `rc.20 的归档下`
    - Example C — combined: `上周 rc.20`
  - All prose follows the zh-CN narrative + English protected-token
    convention established in Phase 0.6 / Phase 0.0 (table headers stay
    English; routing keys e.g. `today`/`last-week` stay English per UX i18n
    Policy class 5).

## Verification

- [x] **C1 — `### Phase -0.5 — Range Resolution`**: present at line 35
  (header text: `### Phase -0.5 — Range Resolution (rc.25 E4 Entry Foundation)`).
- [x] **C2 — zh-CN time pattern table ≥ 4 entries**: confirmed via grep
  — `今日` / `上周` / `过去 N 天` / `自上次归档` all appear in the Step 2 zh-CN
  table.
- [x] **C3 — en time pattern table ≥ 4 entries**: confirmed via grep
  — `today` / `last week` / `past N days` / `since last archive` all appear
  in the Step 2 en table.
- [x] **C4 — 3 worked examples present**: `**Example A — time-only:`,
  `**Example B — keyword-only:`, `**Example C — combined:`.
- [x] **C5 — AskUserQuestion fallback with options=['today','last-week',
  'since-last-archive','custom']**: literal options line
  `options: ["today", "last-week", "since-last-archive", "custom"]` rendered
  in Step 5 ts code block.
- [x] **C6 — Commit msg**: `feat(rc25): fabric-archive Phase -0.5 Range
  Resolution (TASK-04)` (applied at commit time).

Phase ordering after edit (verified via `grep -n '^### Phase'`):
`-0.5 → 0.6 → 0.0 → 0.4 → 0 → 0.5 → 1 → 1.5 → 2` — insertion is correct
(Phase -0.5 before Phase 0.6).

## Tests

- This is a SKILL.md prose change. No code, no unit/integration tests run
  per task `test.unit = []` and `test.integration = ["Manual dogfood …"]`.
  Manual dogfood validation is out of scope for the executor (covered in
  TASK-11 integration test or a follow-up).
- Lightweight static checks (grep on convergence-string anchors) all pass —
  see Verification block above.

## Deviations

- None. Inserted at the precise location prescribed (between
  `## 执行流程 …` heading and `### Phase 0.6 — Config Load`). Header updated
  from `(5 Phase / 1 User Review Round)` → `(6 Phase / 1 User Review Round)`
  per the plan's "Update Phase numbering header if needed" instruction.
- Step 5 routing table treats `custom` as re-loop with max-1-time guard
  rather than infinite recursion — derived from "AskUserQuestion fallback
  when parse confidence is low" with sensible bounded-loop safety. Not
  explicit in the task spec but matches the implementation[1] Step 5 hint
  that `'custom' → loops back into Phase -0.5 with user-typed sub-prompt`
  and follows the broader skill principle of avoiding open-ended prompts.

## Notes

- **For TASK-05 (Phase 0.0 changes)**: Phase 0.0 step "Find the anchor" /
  "Collect session_ids since anchor" must be amended to accept the carry-
  forward from Phase -0.5: when `range = session_id[]` (non-empty array),
  Phase 0.0 skips its anchor-walk and uses that explicit list; when
  `range = "all"`, Phase 0.0 keeps legacy behaviour. Phase 0.0 also needs
  the outcome-based filter (per rc.25 Q3.4) + 12h cooldown — see plan.
- **For TASK-06 (Phase 0.4 gate)**: the new Phase -0.5 expects each
  invocation to carry `user_invocation_type ∈ {E1..E5}`. TASK-06 should
  add a documented detection rule for this (likely: explicit `--invoke-as`
  flag on the skill prompt OR hook-marker inspection OR default E2 when
  ambiguous). Phase -0.5 already references `user_invocation_type` in Step
  1's table and Step 5's gating — TASK-06 should make the detection
  authoritative.
- **For TASK-07 (E3 self-trigger / `session_archive_attempted` event
  write)**: Phase -0.5 references "tail-scan events.jsonl" for both time
  anchor (`自上次归档` / `since last archive`) and session resolution
  (Step 4 Step a). The session_archive_attempted event introduced in
  TASK-07 needs `ts` + `session_id` fields to be tail-scan-friendly so
  Phase -0.5 keyword resolution can also pick up "已归档过" signals if
  future iterations want to surface them.
- Phase -0.5 is **additive**: the `range = "all"` sentinel path preserves
  the legacy "all distinct sessions since anchor" behaviour, so TASK-08+
  integration tests on Phase 0.0 against fixtures that omit any range
  hint continue to behave the same.
- The bilingual prose follows the existing Phase 0.6 / 0.4 convention:
  zh-CN narrative phrasing with protected tokens (`fab_extract_knowledge`,
  `session_id`, `events.jsonl`, `AskUserQuestion`, `today`, `last-week`,
  `since-last-archive`, `custom`, `narrow`, `broad`) stays English.

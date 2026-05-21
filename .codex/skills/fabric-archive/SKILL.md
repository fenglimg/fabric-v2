---
name: fabric-archive
description: Use this skill when the Stop-hook signals an archive opportunity (events.jsonl shows ≥5 plan_context entries since the last knowledge_proposed event, or ≥24h elapsed since the last archive), OR when the user explicitly invokes archival. The skill classifies recent session candidates into one of five knowledge types (model/decision/guideline/pitfall/process), assigns a layer (team/personal) via the verbatim heuristic, proposes a slug, presents one batch review, and persists confirmed entries through the fab_extract_knowledge MCP tool to .fabric/knowledge/pending/.
allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge
---

> **Surface**: This is a Skill (AI-driven, LLM judgment over session digests). See [`docs/surfaces.md`](https://github.com/fenglimg/fabric/blob/main/docs/surfaces.md) for the CLI / Skill / MCP boundary.

## Precondition

This skill is invoked when one of the following holds:

- The Stop-hook printed a stdout JSON pointer of shape `{"decision":"block","reason":"..."}` mentioning fabric-archive
- The user typed an explicit archive request (e.g. "archive what we just did", "fabric archive")
- A task wrap-up moment where the agent itself判定 a worth-keeping insight has surfaced

If none of the above hold, stop the skill immediately and tell the user (UX i18n Policy class 2 — errors/preconditions):

- zh-CN: `没有触发归档信号；如需手动归档请显式调用 fabric-archive`
- en: `No archive signal detected; to manually archive, explicitly invoke fabric-archive`

(Render per `fabric_language` resolved in Phase 0.6 Config Load below.)

This skill is `Check-not-Ask`, not a preference interview:

- **Phase 0.4 (rc.23 F8c) first-run onboard phase** — checks S5 onboard-slot coverage; if unclaimed slots remain, prompts user to fill / dismiss / skip before proceeding to normal archive flow
- Phase 0 proactively gathers candidate evidence from the session
- Phase 0.5 viability gate aborts the skill if the session lacks any archive-signal (anti-archive guard)
- Phase 1 classifies / layers / slugs each candidate and presents one batch review for user correction
- Phase 1.5 assigns `relevance_scope=narrow|broad` and derives `relevance_paths` from edit history (rc.5 single-signal source)
- Phase 2 calls `fab_extract_knowledge` once per confirmed candidate

## 执行流程 (6 Phase / 1 User Review Round)

### Phase -0.5 — Range Resolution

When the skill is invoked, the user's prompt may carry an explicit range hint —
a time window (`今日` / `last week`), a topic keyword (`rc.20`, `cite policy`),
or a literal session_id reference. This phase parses those hints and resolves
them to a concrete `session_id[]` set that constrains Phase 0.0 cross-session
digest collection. **Falls through silently** when no hint is detected — Phase
0.0 then sees the legacy "all distinct sessions since last anchor" behaviour.

This is the foundation of the **E4 (user-language range selection) entry
point** per rc.25 Q3.3. AI (Claude/Codex) interprets the rules below at runtime
— there is no parser code; the LLM IS the parser. Time-window patterns +
keyword extraction are LLM-native tasks; an `AskUserQuestion` fallback covers
the low-confidence case.

#### Step 1 — Invocation context inspection

Read three sources to determine whether a range hint is present:

| Source | Inspection | Yields |
|---|---|---|
| User prompt text (the natural-language string that triggered the skill) | Free-form parse for time words + topic keywords + literal `session_id=...` | Candidate `time_window`, `topic_keywords[]`, `explicit_session_ids[]` |
| Hook-context-marker (only when entry = E1 hook-triggered) | Already-parsed `{count, hours_since_last, sessions_since_last_proposed}` block emitted by archive-hint.cjs | Optional default scope = "since last archive" |
| User invocation type | E1 / E2 / E3 / E4 / E5 (per rc.25 5-entry model) | Decides whether to fall back to `AskUserQuestion` (E2/E4 only) |

If NONE of the three yields a usable hint AND `user_invocation_type ∉ {E2, E4}`,
fall through directly to Phase 0.6 with `range = "all"` sentinel (legacy
behaviour). E2 / E4 with no hint → proceed to Step 5 fallback.

#### Step 2 — Time-window parsing

Match the user prompt against the following bilingual patterns (case-insensitive
substring match, leftmost-longest wins). The matched span yields a
`[ts_start, ts_end]` pair in Unix milliseconds. `now` = the skill invocation
timestamp.

zh-CN pattern table:

| Pattern | ts_start | ts_end |
|---|---|---|
| `今日` / `今天` | `floor(now, day)` (本地时区 00:00) | `now` |
| `上周` / `过去一周` | `now - 7d` | `now` |
| `过去 N 天` / `近 N 天` (N ∈ 1..30) | `now - N*24h` | `now` |
| `自上次归档` / `自上次 archive` | tail-scan events.jsonl → most recent `knowledge_proposed.ts` (fallback `events[0].ts`) | `now` |

en pattern table:

| Pattern | ts_start | ts_end |
|---|---|---|
| `today` | `floor(now, day)` (local TZ 00:00) | `now` |
| `last week` / `past week` | `now - 7d` | `now` |
| `past N days` / `last N days` (N ∈ 1..30) | `now - N*24h` | `now` |
| `since last archive` / `since last archived` | tail-scan events.jsonl → most recent `knowledge_proposed.ts` (fallback `events[0].ts`) | `now` |

Notes:

- Patterns are non-exclusive — if the prompt matches multiple (e.g. "今日 cite policy"),
  apply time-window THEN topic-keyword as AND.
- Numeric N must parse as a positive integer ≤ 30; reject anything else as parse-miss.
- All other date phrasings (specific dates like `5月10日`, relative phrasings
  like `三天前下午`) are NOT handled here — emit parse-miss and let Step 5
  fallback collect a structured answer.

#### Step 3 — Topic-keyword extraction

After time-window matching (or alongside it when both apply), extract content
keywords from the prompt:

1. Strip recognised time-window tokens (e.g. remove `今日` / `last week` from
   the residual prompt).
2. Tokenize residual on whitespace + CJK boundary. Combine adjacent CJK
   characters into one token; split en words on spaces.
3. Filter **stop-words**: skill control verbs (`archive`, `归档`, `下`, `的`),
   articles / particles (`the`, `a`, `an`, `了`, `吧`), pronouns (`it`, `this`,
   `that`, `这个`, `那个`), and 1-character en tokens.
4. Retain **2-5 word tokens** (or 1-token CJK content words ≥ 2 chars like
   `rc.20`, `cite`). Cap at 8 keywords; drop weaker (later-position) ones.

The retained set is `topic_keywords[]`. Empty set = no keyword filter.

#### Step 4 — session_id resolution algorithm

Given `time_window = [ts_start, ts_end] | null` and `topic_keywords[] | []`:

```
Step a — Read events.jsonl tail (last 500 events) via `Bash: tail -n 500
         .fabric/events.jsonl`. ENOENT → empty list (no resolution possible
         → emit parse-miss → Step 5 fallback).

Step b — Per distinct session_id present in the tail, compute:
           ts_min      = min(ts) over events with this session_id
           ts_max      = max(ts) over events with this session_id
           digest_path = .fabric/.cache/session-digests/<session_id>.md
           digest_body = Read(digest_path) if exists, else ""

Step c — TIME-WINDOW FILTER (skip when time_window is null):
           Keep session_id IFF [ts_min, ts_max] intersects [ts_start, ts_end]
           (i.e. ts_max >= ts_start AND ts_min <= ts_end).
           Multiple time intervals are OR'd within the time-window filter
           category (none currently supported; reserved for future ranges).

Step d — TOPIC-KEYWORD FILTER (skip when topic_keywords is empty):
           Keep session_id IFF digest_body (case-insensitive) contains
           AT LEAST ONE keyword from topic_keywords[].
           Multiple keywords are OR'd within the keyword filter category.

Step e — AND across filter categories:
           A session must pass BOTH filters when BOTH are present.
           Pass either filter alone when only one is present.
           Pass-through (all sessions) when neither is present.

Step f — Result: distinct session_id[] (preserve event-order); if empty AND
         a parse hit was claimed → degrade to Step 5 fallback (user wanted a
         range that resolved to zero sessions).
```

#### Step 5 — AskUserQuestion fallback (E2 / E4 only)

When Step 2/3 emit parse-miss OR Step 4 resolves to zero sessions AND the
invocation type permits prompting (E2 user-active or E4 user回溯-active —
NEVER E1 hook / E3 AI-self / E5 cron), surface a structured question. UX i18n
Policy class 5 applies: `header` + `question` translate per `fabric_language`;
`options[]` routing keys stay English.

```ts
AskUserQuestion({
  header: "Archive range",                              // zh-CN: "归档范围"
  question:
    "Which session range should this archive cover? " +
    "(today = current calendar day; last-week = past 7 days; " +
    "since-last-archive = newer than last knowledge_proposed event; " +
    "custom = type a free-form range)",
  options: ["today", "last-week", "since-last-archive", "custom"]
})
```

Routing:

| Choice | Action |
|---|---|
| `today` | Re-enter Step 2 with synthetic prompt `今日` / `today` (per `fabric_language`); resolve session_ids; proceed to Phase 0.6. |
| `last-week` | Re-enter Step 2 with synthetic prompt `上周` / `last week`; proceed to Phase 0.6. |
| `since-last-archive` | Re-enter Step 2 with synthetic prompt `自上次归档` / `since last archive`; proceed to Phase 0.6. |
| `custom` | Surface a one-line text prompt to the user ("type a range, e.g. 'rc.20', 'past 3 days', '上周 cite policy'"). Re-enter Phase -0.5 Step 1 with the user-typed sub-prompt. Loop max 1 time — second parse-miss falls through to `range = "all"` with a warning. |

#### Step 6 — Carry-forward contract

Phase -0.5 produces ONE of:

- `session_id[]` (non-empty array of distinct session_ids) — passed to Phase
  0.0 as the explicit scope filter; Phase 0.0 skips its own anchor-walk and
  uses this list directly.
- `"all"` (sentinel string) — no range hint detected; Phase 0.0 falls back to
  the legacy anchor-walk behaviour ("all distinct sessions since last
  `knowledge_proposed`").

NEVER pass an empty `session_id[]` forward — that case must degrade to Step 5
fallback (or, when fallback is forbidden by invocation type, to `"all"` with
a one-line stderr warning).

#### Worked examples

**Example A — time-only: `今日复盘`**

```
Step 1: prompt = "今日复盘"; user_invocation_type = E2.
Step 2: matches `今日` → time_window = [floor(now, day), now].
Step 3: residual "复盘" survives stop-word filter → topic_keywords = ["复盘"].
        (Edge case: the residual content word may also filter; if 复盘 is
        in the stop list it becomes []. Treat as topic-keyword empty.)
Step 4: tail-scan events.jsonl; keep sessions whose [ts_min, ts_max]
        intersects today's window. Say 3 sessions match.
Step 5: skipped (resolution succeeded).
Step 6: emit session_id[] = ["sess-a", "sess-b", "sess-c"] → Phase 0.6.
```

**Example B — keyword-only: `rc.20 的归档下`**

```
Step 1: prompt = "rc.20 的归档下"; user_invocation_type = E2.
Step 2: no time pattern matches → time_window = null.
Step 3: strip "归档"/"下"/"的" stop-words → topic_keywords = ["rc.20"].
Step 4: tail-scan events.jsonl; for each session_id, Read its digest;
        keep those whose digest body matches /rc\.20/i. Say 2 sessions
        match (one was the rc.20 grilling session, one had a tangential
        mention).
Step 5: skipped.
Step 6: emit session_id[] = ["sess-x", "sess-y"] → Phase 0.6.
```

**Example C — combined: `上周 rc.20`**

```
Step 1: prompt = "上周 rc.20"; user_invocation_type = E4.
Step 2: matches `上周` → time_window = [now - 7d, now].
Step 3: strip "上周" → topic_keywords = ["rc.20"].
Step 4: AND filter — keep sessions whose [ts_min, ts_max] intersects last
        week AND whose digest matches /rc\.20/i. Say 1 session matches.
Step 5: skipped.
Step 6: emit session_id[] = ["sess-z"] → Phase 0.6.
```

If Example C had resolved to zero sessions (e.g. user types `上周 rc.99`),
Step 4 would degrade into Step 5 — surfacing AskUserQuestion since E4 permits
prompting.

### Phase 0.6 — Config Load

Before any candidate-gathering work, the skill MUST read
`.fabric/fabric-config.json` to resolve the following tunables (with documented
defaults if absent):

| Config field | Default | Used by |
|---|---|---|
| `archive_max_candidates_per_batch` | 8 | Phase 0 hard budget on candidates per Phase 1 batch |
| `archive_max_recent_paths` | 20 | Phase 0 cap on `recent_paths` enumeration |
| `archive_digest_max_sessions` | 10 | Phase 0.0 cap on cross-session digest load |

If `.fabric/fabric-config.json` is missing or unreadable, use defaults silently.

### UX i18n Policy

Read `.fabric/fabric-config.json` → `fabric_language` (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`). Emit all user-facing prose in the resolved variant. Protected tokens (MCP tool names like `fab_extract_knowledge`, schema fields like `relevance_scope`, the verbatim `强 team` / `强 personal` / `默认 team` heuristic block) are NEVER translated.

`AskUserQuestion` policy: `header` + `question` translate; `options[]` are routing keys — stay English regardless of locale.

**For the full 5-class taxonomy + edge cases:** `Read packages/cli/templates/skills/fabric-archive/ref/i18n-policy.md` (or `.claude/skills/fabric-archive/ref/i18n-policy.md` post-install).


### Phase 0.0 — Collect Cross-Session Digests

Before any single-session collection or viability gating, stitch together
context from every session that has accumulated since the last
`knowledge_proposed` event. The rc.7 Stop hook writes a per-session digest to
`.fabric/.cache/session-digests/<session_id>.md` (≤5KB, contains top 10 user
messages + edit_paths + 1-line title), so this phase is a tail-scan + read.

1. **Read events.jsonl tail.** Use `Bash` with
   `tail -n 200 .fabric/events.jsonl` (tolerate ENOENT — empty ledger is a
   normal first-run state).
2. **Find the anchor.** Walk the tail backwards to locate the most recent
   `knowledge_proposed` event (`event_type === "knowledge_proposed"`). The
   anchor's `ts` becomes the lower bound for digest selection. If NO anchor
   exists, treat all digests in the cache as in-scope.
3. **Collect session_ids since anchor.** Scan the tail forward from the
   anchor and collect every distinct `session_id` field that appears on any
   event newer than the anchor. Distinct ordering preserved.
4. **Load digests.** For each collected `session_id`, read
   `.fabric/.cache/session-digests/<session_id>.md`. Missing digest files
   degrade silently (the digest write was best-effort, so a Stop hook crash
   can produce a session_id without a digest). Cap the loaded digest set at
   `archive_digest_max_sessions` most-recent sessions (config-resolved, default
   10) to bound LLM context (~50KB worst-case at default).
4.5. **Filter via session_archive_attempted ledger (rc.25 TASK-05).** Before
   step 5 builds the cross-session context, drop sessions that the outcome
   ledger says we should not re-scan. For each `session_id` collected in
   steps 1-3, scan `.fabric/events.jsonl` for events where
   `event_type === "session_archive_attempted"` AND `session_id` matches,
   keep the most-recent one by `ts`, and apply this state machine:

   - **(a) Look up the most recent `session_archive_attempted`** event for
     this `session_id` (none found → fall through to (e)).
   - **(b) `outcome === "user_dismissed"` → drop (permanent skip).** The
     user explicitly rejected this session's candidates; never auto-re-scan
     it. Respect the dismissal forever — re-scanning would re-propose the
     same content the user already declined.
   - **(c) `(nowMs - attempted_event.ts) < ANTI_LOOP_HOURS * 3_600_000` →
     drop (cooldown skip).** Anti-loop window: even if outcome is otherwise
     re-scannable, never re-scan a session within 12 hours of the last
     attempt. Aligns 心智 with the Stop-hook cooldown so a single user does
     not see the same session repeatedly within one work day.
   - **(d) `covered_through_ts` present → check for high-value signal in
     `ts > covered_through_ts` events for this `session_id`.** Tail-scan
     `events.jsonl` for events newer than the watermark whose
     `session_id` matches. A session passes this gate iff at least ONE of:
     - ≥1 event with `event_type ∈ HIGH_VALUE_EVENT_TYPES`
       (`knowledge_context_planned`, `edit_paths_recorded`), OR
     - the latest `assistant_turn_observed` event body contains ≥1 of
       `NORMATIVE_KEYWORDS` (substring match, case-insensitive for
       English entries).

     No high-value signal → drop (no new content worth re-scanning, even
     though the cooldown has expired). Has signal → keep for re-scan.
   - **(e) Never attempted (no `session_archive_attempted` event found for
     this `session_id`) → keep.** First-time scan; nothing to filter
     against.
   - **(f) Cross-session pending dedupe** (operates on candidate
     observations, not on `session_id` filter): gather all
     `knowledge_proposed_ids` from `session_archive_attempted` events with
     `outcome === "proposed"` across ALL sessions in the recent window
     (NOT just the current candidate session). This builds a global set of
     idempotency keys already proposed by prior archive runs but not yet
     reviewed by the user (`.fabric/knowledge/pending/` may still contain
     them). When classifying new observations in Phase 1, drop any
     candidate whose computed `idempotency_key` matches an id already in
     this set — it was already proposed by an earlier archive run, the
     user just hasn't reviewed it yet, so re-proposing would duplicate
     pending entries and inflate `candidates_proposed` counts. Per Phase
     2.5 line 1112 — this is the dedupe consumer of `knowledge_proposed_ids`.

   The resulting filtered `session_id[]` proceeds into step 5's digest
   concatenation. Sessions filtered out in this step do NOT contribute to
   `### Cross-session digest`, are NOT included in `source_sessions` on any
   fab_extract_knowledge call, and are NOT referenced in `session_context`
   bodies.

   **Constants (rc.25 — verbatim):**

   - `ANTI_LOOP_HOURS = 12` — cooldown window in hours between consecutive
     re-scans of the same `session_id`. Rationale: 心智对齐 hook cooldown
     (`stop_hook_cooldown_hours = 12`); identical mental model avoids user
     confusion when a session shows up in both hook reminders and
     archive re-scan candidates.
   - `HIGH_VALUE_EVENT_TYPES = ['knowledge_context_planned', 'edit_paths_recorded']`
     — event types that count as "new substantive activity worth
     re-scanning" past `covered_through_ts`. Chat accumulation
     (`assistant_turn_observed` alone) does NOT count — it would let mere
     conversation noise trigger re-scans.
   - `NORMATIVE_KEYWORDS = ['以后','always','never','from now on','下次','记一下','永远不要']`
     — substring patterns scanned against the latest
     `assistant_turn_observed` body for the session. Mixed CN/EN to cover
     bilingual users. If any keyword hits, the session is flagged as
     having high-value chat-only signal even without code edits.

   **Worked examples:**

   - **Session X (user_dismissed)** — last `session_archive_attempted` ts
     = 3 days ago, outcome = `user_dismissed`. Rule (b) fires → permanent
     skip. Session X is dropped even if 50 new `knowledge_context_planned`
     events have accumulated since.
   - **Session Y (proposed 6h ago)** — last `session_archive_attempted`
     ts = 6h ago, outcome = `proposed`. Rule (c) fires: 6h < 12h cooldown
     window → drop (cooldown skip). Y becomes eligible again after the
     12h window closes, provided high-value signal accumulates by then.
   - **Session Z (viability_failed 14h ago + 3 new plan_context)** — last
     `session_archive_attempted` ts = 14h ago, outcome = `viability_failed`,
     `covered_through_ts` = T₀. Rules (b)(c) pass. Rule (d) tail-scans for
     `session_id === Z AND ts > T₀`: finds 3 `knowledge_context_planned`
     events. HIGH_VALUE_EVENT_TYPES match → keep Z for re-scan. The
     previous viability failure does not block a re-scan once new
     substantive activity has accumulated.
5. **Build cross-session context.** Concatenate the loaded digests into a
   single `### Cross-session digest` block to carry into Phase 0.5 + Phase 1.
   Use this block to:
   - Detect session-spanning patterns (e.g. a discussion that started in
     session A and continued in session B).
   - Populate the `source_sessions` array on every fab_extract_knowledge
     call — the array form (T5) replaces the legacy `source_session` string.
   - Inform the `session_context` blob written to each pending entry's body
     (3-5 lines summarizing goal + key turning point, per T6).

Graceful degradation: if `.fabric/.cache/session-digests/` is missing
entirely, this phase reports an empty context and Phase 0 falls back to the
single-session behaviour. Tests that synthesize events.jsonl without
populating the digest cache continue to work. If `session_archive_attempted`
events are missing entirely (pre-rc.25 ledger or rotation has trimmed older
events), treat all sessions as never-attempted (current default behavior) —
step 4.5 rule (e) applies uniformly, so the filter degrades to the legacy
"scan everything since anchor" semantics without raising errors.

### Phase 0.4 — First-run Onboard (ref-only)

**SKIP this phase entirely unless** entry_point ∈ {E2_explicit_user_invoke, E4_user_range_rollback} AND a fresh `fab onboard-coverage --json` reports `missing.length > 0`. For E1 (hook), E3 (AI self-trigger), and E5 (cron), onboard is non-applicable — silently fall through to Phase 0.

When the gate above does fire (live user + missing slots), `Read packages/cli/templates/skills/fabric-archive/ref/phase-0-4-onboard.md` (or `.claude/skills/fabric-archive/ref/phase-0-4-onboard.md` post-install) for the full Step 1-4 (coverage check → user prompt → tour-and-propose) procedure.

### Phase 0 — Collect Candidates

Gather raw evidence from the recent session before any classification:

1. Read the tail of `.fabric/events.jsonl` since the last `knowledge_proposed` event.
   - Use `Bash` with `tail -n 200 .fabric/events.jsonl` if the file is large.
   - Tolerate ENOENT — empty ledger is a normal first-run state.
2. Enumerate `recent_paths`: workspace files touched by Read/Edit/Write in the current session. Cap at `archive_max_recent_paths` most-recent paths (config-resolved, default 20).
3. Distill `user_messages_summary`: a compact (≤500 char) prose summary of what the user asked for and what was decided. NOT a verbatim transcript.
4. Build a candidate list: each candidate is one observation that MIGHT be worth archiving.

Hard budget: `archive_max_candidates_per_batch` candidates max per Phase 1 batch (config-resolved, default 8). If more surface, keep the configured-N with strongest worth-archiving signals (see Phase 1 type definitions) and drop the rest.

### Phase 0.5 — Viability Gate (Anti-Archive Guard)

Before producing any candidate output, run a coarse viability check on the session as a whole. The goal is to short-circuit obvious no-archive sessions (routine execution, typo fixes, narrow renames) so that Phase 1 batch review is never spent on noise.

#### Archive signals (≥ 1 hit ⇒ gate PASSES, proceed to Phase 1)

Scan `user_messages_summary` + `recent_paths` + the events tail collected in Phase 0:

1. Explicit normative language: user said `always` / `never` / `from now on` / `下次注意` / `记一下` / `以后` / `永远不要`.
2. Wrong-turn-and-revert: a path was edited, then reverted (or partially undone) after diagnosis — indicates a pitfall worth recording.
3. Long diagnostic loop: an issue took > 15 minutes (or > ~10 tool turns) of debugging before resolution.
4. New dependency adoption: a new package / library / external tool was introduced (e.g. `package.json` / `pyproject.toml` / `Cargo.toml` diff adds a dep).
5. New pattern emergence: a reusable abstraction or naming convention was named ("the X phase", "the Y pattern", "let's call this Z").
6. Decision confirmation: ≥ 2 alternatives were weighed AND a rationale was given before settling.
7. Explicit dismissal-with-reason: user rejected an approach AND stated why (the why is the archivable knowledge, not the dismissal itself).
8. Process formalization: a multi-step procedure was executed in a specific order AND the order was identified as load-bearing.

#### Anti-archive signals (forces gate to FAIL unless an archive signal also fires)

1. Typo-only edits: the entire session is whitespace / spelling / formatting changes.
2. Pure refactor: rename / move / extract with no behavior change AND no naming convention being established.
3. Narrow rename request: user asked to rename one symbol / file with no rationale.
4. Duplicate of existing canonical: the observation is already covered by an existing entry under `.fabric/knowledge/<type>/` (do a quick Glob before deciding).

#### Gate decision

```
archive_signals_hit   = count of archive signals fired
anti_signals_hit      = count of anti-archive signals fired
user_explicit_invoke  = user typed "archive what we just did" / "fabric archive" / similar

IF user_explicit_invoke:
    gate = PASS                          # explicit invocation bypasses all gates
ELIF archive_signals_hit == 0:
    gate = FAIL (reason="no_signal")
ELIF anti_signals_hit > 0 AND archive_signals_hit == 0:
    gate = FAIL (reason="anti_signal_dominates")
ELSE:
    gate = PASS
```

#### On gate FAIL

Branching by `entry_point` (resolved at Phase -0.5):

```
IF entry_point ∈ {E1_hook, E3_ai_self_trigger, E5_cron}:
  → SILENT-SKIP path: do NOT emit the gate-FAIL message; do NOT trigger AskUserQuestion.
  → Still write ONE `session_archive_attempted` event per session in scope
    with outcome='skipped_no_signal' (see Phase 2.5 for the emission contract).
  → Exit the skill silently. Rationale: hook / AI self-trigger / cron are
    non-user-active contexts — a verbose message there is pure noise.
ELSE (entry_point ∈ {E2_explicit, E4_user_range}):
  → User-active path: render the gate-FAIL message below (UX i18n Policy
    class 2 — errors/preconditions; render per `fabric_language`).
  → Still write ONE `session_archive_attempted` event per session in scope
    with outcome='viability_failed' (see Phase 2.5 Outcome Decision Matrix
    row 2 — user-active gate failure populates `viability_failed`, NOT
    `skipped_no_signal` which is reserved for the SILENT-SKIP branch
    above).
  → Exit the skill.
```

For the user-active branch (E2 / E4), the gate-FAIL message variants are:

zh-CN variant:

```
本次会话为常规执行，无新知识可归档（gate=<reason>）。如需强制归档，请显式调用 fabric-archive。
```

en variant:

```
Current session is routine execution; no new knowledge to archive (gate=<reason>). To force-archive, explicitly invoke fabric-archive.
```

In BOTH branches: do NOT proceed to Phase 1, do NOT call any MCP tool. The legacy `knowledge_archive_aborted` event line (`{"ts":"...","kind":"knowledge_archive_aborted","reason":"<reason>","session":"<id>"}`) MAY be appended in addition to the mandatory Phase 2.5 `session_archive_attempted` event — they serve different audit purposes (legacy abort reason vs new outcome state machine) and the two coexist during the rc.25 transition window.

##### events.jsonl Constraint Note

Event lines appended to `.fabric/events.jsonl` are subject to POSIX
single-write atomicity: only writes ≤ 4KB (`PIPE_BUF`) are guaranteed
atomic via `Bash: echo "..." >> file`. Lines exceeding 4KB risk
interleaved corruption under concurrent skill + server writes to the
same ledger.

Skills MUST ensure:

- Each event JSON line is a **single line** (no embedded newlines;
  escape `\n` in any string value).
- `session_context` and other free-form text fields **self-truncate** to
  keep the entire serialized line under 4KB. Suggested per-field caps:
  `session_context` first 500 chars; `source_sessions` cap at 5
  entries; `recent_paths` cap at 20 entries; `user_messages_summary`
  first 500 chars.
- If approaching the 4KB ceiling after the per-field caps, drop optional
  fields (e.g. tags / extra metadata) **before** truncating semantic
  content (the summary / context that carries the actual observation).
- This constraint applies to any event the skill itself appends (e.g.
  the abort signal above); MCP-server-side appends (via
  `appendEventLedgerEvent`) are already line-length-bounded server-side.

#### On gate PASS

Proceed to Phase 1 with the candidates carried over from Phase 0.

### Phase 1 — Classify, Layer, Slug, Review

For each candidate, the skill proposes:

- **type** ∈ {model, decision, guideline, pitfall, process}
- **layer** ∈ {team, personal} via the verbatim heuristic below
- **slug** per the 5-rule naming guideline below
- **summary** (1-2 sentences, will become the entry body's lead paragraph)

#### Five Knowledge Types (singular noun = type concept)

- **model** — A reusable mental abstraction or domain object schema. Worth-archive signal: the user names something ("the X pattern", "the Y phase"). Skip-it signal: ad-hoc terminology used once. Positive: "Wave-1/Wave-2 task DAG decomposition for parallel-safe planning". Negative: "the thing we did just now" (too thin, no reusable abstraction).
- **decision** — A choice between alternatives with rationale. Worth-archive signal: ≥2 options were weighed AND a rationale was given. Skip-it signal: the choice was forced by external constraint with no real alternative. Positive: "Single .cjs hook script over three per-client scripts — rationale: identical stdout JSON shape across Claude/Codex". Negative: "Used the existing fab_extract_knowledge schema" (no alternative was considered).
- **guideline** — A normative rule for future similar situations. Worth-archive signal: the user said "always" / "never" / "from now on". Skip-it signal: a one-off preference that won't generalize. Positive: "Slug naming: kebab-case, 2-5 words, 20-40 chars, semantic core only". Negative: "Use 4-space indent in this one file" (too narrow).
- **pitfall** — A trap that wasted time and is non-obvious. Worth-archive signal: a bug took >15 min to diagnose AND is repeatable. Skip-it signal: a typo or one-time API quirk. Positive: "deepMerge replaces arrays — hooks.Stop[] needs special-case append-with-dedupe". Negative: "Forgot a comma in JSON" (too obvious).
- **process** — A multi-step procedure with a stable shape. Worth-archive signal: the steps were executed in a specific order AND the order matters. Skip-it signal: a one-shot script with no reusable structure. Positive: "fab_review approve = counter++ → frontmatter inject → git mv → meta rebuild → event append (5 atomic steps)". Negative: "Ran the tests, then committed" (trivial, no reusable shape).

#### Layer Classification Heuristic (强 team 信号 / 强 personal 信号 / 默认 team)

> - **强 team**: 引用本项目代码、团队共识用语（"we decided"）、fabric-import 路径产物、业务领域、绑定本项目代码的 pitfall
> - **强 personal**: 第一人称偏好、跨项目通用、工具/编辑器偏好、个人工作流
> - **默认 team**: 安全偏置——错标 team 在 PR review 中会被发现，错标 personal 静默丢失

Resolution order: check 强 team signals first; only assign personal if 强 personal signals dominate AND no 强 team signal applies; otherwise default to team.

#### Slug Naming Guideline (5 Rules)

1. kebab-case (lowercase letters, digits, hyphens only — no underscores, no CamelCase)
2. 2-5 words separated by hyphens
3. 20-40 characters total length
4. semantic core only (drop articles "the/a", drop generic suffixes "stuff/thing")
5. unique within its (type, layer) bucket — if collision, the LLM must add a discriminating word, NOT a counter

Examples passing: `wave-1-parallel-task-dag` (4 words, 24 chars), `deepmerge-array-replace-trap` (4 words, 28 chars). Examples failing: `the_solution` (underscore + article), `fix` (1 word, too short), `how-we-decided-to-handle-the-merge-conflict-in-stop-hook-config` (overlong).

#### Decision Tree (是否值得归档)

```
Recent session contains an observation worth keeping?
  ├─ NO → skip (do nothing, no MCP call)
  └─ YES → does it fit one of {model, decision, guideline, pitfall, process}?
            ├─ NO → skip (not classifiable = not yet ripe)
            └─ YES → assign type
                      ↓
                Apply layer heuristic
                      ↓
                Propose slug per 5 rules
                      ↓
                Present in batch review
                      ↓
                User confirms / corrects / rejects
                      ↓
                Phase 2: call fab_extract_knowledge once per confirmed candidate
```

#### Batch Review Template

Present all candidates in a single screen. UX i18n Policy classes 1 + 3 — the roll-up structure AND the per-candidate `Confirm?` prompt are bilingualized; protected tokens (`relevance_scope`, `relevance_paths`, `narrow`, `broad`, `layer`, `team`, `personal`, `pending_path`, etc.) appear verbatim in BOTH variants. Field VALUES (slugs, file paths, type/layer enum strings like `decision` / `team`) are data and are NOT translated.

en variant (`fabric_language === "en"`):

```md
# Archive Review — N candidates

## C1 [type=decision] [layer=team] [relevance_scope=narrow] slug=wave-1-parallel-task-dag
Summary: <1-2 sentences capturing the observation>
Layer reasoning: <which 强 team / 强 personal signal applied, or default team>
Scope reasoning: <why narrow or broad — see Phase 1.5>
relevance_paths: ["packages/cli/src/commands/plan.ts", "packages/cli/templates/**/*.md"]
Confirm? (Y to accept, edit type/layer/slug/relevance_scope/relevance_paths inline, N to skip)

## C2 [type=pitfall] [layer=team] [relevance_scope=broad] slug=deepmerge-array-replace-trap
Summary: ...
Layer reasoning: ...
Scope reasoning: ...
relevance_paths: []
Confirm? ...
```

zh-CN variant (`fabric_language === "zh-CN"`):

```md
# 归档 Review — N 条候选

## C1 [type=decision] [layer=team] [relevance_scope=narrow] slug=wave-1-parallel-task-dag
摘要: <1-2 句捕捉该观察>
Layer 判定: <命中哪条 强 team / 强 personal 信号，或默认 team>
Scope 判定: <为什么 narrow 或 broad — 见 Phase 1.5>
relevance_paths: ["packages/cli/src/commands/plan.ts", "packages/cli/templates/**/*.md"]
确认？(Y 接受 / 内联编辑 type/layer/slug/relevance_scope/relevance_paths / N 跳过)

## C2 [type=pitfall] [layer=team] [relevance_scope=broad] slug=deepmerge-array-replace-trap
摘要: ...
Layer 判定: ...
Scope 判定: ...
relevance_paths: []
确认？...
```

The user MAY edit type/layer/slug/relevance_scope/relevance_paths inline before confirming. The user MAY skip individual candidates without rejecting the whole batch. Inline-editing `[relevance_scope=...]` triggers a re-derivation of `relevance_paths` per the Phase 1.5 rules (narrow ⇒ recompute from edit_paths; broad ⇒ force `[]`).

### Phase 1.5 — Scope Decision + relevance_paths Derivation

After classify/layer/slug but BEFORE batch review output, assign a `relevance_scope` to each candidate and derive its `relevance_paths` array. These two fields drive rc.6 hint injection: narrow knowledge is gated by working in matching paths, broad knowledge is project-wide.

#### Scope decision (narrow vs broad)

```
relevance_scope =
    narrow  IF the candidate is tied to a specific module / file / subsystem
            AND there is explicit single-module evidence in edit_paths
            (i.e. all worth-keeping edits in this session concentrated in one
            module tree, OR the candidate explicitly references that module)

    broad   IF the candidate is cross-cutting / methodological / general
            (applies regardless of which path the agent is working in)

    broad   (default, on uncertainty — safe偏置 per Q-1 in handoff)
```

Special case — Personal layer ALWAYS resolves to `relevance_scope=broad` with `relevance_paths=[]`. Rationale: personal knowledge crosses projects; paths from one project do not generalize. If `layer=personal` and a narrow scope was tentatively chosen, auto-flip to `broad` and clear `relevance_paths`.

##### Examples

- `decision: single-cjs-hook-script` → `narrow` (tied to `templates/claude-hooks/` + `packages/cli/src/commands/hooks.ts`)
- `pitfall: deepmerge-array-replace-trap` → `broad` (cross-cutting JSON merge gotcha, applies anywhere deepMerge is used)
- `guideline: slug-naming-rules` → `broad` (methodology, no specific module)
- `model: wave-1-parallel-task-dag` → `narrow` (tied to `packages/cli/src/commands/plan.ts`)
- `guideline: indent-style-by-language` (personal layer) → `broad + []` (personal forces broad)

#### relevance_paths derivation algorithm (rc.5 single-signal: edit_paths only)

rc.5 uses ONLY the `edit_paths` signal — list of paths modified by `Edit` / `Write` / `MultiEdit` tool calls in the current session. Multi-signal (read_paths + body regex + symbols) is explicitly deferred to rc.7 per design decision.

```
Step 1: COLLECT
  edit_paths = []
  Scan session transcript for tool_use entries where
    tool_use.name ∈ {Edit, Write, MultiEdit}
  Extract the file_path argument from each, push into edit_paths.

Step 2: DEDUPE
  edit_paths = unique(edit_paths)

Step 3: BLACKLIST FILTER
  Drop paths matching any of:
    - **/*.<ext>          where <ext> is a single trivial extension on a single file
                          (i.e. avoid emitting bare **/*.md as a relevance pattern)
    - Repo-root single files: README.md, package.json, package-lock.json,
      pnpm-lock.yaml, tsconfig.json, .gitignore, LICENSE, CHANGELOG.md
    - Read-only paths (never modified) — those go to ## Evidence, not relevance_paths

Step 4: PUBLIC-PREFIX GENERALIZE (depth ≤ 2, minGroupSize = 2)
  Group remaining paths by common prefix.
  For each group of ≥ 2 sibling paths sharing a prefix:
    - Compute longest common directory prefix
    - Limit generalization depth: at most 2 levels below the common prefix
    - Emit glob: <common-prefix>/**/*.<ext>  (or <common-prefix>/**/<filename>)
  Singleton paths (group size = 1) are kept as-is (literal path, no glob).

Step 5: SCOPE GATE
  IF relevance_scope == broad → relevance_paths = []  (force empty regardless of edit_paths)
  IF relevance_scope == narrow → relevance_paths = result of Step 4

Step 6: ATTACH READ-ONLY EVIDENCE
  Read-only paths (filtered in Step 3) are emitted as a ## Evidence markdown
  block in the pending entry body — NOT in relevance_paths. They document
  what the agent consulted without making them part of the activation gate.
```

##### Worked generalization example

Edit history during session:

```
packages/server/src/services/extract.ts
packages/server/src/services/review.ts
packages/server/src/services/promote.ts
packages/cli/src/commands/plan.ts
README.md
```

Step 1-2 (collect + dedupe): all 5 unique.
Step 3 (blacklist): drop `README.md` (repo-root single file).
Step 4 (generalize, depth ≤ 2, minGroupSize = 2):
- `packages/server/src/services/{extract,review,promote}.ts` → group size 3 ≥ 2, common prefix `packages/server/src/services/`, glob: `packages/server/src/services/**/*.ts`
- `packages/cli/src/commands/plan.ts` → group size 1, kept literal.

Step 5 (assume `relevance_scope=narrow`):

```json
"relevance_paths": [
  "packages/server/src/services/**/*.ts",
  "packages/cli/src/commands/plan.ts"
]
```

If `relevance_scope=broad` had been chosen instead, `relevance_paths` would be `[]` regardless of the above.

#### Inline-edit support during batch review

The user MAY inline-edit `[relevance_scope=...]` in the batch review. When this happens:

- Edit changes `narrow → broad`: clear `relevance_paths` to `[]`.
- Edit changes `broad → narrow`: re-run Steps 1-4 of the derivation algorithm to recompute.
- The user MAY also directly inline-edit `relevance_paths` to a custom array; treat this as authoritative and skip auto-derivation.

### Phase 2 — Persist via MCP

For each user-confirmed candidate, call `fab_extract_knowledge` ONCE. Do NOT batch multiple candidates into one call.

#### Output Contract (MCP tool call shape)

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["<session id1>", "<session id2>", ...],  // T5: array form (Phase 0.0)
  recent_paths: ["<path1>", "<path2>", ...],   // capped at archive_max_recent_paths (config-resolved, default 20)
  user_messages_summary: "<compact prose ≤500 chars>",
  type: "decisions" | "pitfalls" | "guidelines" | "models" | "processes",
  slug: "<kebab-case-2-to-5-words>",
  layer: "team" | "personal",
  relevance_scope: "narrow" | "broad",         // from Phase 1.5
  relevance_paths: ["<glob1>", "<literal2>", ...],  // narrow ⇒ derived; broad ⇒ []
  // v2.0.0-rc.7 T6: required fields for future-self reviewability.
  proposed_reason:
    "explicit-user-mark"      // user said "always / never / 下次注意" etc.
    | "diagnostic-then-fix"   // long debug loop surfaced a new pattern/pitfall
    | "decision-confirmation" // ≥2 options weighed AND rationale stated → decision/model
    | "wrong-turn-revert"     // tried path X, reverted → pitfall
    | "new-dependency-or-pattern" // new dep/lib/abstraction introduced
    | "dismissal-with-reason",    // user rejected approach AND said why
  session_context: "<3-5 line markdown: session goal + key turning point>",
  // v2.0.0-rc.23 TASK-006 (a-C1): four OPTIONAL structured triage fields.
  // Lift implicit signals out of `## Session context` prose so future-self
  // reviewers / plan-context retrievers can triage relevance from
  // frontmatter alone, without re-reading the body. Omit any field the
  // skill cannot infer cleanly — guessing is worse than omitting.
  intent_clues: ["<short trigger>", "<negative trigger e.g. 'NOT for X'>"],  // when this rule applies / when NOT
  tech_stack: ["<lang/framework>", "..."],  // inferred from recent_paths (see table below)
  impact: ["<consequence of ignoring>"],    // why future-self should care
  must_read_if: "<one-line strong trigger>" // single condition; if it holds, the entry is required reading
  // tags? — NOT in current schema; reserved for future
})
```

##### C1 triage-field inference table

| Field          | Inference source                                                                 | Skip when                          |
|----------------|----------------------------------------------------------------------------------|------------------------------------|
| `intent_clues` | Pull from `session_context` turning point + negative phrasing in the transcript ("not for", "don't do X when") | No clear trigger phrasing surfaced |
| `tech_stack`   | Map `recent_paths` extensions: `.ts`→`typescript`, `.tsx`→`typescript`+`react`, `.go`→`go`, `package.json`→`nodejs`, `pyproject.toml`→`python`, `Cargo.toml`→`rust`. Add framework markers from path heuristics (`cocos`→`cocos-creator`, `next.config`→`nextjs`) | Rule is stack-agnostic            |
| `impact`       | Pull from the diagnostic-loop body — "wasted 30 min", "production outage", "silent data loss" | No observable consequence stated   |
| `must_read_if` | Strongest single trigger from the worth-archive signal: a file path, a routine, a recurring condition; ≤160 chars | No single dominant trigger fits    |

All four fields are STRICTLY OPTIONAL. The schema accepts the call without any of them — omit rather than guess. None of the four participate in the idempotency_key hash (server formula at `extract-knowledge.ts:100-106` is frozen to `{source_session, type, slug}`), so partial-vs-full fill of these fields on the same triple is safe.

The Skill infers `proposed_reason` from the classification + viability-gate
signal that fired:

| Signal fired (Phase 0.5)       | Classification | Default proposed_reason     |
|--------------------------------|----------------|-----------------------------|
| Explicit normative language    | guideline      | `explicit-user-mark`        |
| Wrong-turn-and-revert          | pitfall        | `wrong-turn-revert`         |
| Long diagnostic loop           | pitfall/model  | `diagnostic-then-fix`       |
| New dependency adoption        | decision/model | `new-dependency-or-pattern` |
| New pattern emergence          | model          | `new-dependency-or-pattern` |
| Decision confirmation          | decision       | `decision-confirmation`     |
| Explicit dismissal-with-reason | decision       | `dismissal-with-reason`     |
| Process formalization          | process        | `new-dependency-or-pattern` |

The `session_context` is a 3-5 line summary distilled from the Phase 0.0
cross-session digest (see Phase 0.0 below for digest source). Format:

```
Session goal: <one-line of what the user was trying to accomplish>
Turning point: <one-line of the key moment that produced the worth-archive observation>
[optional 1-3 more lines of supporting context]
```

Future-self reviewing the pending entry MUST be able to understand WHY this
entry was proposed without conversation transcript access — proposed_reason
is the structured why, session_context is the narrative why.

Note on type plurality: the MCP enum uses plural directory-form (decisions / pitfalls / guidelines / models / processes), while the conceptual classification above uses singular nouns (decision / pitfall / guideline / model / process) for natural English. They map 1:1.

The server returns `{ pending_path, idempotency_key }`. Display `pending_path` to the user so they can `Read` the persisted entry if they wish.

#### Idempotency Note

The MCP tool derives `idempotency_key = sha256({source_session, type, slug})`. Calling fab_extract_knowledge twice with the same `(source_session, type, slug)` triple is SAFE: the server appends new evidence to the existing pending file rather than overwriting or producing duplicates. This means the skill MAY be re-invoked on the same session without producing junk.

If the skill needs to record a genuinely separate observation in the same session+type, the slug MUST differ.

**T5 array-form note (rc.7+)**: when `source_sessions` is passed as an array (the rc.7 T5 contract), only `source_sessions[0]` participates in the server-side idempotency hash. The actual server formula at `packages/server/src/services/extract-knowledge.ts:78` is `sha256(JSON.stringify({source_session: sourceSessions[0], type, slug}))`. Implications:

- Same `(type, slug)` but a different **first** session → distinct idempotency key → produces two pending files.
- Same first session but different tail sessions → evidence-merge into the SAME pending file; tail `session_id`s are NOT recorded as independent evidence keys.
- The formula is intentionally stable across the rc.5 → rc.7 migration; adding or removing tail entries does NOT change the idempotency key, preserving rc.5 single-session compat.

### Phase 2.5 — Persist Archive Attempt

MANDATORY closing step on every skill invocation — runs AFTER Phase 2 (success path) AND on every early-exit path (Phase 0.0 dropped-all, Phase 0.5 gate-FAIL silent-skip or user-active, Phase 1 batch user-dismissed). Drives the Q3.4 outcome state machine + cross-session digest rescan filter.

#### Dry-run override (v2.0.0-rc.27 TASK-007 / audit §2.25)

When the user's invocation explicitly carries a dry-run intent — the prompt or `/fabric-archive` invocation contains a literal `--dry-run`, `dry-run`, `dry_run`, or `预览` token — the skill MUST skip Phase 2.5's ledger write. The mandatory contract above is suspended only in this single case; every other early-exit path still emits the event.

Rationale: pre-rc.27 the spec read as "MANDATORY on every invocation" which created an irreconcilable conflict when the user explicitly requested a no-mutation preview (audit §2.25). The dry-run override resolves the deadlock by treating dry-run as an entry-context override that disables the ledger side-effect while preserving the rest of the skill's read-side machinery (Phase 0.0 digest collection, Phase 0.5 viability gate, Phase 1 candidate preview render). The user sees what WOULD have happened without the audit trail recording an attempt that never produced a pending entry.

Detection rule (substring match, case-insensitive): if the originating prompt contains `--dry-run` | `dry-run` | `dry_run` | `预览` as a standalone token, set `dry_run = true` for the entire skill run and skip the Phase 2.5 event emission. All other phases run normally; their user-facing output should prefix `[DRY-RUN]` to make the mode visible.

When `dry_run = true`:
- Phase 1 batch review header MUST include `[DRY-RUN — no writes will occur]`
- Phase 2 candidate emission is REPLACED with a "would write N pending entries" preview rendered as a numbered table (`would-write` shape — same columns as the real Phase 1 review)
- Phase 2.5 event emission is SKIPPED entirely (the rationale above)
- No `fab_extract_knowledge` MCP call is issued (dry-run is purely read-side)

#### What to emit

For EACH `session_id` in the run's scope (multi-session E4 runs emit MULTIPLE events — one per session_id; single-session E1/E2/E3/E5 runs emit ONE event), append ONE `session_archive_attempted` line to `.fabric/events.jsonl`:

```jsonc
{
  "kind": "fabric-event",
  "id": "<uuid or ts-derived>",
  "ts": <epoch ms>,
  "schema_version": 1,
  "session_id": "<the session this event pertains to>",
  "event_type": "session_archive_attempted",
  "outcome": "proposed" | "viability_failed" | "user_dismissed" | "skipped_no_signal",
  "covered_through_ts": <max event ts scanned for this session>,
  "candidates_proposed": <integer, default 0>,
  "knowledge_proposed_ids": ["<idempotency_key_1>", "..."]   // default []
}
```

#### Outcome decision matrix

| Skill terminal state                                                 | outcome              | candidates_proposed | knowledge_proposed_ids                          |
|----------------------------------------------------------------------|----------------------|---------------------|-------------------------------------------------|
| Phase 2 wrote ≥ 1 pending entry                                      | `proposed`           | N (count written)   | `[idempotency_key_1, idempotency_key_2, ...]` (from each fab_extract_knowledge response) |
| Phase 0.5 viability_failed AND entry_point ∈ {E2_explicit, E4_user_range} AND user saw + accepted the gate-FAIL message | `viability_failed`   | 0                   | `[]`                                            |
| Phase 1 batch review — user dismissed ALL presented candidates       | `user_dismissed`     | 0                   | `[]`                                            |
| Phase 0.0 filter dropped every session in scope OR Phase 0.5 silent-skip path (E1_hook / E3_ai_self_trigger / E5_cron) | `skipped_no_signal`  | 0                   | `[]`                                            |

Rationale highlights:
- `user_dismissed` is the ONLY outcome that suppresses future auto-rescan (respects user decision per Q3.4).
- `proposed` populates `knowledge_proposed_ids` so the cross-session digest in Phase 0.0 can dedupe future runs against already-proposed entries.
- `viability_failed` vs `skipped_no_signal` distinguishes "user was prompted but the gate stopped us" from "we never bothered the user" — both allow rescan but the doctor history report differentiates them.

#### covered_through_ts watermark

```
covered_through_ts = max(events_in_scope[*].ts)
```

where `events_in_scope` is the set of events the skill actually examined for THAT session_id (Phase 0 + Phase 0.0 digest input). On rescan, Phase 0.0 compares the current `max(ts)` against this stored watermark — only sessions with new events past the watermark are eligible candidates.

#### Multi-session emission rule

When the run scope spans multiple session_ids (E4 user-range with `--since` / topic-keyword matching multiple sessions), emit ONE `session_archive_attempted` event PER session_id. Each event's `covered_through_ts` is computed against that session's own event subset. The `knowledge_proposed_ids` for a multi-session `proposed` run lists ALL idempotency_keys produced by the run; ledger consumers that want per-session breakdown should join against `source_sessions` on each pending entry.

#### Append pattern (Bash echo, 4KB-safe, fail-tolerant)

Reuse the Phase 0.5 `events.jsonl Constraint Note` pattern: single-line JSON ≤ 4KB, no embedded newlines. Best-effort write — if the append fails (disk full, permission denied, race), the skill MUST still exit successfully. Log the failure to stderr only; do NOT surface it to the user. Rationale: a missing `session_archive_attempted` event degrades gracefully — the next Phase 0.0 digest treats the session as "never archived" and re-evaluates it, which is the safe-default behavior.

```bash
# Pseudo — actual implementation uses the same pattern as the legacy
# knowledge_archive_aborted emit at the end of Phase 0.5.
echo '{"kind":"fabric-event","id":"...","ts":..., "schema_version":1, "session_id":"...", "event_type":"session_archive_attempted","outcome":"...","covered_through_ts":...,"candidates_proposed":0,"knowledge_proposed_ids":[]}' >> .fabric/events.jsonl
```

The per-field caps from Phase 0.5's constraint note carry over: `knowledge_proposed_ids` capped at 20 entries (drop tail with `...` marker in `id` field if truncated); other fields are bounded by schema.

#### Worked example: E5 cron silent-skip

Setup: An OS cron job runs `fabric-archive` at 03:00 daily for the "today" range (E5 entry_point). Today's session was routine config edits — no archive signals fire.

Trace:
1. Phase -0.5 resolves `entry_point=E5_cron`, range = "today" → 1 session_id in scope.
2. Phase 0.0 digest collects events for that session_id; nothing dropped.
3. Phase 0.4 onboard is skipped (E5 is not E2).
4. Phase 0.5 viability gate runs — `archive_signals_hit=0` → `gate=FAIL (reason=no_signal)`.
5. `entry_point=E5_cron` ∈ {E1, E3, E5} → SILENT-SKIP branch. No message rendered.
6. Phase 2.5 (mandatory) appends ONE event:
   ```
   {"kind":"fabric-event","id":"...","ts":<now>,"schema_version":1,"session_id":"<today-session-id>","event_type":"session_archive_attempted","outcome":"skipped_no_signal","covered_through_ts":<max ts of today's events>,"candidates_proposed":0,"knowledge_proposed_ids":[]}
   ```
7. Skill exits silently. Cron output is empty.

Next day's cron rescan: Phase 0.0 sees `covered_through_ts < max(ts of session's new events)` → session is rescan-eligible → loop continues without `user_dismissed` block.

## Hard Rules (DO NOT TRANSLATE) — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST complete Phase 0 AND Phase 0.5 viability gate before any batch-review output.
- MUST abort with the gate-FAIL message (no MCP call) when the viability gate fails AND the user did not explicitly invoke fabric-archive.
- MUST present every candidate with explicit `[type=...]`, `[layer=...]`, `[relevance_scope=...]`, and `slug=...` fields plus a `relevance_paths` line.
- MUST include a one-line `Layer reasoning:` for each candidate citing which 强 team / 强 personal signal applied (or default team).
- MUST include a one-line `Scope reasoning:` for each candidate citing why narrow or broad was chosen (or that personal forced broad).
- MUST classify against the canonical singular nouns: model / decision / guideline / pitfall / process. NEVER invent new types.
- MUST cap the batch at `archive_max_candidates_per_batch` candidates (config-resolved, default 8); drop weaker ones over the cap.
- MUST display the resolved `pending_path` returned by `fab_extract_knowledge` so the user can verify.
- MUST treat user inline edits to type/layer/slug/relevance_scope/relevance_paths as authoritative replacements before Phase 2.
- MUST skip rather than guess when an observation does not fit any of the 5 types.

### WRITE Rules

- NEVER write a knowledge entry directly to the filesystem; the only legal write path is `mcp__fabric__fab_extract_knowledge`.
- NEVER write outside `.fabric/knowledge/pending/` — promotion to `.fabric/knowledge/<type>/` is rc.3 fab_review concern, NOT this skill.
- NEVER include an `id` field anywhere — pending entries have no id (late-bind on approve).
- NEVER classify a candidate as `personal` when a 强 team signal applies. Default to team on ambiguity.
- NEVER emit a non-empty `relevance_paths` when `relevance_scope=broad` — broad MUST always carry `relevance_paths=[]`.
- NEVER emit a non-empty `relevance_paths` when `layer=personal` — personal forces `relevance_scope=broad` + `relevance_paths=[]`.
- NEVER use multi-signal sources for relevance_paths in rc.5 — `edit_paths` is the SOLE source. `read_paths`, body regex, and symbol extraction are reserved for rc.7+.
- NEVER batch multiple candidates into a single fab_extract_knowledge call; one call per candidate.
- NEVER paraphrase the verbatim layer heuristic block above — the Chinese text is contract-locked.
- MUST preserve protected tokens exactly: `stable_id`, `knowledge_proposed`, `knowledge_archive_aborted`, `knowledge_scope_degraded`, `.fabric/knowledge/pending/`, `fab_extract_knowledge`, `relevance_paths`, `relevance_scope`, `narrow`, `broad`, `edit_paths`, `source_sessions`, `proposed_reason`, `session_context`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`, `pending_path`, `layer`, `team`, `personal`, `MUST`, `NEVER`, `强 team`, `强 personal`, `默认 team`.

## Worked Examples (ref-only)

Three end-to-end fab_extract_knowledge call examples (decision/team, pitfall/team, guideline/personal) live in `packages/cli/templates/skills/fabric-archive/ref/worked-examples.md` (or `.claude/skills/fabric-archive/ref/worked-examples.md` post-install). Load when you want to see all required + optional fields populated together in a realistic shape.

## E5 Scheduled Daily Recap (ref-only)

Only relevant when entry_point=E5_cron (OS cron, `/loop`, or scheduled trigger). For interactive invocations, Phase -0.5 has already routed past this — nothing to load.

When E5 fires: `Read packages/cli/templates/skills/fabric-archive/ref/e5-cron-recap.md` (or `.claude/skills/fabric-archive/ref/e5-cron-recap.md` post-install) for `/loop` vs OS cron tradeoffs + the `今日复盘` magic-phrase parse contract.

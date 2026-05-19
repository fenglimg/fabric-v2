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

### Phase -0.5 — Range Resolution (rc.25 E4 Entry Foundation)

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

### UX i18n Policy (5-class bilingualization)

The skill consults `fabric_language` from `.fabric/fabric-config.json`
(固化于 init 时，via `lib/detect-language.ts:detectExistingLanguage`; default `"en"` when no
CJK signal is detected in README + docs/; may resolve to `"match-existing"`,
`"zh-CN"`, `"en"`, or `"zh-CN-hybrid"`). All user-facing text in the
following 5 categories MUST be rendered in the resolved language:

1. **Roll-up templates** — the `# Archive Review — N candidates` batch
   review block (one per candidate) AND any final session summary the
   skill emits after Phase 2 completes. zh-CN ↔ en mirror.
2. **Errors / Preconditions warnings** — abort + gate-fail messages (e.g.
   the "没有触发归档信号…" trigger-miss and the "本次会话为常规执行…"
   viability-gate-FAIL message). zh-CN ↔ en mirror.
3. **Confirmation prompts** — the per-candidate `Confirm? (Y to accept,
   edit … inline, N to skip)` line in the batch review template. zh-CN
   ↔ en mirror.
4. **Dry-run table headers** — fabric-archive does not currently expose
   a dry-run mode; this slot is reserved for parity with fabric-import.
   IF a future revision adds dry-run, the table header MUST be
   bilingualized per this policy. zh-CN ↔ en mirror.
5. **AskUserQuestion** — `header` + `question` fields (NOT `options[]`).
   zh-CN ↔ en mirror. fabric-archive itself does not surface
   AskUserQuestion in the current contract (Phase 1 batch review is a
   single markdown screen, not a structured question), but if a future
   version adds one — e.g. to confirm layer flip — this rule applies.

Rendering rule:

- `fabric_language === "zh-CN"` → emit the zh-CN variant; pure monolingual, no language mixing inside a single user-facing block.
- `fabric_language === "en"` → emit the en variant; pure monolingual, no language mixing inside a single user-facing block.
- `fabric_language === "zh-CN-hybrid"` → emit Chinese narrative prose with English technical terms preserved. Protected tokens (always EN): MCP tool names (e.g. `fab_get_knowledge_sections`), CLI command names (e.g. `fab install`), file paths, technical concepts (`Skill`, `SessionStart`, `hook`, `MCP`, `revision_hash`, `pending`, `proven`, `verified`, `draft`).
- `fabric_language === "match-existing"` or any other value → emit the en variant; pure monolingual.

Protected tokens (`fab_extract_knowledge`, `relevance_scope`,
`relevance_paths`, `narrow`, `broad`, `source_sessions`, `proposed_reason`,
`session_context`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`,
`pending_path`, `layer`, `team`, `personal`,
`knowledge_scope_degraded`, `MUST`, `NEVER`, `.fabric/knowledge/`, the verbatim
`强 team` / `强 personal` / `默认 team` heuristic block, etc.) are NEVER
translated — they appear verbatim in both language variants. The
bilingualization scope is prose ONLY.

### AskUserQuestion i18n Policy (value vs label)

When a skill (this one or any sibling skill the user is composing with)
issues an `AskUserQuestion`, the `header` and `question` strings are
user-facing prose → translated per `fabric_language`. The `options[]`
array entries (e.g. `["approve", "reject", "modify", "defer", "skip"]` in
fabric-review, or `["team", "personal"]` for a layer-flip target) are
**routing keys** consumed by the skill state machine — they MUST remain
English regardless of `fabric_language`.

```ts
// EN (fabric_language === "en")
AskUserQuestion({
  header: "Layer-flip target",
  question: "Move '{title}' to which layer? (current: {current_layer})",
  options: ["team", "personal"]
})

// zh-CN (fabric_language === "zh-CN")
AskUserQuestion({
  header: "Layer 切换目标",
  question: "将 '{title}' 切换到哪一层？(当前: {current_layer})",
  options: ["team", "personal"]   // 不翻译 — routing key
})
```

Rationale: localizing routing keys would force every routing branch to
dual-string match (e.g. `if (choice === "team" || choice === "团队")`),
which doubles the surface area for protected-token regressions and breaks
the option-list invariants that downstream tooling depends on. Keeping
`options[]` English-only is contract-locked across all three skills.

### Phase 0.0 — Collect Cross-Session Digests (v2.0.0-rc.7 T5)

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

### Phase 0.4 — First-run Onboard Phase (rc.23 F8c)

#### Phase 0.4 Trigger Gate (rc.25 — entry-context aware)

Before running ANY of the onboard coverage steps below, evaluate the
**entry-context gate**. Onboard slot collection is an interactive,
one-time project-tone capture flow that REQUIRES live user dialogue.
Non-user-active entries (hook / AI self-trigger / cron) either interrupt
the user mid-work or run unattended where dialogue is impossible, so
they MUST skip Phase 0.4 entirely and fall through to Phase 0.

Read `context.entry_point` — already determined in **Phase -0.5 Range
Resolution** (see TASK-04 / Phase -0.5 section above). The 5-entry model
is the canonical taxonomy for this gate.

##### Entry-context detection rules

| Entry | Symbol | Detection rule (LLM-native, evaluated at skill entry) |
|-------|--------|-------------------------------------------------------|
| **E1** | `hook_passive` | stdout JSON `{decision:'block', ...}` from `archive-hint.cjs` detected at skill entry (the Stop-hook reminder path). |
| **E2** | `explicit_user_invoke` | User prompt is a direct invocation: `fabric archive` / `/fabric-archive` / `archive what we just did` / `归档一下` / similar imperative. |
| **E3** | `ai_self_trigger` | AI internal marker `self-archive policy triggered by signal X` present (one of the 4 self-trigger signals from AGENTS.md E3 section). |
| **E4** | `user_range_rollback` | Prompt contains a **range hint** (parsed in Phase -0.5 — e.g. `今日` / `上周` / `rc.20`) AND the user is invoking. Sub-mode of E2. |
| **E5** | `cron` | Prompt contains literal `今日复盘` / `daily recap` / `daily-archive` AND no human is present (running under `/loop`, OS cron, or scheduled trigger). |

##### Gate decision

```
IF context.entry_point ∈ {E2_explicit_user_invoke, E4_user_range_rollback}:
    → gate = PROCEED       # user is live, dialogue is possible
    → continue to Step 1 (Check coverage) below
ELSE (E1_hook_passive | E3_ai_self_trigger | E5_cron):
    → gate = SKIP           # no live user, onboard prompting would misfire
    → emit one-line log: "Phase 0.4 skipped (entry=<E1|E3|E5>, no live user)"
    → proceed directly to Phase 0
```

##### Rationale

Onboard slot collection is a one-time project-tone capture flow that
requires user dialogue. Non-user-active entries (hook / AI / cron)
interrupt the user mid-work or run unattended where dialogue is
impossible, so they MUST skip Phase 0.4. The S5 slot semantics
(`tech-stack-decision`, `architecture-pattern`, ...) are user-validated
baselines — populating them from a hook fire-and-forget or a cron daily
recap would defeat the purpose of capturing _user-confirmed_ project
tone.

##### Tradeoff (documented in CHANGELOG)

A first-time user whose ONLY invocations ever come via hook (never an
explicit `/fabric-archive`) will not see the onboard prompt; the 5
onboard slots remain empty. Mitigation: documentation tells users to
run an explicit `fab archive` at least once to populate the onboard
baseline.

##### Worked example

```
$ /loop 24h /fabric-archive 今日复盘
  → cron context, no live user
  → Phase -0.5 detects literal "今日复盘" + no-human marker
  → context.entry_point = E5_cron
  → Phase 0.4 Trigger Gate evaluates: E5 ∉ {E2, E4} → SKIP
  → emit log "Phase 0.4 skipped (entry=E5, no live user)"
  → proceed directly to Phase 0 (collect candidates for daily window)
```

Contrast with E2:

```
$ /fabric-archive
  → user typed explicit invocation
  → Phase -0.5: context.entry_point = E2_explicit_user_invoke
  → Phase 0.4 Trigger Gate evaluates: E2 ∈ {E2, E4} → PROCEED
  → run Step 1 (Check coverage) below
```

---

After F8a removed the auto-`fab scan` baseline pipeline, a freshly installed
Fabric workspace ships with an EMPTY `.fabric/knowledge/` tree. Five fixed
**S5 onboard slots** capture the "project tone" baseline that the AI needs
for high-quality plan_context retrieval from day one:

- `tech-stack-decision` — primary languages / frameworks / runtime stack
- `architecture-pattern` — module layout, service boundaries, layering rules
- `code-style-tone` — naming / formatting / idiom conventions the project enforces
- `build-system-idiom` — build tool quirks, scripts, deploy pipeline shape
- `domain-vocabulary` — business / product terminology that names code entities

This phase runs ONCE per archive-skill invocation, BEFORE Phase 0 evidence
gathering, so coverage state is fresh for the session.

#### Step 1 — Check coverage

Invoke `fab onboard-coverage --json` and parse the JSON payload:

```bash
fab onboard-coverage --json
```

Expected shape:

```json
{
  "filled":    { "tech-stack-decision": ["KT-DEC-0012"], ... },
  "missing":   ["architecture-pattern", "code-style-tone"],
  "opted_out": ["domain-vocabulary"],
  "total": 5
}
```

#### Step 2 — Decide

```
IF missing.length === 0:
    → skip Phase 0.4 entirely; proceed to Phase 0.
ELSE:
    → ask the user how to handle the missing slots (Step 3).
```

#### Step 3 — Prompt user

Present a single roll-up listing each missing slot. UX i18n Policy class 5
applies: the `header` + `question` strings are translated per
`fabric_language`; the `options[]` routing keys stay English.

```ts
AskUserQuestion({
  header: "Onboard coverage",  // zh-CN: "首装基调覆盖"
  question:
    "KB is missing the following project-tone slots: " +
    missing.join(", ") +
    ". Tour the project and propose pending entries for each?",
  options: ["fill-all", "fill-each", "dismiss-all", "skip"]
})
```

`fab_extract_knowledge` is called with `onboard_slot: <slot>` set so each
proposed entry counts toward coverage once approved via fab_review.

| User choice    | Action |
|----------------|--------|
| `fill-all`     | For EACH slot in `missing`, run Step 4 (Tour-and-propose). All proposals share session_id; one batch review at the end (Phase 1). |
| `fill-each`    | Loop slot-by-slot through `missing`. Per slot: ask user `confirm | dismiss | skip` (per-slot AskUserQuestion); `confirm` → run Step 4; `dismiss` → `fab config dismiss-slot <slot>`; `skip` → leave for next archive run. |
| `dismiss-all`  | For EACH slot in `missing`, invoke `Bash("fab config dismiss-slot <slot>")`. Print a one-line confirmation each. Skip to Phase 0. |
| `skip`         | No-op. Slots remain in `missing` for the next archive run. Skip to Phase 0. |

#### Step 4 — Tour-and-propose (per-slot)

For each slot to fill, the LLM independently sources slot-specific evidence
from the project (no user prompt — this is a Read-only tour):

| Slot                     | Source files (LLM should Read these) |
|--------------------------|---------------------------------------|
| `tech-stack-decision`    | `package.json` (+ lockfile), `pyproject.toml` / `Cargo.toml` / `go.mod`, `tsconfig.json`, root README |
| `architecture-pattern`   | Top-level dir tree (`ls -F`), 1-2 entry-point files (`src/index.ts`, `main.go`, etc.), framework-config files (`next.config`, `vite.config`, `astro.config`) |
| `code-style-tone`        | `.editorconfig`, `prettier.config.*`, `eslint.config.*`, `biome.*`, `.prettierrc*`, framework lint config, 2-3 representative source files for naming-pattern inference |
| `build-system-idiom`     | `package.json` `scripts` block, `Makefile`, `taskfile.yaml`, CI yml (`.github/workflows/*.yml`), Dockerfile if present |
| `domain-vocabulary`      | README, `docs/*.md`, top-level `src/` directory names (often domain-aligned), public API entry types |

After Read-ing the slot-specific sources, classify the observation:

- `tech-stack-decision` → type=`decisions`, `proposed_reason=decision-confirmation`
- `architecture-pattern` → type=`models`, `proposed_reason=new-dependency-or-pattern`
- `code-style-tone` → type=`guidelines`, `proposed_reason=explicit-user-mark` (the project ITSELF is the mark)
- `build-system-idiom` → type=`processes`, `proposed_reason=new-dependency-or-pattern`
- `domain-vocabulary` → type=`models`, `proposed_reason=new-dependency-or-pattern`

Call `fab_extract_knowledge` with the inferred fields PLUS `onboard_slot:
<slot>`. The pending file's frontmatter will carry the slot label, and the
next `fab onboard-coverage` run will see the slot as filled (once approved
via fab_review).

Example:

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["<current-session-id>"],
  recent_paths: ["package.json", "tsconfig.json"],
  user_messages_summary: "Project uses TypeScript + pnpm workspace + Vitest. Node 20 LTS target. ESM-only.",
  type: "decisions",
  slug: "primary-tech-stack",
  layer: "team",
  relevance_scope: "broad",        // tech stack applies everywhere
  relevance_paths: [],
  proposed_reason: "decision-confirmation",
  session_context:
    "Session goal: capture onboard tech-stack baseline.\nTurning point: read package.json + tsconfig.json + pnpm-workspace.yaml; stack confirmed.",
  onboard_slot: "tech-stack-decision",    // ← claims the slot
  tech_stack: ["typescript", "nodejs", "pnpm", "vitest"]
})
```

#### Onboard phase constraints (DO NOT TRANSLATE)

- MUST run BEFORE Phase 0 evidence gathering — onboard is a separate flow,
  not interleaved with session-archive candidates.
- MUST call `fab onboard-coverage --json` before deciding; never assume
  coverage state.
- NEVER fill a slot that is in `opted_out` — `fab onboard-coverage` already
  excludes those from `missing`, but the Skill MUST NOT re-propose them
  even if the user asks "fill all of them" — the dismiss is intentional.
- NEVER prompt the user when `missing.length === 0` — silent skip.
- NEVER set `onboard_slot` on a regular session-archive candidate in
  Phase 2 — that field is RESERVED for the onboard phase. Mixing the
  two would let session-archive proposals masquerade as onboard
  coverage and let any random pending file claim a slot.
- MUST emit `onboard_slot: <slot>` verbatim — the slot name is one of
  the locked S5 strings (tech-stack-decision / architecture-pattern /
  code-style-tone / build-system-idiom / domain-vocabulary). The
  fab_extract_knowledge schema enum will reject anything else.

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

Stop the skill with the gate-FAIL message (UX i18n Policy class 2 — errors/preconditions; render per `fabric_language`):

zh-CN variant:

```
本次会话为常规执行，无新知识可归档（gate=<reason>）。如需强制归档，请显式调用 fabric-archive。
```

en variant:

```
Current session is routine execution; no new knowledge to archive (gate=<reason>). To force-archive, explicitly invoke fabric-archive.
```

Optionally append a one-line event to `.fabric/events.jsonl` of shape `{"ts":"...","kind":"knowledge_archive_aborted","reason":"<reason>","session":"<id>"}` if the events ledger is writable; otherwise just log to stderr. Do NOT proceed to Phase 1, do NOT call any MCP tool.

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

## Worked Examples

### Example 1 — decision (team)

Session: User and agent debated whether the Stop-hook should be one .cjs script or three per-client scripts. Settled on one because stdout JSON shape `{"decision":"block","reason"}` is identical across Claude / Codex.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["WFS-2026-05-10-rc2"],
  recent_paths: ["templates/claude-hooks/", "packages/cli/src/commands/hooks.ts"],
  user_messages_summary: "User pushed back on three-script proposal; agreed single .cjs because stdout JSON shape is universal across Claude Code and Codex CLI.",
  type: "decisions",
  slug: "single-cjs-hook-script",
  layer: "team",
  relevance_scope: "narrow",
  relevance_paths: [
    "templates/claude-hooks/**/*.cjs",
    "packages/cli/src/commands/hooks.ts"
  ],
  proposed_reason: "decision-confirmation",
  session_context: "Session goal: ship Stop-hook for v2 release.\nTurning point: user rejected 3-script proposal after seeing identical stdout JSON across Claude / Codex.\nResult: single .cjs path locked in."
})
```

Layer = team (引用本项目代码 + fabric-import 路径产物 signals). Scope = narrow (tied to hook templates + hooks command module; single-module evidence in edit_paths).

### Example 2 — pitfall (team)

Session: deepMerge silently replaced the existing `hooks.Stop[]` array in `.claude/settings.json` instead of appending. Cost ~30 min to diagnose.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["WFS-2026-05-10-rc2"],
  recent_paths: ["packages/cli/src/config/json.ts"],
  user_messages_summary: "deepMerge default behavior REPLACES arrays. hooks.Stop[] needs an array-append-with-dedupe special case keyed on .command string match.",
  type: "pitfalls",
  slug: "deepmerge-array-replace-trap",
  layer: "team",
  relevance_scope: "broad",
  relevance_paths: [],
  proposed_reason: "diagnostic-then-fix",
  session_context: "Session goal: wire hook installer for v2.\nTurning point: spent ~30 min chasing why prior Stop[] entries vanished — root cause was deepMerge replacing arrays silently.\nResult: array-append-with-dedupe special case added."
})
```

Layer = team (绑定本项目代码的 pitfall signal). Scope = broad (deepMerge gotcha is cross-cutting — applies anywhere JSON merge is used, not just `json.ts`).

### Example 3 — guideline (personal)

Session: User mentioned across three projects that they prefer 2-space indent in TypeScript and 4-space in Python.

Skill output:

```ts
mcp__fabric__fab_extract_knowledge({
  source_sessions: ["WFS-2026-05-10-rc2"],
  recent_paths: [".editorconfig"],
  user_messages_summary: "Personal indent preference: 2-space TS / 4-space Py. Stable across multiple projects, not project-specific.",
  type: "guidelines",
  slug: "indent-style-by-language",
  layer: "personal",
  relevance_scope: "broad",
  relevance_paths: [],
  proposed_reason: "explicit-user-mark",
  session_context: "Session goal: align editor config.\nTurning point: user said '一直 prefer 2-space TS / 4-space Py，across projects'.\nResult: personal-layer guideline; not bound to this project."
})
```

Layer = personal (跨项目通用 + 工具/编辑器偏好 signals dominate; no 强 team signal applies). Scope = broad with `relevance_paths=[]` (personal layer ALWAYS forces broad — paths don't generalize across projects per Phase 1.5 special case).

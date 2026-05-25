# Phase 0 — Range Resolution (ref)

> **Loaded on demand.** SKILL.md hot path retains the Phase 0 intro, the Confidence decision rule, and Step 1 (invocation context inspection). This file holds Steps 2-6 (parsing tables, session_id resolution algorithm, AskUserQuestion fallback, carry-forward contract) + worked examples. Read when entry_point ∈ {E2_explicit_user_invoke, E4_user_range_rollback} AND the user prompt likely carries a range hint that needs parsing.

## Step 2 — Time-window parsing

Match the user prompt against the following bilingual patterns (case-insensitive substring match, leftmost-longest wins). The matched span yields a `[ts_start, ts_end]` pair in Unix milliseconds. `now` = the skill invocation timestamp.

### zh-CN pattern table

| Pattern | ts_start | ts_end |
|---|---|---|
| `今日` / `今天` | `floor(now, day)` (本地时区 00:00) | `now` |
| `上周` / `过去一周` | `now - 7d` | `now` |
| `过去 N 天` / `近 N 天` (N ∈ 1..30) | `now - N*24h` | `now` |
| `自上次归档` / `自上次 archive` | tail-scan events.jsonl → most recent `knowledge_proposed.ts` (fallback `events[0].ts`) | `now` |

### en pattern table

| Pattern | ts_start | ts_end |
|---|---|---|
| `today` | `floor(now, day)` (local TZ 00:00) | `now` |
| `last week` / `past week` | `now - 7d` | `now` |
| `past N days` / `last N days` (N ∈ 1..30) | `now - N*24h` | `now` |
| `since last archive` / `since last archived` | tail-scan events.jsonl → most recent `knowledge_proposed.ts` (fallback `events[0].ts`) | `now` |

Notes:

- Patterns are non-exclusive — if the prompt matches multiple (e.g. "今日 cite policy"), apply time-window THEN topic-keyword as AND.
- Numeric N must parse as a positive integer ≤ 30; reject anything else as parse-miss.
- All other date phrasings (specific dates like `5月10日`, relative phrasings like `三天前下午`) are NOT handled here — emit parse-miss and let Step 5 fallback collect a structured answer.

## Step 3 — Topic-keyword extraction

After time-window matching (or alongside it when both apply), extract content keywords from the prompt:

1. Strip recognised time-window tokens (e.g. remove `今日` / `last week` from the residual prompt).
2. Tokenize residual on whitespace + CJK boundary. Combine adjacent CJK characters into one token; split en words on spaces.
3. Filter **stop-words**: skill control verbs (`archive`, `归档`, `下`, `的`), articles / particles (`the`, `a`, `an`, `了`, `吧`), pronouns (`it`, `this`, `that`, `这个`, `那个`), and 1-character en tokens.
4. Retain **2-5 word tokens** (or 1-token CJK content words ≥ 2 chars like `rc.20`, `cite`). Cap at 8 keywords; drop weaker (later-position) ones.

The retained set is `topic_keywords[]`. Empty set = no keyword filter.

## Step 4 — session_id resolution algorithm

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

## Step 5 — AskUserQuestion fallback (E2 / E4 only)

When Step 2/3 emit parse-miss OR Step 4 resolves to zero sessions AND the invocation type permits prompting (E2 user-active or E4 user回溯-active — NEVER E1 hook / E3 AI-self / E5 cron), surface a structured question. UX i18n Policy class 5 applies: `header` + `question` translate per `fabric_language`; `options[]` routing keys stay English.

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
| `today` | Re-enter Step 2 with synthetic prompt `今日` / `today` (per `fabric_language`); resolve session_ids; proceed to Phase 0.5. |
| `last-week` | Re-enter Step 2 with synthetic prompt `上周` / `last week`; proceed to Phase 0.5. |
| `since-last-archive` | Re-enter Step 2 with synthetic prompt `自上次归档` / `since last archive`; proceed to Phase 0.5. |
| `custom` | Surface a one-line text prompt to the user ("type a range, e.g. 'rc.20', 'past 3 days', '上周 cite policy'"). Re-enter Phase 0 Step 1 with the user-typed sub-prompt. Loop max 1 time — second parse-miss falls through to `range = "all"` with a warning. |

## Step 6 — Carry-forward contract

Phase 0 produces ONE of:

- `session_id[]` (non-empty array of distinct session_ids) — passed to Phase 1 as the explicit scope filter; Phase 1 skips its own anchor-walk and uses this list directly.
- `"all"` (sentinel string) — no range hint detected; Phase 1 falls back to the legacy anchor-walk behaviour ("all distinct sessions since last `knowledge_proposed`").

NEVER pass an empty `session_id[]` forward — that case must degrade to Step 5 fallback (or, when fallback is forbidden by invocation type, to `"all"` with a one-line stderr warning).

## Worked examples

### Example A — time-only: `今日复盘`

```
Step 1: prompt = "今日复盘"; user_invocation_type = E2.
Step 2: matches `今日` → time_window = [floor(now, day), now].
Step 3: residual "复盘" survives stop-word filter → topic_keywords = ["复盘"].
        (Edge case: the residual content word may also filter; if 复盘 is
        in the stop list it becomes []. Treat as topic-keyword empty.)
Step 4: tail-scan events.jsonl; keep sessions whose [ts_min, ts_max]
        intersects today's window. Say 3 sessions match.
Step 5: skipped (resolution succeeded).
Step 6: emit session_id[] = ["sess-a", "sess-b", "sess-c"] → Phase 0.5.
```

### Example B — keyword-only: `rc.20 的归档下`

```
Step 1: prompt = "rc.20 的归档下"; user_invocation_type = E2.
Step 2: no time pattern matches → time_window = null.
Step 3: strip "归档"/"下"/"的" stop-words → topic_keywords = ["rc.20"].
Step 4: tail-scan events.jsonl; for each session_id, Read its digest;
        keep those whose digest body matches /rc\.20/i. Say 2 sessions
        match (one was the rc.20 grilling session, one had a tangential
        mention).
Step 5: skipped.
Step 6: emit session_id[] = ["sess-x", "sess-y"] → Phase 0.5.
```

### Example C — combined: `上周 rc.20`

```
Step 1: prompt = "上周 rc.20"; user_invocation_type = E4.
Step 2: matches `上周` → time_window = [now - 7d, now].
Step 3: strip "上周" → topic_keywords = ["rc.20"].
Step 4: AND filter — keep sessions whose [ts_min, ts_max] intersects last
        week AND whose digest matches /rc\.20/i. Say 1 session matches.
Step 5: skipped.
Step 6: emit session_id[] = ["sess-z"] → Phase 0.5.
```

If Example C had resolved to zero sessions (e.g. user types `上周 rc.99`), Step 4 would degrade into Step 5 — surfacing AskUserQuestion since E4 permits prompting.

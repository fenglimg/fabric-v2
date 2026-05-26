---
name: fabric-review
description: 审 .fabric/knowledge pending+canonical (NOT PR review):approve/reject/modify/revisit/defer。Triggers 审批/驳回/复审/重审/approve/reject/review pending.
allowed-tools: Read, Glob, Grep, Bash, Edit, mcp__fabric__fab_review
---

> **Surface**: Skill (AI-driven, per-entry human-judgment routing). See [`docs/surfaces.md`](https://github.com/fenglimg/fabric/blob/main/docs/surfaces.md).

## Precondition

Invoke this skill ONLY when ONE of the following holds:

- Stop-hook printed stdout JSON `{"decision":"block","reason":"..."}` carrying `signal=review` (pending overflow: count ≥ `review_hint_pending_count` (default 10) OR oldest age ≥ `review_hint_pending_age_days` (default 7) days)
- User typed an explicit review request (e.g. "review knowledge", "show pending", "approve what's queued", "what's stale", "look at KT-D-7")
- Agent判定 review backlog crossed the overflow threshold

If none hold, stop the skill and tell the user:

- zh-CN: `没有触发 review 信号；如需手动 review 请显式调用 fabric-review`
- en: `No review signal detected; to manually review, explicitly invoke fabric-review`

This skill is `Infer-not-Ask` for mode and `Ask-when-genuine` for per-item actions:

- Mode (pending / topic / health / revisit) is INFERRED from context — NEVER surfaced via AskUserQuestion
- Per-item action (approve / reject / modify / defer) IS surfaced via AskUserQuestion — the user must judge
- Layer-flip target (team vs personal) IS surfaced via AskUserQuestion when modify includes layer change

Required preconditions before any `fab_review` call: `.fabric/` exists (or `~/.fabric/` for personal layer); `mcp__fabric__fab_review` MCP tool registered; `.fabric/agents.meta.json` present (id allocator reads it on approve); `.fabric/events.jsonl` exists (tolerate ENOENT — empty ledger normal first-run).

### Config Load

Read `.fabric/fabric-config.json`; resolve:

| Config field | Default | Used by |
|---|---|---|
| `review_topic_result_cap` | 8 | topic mode top-N cap |
| `review_stale_pending_days` | 14 | health mode stale threshold (days) |
| `review_hint_pending_count` | 10 | precondition overflow signal (count) |
| `review_hint_pending_age_days` | 7 | precondition overflow signal (age) |

Missing or unreadable → defaults silently.

### UX i18n Policy

Read `fabric_language` (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`); emit user-facing prose in resolved variant. Protected tokens (`fab_review`, `fab_extract_knowledge`, `relevance_scope`, layer/scope enums, `stable_id`, the verbatim `强 team` / `强 personal` / `默认 team` block) NEVER translated. `AskUserQuestion` policy: `header` + `question` translate; `options[]` stay English (routing keys).

`Read ref/i18n-policy.md` for the full 5-class taxonomy + edge cases.

## Mode Inference (System Infers — NEVER Ask)

> Verbatim from rc.3 locked decisions:
> "review 永远走 fabric-review skill，**模式从上下文推断**（4 种 mode：pending queue / by topic / health overview / revisit existing）"
> "**AskUserQuestion 仅在真有选择时用**——'何种 mode' 不是真选择（系统能推断），'approve/reject/modify 单条' 是真选择"

The skill MUST infer one of {`pending`, `topic`, `health`, `revisit`} BEFORE any user-facing output.

### 3-Step Inference Algorithm

**Step 1 — Recent user message keyword scan.** Match against priority order:

| Keywords (zh-CN + en) | Inferred mode |
|---|---|
| "approve", "review pending", "promote", "what's queued", "审核 pending", "通过" | `pending` |
| "search for X about Y", "find entries about <topic>", "关于…的知识", "找一下 <topic>" | `topic` |
| "what's stale", "demote old", "health check", "过期的", "陈旧的", "整理一下" | `health` |
| "look at <id>", "revisit KT-…", "show <slug>", "再看下 <id>", "回顾" | `revisit` |

Exactly one row matches → lock mode, skip to Step 3.

**Step 2 — events.jsonl tail scan.** If Step 1 yielded 0 or >1 matches, tail (last 200 lines) `.fabric/events.jsonl`:

- `>5` recent `knowledge_proposed` since last `knowledge_promoted` → `pending` (write side piled up).
- `≥1` `knowledge_demoted` or `lint` events in 24h → `health` (corpus quality signal).
- Recent `knowledge_layer_changed` for the entry user referenced → `revisit`.

**Step 3 — Pending count default.** Still ambiguous → glob `.fabric/knowledge/pending/**/*.md`:

- Count ≥ `review_hint_pending_count` (default 10) OR oldest mtime > `review_hint_pending_age_days` (default 7) → `pending` (overflow, same threshold as Stop-hook).
- Otherwise → default `pending` (most common review entry point).

`Read ref/per-mode-flows.md` for 5 inference examples and anti-pattern restatement.

## Per-Mode Flow

Each mode produces user-facing output, then routes per-item or per-batch decisions through `fab_review` actions. Display body = zh-CN summaries (M3 style); section headings = EN.

- **`pending`** — list pending entries → run Semantic Check (see `ref/semantic-check.md`) → per-item AskUserQuestion `{approve, reject, modify, defer, skip}` → route per choice (modify path = `ref/modify-flow.md`).
- **`topic`** — extract keywords → `fab_review action="search"` → render top-N (cap `review_topic_result_cap`) → only AskUserQuestion when user signals action verb.
- **`health`** — `fab_review action="list"` + tail events → compute stale → render dashboard → per-stale AskUserQuestion `{defer, demote, skip}`.
- **`revisit`** — user referenced specific id/slug → `Read` canonical file directly OR `fab_review action="list"` with narrow filters → display body + history → AskUserQuestion only if pending.

`Read ref/per-mode-flows.md` for full step-by-step procedures, bilingual rendering blocks (en + zh-CN per-item display, AskUserQuestion templates, health dashboard format), and the rc.7 T6 `proposed_reason` + `## Why proposed` + `## Session context` rendering contract.

## Semantic Check (LLM-Assisted Duplicate / Contradiction Detection)

> Boundary B (locked): "extraction / classification / layer / slug / mode / **semantic dedup** → Skill (LLM); file write / frontmatter / idempotency / counter / layer-flip / atomic promote → MCP (deterministic)"

Semantic check is the LLM's job — the MCP tool does NOT compare meaning. Run during `pending` mode (and on demand during `topic`): for each pending entry, `fab_review action="search"` scoped by `filters.type` → LLM judges semantically against returned canonical entries → surface one of three flags as informational:

- `⚠ Possible duplicate of <stable_id>` — same essential claim
- `⚠ Contradicts <stable_id>` — opposing claims, same scope
- `⚠ Subsumed by <stable_id>; consider modify-to-merge` — fully covered

Thresholds intentionally NOT quantified (no similarity %). User decides: still-approve (flag informational), modify-to-harmonize, or reject-as-duplicate (reason MUST cite existing stable_id).

DO NOT AskUserQuestion "is this a duplicate?" — LLM already judged. User only chooses approve/reject/modify.

`Read ref/semantic-check.md` for full procedure + 三类判断的细化定义.

## Narrowing Imported Entries & Modify Sub-Flow

`modify` is the only action that mutates frontmatter or stable_id. Two paths:

- **Title/summary/tags/maturity** → in-place rewrite; stable_id PRESERVED.
- **Layer change** → ONLY legal stable_id mutation. BEFORE call, AskUserQuestion `{team, personal}` to confirm target (this IS genuine choice). AFTER server returns, surface BOTH `prior_stable_id` and `new_stable_id` in roll-up — downstream agents may cache the prior id.

**Import-origin entries** (`source_sessions[0]` starts with `fabric-import-`) ship with `relevance_scope=broad + relevance_paths=[]` by design; narrowing is fabric-review's responsibility. Render `⚠ Imported (relevance_scope=broad, relevance_paths=[]) — pick 'modify' + say 'narrow to <paths>'` as informational hint. On `modify` of import-origin: extended option list `{narrow scope, edit summary, change layer, change maturity, skip}`; "narrow scope" → free-text follow-up → `changes: { relevance_scope: "narrow", relevance_paths: [<parsed>] }`. Personal layer auto-degrades narrow → broad+[] (server-side), emitting `knowledge_scope_degraded`.

`Read ref/modify-flow.md` for layer-flip server transaction (4-step), modify call shape examples (maturity bump / layer flip), and full narrowing flow with bilingual AskUserQuestion templates.

## AskUserQuestion Policy

**DO ask** (genuine choices): per-pending action `{approve, reject, modify, defer, skip}` · per-stale action `{defer, demote, skip}` · layer-flip target `{team, personal}` · reject reason follow-up (free-text).

**DO NOT ask**: mode picking (inferred) · whether to invoke skill (Stop-hook/explicit decides) · whether duplicate (LLM judges) · frontmatter parsing (deterministic) · next id allocation (deterministic via KnowledgeIdAllocator).

`Read ref/askuserquestion-policy.md` for full DO/DO NOT lists + bilingual per-item question phrasing templates (pending action / layer-flip target).

## Decision Tree — Is This Entry Approvable?

```
Pending entry presented for review
  ├─ Has clear stable scope (not too narrow / not one-off)?
  │    ├─ NO  → reject (reason: "too narrow / not generalizable")
  │    └─ YES ↓
  ├─ Duplicates an existing canonical entry (semantic check flagged)?
  │    ├─ YES → reject (reason: "duplicate of <stable_id>")  OR  modify-to-merge
  │    └─ NO  ↓
  ├─ Wrong layer (e.g. personal preference shipped as team)?
  │    ├─ YES → modify with changes.layer = correct layer (triggers id flip)
  │    └─ NO  ↓
  └─ Approvable → approve (single via pending_paths=[path], or batch via pending_paths=[…])
```

## Hard Rules — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST infer mode before any user-facing output; NEVER ask the user which mode to use.
- MUST present every pending item with explicit `[type=...]`, `[layer=...]`, and `pending_path=...` fields.
- MUST run semantic check during `pending` mode and surface `⚠` flags for possible duplicates / contradictions.
- MUST display zh-CN body for entry summaries (M3 style consistent with fabric-archive).
- MUST display EN section headings.
- MUST surface BOTH `prior_stable_id` and `new_stable_id` after a layer flip so callers can update caches.
- NEVER show raw `idempotency_key` to the user (internal server-side concern).
- NEVER skip the AskUserQuestion for per-item action — every pending entry MUST receive an explicit user judgment OR a `skip`.

### WRITE Rules

- NEVER write a knowledge file directly via Edit/Write/Bash; the only legal mutation path is `mcp__fabric__fab_review`.
- NEVER call `git mv` from this skill — layer flip and slug rename are server-side transactions.
- NEVER invent an `action` value — `action` MUST be one of {`list`, `approve`, `reject`, `modify`, `search`, `defer`}.
- NEVER batch heterogeneous decisions into a single MCP call. Approve and reject MAY be batched within their own action; modify MUST be one call per entry.
- NEVER invoke `fab_review action="approve"` without at least one `pending_paths` entry.
- NEVER infer a layer-flip target — the user MUST choose via AskUserQuestion.
- MUST preserve protected tokens exactly: `stable_id`, `pending_path`, `layer`, `team`, `personal`, `knowledge_promoted`, `knowledge_layer_changed`, `knowledge_proposed`, `knowledge_scope_degraded`, `fab_review`, `MUST`, `NEVER`, `relevance_scope`, `relevance_paths`, `narrow`, `broad`, `proposed_reason`, `session_context`.

## Output Contract & events.jsonl Constraint (ref-only)

After each invocation, produce a bilingual `# Review Summary` (en) / `# Review 汇总` (zh-CN) roll-up: listed/approved/rejected/modified/deferred/skipped counts + new stable_ids + tail of `.fabric/events.jsonl` events (`knowledge_promote_started`, `knowledge_promoted`, `knowledge_layer_changed`, `knowledge_rejected`, `knowledge_deferred`). Also surface `git status` of `.fabric/knowledge/` so file moves are visible.

events.jsonl appends MUST stay single-line + ≤4KB (POSIX `PIPE_BUF` atomicity).

`Read ref/output-contract.md` for full bilingual rollup templates + per-field self-truncate caps (`session_context` 500 chars; `source_sessions` 5 entries; `recent_paths` 20 entries; `user_messages_summary` 500 chars).

## Worked Examples (ref-only)

Four worked examples (pending-mode dedupe / revisit layer-flip / health mode / narrowing imported entries) live in `ref/worked-examples.md`. Load when you want to see how Mode + AskUserQuestion + MCP-call shape composes on real candidate sets.

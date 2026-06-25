---
name: fabric-review
description: 审 store-backed pending+canonical knowledge (NOT PR review):pending triage + maintain(含 retire 语义淘汰 + relate 关联建边)。Triggers 审批/review pending;淘汰陈旧/deprecate;连接知识/补 related 边.
allowed-tools: Read, Glob, Grep, Bash, Edit, mcp__fabric__fab_recall, mcp__fabric__fab_pending, mcp__fabric__fab_review
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

Required preconditions before any `fab_review` / `fab_pending` call: `.fabric/` exists; `mcp__fabric__fab_review` (write) + `mcp__fabric__fab_pending` (read) MCP tools registered; a write store is resolved for mutations; `.fabric/events.jsonl` exists (tolerate ENOENT — empty ledger normal first-run).

### Config Load

Read `.fabric/fabric-config.json`; resolve:

| Config field | Default | Used by |
|---|---|---|
| `review_topic_result_cap` | 8 | topic mode top-N cap |
| `review_stale_pending_days` | 14 | health mode stale threshold (days) |
| `review_hint_pending_count` | 10 | precondition overflow signal (count) |
| `review_hint_pending_age_days` | 7 | precondition overflow signal (age) |

Missing or unreadable → defaults silently.

### Store routing (v2.1 multi-store)

Review iterates **per-store** — the read-set may span multiple stores (`fabric info scope team` → resolved `readSet.stores`). Pending/backlog is reported per-store (NOT aggregated into one undifferentiated pile); each candidate's provenance store is surfaced in cites as `KB: <store-alias>:<id>`. Promotion (draft → verified/proven) is a normal edit + git commit **inside that store's own repo** — no cross-store move. A `dismissed`/`modify` that flips layer between team and personal still goes through `AskUserQuestion`. Never read `~/.fabric` store trees directly; go through the MCP recall path / `fabric info scope`.

`Read ref/cite-contract.md` (v2.2 SK5) for the authoritative cite-contract reference — operator syntax, skip/dismissed reason dictionaries, type routing, audit semantics, backward-compat, and the adjudication ladder (AI-self → multi-LLM cold-eval → non-blocking queue) — sunk out of the bootstrap so cite/governance depth lives here, not in `.fabric/AGENTS.md`.

### UX i18n Policy

Read `fabric_language` (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`); emit user-facing prose in resolved variant. Protected tokens (`fab_review`, `fab_pending`, `fab_propose`, `relevance_scope`, layer/scope enums, `stable_id`, the verbatim `强 team` / `强 personal` / `默认 team` block) NEVER translated. `AskUserQuestion` policy: `header` + `question` translate; `options[]` stay English (routing keys).

`Read ref/i18n-policy.md` for the full 5-class taxonomy + edge cases.

## Mode Inference (System Infers — NEVER Ask)

> Locked decision (KT-DEC-0006): "Review mode inferred from context, not solicited via AskUserQuestion."
> "**AskUserQuestion 仅在真有选择时用**——'何种 mode' 不是真选择（系统能推断），'approve/reject/modify 单条' 是真选择"

The skill MUST infer one of **2 modes** BEFORE any user-facing output (v2.0.0-rc.37 NEW-12 simplified 4 → 2):

- **`pending`** — triage the write-side backlog returned by `fab_pending action="list"` (`pending_path` identifies each store-backed entry): approve / reject / modify / defer per item via `fab_review`. The dominant entry point.
- **`maintain`** — sustain the EXISTING canonical KB: browse by topic (search), survey staleness/health, or revisit a specific entry. Merges the legacy `topic` + `health` + `revisit` modes — they are all "operate on already-canonical knowledge", distinct from triaging new drafts.

### 2-Step Inference Algorithm

**Step 1 — Recent user message keyword scan:**

| Keywords (zh-CN + en) | Inferred mode |
|---|---|
| "approve", "review pending", "promote", "what's queued", "审核 pending", "通过" | `pending` |
| "search/find about <topic>", "what's stale", "demote old", "health check", "look at <id>", "revisit KT-…", "关于…的知识", "过期的", "陈旧的", "整理一下", "再看下 <id>", "回顾" | `maintain` (browse/health/revisit) |
| "审计知识库", "清理陈旧知识", "知识库瘦身", "淘汰旧决策", "deprecate", "prune stale", "这些旧决策还要吗" | `maintain` → **retire** sub-flow |
| "连接知识", "找相关条目", "补 related 边", "知识库连通性", "link related", "建知识图谱" | `maintain` → **relate** sub-flow |

A `maintain`-row match → lock `maintain`. A `pending`-row match (or 0/ambiguous) → fall to Step 2.

**Step 2 — Backlog default.** Call `fab_pending action="list"` and inspect returned `items[].pending_path`:

- Count ≥ `review_hint_pending_count` (default 10) OR oldest mtime > `review_hint_pending_age_days` (default 7) → `pending` (overflow, same threshold as Stop-hook).
- Otherwise → default `pending` (most common review entry point).

> Back-compat: the legacy 4-mode names (`topic` / `health` / `revisit`) still resolve — they all map to `maintain`. Old session traces / muscle memory keep working.

`Read ref/per-mode-flows.md` for inference examples and anti-pattern restatement.

## Per-Mode Flow

Each mode produces user-facing output, then routes per-item or per-batch decisions through `fab_review` actions. Display body = zh-CN summaries (M3 style); section headings = EN.

- **`pending`** — list pending entries → run Semantic Check (see `ref/semantic-check.md`) → per-item AskUserQuestion `{approve, reject, modify, defer, skip}` → route per choice. The modify branch chooses between two explicit actions (rc.37 NEW-12):
  - `fab_review action="modify-content"` — edit scalars (title/summary/maturity/tags/relevance_*); NEVER flips layer.
  - `fab_review action="modify-layer"` — the dedicated layer-flip path (`changes.layer` required); may reallocate the stable_id + emit an id-redirect.
  - (Legacy `action="modify"` still works — it routes by whether `changes.layer` is present.) See `ref/modify-flow.md`.
- **`maintain`** — sub-flow inferred from the same keywords:
  - *browse-by-topic*: extract keywords → `fab_pending action="search"` → render top-N (cap `review_topic_result_cap`) → AskUserQuestion only on an action verb.
  - *health/staleness*: `fab_pending action="list"` + tail events → compute stale → render dashboard → per-stale AskUserQuestion `{defer, demote, skip}`.
  - *revisit*: user referenced a specific id/slug → `Read` canonical file directly OR `fab_pending action="list"` with narrow filters → display body + history → AskUserQuestion only if actionable.
  - *retire* (W3-C, 吸收原 fabric-audit): 语义淘汰陈旧/孤儿/被取代的 **canonical** 条目。引擎 `fabric doctor`(给 orphan/stale/health 信号);守两条红线 **deprecate-over-delete**(陈旧≠该删,降 maturity / 标 `superseded-by` 保留 rationale)+ **rescue-before-delete**(删前必做独特-rationale 抢救检查)。逐条判三态 still-valid / superseded(deprecate)/ never-valid(rescue 后删空壳),处置经 `fab_review` 写路径落盘。**完整两条红线定义 / 意图→动作映射 / 三态流程 / scope 纠偏 → `Read ref/retire-mode.md`。**
  - *relate* (W3-C, 吸收原 fabric-connect): **默认不主动建边**,仅用户显式「连一下 / 补 related」时进入。`fab_recall` 拿候选 + 现有 `related` → 按互补/规避/取代/同域/引用链判**高置信**隐藏关联(稀疏优于稠密)→ 落盘**复用 `fab_review` modify 写路径**(零新写面,追加源条目 `related` 数组)。§4 隐私铁律 `KT→KP` FORBIDDEN。**关联类型判据表 / 流程 / 约束 → `Read ref/relate-mode.md`。**

`Read ref/per-mode-flows.md` for full step-by-step procedures, bilingual rendering blocks (en + zh-CN per-item display, AskUserQuestion templates, health dashboard format), and the rc.7 T6 `proposed_reason` + `## Why proposed` + `## Session context` rendering contract.

## Semantic Check (LLM-Assisted Duplicate / Contradiction Detection)

> Boundary B (locked): "extraction / classification / layer / slug / mode / **semantic dedup** → Skill (LLM); file write / frontmatter / idempotency / counter / layer-flip / atomic promote → MCP (deterministic)"

Semantic check is the LLM's job — the MCP tool does NOT compare meaning. Run during `pending` mode (and on demand during `topic`): for each pending entry, `fab_pending action="search"` scoped by `filters.type` → LLM judges semantically against returned canonical entries → surface one of three flags as informational:

- `⚠ Possible duplicate of <stable_id> (overlap: high)` — same essential claim
- `⚠ Contradicts <stable_id> (overlap: high)` — opposing claims, same scope
- `⚠ Subsumed by <stable_id> (overlap: medium+); consider modify-to-merge` — fully covered

**Quantified overlap band (rc.37 NEW-12).** The LLM still judges meaning (no embedding %), but MUST tag each flag with a 3-level band so the signal is comparable across entries and the user can triage at a glance:

- `high` — ≥ ~80% of the candidate's essential claim is restated; near-certain dup/contradiction. Recommend reject-as-duplicate or modify-to-merge.
- `medium` — substantial conceptual overlap but the new entry adds a distinct facet (different path scope, added caveat). Recommend modify-to-harmonize.
- `low` — adjacent topic, not a real overlap. Do NOT raise a flag at `low` — it is below the surfacing threshold (suppresses noise).

Only `medium`+ flags are surfaced. User decides: still-approve (flag informational), modify-to-harmonize, or reject-as-duplicate (reason MUST cite existing stable_id).

DO NOT AskUserQuestion "is this a duplicate?" — LLM already judged. User only chooses approve/reject/modify.

`Read ref/semantic-check.md` for full procedure + 三类判断的细化定义.

## Summary Self-Sufficiency Gate (guideline / model only — KT-GLD-0006)

Guideline/model entries surface in the SessionStart **ALWAYS-ACTIVE** sink as a body-less INDEX line, so an opaque summary (`Code style guidelines`) leaks in as an unactionable "rule". Before approving/promoting a **guideline or model** (only these two types — decision/pitfall/process surface as `must_read_if` triggers and are exempt), run the summary through the **zero-context cold-eval judge**, never your own judgment:

- The reviewing agent self-judging sufficiency is curse-of-knowledge — it back-fills from context it already has and rubber-stamps pointers (KT-GLD-0006). The withheld-body cold eval is the whole point.
- Build the batch with `summary-cold-eval.ts#buildColdEvalBatch` (rubric = `COLD_EVAL_RUBRIC`, candidates = the guideline/model summaries) and hand it to an **offline** judge via `maestro delegate` (zero-context, batched — NOT on the hot path). The judge returns `ColdEvalVerdict[]`.
- For each `self_sufficient=false` verdict: surface `⚠ Summary not act-on-able (cold-eval); suggested: <suggested_summary>` and route to `modify-content` (summary rewrite, stable_id preserved) — do NOT approve as-is. `self_sufficient=true` → no action.
- This is a nudge, not a hard block (KT-DEC-0007): the user may still approve over a failed verdict, but the flag must be shown.

## Narrowing Imported Entries & Modify Sub-Flow

`modify` is the only action that mutates frontmatter or stable_id. Two paths:

- **Title/summary/tags/maturity** → in-place rewrite; stable_id PRESERVED.
- **Layer change** → ONLY legal stable_id mutation. BEFORE call, AskUserQuestion `{team, personal}` to confirm target (this IS genuine choice). AFTER server returns, surface BOTH `prior_stable_id` and `new_stable_id` in roll-up — downstream agents may cache the prior id.

**Source-mode entries** (`source_sessions[0]` starts with `fabric-archive-source-`) ship with `relevance_scope=broad + relevance_paths=[]` by design; narrowing is fabric-review's responsibility. Render `⚠ Imported (relevance_scope=broad, relevance_paths=[]) — pick 'modify' + say 'narrow to <paths>'` as informational hint. On `modify` of import-origin: extended option list `{narrow scope, edit summary, change layer, change maturity, skip}`; "narrow scope" → free-text follow-up → `changes: { relevance_scope: "narrow", relevance_paths: [<parsed>] }`. Personal layer auto-degrades narrow → broad+[] (server-side), emitting `knowledge_scope_degraded`.

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
- NEVER invent an `action` value — `fab_review action` MUST be one of {`approve`, `reject`, `modify`, `modify-content`, `modify-layer`, `defer`} (write-only); read actions {`list`, `search`} go through the read-only `fab_pending` tool.
- NEVER batch heterogeneous decisions into a single MCP call. Approve and reject MAY be batched within their own action; modify MUST be one call per entry.
- NEVER invoke `fab_review action="approve"` without at least one `pending_paths` entry.
- NEVER infer a layer-flip target — the user MUST choose via AskUserQuestion.
- MUST preserve protected tokens exactly: `stable_id`, `pending_path`, `layer`, `team`, `personal`, `knowledge_promoted`, `knowledge_layer_changed`, `knowledge_proposed`, `knowledge_scope_degraded`, `fab_review`, `fab_pending`, `MUST`, `NEVER`, `relevance_scope`, `relevance_paths`, `narrow`, `broad`, `proposed_reason`, `session_context`.

## Output Contract & events.jsonl Constraint (ref-only)

After each invocation, produce a bilingual `# Review Summary` (en) / `# Review 汇总` (zh-CN) roll-up: listed/approved/rejected/modified/deferred/skipped counts + new stable_ids + tail of `.fabric/events.jsonl` events (`knowledge_promote_started`, `knowledge_promoted`, `knowledge_layer_changed`, `knowledge_rejected`, `knowledge_deferred`). Also surface the target store alias/UUID for any mutation so file moves are attributable to the right store repo.

events.jsonl appends MUST stay single-line + ≤4KB (POSIX `PIPE_BUF` atomicity).

`Read ref/output-contract.md` for full bilingual rollup templates + per-field self-truncate caps (`session_context` 500 chars; `source_sessions` 5 entries; `recent_paths` 20 entries; `user_messages_summary` 500 chars).

## Worked Examples (ref-only)

Four worked examples (pending-mode dedupe / revisit layer-flip / health mode / narrowing imported entries) live in `ref/worked-examples.md`. Load when you want to see how Mode + AskUserQuestion + MCP-call shape composes on real candidate sets.

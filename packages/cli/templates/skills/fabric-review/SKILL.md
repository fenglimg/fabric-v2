---
name: fabric-review
description: Use this skill to review pending knowledge entries in `.fabric/knowledge/pending/` — list, approve (late-bind id allocation), reject, modify (incl. layer flip), search, defer. Mode is inferred from invocation context (recent user message + events.jsonl tail + pending count) — NEVER asked. Per-item actions (approve / reject / modify / defer) are surfaced via AskUserQuestion because they are genuine human-judgment choices.
allowed-tools: Read, Glob, Grep, Bash, Edit, mcp__fabric__fab_review
---

## Precondition

This skill is invoked when one of the following holds:

- The Stop-hook printed a stdout JSON pointer of shape `{"decision":"block","reason":"..."}` carrying a `signal=review` (pending overflow: ≥10 entries or oldest pending age ≥7 days)
- The user typed an explicit review request (e.g. "review knowledge", "show pending", "approve what's queued", "what's stale", "look at KT-D-7")
- A task end where the agent itself判定 review backlog has crossed the overflow threshold

If none of the above hold, stop the skill immediately and tell the user `没有触发 review 信号；如需手动 review 请显式调用 fabric-review`.

This skill is `Infer-not-Ask` for mode and `Ask-when-genuine` for per-item actions:

- Mode (pending / topic / health / revisit) is INFERRED from context — NEVER surfaced via AskUserQuestion
- Per-item action (approve / reject / modify / defer) IS surfaced via AskUserQuestion — the user must judge
- Layer-flip target (team vs personal) IS surfaced via AskUserQuestion when modify path includes layer change

Required preconditions before any fab_review call:

- `.fabric/` directory exists in the project (or `~/.fabric/` for personal layer)
- `mcp__fabric__fab_review` MCP tool is registered and reachable
- `.fabric/agents.meta.json` is present (the id allocator reads it on approve)
- `.fabric/events.jsonl` exists (tolerate ENOENT — empty ledger is normal first-run)

## Mode Inference (System Infers — NEVER Ask)

> Verbatim from rc.3 locked decisions:
> "review 永远走 fabric-review skill，**模式从上下文推断**（4 种 mode：pending queue / by topic / health overview / revisit existing）"
> "**AskUserQuestion 仅在真有选择时用**——'何种 mode' 不是真选择（系统能推断），'approve/reject/modify 单条' 是真选择"

The skill MUST infer one of {`pending`, `topic`, `health`, `revisit`} before any user-facing output. NEVER call `AskUserQuestion` to ask the user which mode to use — the system MUST infer.

### 3-Step Inference Algorithm

**Step 1 — Recent user message keyword scan.** Read the user's most recent invocation message (or the Stop-hook reason text). Match against keyword sets in this priority order:

| Keywords (zh-CN + en) | Inferred mode |
|---|---|
| "approve", "review pending", "promote", "what's queued", "审核 pending", "通过" | `pending` |
| "search for X about Y", "find entries about <topic>", "关于…的知识", "找一下 <topic>" | `topic` |
| "what's stale", "demote old", "health check", "过期的", "陈旧的", "整理一下" | `health` |
| "look at <id>", "revisit KT-…", "show <slug>", "再看下 <id>", "回顾" | `revisit` |

If exactly one row matches, lock that mode and skip to Step 3.

**Step 2 — events.jsonl tail scan.** If Step 1 yielded zero or multiple matches, read the tail (last 200 lines) of `.fabric/events.jsonl`:

- Count `knowledge_proposed` events since the last `knowledge_promoted` event. If `>5` recent proposals → infer `pending` (write side has piled up; review is overdue).
- Count `knowledge_demoted` or `lint`-class events in the last 24h. If `≥1` → infer `health` (corpus quality signal already firing).
- If a recent `knowledge_layer_changed` event exists for the entry the user just referenced → infer `revisit`.

**Step 3 — Pending count default.** If Step 1 and Step 2 both produced no signal, glob `.fabric/knowledge/pending/**/*.md`:

- If pending count `≥10` OR oldest pending file mtime is `>7 days` ago → infer `pending` (overflow signal — same threshold the Stop-hook uses).
- Otherwise → default to `pending` (most common review entry point).

### Inference Examples (Sample User Messages → Expected Mode)

- "review the pending knowledge" → `pending` (Step 1 keyword "review pending")
- "find anything about deepMerge" → `topic` (Step 1 keyword "find … about")
- "anything stale in our knowledge base?" → `health` (Step 1 keyword "stale")
- "look at KT-D-7" → `revisit` (Step 1 keyword "look at <id>")
- (Stop-hook fired with signal=review, no user typing) → `pending` (Step 3 default, overflow threshold tripped)

### Anti-Pattern (Hard Rule)

NEVER emit an `AskUserQuestion` whose options include {pending, topic, health, revisit}. The user does not pick the mode. If inference is genuinely ambiguous after all 3 steps, default to `pending` and proceed; the user can always cancel and redirect.

## Per-Mode Flow

Each mode produces user-facing output, then routes per-item or per-batch decisions through `fab_review` actions. Display body = zh-CN summaries (M3 style); section headings = EN.

### Mode: pending — Approve / Reject / Modify Backlog

1. Call `fab_review` with `action: "list"`, no filters (or `filters.layer="both"` if user explicitly mentioned both layers).
2. Server returns `items[]` (each = `{pending_path, type, layer, maturity, tags?, title?, summary?}`).
3. Before presenting, perform **Semantic Check** (see below) by issuing one or more `action: "search"` calls scoped by `filters.type` to surface possible duplicates / contradictions among already-canonical entries.
4. For each pending item, render a per-item block. v2.0.0-rc.7 T6: render
   `proposed_reason` (frontmatter) + `## Why proposed` line (body, 1-line enum
   explanation) + first line of `## Session context` so future-self has full
   context without re-reading the transcript:

   ```md
   ## [type=decisions] [layer=team] pending_path=knowledge/pending/decisions/single-cjs-hook.md
   Title: 单 .cjs hook 跨客户端
   Summary: 三客户端 stdout JSON 格式一致，单脚本即可。
   Maturity: draft   Tags: [hook, cli]
   Proposed reason: decision-confirmation — ≥2 候选方案经权衡后确认选型。
   Session context: Session goal: ship Stop-hook for v2 release.
   ⚠ Possible duplicate of KT-D-0007 (similarity 0.78 on title + summary)
   ```

   The Skill MUST read `proposed_reason` from the pending file's frontmatter
   (parse the YAML block, key `proposed_reason`) and the `## Why proposed`
   line / first non-blank line of `## Session context` from the body. If
   either is missing on a pre-rc.7 pending entry, render `Proposed reason:
   <legacy entry, no reason recorded>` and `Session context: <not recorded>`
   so the reviewer can still proceed.

5. Surface a per-item AskUserQuestion:

   ```ts
   AskUserQuestion({
     header: "Review pending entry",
     question: "What action for '单 .cjs hook 跨客户端'?",
     options: ["approve", "reject", "modify", "defer", "skip"]
   })
   ```

6. Route the user's choice:
   - `approve` → accumulate pending_path into a batch; flush via single `fab_review action="approve"` with `pending_paths=[…]` after the loop ends.
   - `reject` → ask the user for a one-line reason via free-text follow-up; call `fab_review action="reject"` with `pending_paths=[path]` and `reason`.
   - `modify` → see Modify Sub-Flow below.
   - `defer` → call `fab_review action="defer"` with `pending_paths=[path]`; optional `until` ISO datetime if the user supplies one ("defer 2 weeks" → compute and set).
   - `skip` → no MCP call; move to next item.
7. After the loop, display a roll-up: counts by action, list of newly-allocated `stable_id`s (from approve output), and tail of `.fabric/events.jsonl` showing the appended events.

### Mode: topic — Search & Surface Findings

1. Extract the topic keyword(s) from the user's message (e.g. "find about deepMerge" → query="deepMerge").
2. Call `fab_review action="search"` with `query` and any obvious filters (if user said "team-only" → `filters.layer="team"`).
3. Server returns `items[]` ranked by relevance — these are entries already in `.fabric/knowledge/{layer}/{type}/` (NOT pending), unless `filters` says otherwise.
4. Render top-N (cap at 8) results with title / summary / pending_path.
5. If the user follow-up indicates intent to act ("approve all", "modify the second one"), pivot into the corresponding pending mode action — the search result already gives the `pending_path` needed for the action.
6. NEVER surface a per-item AskUserQuestion just for browsing — only when the user signals an action verb.

### Mode: health — Corpus Health & Stale Detection

1. Call `fab_review action="list"` with `filters.maturity="draft"` (or no filter for full corpus inspection).
2. Tail `.fabric/events.jsonl` for layer_changed / demoted / rejected counts in the trailing 30 days.
3. Compute stale candidates: pending entries with mtime `>14 days` OR maturity=draft entries with no recent evidence-append events.
4. Render a corpus dashboard:

   ```md
   ## Health Overview
   - Pending: 12 entries (oldest 18d) — recommend `defer` or `reject`
   - Drafts: 8 (3 are stale candidates: KP-G-3, KP-G-5, KT-P-9)
   - Layer flips (30d): 2
   - Rejections (30d): 1
   ```

5. For each stale candidate, surface AskUserQuestion `{options: ["defer", "demote", "skip"]}`; route `defer` → `fab_review action="defer"`, `demote` → `fab_review action="modify"` with `changes.maturity` lowered (or `reject` if the user wants outright removal of a pending entry).

### Mode: revisit — Specific Entry Deep Dive

1. The user referenced a specific entry (by id `KT-D-7` or by slug `single-cjs-hook`).
2. Call `fab_review action="list"` with `filters` narrowed by best-guess fields; if the entry is canonical (has stable_id), `Read` the file directly at `.fabric/knowledge/{layer}/{type}/<id>--<slug>.md`.
3. Display the full body (frontmatter + content). Tail the events.jsonl for any history events tagged with this stable_id.
4. Surface AskUserQuestion `{options: ["approve", "modify", "reject", "skip"]}` only if the entry is still pending; for canonical entries the only mutation path is `modify` (incl. layer flip).

## Semantic Check Guidance (LLM-Assisted Duplicate / Contradiction Detection)

> Boundary B (locked): "extraction classification / layer inference / slug naming / mode inference / **semantic dedup** → Skill (LLM); pending file write / frontmatter assembly / idempotency check / counter mgmt / layer-flip transaction / atomic promote → MCP (deterministic)"

Semantic check is the LLM's job — the MCP tool does NOT compare meaning. Run this check during `pending` mode (and on demand during `topic` mode):

For each pending entry to be presented:

1. Call `fab_review action="search"` with `query=<title or summary keywords>` and `filters.type=<same type>` to fetch already-canonical entries of the same type.
2. Compare semantically (LLM judgment, not string match):
   - **Duplicate** — same essential claim. Heuristics: title keyword overlap >60%, summary asserts the same outcome with no novel context. Flag: `⚠ Possible duplicate of <stable_id>`.
   - **Contradiction** — opposing claims about the same subject. Heuristics: one entry says "use X" while pending says "avoid X" on identical scope. Flag: `⚠ Contradicts <stable_id>`.
   - **Subsumption** — pending fully covered by an existing entry plus extras. Flag: `⚠ Subsumed by <stable_id>; consider modify-to-merge`.
3. Surface the flag in the per-item display block (see pending mode step 4).
4. The user decides:
   - Still approve → flag is informational; pending becomes canonical alongside the existing entry.
   - Modify-to-harmonize → user supplies edits via `modify` action; consider merging language with the existing entry.
   - Reject as duplicate → reason field MUST cite the existing stable_id (e.g. `reason="duplicate of KT-D-7"`).

DO NOT call `AskUserQuestion` to ask "is this a duplicate?" — the LLM has already judged. The user only chooses among approve / reject / modify, which is a genuine choice.

## Modify Sub-Flow & Layer-Flip Rules

`modify` is the only action that mutates frontmatter or stable_id. It accepts `changes` of shape `{title?, summary?, layer?, maturity?, tags?}`. Server semantics:

- **title / summary / tags / maturity changes** → in-place rewrite; stable_id PRESERVED; emits `knowledge_slug_renamed` only when slug derives from title.
- **layer change** → the ONLY legal stable_id mutation in the system.

### Layer-Flip Rules (the only legal stable_id mutation)

Triggered when `changes.layer` differs from current entry layer. Server-side transaction:

1. Allocate new id under target layer via `KnowledgeIdAllocator.allocate(new_layer, type)` (e.g. KT-D-7 in `team/decisions/` flips to KP-D-3 in `personal/decisions/`).
2. `git mv <old-layer>/<type>/<old-id>--<slug>.md <new-layer>/<type>/<new-id>--<slug>.md`.
3. Append `knowledge_layer_changed` event with `{from_layer, to_layer, prior_stable_id, new_stable_id}`.
4. Server response includes `prior_stable_id` and `new_stable_id` — surface BOTH to the user in the roll-up.

Skill responsibilities for layer flip:

- BEFORE calling fab_review, surface `AskUserQuestion {options: ["team", "personal"]}` to confirm target layer. The default in the question header should reflect the verbatim layer heuristic (default team unless 强 personal signals dominate). This IS a genuine choice — the user must pick.
- AFTER server returns, render: `Layer flipped: <prior_stable_id> → <new_stable_id>`. Do NOT silently swallow the id change — downstream agents may have cached the prior id.

### Modify Examples

```ts
// Maturity bump only (no id change)
mcp__fabric__fab_review({
  action: "modify",
  pending_path: "knowledge/team/decisions/KT-D-0007--single-cjs-hook.md",
  changes: { maturity: "verified" }
})

// Layer flip team → personal (id WILL change)
mcp__fabric__fab_review({
  action: "modify",
  pending_path: "knowledge/team/guidelines/KT-G-0003--indent-style.md",
  changes: { layer: "personal" }
})
```

## AskUserQuestion Policy

### DO ask (genuine choices that require human judgment)

- Per-pending-item action: `["approve", "reject", "modify", "defer", "skip"]`
- Per-stale-item action (health mode): `["defer", "demote", "skip"]`
- Layer-flip target when modify path includes layer change: `["team", "personal"]`
- Reject reason follow-up (free-text, may use AskUserQuestion's free-form variant if available, otherwise plain prompt)

### DO NOT ask (system must infer or operate deterministically)

- Mode picking (pending / topic / health / revisit) — INFERRED per the 3-step algorithm
- Whether to invoke this skill at all — Stop-hook signal or explicit user request decides
- Whether an entry is a duplicate — LLM semantic check answers
- Frontmatter parsing — deterministic, never asked
- Allocate next id — deterministic via KnowledgeIdAllocator, never asked

### Per-Item Question Phrasing Template

```ts
AskUserQuestion({
  header: "Review pending entry",
  question: "What action for '{title}'?  ({pending_path})",
  options: ["approve", "reject", "modify", "defer", "skip"]
})
```

For layer-flip target:

```ts
AskUserQuestion({
  header: "Layer-flip target",
  question: "Move '{title}' to which layer?  (current: {current_layer})",
  options: ["team", "personal"]
})
```

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
- MUST preserve protected tokens exactly: `stable_id`, `pending_path`, `layer`, `team`, `personal`, `knowledge_promoted`, `knowledge_layer_changed`, `knowledge_proposed`, `fab_review`, `MUST`, `NEVER`.

## Output Contract

After each invocation, the skill MUST produce a brief roll-up to the user:

```md
# Review Summary — mode={pending|topic|health|revisit}
- Listed: N entries
- Approved: M (new stable_ids: KT-D-12, KT-G-4, KP-P-2)
- Rejected: R
- Modified: U (incl. K layer flips)
- Deferred: D
- Skipped: S

## Events appended (.fabric/events.jsonl tail)
- knowledge_promote_started ×M
- knowledge_promoted ×M
- knowledge_layer_changed ×K
- knowledge_rejected ×R
- knowledge_deferred ×D
```

Also surface a one-line `git status` of `.fabric/knowledge/` so the user sees the file moves caused by approve / layer-flip.

## Worked Examples

### Example A — pending mode with semantic check flagging a duplicate (user chooses reject)

User: "review the pending knowledge".

Inferred mode: `pending` (Step 1 keyword "review … pending").

Skill flow:

1. `fab_review action="list"` → returns 3 pending items.
2. Semantic check on item 2 (`pending/decisions/single-cjs-hook.md`) — `fab_review action="search"` with `query="single cjs hook"` filter `type=decisions` returns canonical `KT-D-0007--single-cjs-hook-across-clients.md` (similarity high).
3. Display block:

   ```md
   ## [type=decisions] [layer=team] pending_path=knowledge/pending/decisions/single-cjs-hook.md
   Title: 单 .cjs hook 跨客户端
   Summary: 三客户端 stdout JSON 格式一致，单脚本即可。
   ⚠ Possible duplicate of KT-D-0007 (similarity 0.84 on title + summary)
   ```

4. AskUserQuestion fires; user picks `reject`.
5. Free-text follow-up: user types `duplicate of KT-D-7`.
6. `fab_review action="reject"` with `pending_paths=["knowledge/pending/decisions/single-cjs-hook.md"]` and `reason="duplicate of KT-D-7"`.
7. Roll-up reports: 1 rejected, 0 approved, events appended.

### Example B — revisit mode with layer flip (KT → KP)

User: "look at KT-G-3, that's actually personal not team".

Inferred mode: `revisit` (Step 1 keyword "look at <id>").

Skill flow:

1. Read `.fabric/knowledge/team/guidelines/KT-G-0003--indent-style.md`. Display body to user.
2. AskUserQuestion `{options: ["approve", "modify", "reject", "skip"]}` — user picks `modify`.
3. Skill detects user-stated intent "actually personal not team" — surface AskUserQuestion `{options: ["team", "personal"]}` with current layer=team noted; user confirms `personal`.
4. Call:

   ```ts
   mcp__fabric__fab_review({
     action: "modify",
     pending_path: "knowledge/team/guidelines/KT-G-0003--indent-style.md",
     changes: { layer: "personal" }
   })
   ```

5. Server returns `{prior_stable_id: "KT-G-0003", new_stable_id: "KP-G-0001"}`.
6. Roll-up: `Layer flipped: KT-G-0003 → KP-G-0001`. `git status` shows the rename across layer roots.

### Example C — health mode finding stale entries (defer 2, demote 1)

User: "anything stale in our knowledge base?"

Inferred mode: `health` (Step 1 keyword "stale").

Skill flow:

1. `fab_review action="list"` (no filter) + tail events.jsonl for trailing-30d demoted/layer_changed counts.
2. Compute stale candidates: 3 pending entries with mtime >14d (KP-G-5 candidate-pending, KT-P-9 candidate-pending, KP-G-3 canonical draft with no evidence-append in 21d).
3. Render dashboard then loop per stale item.
4. Per-item AskUserQuestion fires:
   - KP-G-5 → user picks `defer` (until="2026-06-01") → `fab_review action="defer"` with `until` set.
   - KT-P-9 → user picks `defer` (no until) → `fab_review action="defer"` with no `until`.
   - KP-G-3 → user picks `demote` → `fab_review action="modify"` with `changes.maturity="draft"` (already draft; equivalently demote means reject if pending — skill chooses correct action by inspecting current state).
5. Roll-up: 2 deferred, 1 modified, events appended (`knowledge_deferred ×2`, `knowledge_promote_started/promoted` not relevant; `knowledge_layer_changed` not relevant).

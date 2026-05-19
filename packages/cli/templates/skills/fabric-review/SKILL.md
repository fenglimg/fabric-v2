---
name: fabric-review
description: Use this skill to review pending knowledge entries in `.fabric/knowledge/pending/` — list, approve (late-bind id allocation), reject, modify (incl. layer flip), search, defer. Mode is inferred from invocation context (recent user message + events.jsonl tail + pending count) — NEVER asked. Per-item actions (approve / reject / modify / defer) are surfaced via AskUserQuestion because they are genuine human-judgment choices.
allowed-tools: Read, Glob, Grep, Bash, Edit, mcp__fabric__fab_review
---

> **Surface**: This is a Skill (AI-driven, per-entry human-judgment routing). See [`docs/surfaces.md`](https://github.com/fenglimg/fabric/blob/main/docs/surfaces.md) for the CLI / Skill / MCP boundary.

## Precondition

This skill is invoked when one of the following holds:

- The Stop-hook printed a stdout JSON pointer of shape `{"decision":"block","reason":"..."}` carrying a `signal=review` (pending overflow: pending count ≥ `review_hint_pending_count` (config-resolved, default 10) OR oldest pending age ≥ `review_hint_pending_age_days` (config-resolved, default 7) days)
- The user typed an explicit review request (e.g. "review knowledge", "show pending", "approve what's queued", "what's stale", "look at KT-D-7")
- A task end where the agent itself判定 review backlog has crossed the overflow threshold

If none of the above hold, stop the skill immediately and tell the user (UX i18n Policy class 2 — errors/preconditions):

- zh-CN: `没有触发 review 信号；如需手动 review 请显式调用 fabric-review`
- en: `No review signal detected; to manually review, explicitly invoke fabric-review`

(Render per `fabric_language` resolved in Config Load below.)

This skill is `Infer-not-Ask` for mode and `Ask-when-genuine` for per-item actions:

- Mode (pending / topic / health / revisit) is INFERRED from context — NEVER surfaced via AskUserQuestion
- Per-item action (approve / reject / modify / defer) IS surfaced via AskUserQuestion — the user must judge
- Layer-flip target (team vs personal) IS surfaced via AskUserQuestion when modify path includes layer change

Required preconditions before any fab_review call:

- `.fabric/` directory exists in the project (or `~/.fabric/` for personal layer)
- `mcp__fabric__fab_review` MCP tool is registered and reachable
- `.fabric/agents.meta.json` is present (the id allocator reads it on approve)
- `.fabric/events.jsonl` exists (tolerate ENOENT — empty ledger is normal first-run)

### Config Load

Before any mode inference work, the skill MUST read
`.fabric/fabric-config.json` to resolve the following tunables (with documented
defaults if absent):

| Config field | Default | Used by |
|---|---|---|
| `review_topic_result_cap` | 8 | topic mode top-N rendering cap |
| `review_stale_pending_days` | 14 | health mode stale-pending detection threshold (days) |
| `review_hint_pending_count` | 10 | precondition overflow signal (pending-count branch) |
| `review_hint_pending_age_days` | 7 | precondition overflow signal (oldest-pending-age branch) |

If `.fabric/fabric-config.json` is missing or unreadable, use defaults silently.

### UX i18n Policy (5-class bilingualization)

The skill consults `fabric_language` from `.fabric/fabric-config.json`
(固化于 init 时，via `lib/detect-language.ts:detectExistingLanguage`; default `"en"` when no
CJK signal is detected in README + docs/; may resolve to `"match-existing"`,
`"zh-CN"`, `"en"`, or `"zh-CN-hybrid"`). All user-facing text in the
following 5 categories MUST be rendered in the resolved language:

1. **Roll-up templates** — the `# Review Summary — mode={...}` final block,
   the `## Health Overview` dashboard in health mode, and any per-item
   display blocks (`## [type=...] [layer=...] pending_path=...` lines).
   zh-CN ↔ en mirror.
2. **Errors / Preconditions warnings** — abort + trigger-miss messages
   (e.g. "没有触发 review 信号…" / "No review signal detected…").
   zh-CN ↔ en mirror.
3. **Confirmation prompts** — free-text reject-reason follow-up, the
   "Type relevance_paths (comma-separated globs, …)" narrow-scope
   follow-up, and any other free-text prompts. zh-CN ↔ en mirror.
4. **Dry-run table headers** — fabric-review does not currently expose
   a dry-run mode; this slot is reserved for parity with fabric-import.
   IF a future revision adds dry-run, the table header MUST be
   bilingualized per this policy. zh-CN ↔ en mirror.
5. **AskUserQuestion** — `header` + `question` fields (NOT `options[]`).
   zh-CN ↔ en mirror. fabric-review is the heaviest AskUserQuestion
   consumer (per-item action, layer-flip target, stale-item action,
   modify-extended option set), so this class applies broadly.

Rendering rule:

- `fabric_language === "zh-CN"` → emit the zh-CN variant; pure monolingual, no language mixing inside a single user-facing block.
- `fabric_language === "en"` → emit the en variant; pure monolingual, no language mixing inside a single user-facing block.
- `fabric_language === "zh-CN-hybrid"` → emit Chinese narrative prose with English technical terms preserved. Protected tokens (always EN): MCP tool names (e.g. `fab_get_knowledge_sections`), CLI command names (e.g. `fab install`), file paths, technical concepts (`Skill`, `SessionStart`, `hook`, `MCP`, `revision_hash`, `pending`, `proven`, `verified`, `draft`).
- `fabric_language === "match-existing"` or any other value → emit the en variant; pure monolingual.

Protected tokens (`fab_review`, `relevance_scope`, `relevance_paths`,
`narrow`, `broad`, `source_sessions`, `proposed_reason`, `session_context`,
`pending_path`, `layer`, `team`, `personal`, `knowledge_scope_degraded`,
`MUST`, `NEVER`, `.fabric/knowledge/`, etc.) are NEVER translated — they
appear verbatim in both language variants. The bilingualization scope is
prose ONLY.

### AskUserQuestion i18n Policy (value vs label)

When this skill issues an `AskUserQuestion`, the `header` and `question`
strings are user-facing prose → translated per `fabric_language`. The
`options[]` array entries are **routing keys** consumed by the skill
state machine — they MUST remain English regardless of `fabric_language`.

Canonical options arrays used by this skill (every value below stays
English in BOTH language variants):

- Per-item action: `["approve", "reject", "modify", "defer", "skip"]`
- Per-stale-item action (health mode): `["defer", "demote", "skip"]`
- Layer-flip target: `["team", "personal"]`
- Modify-extended (import-origin narrow-scope nudge):
  `["narrow scope", "edit summary", "change layer", "change maturity", "skip"]`

Worked example — per-item action (the most common AskUserQuestion in this skill):

```ts
// EN (fabric_language === "en")
AskUserQuestion({
  header: "Review pending entry",
  question: "What action for '{title}'?  ({pending_path})",
  options: ["approve", "reject", "modify", "defer", "skip"]
})

// zh-CN (fabric_language === "zh-CN")
AskUserQuestion({
  header: "审核 pending 条目",
  question: "对 '{title}' 执行什么操作？({pending_path})",
  options: ["approve", "reject", "modify", "defer", "skip"]   // 不翻译 — routing key
})
```

Worked example — layer-flip target:

```ts
// EN
AskUserQuestion({
  header: "Layer-flip target",
  question: "Move '{title}' to which layer?  (current: {current_layer})",
  options: ["team", "personal"]
})

// zh-CN
AskUserQuestion({
  header: "Layer 切换目标",
  question: "将 '{title}' 切换到哪一层？(当前: {current_layer})",
  options: ["team", "personal"]   // 不翻译 — routing key
})
```

Rationale: localizing routing keys would force every routing branch to
dual-string match (e.g. `if (choice === "approve" || choice === "通过")`),
which doubles the surface area for protected-token regressions and breaks
the option-list invariants that downstream tooling (the Skill's own
`switch` statements over `choice`, plus any future MCP-level audit lint
that scans for these specific string literals) depends on. Keeping
`options[]` English-only is contract-locked across all three skills.

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

- If pending count ≥ `review_hint_pending_count` (config-resolved, default 10) OR oldest pending file mtime is older than `review_hint_pending_age_days` (config-resolved, default 7) days → infer `pending` (overflow signal — same threshold the Stop-hook uses).
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
   context without re-reading the transcript. UX i18n Policy class 1 — roll-up
   templates; protected tokens (`pending_path`, `layer`, `team`, `decisions`,
   `proposed_reason`, `Tags`, etc.) appear verbatim in BOTH variants:

   en variant (`fabric_language === "en"`):

   ```md
   ## [type=decisions] [layer=team] pending_path=knowledge/pending/decisions/single-cjs-hook.md
   Title: Single .cjs hook across clients
   Summary: stdout JSON shape is identical across the three clients; one script suffices.
   Maturity: draft   Tags: [hook, cli]
   Proposed reason: decision-confirmation — ≥2 alternatives weighed; rationale stated.
   Session context: Session goal: ship Stop-hook for v2 release.
   ⚠ Possible duplicate of KT-D-0007 (LLM subjective dup/subsumption judgement; thresholds intentionally not quantified)
   ```

   zh-CN variant (`fabric_language === "zh-CN"`):

   ```md
   ## [type=decisions] [layer=team] pending_path=knowledge/pending/decisions/single-cjs-hook.md
   标题: 单 .cjs hook 跨客户端
   摘要: 三客户端 stdout JSON 格式一致，单脚本即可。
   成熟度: draft   Tags: [hook, cli]
   Proposed reason: decision-confirmation — ≥2 候选方案经权衡后确认选型。
   Session context: Session goal: ship Stop-hook for v2 release.
   ⚠ 可能重复 KT-D-0007 (LLM 主观判断 dup/subsumption；具体阈值不可量化)
   ```

   The Skill MUST read `proposed_reason` from the pending file's frontmatter
   (parse the YAML block, key `proposed_reason`) and the `## Why proposed`
   line / first non-blank line of `## Session context` from the body. If
   either is missing on a pre-rc.7 pending entry, render the legacy fallback
   (UX i18n Policy class 1):

   - en: `Proposed reason: <legacy entry, no reason recorded>` and `Session context: <not recorded>`
   - zh-CN: `Proposed reason: <历史条目，未记录 reason>` 与 `Session context: <未记录>`

   …so the reviewer can still proceed.

5. Surface a per-item AskUserQuestion. UX i18n Policy class 5 — `header` +
   `question` translated; `options[]` array remain English routing keys:

   ```ts
   // EN
   AskUserQuestion({
     header: "Review pending entry",
     question: "What action for 'Single .cjs hook across clients'?",
     options: ["approve", "reject", "modify", "defer", "skip"]
   })

   // zh-CN
   AskUserQuestion({
     header: "审核 pending 条目",
     question: "对 '单 .cjs hook 跨客户端' 执行什么操作？",
     options: ["approve", "reject", "modify", "defer", "skip"]   // 不翻译
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
4. Render top-N (cap at `review_topic_result_cap`, config-resolved, default 8) results with title / summary / pending_path.
5. If the user follow-up indicates intent to act ("approve all", "modify the second one"), pivot into the corresponding pending mode action — the search result already gives the `pending_path` needed for the action.
6. NEVER surface a per-item AskUserQuestion just for browsing — only when the user signals an action verb.

### Mode: health — Corpus Health & Stale Detection

1. Call `fab_review action="list"` with `filters.maturity="draft"` (or no filter for full corpus inspection).
2. Tail `.fabric/events.jsonl` for layer_changed / demoted / rejected counts in the trailing 30 days.
3. Compute stale candidates: pending entries with mtime older than `review_stale_pending_days` (config-resolved, default 14) OR maturity=draft entries with no recent evidence-append events.
4. Render a corpus dashboard. UX i18n Policy class 1 — roll-up templates; render per `fabric_language`:

   en variant:

   ```md
   ## Health Overview
   - Pending: 12 entries (oldest 18d) — recommend `defer` or `reject`
   - Drafts: 8 (3 are stale candidates: KP-G-3, KP-G-5, KT-P-9)
   - Layer flips (30d): 2
   - Rejections (30d): 1
   ```

   zh-CN variant:

   ```md
   ## 健康度总览
   - Pending: 12 条 (最旧 18 天) — 建议 `defer` 或 `reject`
   - Drafts: 8 条 (3 条为陈旧候选: KP-G-3, KP-G-5, KT-P-9)
   - Layer 切换 (30 天): 2
   - 已驳回 (30 天): 1
   ```

5. For each stale candidate, surface AskUserQuestion. UX i18n Policy class 5 — `header` + `question` translated; `options[]` remain English routing keys:

   ```ts
   // EN
   AskUserQuestion({
     header: "Stale entry triage",
     question: "Action for stale entry '{title}'?",
     options: ["defer", "demote", "skip"]
   })

   // zh-CN
   AskUserQuestion({
     header: "陈旧条目处理",
     question: "对陈旧条目 '{title}' 执行什么操作？",
     options: ["defer", "demote", "skip"]   // 不翻译
   })
   ```

   Route `defer` → `fab_review action="defer"`, `demote` → `fab_review action="modify"` with `changes.maturity` lowered (or `reject` if the user wants outright removal of a pending entry).

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
2. Compare semantically (LLM judgment, not string match). 三类判断均为 LLM 主观判断 dup/subsumption；具体阈值不可量化（不使用百分比 / 相似度数值伪精度）：
   - **Duplicate** — same essential claim. 标题与摘要表达同一核心结论，pending 未提供新证据或新上下文。Flag: `⚠ Possible duplicate of <stable_id>`.
   - **Contradiction** — opposing claims about the same subject. 例：一个 entry 说 "use X"，pending 说 "avoid X"，且作用域一致。Flag: `⚠ Contradicts <stable_id>`.
   - **Subsumption** — pending fully covered by an existing entry plus extras. Flag: `⚠ Subsumed by <stable_id>; consider modify-to-merge`.
3. Surface the flag in the per-item display block (see pending mode step 4).
4. The user decides:
   - Still approve → flag is informational; pending becomes canonical alongside the existing entry.
   - Modify-to-harmonize → user supplies edits via `modify` action; consider merging language with the existing entry.
   - Reject as duplicate → reason field MUST cite the existing stable_id (e.g. `reason="duplicate of KT-D-7"`).

DO NOT call `AskUserQuestion` to ask "is this a duplicate?" — the LLM has already judged. The user only chooses among approve / reject / modify, which is a genuine choice.

## Narrowing Imported Entries

The fabric-import skill creates pending entries with `relevance_scope=broad` 
+ `relevance_paths=[]` as a deliberate contract — it cannot derive paths from 
git history. **Narrowing imported entries is fabric-review's responsibility.**

### Detection

An entry is "import-origin" when `source_sessions[0]` starts with 
`fabric-import-` (e.g. `fabric-import-2026-05-10`).

### Pending mode rendering

For each import-origin entry, prepend one warning line to the display block. UX i18n Policy class 1 — roll-up templates; the protected tokens `relevance_scope`, `relevance_paths`, `broad` appear verbatim in BOTH variants:

- en: `⚠ Imported (relevance_scope=broad, relevance_paths=[]) — pick 'modify' + say 'narrow to <paths>' to bind scope.`
- zh-CN: `⚠ Imported (relevance_scope=broad, relevance_paths=[]) — 选择 'modify' 并指定 'narrow to <paths>' 以收紧作用域。`

This hint is informational. The user MAY ignore it; broad+[] is a valid 
final state for cross-cutting knowledge.

### Modify follow-up — narrow scope

When the user picks `modify` on an import-origin entry, surface 
AskUserQuestion with an extended option list. UX i18n Policy class 5 — `header` + `question` translated; `options[]` remain English routing keys:

```ts
// EN
AskUserQuestion({
  header: "Modify imported entry",
  question: "What aspect of '{title}' to modify?",
  options: ["narrow scope", "edit summary", "change layer", "change maturity", "skip"]
})

// zh-CN
AskUserQuestion({
  header: "修改 imported 条目",
  question: "要修改 '{title}' 的哪一项？",
  options: ["narrow scope", "edit summary", "change layer", "change maturity", "skip"]   // 不翻译
})
```

When user picks "narrow scope":
1. Free-text follow-up. UX i18n Policy class 3 — confirmation prompts:
   - en: `Type relevance_paths (comma-separated globs, e.g. packages/server/src/retry/**, packages/server/src/lib/retry.ts)`
   - zh-CN: `请输入 relevance_paths (逗号分隔的 glob，例如 packages/server/src/retry/**, packages/server/src/lib/retry.ts)`
2. Call fab_review action="modify" with:
   changes: { relevance_scope: "narrow", relevance_paths: [<parsed paths>] }
3. Display the resolved frontmatter to confirm.

### Special cases

- Layer=personal entries: server auto-degrades narrow → broad+[]; surface 
  the `knowledge_scope_degraded` event back to the user.
- Non-import-origin entries: modify can still narrow (just doesn't show 
  this UX nudge — user types it as a normal modify).

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

UX i18n Policy class 5 — `header` + `question` translated per `fabric_language`; `options[]` arrays remain English routing keys in BOTH variants. Choose the variant matching the resolved language; the structure (field names, options) is identical.

en variant:

```ts
AskUserQuestion({
  header: "Review pending entry",
  question: "What action for '{title}'?  ({pending_path})",
  options: ["approve", "reject", "modify", "defer", "skip"]
})
```

zh-CN variant:

```ts
AskUserQuestion({
  header: "审核 pending 条目",
  question: "对 '{title}' 执行什么操作？({pending_path})",
  options: ["approve", "reject", "modify", "defer", "skip"]   // 不翻译 — routing key
})
```

For layer-flip target.

en variant:

```ts
AskUserQuestion({
  header: "Layer-flip target",
  question: "Move '{title}' to which layer?  (current: {current_layer})",
  options: ["team", "personal"]
})
```

zh-CN variant:

```ts
AskUserQuestion({
  header: "Layer 切换目标",
  question: "将 '{title}' 切换到哪一层？(当前: {current_layer})",
  options: ["team", "personal"]   // 不翻译 — routing key
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
- MUST preserve protected tokens exactly: `stable_id`, `pending_path`, `layer`, `team`, `personal`, `knowledge_promoted`, `knowledge_layer_changed`, `knowledge_proposed`, `knowledge_scope_degraded`, `fab_review`, `MUST`, `NEVER`, `relevance_scope`, `relevance_paths`, `narrow`, `broad`, `proposed_reason`, `session_context`.

## Output Contract

After each invocation, the skill MUST produce a brief roll-up to the user. UX i18n Policy class 1 — roll-up templates; render per `fabric_language`. Protected tokens (event-type strings such as `knowledge_promoted` / `knowledge_layer_changed` / `knowledge_rejected` / `knowledge_deferred`, plus `.fabric/events.jsonl`) appear verbatim in BOTH variants:

en variant (`fabric_language === "en"`):

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

zh-CN variant (`fabric_language === "zh-CN"`):

```md
# Review 汇总 — mode={pending|topic|health|revisit}
- 列出: N 条
- 已批准: M (新分配 stable_ids: KT-D-12, KT-G-4, KP-P-2)
- 已驳回: R
- 已修改: U (含 K 次 layer 切换)
- 已延后: D
- 已跳过: S

## 追加事件 (.fabric/events.jsonl 末尾)
- knowledge_promote_started ×M
- knowledge_promoted ×M
- knowledge_layer_changed ×K
- knowledge_rejected ×R
- knowledge_deferred ×D
```

### events.jsonl Constraint Note

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
- The promote / reject / modify / defer events listed above are emitted
  by the MCP server via `appendEventLedgerEvent` and are already
  length-bounded server-side; this constraint applies to any event the
  skill itself appends directly to the ledger (rare, but possible for
  diagnostic markers).

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
   ⚠ Possible duplicate of KT-D-0007 (LLM 主观判断 dup/subsumption；具体阈值不可量化)
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

### Example D — narrowing an imported decision

User: "review the pending knowledge".

Inferred mode: `pending`. Skill lists 5 pending entries; entry 3's frontmatter 
shows `source_sessions[0] = "fabric-import-2026-05-10"` → import-origin.

Display block prepends warning line. User picks `modify` on entry 3.
AskUserQuestion fires with extended options including `narrow scope`.
User picks `narrow scope`; free-text follow-up: 
`packages/server/src/retry/**, packages/server/src/lib/retry.ts`

Skill calls:

mcp__fabric__fab_review({
  action: "modify",
  pending_path: "knowledge/pending/decisions/<slug>.md",
  changes: {
    relevance_scope: "narrow",
    relevance_paths: ["packages/server/src/retry/**", "packages/server/src/lib/retry.ts"]
  }
})

Roll-up confirms `relevance_scope: narrow` written to frontmatter.

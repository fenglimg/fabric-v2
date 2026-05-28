# Per-Mode Flows — fabric-review

Full bilingual rendering blocks + step-by-step procedures for the four modes referenced from SKILL.md.

---

## Mode: pending — Approve / Reject / Modify Backlog

1. Call `fab_review` with `action: "list"`, no filters (or `filters.layer="both"` if user explicitly mentioned both layers).
2. Server returns `items[]` (each = `{pending_path, type, layer, maturity, tags?, title?, summary?}`).
3. Before presenting, perform **Semantic Check** (see `ref/semantic-check.md`) by issuing one or more `action: "search"` calls scoped by `filters.type` to surface possible duplicates / contradictions among already-canonical entries.
4. For each pending item, render a per-item block. v2.0.0-rc.7 T6: render `proposed_reason` (frontmatter) + `## Why proposed` line (body, 1-line enum explanation) + first line of `## Session context` so future-self has full context without re-reading the transcript. UX i18n Policy class 1 — roll-up templates; protected tokens (`pending_path`, `layer`, `team`, `decisions`, `proposed_reason`, `Tags`, etc.) appear verbatim in BOTH variants:

   **en variant** (`fabric_language === "en"`):

   ```md
   ## [type=decisions] [layer=team] pending_path=knowledge/pending/decisions/single-cjs-hook.md
   Title: Single .cjs hook across clients
   Summary: stdout JSON shape is identical across the three clients; one script suffices.
   Maturity: draft   Tags: [hook, cli]
   Proposed reason: decision-confirmation — ≥2 alternatives weighed; rationale stated.
   Session context: Session goal: ship Stop-hook for v2 release.
   ⚠ Possible duplicate of KT-D-0007 (LLM subjective dup/subsumption judgement; thresholds intentionally not quantified)
   ```

   **zh-CN variant** (`fabric_language === "zh-CN"`):

   ```md
   ## [type=decisions] [layer=team] pending_path=knowledge/pending/decisions/single-cjs-hook.md
   标题: 单 .cjs hook 跨客户端
   摘要: 三客户端 stdout JSON 格式一致，单脚本即可。
   成熟度: draft   Tags: [hook, cli]
   Proposed reason: decision-confirmation — ≥2 候选方案经权衡后确认选型。
   Session context: Session goal: ship Stop-hook for v2 release.
   ⚠ 可能重复 KT-D-0007 (LLM 主观判断 dup/subsumption；具体阈值不可量化)
   ```

   The Skill MUST read `proposed_reason` from the pending file's frontmatter (parse the YAML block, key `proposed_reason`) and the `## Why proposed` line / first non-blank line of `## Session context` from the body. If either is missing on a pre-rc.7 pending entry, render the legacy fallback (UX i18n Policy class 1):

   - en: `Proposed reason: <legacy entry, no reason recorded>` and `Session context: <not recorded>`
   - zh-CN: `Proposed reason: <历史条目，未记录 reason>` 与 `Session context: <未记录>`

   …so the reviewer can still proceed.

5. Surface a per-item AskUserQuestion. UX i18n Policy class 5 — `header` + `question` translated; `options[]` array remain English routing keys:

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
   - `modify` → see `ref/modify-flow.md`.
   - `defer` → call `fab_review action="defer"` with `pending_paths=[path]`; optional `until` ISO datetime if the user supplies one ("defer 2 weeks" → compute and set).
   - `skip` → no MCP call; move to next item.

7. After the loop, display a roll-up: counts by action, list of newly-allocated `stable_id`s (from approve output), and tail of `.fabric/events.jsonl` showing the appended events. See `ref/output-contract.md` for the bilingual rollup template.

---

## Mode: topic — Search & Surface Findings

1. Extract the topic keyword(s) from the user's message (e.g. "find about deepMerge" → query="deepMerge").
2. Call `fab_review action="search"` with `query` and any obvious filters (if user said "team-only" → `filters.layer="team"`).
3. Server returns `items[]` ranked by relevance — these are entries already in `.fabric/knowledge/{layer}/{type}/` (NOT pending), unless `filters` says otherwise.
4. Render top-N (cap at `review_topic_result_cap`, config-resolved, default 8) results with title / summary / pending_path.
5. If the user follow-up indicates intent to act ("approve all", "modify the second one"), pivot into the corresponding pending mode action — the search result already gives the `pending_path` needed for the action.
6. NEVER surface a per-item AskUserQuestion just for browsing — only when the user signals an action verb.

---

## Mode: health — Corpus Health & Stale Detection

1. Call `fab_review action="list"` with `filters.maturity="draft"` (or no filter for full corpus inspection).
2. Tail `.fabric/events.jsonl` for layer_changed / demoted / rejected counts in the trailing 30 days.
3. Compute stale candidates: pending entries with mtime older than `review_stale_pending_days` (config-resolved, default 14) OR maturity=draft entries with no recent evidence-append events.
4. Render a corpus dashboard. UX i18n Policy class 1 — roll-up templates; render per `fabric_language`:

   **en variant**:

   ```md
   ## Health Overview
   - Pending: 12 entries (oldest 18d) — recommend `defer` or `reject`
   - Drafts: 8 (3 are stale candidates: KP-G-3, KP-G-5, KT-P-9)
   - Layer flips (30d): 2
   - Rejections (30d): 1
   ```

   **zh-CN variant**:

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

---

## Mode: revisit — Specific Entry Deep Dive

1. The user referenced a specific entry (by id `KT-D-7` or by slug `single-cjs-hook`).
2. Call `fab_review action="list"` with `filters` narrowed by best-guess fields; if the entry is canonical (has stable_id), `Read` the file directly at `.fabric/knowledge/{layer}/{type}/<id>--<slug>.md`.
3. Display the full body (frontmatter + content). Tail the events.jsonl for any history events tagged with this stable_id.
4. Surface AskUserQuestion `{options: ["approve", "modify", "reject", "skip"]}` only if the entry is still pending; for canonical entries the only mutation path is `modify` (incl. layer flip).

---

## Mode Inference — Examples & Anti-Pattern (companion to SKILL.md table)

### Inference Examples (Sample User Messages → Expected Mode)

- "review the pending knowledge" → `pending` (Step 1 keyword "review pending")
- "find anything about deepMerge" → `topic` (Step 1 keyword "find … about")
- "anything stale in our knowledge base?" → `health` (Step 1 keyword "stale")
- "look at KT-D-7" → `revisit` (Step 1 keyword "look at <id>")
- (Stop-hook fired with signal=review, no user typing) → `pending` (Step 3 default, overflow threshold tripped)

### Anti-Pattern (Hard Rule restatement)

NEVER emit an `AskUserQuestion` whose options include {pending, maintain} (or the legacy {topic, health, revisit} aliases). The user does not pick the mode. If inference is genuinely ambiguous after both steps, default to `pending` and proceed; the user can always cancel and redirect. (rc.37 NEW-12 collapsed the 4 legacy modes to 2: `pending` + `maintain`.)

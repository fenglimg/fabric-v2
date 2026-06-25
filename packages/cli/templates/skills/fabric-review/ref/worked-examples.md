# Worked Examples — fabric-review full reference

> **Loaded on demand.** Four end-to-end mode walkthroughs (pending dedupe / revisit layer-flip / health mode / narrowing imported entries). SKILL.md gives the operative contract; load these to see how Mode + AskUserQuestion + MCP-call shape composes on real candidates.

## Worked Examples

## Example A — pending mode with semantic check flagging a duplicate (user chooses reject)

User: "review the pending knowledge".

Inferred mode: `pending` (Step 1 keyword "review … pending").

Skill flow:

1. `fab_pending action="list"` → returns 3 pending items.
2. Semantic check on item 2 (`pending/decisions/single-cjs-hook.md`) — `fab_pending action="search"` with `query="single cjs hook"` filter `type=decisions` returns canonical `KT-D-0007--single-cjs-hook-across-clients.md` (similarity high).
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

1. Read the canonical path returned by `fab_pending search` for `KT-G-0003`. Display body to user.
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

1. `fab_pending action="list"` (no filter) + tail events.jsonl for trailing-30d demoted/layer_changed counts.
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
shows `source_sessions[0] = "fabric-archive-source-2026-05-10"` → import-origin.

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

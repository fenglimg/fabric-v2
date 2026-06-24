# Modify Sub-Flow, Layer-Flip Rules & Narrowing Imported Entries

## Modify Sub-Flow

The modify family is the only action group that mutates frontmatter or stable_id. It accepts `changes` of shape `{title?, summary?, layer?, maturity?, tags?, relevance_scope?, relevance_paths?}`.

**v2.0.0-rc.37 NEW-12 — explicit split.** Prefer the dedicated action over the legacy combined `modify`:

- `action="modify-content"` — scalar edits (title/summary/tags/maturity/relevance_*); stable_id PRESERVED; the server STRIPS any `changes.layer` so this path can never flip layer. Emits `knowledge_slug_renamed` only when slug derives from title.
- `action="modify-layer"` — the dedicated layer-flip path; `changes.layer` is REQUIRED. The ONLY legal stable_id mutation in the system (see Layer-Flip Rules below).
- `action="modify"` (legacy alias) — still accepted; routes to content-edit OR layer-flip by whether `changes.layer` is present. New call sites should use the explicit pair.

Server semantics (identical regardless of which action selected the path):

- **title / summary / tags / maturity changes** → in-place rewrite; stable_id PRESERVED; emits `knowledge_slug_renamed` only when slug derives from title.
- **layer change** → the ONLY legal stable_id mutation in the system.

## Layer-Flip Rules (the only legal stable_id mutation)

Triggered when `changes.layer` differs from current entry layer. Server-side transaction:

1. Allocate new id under target layer via `KnowledgeIdAllocator.allocate(new_layer, type)` (e.g. KT-D-7 in `team/decisions/` flips to KP-D-3 in `personal/decisions/`).
2. `git mv <old-layer>/<type>/<old-id>--<slug>.md <new-layer>/<type>/<new-id>--<slug>.md`.
3. Append `knowledge_layer_changed` event with `{from_layer, to_layer, prior_stable_id, new_stable_id}`.
4. Server response includes `prior_stable_id` and `new_stable_id` — surface BOTH to the user in the roll-up.

Skill responsibilities for layer flip:

- BEFORE calling fab_review, surface `AskUserQuestion {options: ["team", "personal"]}` to confirm target layer. The default in the question header should reflect the verbatim layer heuristic (default team unless 强 personal signals dominate). This IS a genuine choice — the user must pick.
- AFTER server returns, render: `Layer flipped: <prior_stable_id> → <new_stable_id>`. Do NOT silently swallow the id change — downstream agents may have cached the prior id.

## Modify Examples

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

---

## Promotion Gate — verified → proven (v2.2 C1)

`maturity` promotion to `proven` is the foundational tier and runs a 3-part gate from `processes/maturity-promotion-rubric-v1`. The doctor `knowledge_broad_review_recheck`-adjacent `promotion_candidate` lint only SURFACES candidates (verified entries with `related` in-degree ≥3); the SUFFICIENT judgment lives here in review.

Before issuing `fab_review modify ... { maturity: "proven" }`, satisfy all three:

1. **0 dismiss (NECESSARY — server-enforced).** The server REFUSES the verified→proven modify when the entry carries an unresolved dismissed cite (latest `assistant_turn_observed` verdict for its id is `dismissed`, last-write-wins). You do NOT need to pre-check this — the modify throws with an actionable message. To clear it, the entry must be re-affirmed (a later `applied` cite) or the objection addressed. Do not work around the block; resolving it IS the gate.
2. **guideline/model summary cold-eval (NECESSARY for those two types).** For `guidelines`/`models`, run the zero-context self-sufficiency judge before promoting: build the batch with `summary-cold-eval.buildColdEvalBatch([{stable_id, summary}])` + `COLD_EVAL_RUBRIC`, hand it to a `maestro delegate` cold judge (body WITHHELD), and only proceed if `self_sufficient=true`. A FAIL means the summary only points at the body — fix the summary (modify) first, then re-judge. (decisions/pitfalls/processes skip this — they are reference, not always-active rules.)
3. **Foundational affirmation (SUFFICIENT — human).** Surface AskUserQuestion confirming the reviewer judges the entry "foundational / load-bearing", not merely correct. Promotion to proven is a standing-rule claim; the human makes it.

Only after 1–3 hold, call `fab_review action="modify-content" changes={ maturity: "proven" }`. The modify itself stamps `last_review_confirmed_at` (every approve/modify is a review re-confirmation — this also resets the broad review-recheck clock).

## Narrowing Imported Entries

The fabric-import skill creates pending entries with `relevance_scope=broad` + `relevance_paths=[]` as a deliberate contract — it cannot derive paths from git history. **Narrowing imported entries is fabric-review's responsibility.**

### Detection

An entry is "import-origin" when `source_sessions[0]` starts with `fabric-archive-source-` (e.g. `fabric-archive-source-2026-05-10`).

### Pending mode rendering

For each import-origin entry, prepend one warning line to the display block. UX i18n Policy class 1 — roll-up templates; the protected tokens `relevance_scope`, `relevance_paths`, `broad` appear verbatim in BOTH variants:

- en: `⚠ Imported (relevance_scope=broad, relevance_paths=[]) — pick 'modify' + say 'narrow to <paths>' to bind scope.`
- zh-CN: `⚠ Imported (relevance_scope=broad, relevance_paths=[]) — 选择 'modify' 并指定 'narrow to <paths>' 以收紧作用域。`

This hint is informational. The user MAY ignore it; broad+[] is a valid final state for cross-cutting knowledge.

### Modify follow-up — narrow scope

When the user picks `modify` on an import-origin entry, surface AskUserQuestion with an extended option list. UX i18n Policy class 5 — `header` + `question` translated; `options[]` remain English routing keys:

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
   ```ts
   changes: { relevance_scope: "narrow", relevance_paths: [<parsed paths>] }
   ```
3. Display the resolved frontmatter to confirm.

### Special cases

- **Layer=personal entries**: server auto-degrades narrow → broad+[]; surface the `knowledge_scope_degraded` event back to the user.
- **Non-import-origin entries**: modify can still narrow (just doesn't show this UX nudge — user types it as a normal modify).

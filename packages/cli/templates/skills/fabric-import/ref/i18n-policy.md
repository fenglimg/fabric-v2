# UX i18n Policy — fabric-import full reference

> **Shared core (rc.37 NEW-13):** the cross-skill invariants — protected-token
> NEVER-translate list, AskUserQuestion routing-key rule, layer heuristic, and
> events-emit convention — live once in `../../lib/shared-policy.md`. This file
> keeps only the fabric-import-specific 5-class examples. Read the shared lib
> for the common rules; do not fork them here.

> **Loaded on demand.** Only consult when you need to disambiguate which of the 5 classes a given string belongs to. SKILL.md gives the operative rule.

## UX i18n Policy (5-class bilingualization)

The skill consults `fabric_language` from `.fabric/fabric-config.json`
(固化于 install 时，via `scan.ts:detectExistingLanguage`; default `"en"` when no
CJK signal is detected in README + docs/; may resolve to `"match-existing"`,
`"zh-CN"`, `"en"`, or `"zh-CN-hybrid"`). All user-facing text in the
following 5 categories MUST be rendered in the resolved language:

1. **Roll-up templates** — final summary blocks (`# Import Summary — phase=...`,
   `## Phase 2 — Mining`, `## Phase 3 — Dedup`, etc.). zh-CN ↔ en mirror.
2. **Errors / Preconditions warnings** — abort + gate-fail messages (e.g.
   "请先运行 fabric install 完成基线扫描…" / "Please run fabric install first…").
   zh-CN ↔ en mirror.
3. **Confirmation prompts** — re-run-within-24h prompt, reset prompts, etc.
   zh-CN ↔ en mirror.
4. **Dry-run table headers** — `# Import Dry Run — would propose N pending
   entries…` + the `| # | Source | Type | Slug | Scope | Summary |` header row.
   zh-CN ↔ en mirror.
5. **AskUserQuestion** — `header` + `question` fields (NOT `options[]`).
   zh-CN ↔ en mirror. fabric-import itself does not surface AskUserQuestion
   in the current contract (the rare re-run prompt is free-text), but if a
   future version adds one, this rule applies.

Rendering rule:

- `fabric_language === "zh-CN"` → emit the zh-CN variant; pure monolingual, no language mixing inside a single user-facing block.
- `fabric_language === "en"` → emit the en variant; pure monolingual, no language mixing inside a single user-facing block.
- `fabric_language === "zh-CN-hybrid"` → emit Chinese narrative prose with English technical terms preserved. Protected tokens (always EN): MCP tool names (e.g. `fab_recall`), CLI command names (e.g. `fabric install`), file paths, technical concepts (`Skill`, `SessionStart`, `hook`, `MCP`, `revision_hash`, `pending`, `proven`, `verified`, `draft`).
- `fabric_language === "match-existing"` or any other value → emit the en variant; pure monolingual.

Protected tokens (`fab_extract_knowledge`, `fab_review`, `relevance_scope`,
`relevance_paths`, `broad`, `narrow`, `source_sessions`, `proposed_reason`,
`session_context`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`,
`pending_path`, `layer`, `team`, `personal`,
`knowledge_scope_degraded`, `MUST`, `NEVER`, `knowledge/pending`, etc.)
are NEVER translated — they appear verbatim in both language variants.
The bilingualization scope is prose ONLY.

### AskUserQuestion i18n Policy (value vs label)

When a skill (this one or any sibling skill the user is composing with)
issues an `AskUserQuestion`, the `header` and `question` strings are
user-facing prose → translated per `fabric_language`. The `options[]`
array entries (e.g. `["approve", "reject", "modify", "defer", "skip"]` in
fabric-review) are **routing keys** consumed by the skill state machine —
they MUST remain English regardless of `fabric_language`.

```ts
// EN (fabric_language === "en")
AskUserQuestion({
  header: "Review pending entry",
  question: "What action for '{title}'?",
  options: ["approve", "reject", "modify", "defer", "skip"]
})

// zh-CN (fabric_language === "zh-CN")
AskUserQuestion({
  header: "审核 pending 条目",
  question: "对 '{title}' 执行什么操作？",
  options: ["approve", "reject", "modify", "defer", "skip"]   // 不翻译 — routing key
})
```

Rationale: localizing routing keys would force every routing branch to
dual-string match (e.g. `if (choice === "approve" || choice === "通过")`),
which doubles the surface area for protected-token regressions and breaks
the option-list invariants that downstream tooling depends on. Keeping
`options[]` English-only is contract-locked across all three skills.

# UX i18n Policy — fabric-review full reference

> **Shared core (rc.37 NEW-13):** the cross-skill invariants — protected-token
> NEVER-translate list, AskUserQuestion routing-key rule, layer heuristic, and
> events-emit convention — live once in `../../lib/shared-policy.md`. This file
> keeps only the fabric-review-specific 5-class examples. Read the shared lib
> for the common rules; do not fork them here.

> **Loaded on demand.** Only consult when you need to disambiguate which of the 5 classes a given string belongs to. SKILL.md gives the operative rule.

## UX i18n Policy (5-class bilingualization)

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
- `fabric_language === "zh-CN-hybrid"` → emit Chinese narrative prose with English technical terms preserved. Protected tokens (always EN): MCP tool names (e.g. `fab_get_knowledge_sections`), CLI command names (e.g. `fabric install`), file paths, technical concepts (`Skill`, `SessionStart`, `hook`, `MCP`, `revision_hash`, `pending`, `proven`, `verified`, `draft`).
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


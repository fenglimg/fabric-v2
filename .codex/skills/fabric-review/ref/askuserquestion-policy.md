# AskUserQuestion Policy — fabric-review

Full DO / DO NOT split + per-item question phrasing templates referenced from SKILL.md.

## DO ask (genuine choices that require human judgment)

- Per-pending-item action: `["approve", "reject", "modify", "defer", "skip"]`
- Per-stale-item action (health mode): `["defer", "demote", "skip"]`
- Layer-flip target when modify path includes layer change: `["team", "personal"]`
- Reject reason follow-up (free-text, may use AskUserQuestion's free-form variant if available, otherwise plain prompt)

## DO NOT ask (system must infer or operate deterministically)

- Mode picking (pending / topic / health / revisit) — INFERRED per the 3-step algorithm
- Whether to invoke this skill at all — Stop-hook signal or explicit user request decides
- Whether an entry is a duplicate — LLM semantic check answers
- Frontmatter parsing — deterministic, never asked
- Allocate next id — deterministic via KnowledgeIdAllocator, never asked

## Per-Item Question Phrasing Template

UX i18n Policy class 5 — `header` + `question` translated per `fabric_language`; `options[]` arrays remain English routing keys in BOTH variants. Choose the variant matching the resolved language; the structure (field names, options) is identical.

### Pending entry action

**en variant**:

```ts
AskUserQuestion({
  header: "Review pending entry",
  question: "What action for '{title}'?  ({pending_path})",
  options: ["approve", "reject", "modify", "defer", "skip"]
})
```

**zh-CN variant**:

```ts
AskUserQuestion({
  header: "审核 pending 条目",
  question: "对 '{title}' 执行什么操作？({pending_path})",
  options: ["approve", "reject", "modify", "defer", "skip"]   // 不翻译 — routing key
})
```

### Layer-flip target

**en variant**:

```ts
AskUserQuestion({
  header: "Layer-flip target",
  question: "Move '{title}' to which layer?  (current: {current_layer})",
  options: ["team", "personal"]
})
```

**zh-CN variant**:

```ts
AskUserQuestion({
  header: "Layer 切换目标",
  question: "将 '{title}' 切换到哪一层？(当前: {current_layer})",
  options: ["team", "personal"]   // 不翻译 — routing key
})
```

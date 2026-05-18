---
id: KT-GLD-0002
type: guidelines
maturity: draft
layer: team
created_at: 2026-05-14T02:58:52.319Z
source_sessions: ["WFS-2026-05-14-fabric-skills-contract-fix"]
proposed_reason: decision-confirmation
tags: []
---

## Summary

AskUserQuestion 的 i18n 政策：header 和 question 文本按 knowledge_language 翻译；options[] 数组始终保持英文路由 key，不翻译。原因：localizing routing keys 会强制每处分支做双串匹配（if choice === "approve" || choice === "通过"），翻倍保护 token 回归面，且破坏 SKILL.md 路由 invariant。Options 是"协议字段"非"自然语言"，等同 protected token。grill-me 权衡 A（保 EN 路由）/B（全翻译双映射）/C（双语并列 label）后选 A。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: 5 类 UX i18n 双语化政策（roll-up / 错误 / 确认 prompt / dry-run 表头 / AskUserQuestion）。
Turning point: 设计第 5 类时发现 AskUserQuestion 的 options[] 既是 UI label 又是路由 key，无 label/value 分离 API；权衡 3 个方案后选 A——只翻译 header/question，options 保持英文。
Result: 三 skill SKILL.md 都加了 "AskUserQuestion i18n Policy (value vs label)" 章节明示这条规则。
Implication: 任何 routing key 字符串都不应被 i18n 触及——这是跨 skill 通用的"协议层 vs 表现层"分离原则。

## Evidence

Recent paths:

- packages/cli/templates/skills/fabric-import/SKILL.md
- packages/cli/templates/skills/fabric-archive/SKILL.md
- packages/cli/templates/skills/fabric-review/SKILL.md

Notes:

- AskUserQuestion 的 i18n 政策：header 和 question 文本按 knowledge_language 翻译；options[] 数组始终保持英文路由 key，不翻译。原因：localizing routing keys 会强制每处分支做双串匹配（if choice === "approve" || choice === "通过"），翻倍保护 token 回归面，且破坏 SKILL.md 路由 invariant。Options 是"协议字段"非"自然语言"，等同 protected token。grill-me 权衡 A（保 EN 路由）/B（全翻译双映射）/C（双语并列 label）后选 A。

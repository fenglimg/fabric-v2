---
id: KT-DEC-0009
type: decisions
maturity: draft
layer: team
created_at: 2026-05-10T11:29:43.862Z
source_session: WFS-rc2-impl-2026-05-10
tags: []
---

## Summary

rc.2 决定使用单份 .cjs hook 脚本（archive-hint.cjs）同时服务 Claude Code 和 Codex CLI 两个客户端，而非每客户端一份。依据：现存 fabric-init-reminder.cjs 和 fabric-stop-reminder.cjs 已验证两个客户端都接受相同的 stdout JSON 形态 {decision:'block',reason:string}；维护单一脚本避免重复实现 events.jsonl 解析与阈值逻辑。记录于 packages/cli/templates/hooks/archive-hint.cjs，被 .claude/hooks/ 与 .codex/hooks/ 同时引用。

## Evidence (call 1)

Recent paths:

- packages/cli/templates/hooks/archive-hint.cjs
- packages/cli/templates/hooks/configs/claude-code.json
- packages/cli/templates/hooks/configs/codex-hooks.json
- .workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/planning-context.md

Notes:

rc.2 决定使用单份 .cjs hook 脚本（archive-hint.cjs）同时服务 Claude Code 和 Codex CLI 两个客户端，而非每客户端一份。依据：现存 fabric-init-reminder.cjs 和 fabric-stop-reminder.cjs 已验证两个客户端都接受相同的 stdout JSON 形态 {decision:'block',reason:string}；维护单一脚本避免重复实现 events.jsonl 解析与阈值逻辑。记录于 packages/cli/templates/hooks/archive-hint.cjs，被 .claude/hooks/ 与 .codex/hooks/ 同时引用。

## Evidence (call 2)

二次调用：验证 idempotency_key 在 (source_session,type,slug) 三元组未变时保持稳定，且 LLM 重新生成的 summary 应 append 到 ## Evidence (call N) 而不是覆盖原内容。本次模拟 LLM 在同一会话中对同一决策再次抽取 — 结果应是 events.jsonl 多一条 knowledge_proposed 但 .fabric/knowledge/pending/decisions/ 下文件数不变。

## Evidence (call 3)

rc.2 决定使用单份 .cjs hook 脚本（archive-hint.cjs）同时服务 Claude Code 和 Codex CLI 两个客户端，而非每客户端一份。依据：现存 fabric-init-reminder.cjs 和 fabric-stop-reminder.cjs 已验证两个客户端都接受相同的 stdout JSON 形态 {decision:'block',reason:string}；维护单一脚本避免重复实现 events.jsonl 解析与阈值逻辑。记录于 packages/cli/templates/hooks/archive-hint.cjs，被 .claude/hooks/ 与 .codex/hooks/ 同时引用。

## Evidence (call 4)

二次调用：验证 idempotency_key 在 (source_session,type,slug) 三元组未变时保持稳定，且 LLM 重新生成的 summary 应 append 到 ## Evidence (call N) 而不是覆盖原内容。本次模拟 LLM 在同一会话中对同一决策再次抽取 — 结果应是 events.jsonl 多一条 knowledge_proposed 但 .fabric/knowledge/pending/decisions/ 下文件数不变。

## Evidence (call 5)

rc.2 决定使用单份 .cjs hook 脚本（archive-hint.cjs）同时服务 Claude Code 和 Codex CLI 两个客户端，而非每客户端一份。依据：现存 fabric-init-reminder.cjs 和 fabric-stop-reminder.cjs 已验证两个客户端都接受相同的 stdout JSON 形态 {decision:'block',reason:string}；维护单一脚本避免重复实现 events.jsonl 解析与阈值逻辑。记录于 packages/cli/templates/hooks/archive-hint.cjs，被 .claude/hooks/ 与 .codex/hooks/ 同时引用。

## Evidence (call 6)

二次调用：验证 idempotency_key 在 (source_session,type,slug) 三元组未变时保持稳定，且 LLM 重新生成的 summary 应 append 到 ## Evidence (call N) 而不是覆盖原内容。本次模拟 LLM 在同一会话中对同一决策再次抽取 — 结果应是 events.jsonl 多一条 knowledge_proposed 但 .fabric/knowledge/pending/decisions/ 下文件数不变。

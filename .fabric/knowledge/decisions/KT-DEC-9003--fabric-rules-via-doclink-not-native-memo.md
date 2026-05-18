---
id: KT-DEC-9003
type: decisions
maturity: draft
layer: team
created_at: 2026-05-18T02:31:46.087Z
source_sessions: ["1bced005-71b4-4d95-8798-611c3dfcf5ae", "36f76853-d78d-4f6e-9028-303d404e93ca"]
proposed_reason: decision-confirmation
tags: []
relevance_scope: broad
relevance_paths: []
---

## Summary

grill-me 2026-05-15 明确 Fabric 团队规则不走 native memory 通道 (Claude auto-memory / Codex 全局 AGENTS.md / Cursor Memories beta),统一通过各端主文档 @import 引用 .fabric/AGENTS.md 实现跨客户端单源。Rationale: native memory 三端语义割裂、不可版本控制、不可团队共享;doc-link 可 git-track + cross-client 一致。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: 厘清 Fabric 行为规则的承载介质 —— CLAUDE.md 类文档 vs 各端 native Memory。
Turning point: 用户提问 "Fabric 整体放在 CLAUDE.md 还是原生 Memory?",经过对三端 memory 能力对比 (Claude auto-memory 私人 / Codex 全局 AGENTS.md 不递归发现嵌套 / Cursor Memories beta),用户判断 "感觉基本不用使用到 Memory",并提出 .fabric/AGENTS.md doc-link 方案。
Result: 所有 Fabric 团队规则归 doc-link 通道,native memory 仅承载个人偏好;跨客户端契约统一为 fab install 写各端 managed block + @import / direct concat 引用。

## Evidence

Recent paths:

- .fabric/AGENTS.md
- CLAUDE.md
- AGENTS.md
- .cursor/rules/fabric-bootstrap.mdc

Notes:

- grill-me 2026-05-15 明确 Fabric 团队规则不走 native memory 通道 (Claude auto-memory / Codex 全局 AGENTS.md / Cursor Memories beta),统一通过各端主文档 @import 引用 .fabric/AGENTS.md 实现跨客户端单源。Rationale: native memory 三端语义割裂、不可版本控制、不可团队共享;doc-link 可 git-track + cross-client 一致。

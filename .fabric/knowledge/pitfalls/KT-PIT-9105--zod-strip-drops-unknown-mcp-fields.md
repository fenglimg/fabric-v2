---
id: KT-PIT-9105
type: pitfalls
maturity: verified
layer: team
created_at: 2026-05-14T02:58:13.737Z
source_sessions: ["WFS-2026-05-14-fabric-skills-contract-fix"]
proposed_reason: diagnostic-then-fix
tags: []
---

## Summary

通过 grill-me + skill-tuning audit 发现 P0：fab_extract_knowledge 的 zod input schema 不含 relevance_scope/relevance_paths 字段，而 archive/import skill 文档承诺写入这两个字段。zod 默认 .strip() 静默丢弃未声明字段，导致 archive Phase 1.5 的 200 行 path-derivation 算法输出被完全无声丢弃，rc.5/rc.6 的 "narrow knowledge 路径门控" 功能从未真正激活。修复：α 方案扩 schema 加 optional 字段 + 入口 normalize（personal+narrow 静默降级 broad+[]）。

## Why proposed

diagnostic-then-fix — 诊断过程发现新模式或踩坑，修复后值得沉淀。

## Session context

Session goal: 修复 fabric 三 skill 合约 + 优化（grill-me 收敛 → skill-tuning audit）。
Turning point: 探查 server 代码核 scope/relevance_scope 字段名冲突时发现 fab_extract_knowledge input schema 根本不含这两个字段——不是字段名冲突，是字段不存在；zod 默认 .strip() 把 skill 端写的 scope/paths 全部静默吞掉。
Result: 升级 fix 优先级到 P0；α 方案扩 schema；archive Phase 1.5 的精心设计才真正生效。
Implication: 任何 zod schema 默认 .strip() 都是隐式合约，未来设计 MCP 工具应显式 .strict() 或 passthrough，避免文档与实现的静默漂移。

## Evidence

Recent paths:

- packages/shared/src/schemas/api-contracts.ts
- packages/server/src/services/extract-knowledge.ts
- packages/cli/templates/skills/fabric-archive/SKILL.md
- packages/cli/templates/skills/fabric-import/SKILL.md
- packages/shared/test/api-contracts.test.ts
- packages/server/src/services/extract-knowledge.test.ts

Notes:

- 通过 grill-me + skill-tuning audit 发现 P0：fab_extract_knowledge 的 zod input schema 不含 relevance_scope/relevance_paths 字段，而 archive/import skill 文档承诺写入这两个字段。zod 默认 .strip() 静默丢弃未声明字段，导致 archive Phase 1.5 的 200 行 path-derivation 算法输出被完全无声丢弃，rc.5/rc.6 的 "narrow knowledge 路径门控" 功能从未真正激活。修复：α 方案扩 schema 加 optional 字段 + 入口 normalize（personal+narrow 静默降级 broad+[]）。

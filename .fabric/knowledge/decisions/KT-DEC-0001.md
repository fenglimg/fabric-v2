---
id: KT-DEC-0001
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [v2-architecture, scope-boundary]
---

# Boundary B: data + lifecycle + async-review primitive

## Decision

将 boundary B（data layer + lifecycle hooks + async-review primitive）确立为
v2.0 的架构边界，同时拒绝更窄和更宽的两种边界划法。

## Alternatives considered

- **Boundary A**（仅 data 层）：太薄，相对通用 vector store 没有任何增量价值。
- **Boundary C**（带内置 UI 的完整平台）：定位错位，会与 Obsidian、Notion
  这类既有工具在我们注定打不赢的 UX 战场上正面竞争。

## Rationale

B 抓住了 Fabric 真正能守住的独特组合：带 maturity lifecycle 的 typed
knowledge，加上 async-review 的 skill 闭环。A 和 C 都会失去这层差异——A
没有路由智能可言，C 又过度扩张，硬碰硬地与既有工具在 UX 上较劲。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q1/Q7 设计决策
（option B accepted）。

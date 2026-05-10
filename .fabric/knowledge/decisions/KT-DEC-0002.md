---
id: KT-DEC-0002
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [v2-architecture, migration-strategy]
---

# v2.0 clean rebrand over v1.x staged migration

## Decision

采用 clean-slate 的 v2.0 rebrand，不为 v1.x artifacts 提供任何迁移路径。
所有 v1.x 概念（`.fabric/rules/`、`INITIAL_TAXONOMY`、`bootstrap-guide`、
被砍掉的 clients）一律硬删除，不保留 deprecated fallback shims。

## Alternatives considered

- **Staged migration**：写 adapter 让 v1 和 v2 layout 在 1-2 个 release
  周期内并行读取。代价是引入约三周的双路径复杂度，对用户没有任何收益。
- **In-place rename**：在现有 layout 内重命名 v1.x 路径。能保留历史，
  但会把死代码路径留在生产中。

## Rationale

Fabric 在 v1.x 阶段没有任何生产用户，迁移税为零。一刀切能在一批 commit
内清掉所有 v1.x 的历史包袱，让 codebase 从 v2.0 第一天起就保持内部一致。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q1（version
strategy，clean-slate 偏好已确认）。

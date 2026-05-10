---
id: KT-MOD-0002
type: model
layer: team
maturity: verified
layer_reason: "project artifact (deterministic init scan)"
created_at: 2026-05-10T05:24:25.169Z
tags: [unknown, typescript, csv, ndjson, [none]]
---

# Module structure

## [MISSION_STATEMENT]

梳理 fabric-monorepo 的高层 module 布局与主要 entry point。

## [CONTEXT_INFO]

文件总数：778
最大目录深度：7

关键目录：
- .agents/skills/ui-ux-pro-max/scripts
- .claude/skills/ui-ux-pro-max/scripts
- examples/werewolf-minigame-stub/assets/scripts
- packages/cli/src
- packages/dashboard/src
- packages/dashboard/src/components
- packages/server/scripts
- packages/server/src
- packages/shared/src
- scripts

Entry points：
- scripts/lint-protected-tokens.ts —— 顶层脚本

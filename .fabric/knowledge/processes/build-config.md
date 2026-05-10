---
id: KT-PRO-0001
type: process
layer: team
maturity: verified
layer_reason: "project artifact (deterministic init scan)"
created_at: 2026-05-10T05:24:25.169Z
tags: [unknown, typescript, csv, ndjson, [none]]
---

# Build configuration

## [MISSION_STATEMENT]

记录 fabric-monorepo 所依赖的、确定性的 build / bootstrap 配置。

## [BUSINESS_LOGIC_CHUNKS]

1. 探测 framework：`unknown`。
2. 按声明顺序读取 configuration files。
3. 在生成新代码之前，尊重 compiler / bundler 的边界。
4. 把 config 漂移视为 fact-check 信号 —— 修改后重新运行 `fab scan`。

## [CONTEXT_INFO]

Framework：unknown

Configuration files：
- package.json
- examples/werewolf-minigame-stub/package.json
- examples/werewolf-minigame-stub/project.config.json

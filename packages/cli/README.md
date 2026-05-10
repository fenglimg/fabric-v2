# @fenglimg/fabric-cli

`fabric` 是 Fabric 的主命令，`fab` 是永久别名，两者等价。

## 快速开始

1. 在 monorepo 根目录运行 `pnpm install`。
2. 用 `pnpm --filter @fenglimg/fabric-cli build` 构建 CLI。
3. 在目标项目运行 `fabric init`，完成一站式初始化。
4. 启动 `fabric serve`，再去客户端里验证 `fab_plan_context` 和 `fab_get_rule_sections`。

`fabric init` 会自动准备 bootstrap、MCP 配置和 git hooks。公共命令面只保留 `init`、`scan`、`doctor`、`serve`。

## 常用命令

- `fabric init`
- `fabric scan`
- `fabric doctor`
- `fabric doctor --json`
- `fabric doctor --strict`
- `fabric doctor --fix`
- `fabric serve`

`fabric doctor --fix` 只修复确定性的派生状态，例如 `.fabric/agents.meta.json`、`.fabric/.cache/knowledge-test.index.json`、缺失的 `.fabric/events.jsonl` 和 stale hashes；语义冲突、缺失 rule section、未完成的初始化确认仍需要人工处理。

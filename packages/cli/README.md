# @fenglimg/fabric-cli

`fabric` 是 Fabric 的主命令，`fab` 是永久别名，两者等价。

## 快速开始

1. 在 monorepo 根目录运行 `pnpm install`。
2. 用 `pnpm --filter @fenglimg/fabric-cli build` 构建 CLI。
3. 在目标项目运行 `fabric install`，完成一站式安装。
4. 启动 `fabric serve`，再去客户端里验证 `fab_plan_context` 和 `fab_get_knowledge_sections`。

`fabric install` 会自动准备 bootstrap、MCP 配置和 git hooks。公共命令面只保留 `install`、`doctor`、`serve`、`uninstall`、`config`（rc.23 起移除了 baseline scan 机制，知识库唯一合法来源是 Skill 路径：`fabric-archive` / `fabric-import` / `fabric-review`）。

## 常用命令

- `fabric install`
- `fabric doctor`
- `fabric doctor --json`
- `fabric doctor --strict`
- `fabric doctor --fix`
- `fabric serve`
- `fabric uninstall`
- `fabric config`（rc.16 起将提供配置面板；当前为占位提示）

`fabric doctor --fix` 只修复确定性的派生状态，例如 `.fabric/agents.meta.json`、`.fabric/.cache/knowledge-test.index.json`、缺失的 `.fabric/events.jsonl` 和 stale hashes；语义冲突、缺失 rule section、未完成的初始化确认仍需要人工处理。

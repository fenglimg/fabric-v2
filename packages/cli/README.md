# @fenglimg/fabric-cli

`fabric` 是 Fabric 的 CLI 主命令。

## 快速开始

1. 在 monorepo 根目录运行 `pnpm install`。
2. 用 `pnpm --filter @fenglimg/fabric-cli build` 构建 CLI。
3. 在目标项目运行 `fabric install`，完成一站式安装。
4. 重启 Claude Code / Codex CLI，在客户端里验证 `fab_recall`。

`fabric install` 会自动准备 bootstrap、MCP stdio 配置和 git hooks。当前公共命令面包括 `install`、`store`、`sync`、`info`、`doctor`、`uninstall`、`config`；`metrics`、`plan-context-hint`、`onboard-coverage` 是 hidden/internal 命令；`whoami` / `status` / `scope-explain` 作为 deprecated alias 保留到 v3。`fabric serve` 已 quarantine 到 `packages/server-http-experimental/`，主线不再注册。

## 常用命令

- `fabric install`
- `fabric doctor`
- `fabric doctor --json`
- `fabric doctor --fix`
- `fabric doctor --fix-knowledge`
- `fabric store list`
- `fabric sync`
- `fabric info`
- `fabric metrics`（hidden/internal）
- `fabric uninstall`
- `fabric config`（rc.16 起将提供配置面板；当前为占位提示）

`fabric doctor --fix` 只修复确定性的派生状态，例如 `.fabric/agents.meta.json`、`.fabric/.cache/knowledge-test.index.json`、缺失的 `.fabric/events.jsonl` 和 stale hashes。知识条目的 demote/archive/default backfill 走 `fabric doctor --fix-knowledge` 或 `fabric-review`；语义冲突、未完成的初始化确认和本地客户端配置问题仍需要人工处理。

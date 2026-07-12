# @fenglimg/fabric-cli

`fabric` 是 Fabric 的 CLI 主命令。

## 快速开始

1. 在 monorepo 根目录运行 `pnpm install`。
2. 用 `pnpm --filter @fenglimg/fabric-cli build` 构建 CLI。
3. 在目标项目运行 `fabric install`，完成一站式安装。
4. 重启 Claude Code / Codex CLI，在客户端里验证 `fab_recall`。

`fabric install` 会自动准备 bootstrap、MCP stdio 配置和 git hooks。

**公共命令面（registry）**: `install` · `store` · `sync` · `info` · `doctor` · `uninstall` · `config` · `audit` · `preview`（以 `fabric --help` / 命令注册表为准）。

**hidden/internal**: `metrics` · `plan-context-hint` · `onboard-coverage` 等。

**deprecated alias（保留到 v3）**: `whoami` / `status` / `scope-explain`。

`fabric serve` 已 quarantine 到 `packages/server-http-experimental/`，主线不再注册。

## 常用命令

- `fabric install`
- `fabric doctor` / `fabric doctor --json` / `fabric doctor --fix`
- `fabric store list` / `fabric store bind` / `fabric store switch-write`
- `fabric sync`
- `fabric info`
- `fabric audit`
- `fabric preview`（只读知识预览）
- `fabric config`（交互配置；`FABRIC_CONFIG_PLAIN=1` 或 `NO_COLOR` 时追加式 plain 菜单）
- `fabric uninstall`

`fabric doctor --fix` 只修复确定性的派生状态（例如缺失的 `.fabric/events.jsonl`、stale serve-lock、store counter floor、hook/config 可自愈项）。**不再重建** 已退役的 co-location `.fabric/agents.meta.json`（知识在 mounted stores 里，ISS-20260711-172）。知识条目的 demote/archive/default backfill 走 `fabric-review`；语义冲突、未完成的初始化确认和本地客户端配置问题仍需要人工处理。

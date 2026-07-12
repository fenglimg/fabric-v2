# @fenglimg/fabric-cli

`fabric` 是 Fabric 的 CLI 主命令。

## 快速开始

1. 在 monorepo 根目录运行 `pnpm install`。
2. 用 `pnpm --filter @fenglimg/fabric-cli build` 构建 CLI。
3. 在目标项目运行 `fabric install`，完成一站式安装。
4. 重启 Claude Code / Codex CLI，在客户端里验证 `fab_recall`。

`fabric install` 会自动准备 bootstrap、MCP stdio 配置和 git hooks。

### 命令面（与 `packages/cli/src/commands/index.ts` 对齐）

**公共（`fabric --help` 可见）**

- `install` / `store` / `sync` / `info` / `doctor` / `uninstall` / `config`
- `audit`（知识/遥测审计组：`cite` / `conflicts` / `history` / `descriptions` / `metrics` / `retired` 等）
- `inspect`（展示 SessionStart 注入内容，与 hook 共用 renderer）
- `preview`（只读知识预览 HTTP UI，**不是** 已 quarantine 的 `serve`）
- `first-hit`（空仓/首 hit 验收与 seed；与 preview 共享 store 读路径）

**Hidden / internal（注册但默认不进顶层 help；hooks / skills 仍会调用）**

- `plan-context-hint` — SessionStart / broad-hint 管道
- `onboard-coverage` — fabric-archive Phase 1.5 槽位覆盖
- `metrics` 的顶层别名已退役；请用 `fabric audit metrics`

**已退役 / 迁入**

- 顶层 `whoami` / `status` / `scope-explain` → 已并入 `fabric info`（含 `fabric info scope <coord>`），**不再作为顶层子命令注册**
- `fabric serve` → quarantine 到 `packages/server-http-experimental/`（主线不注册；见 KT-DEC-0016）

## 常用命令

- `fabric install`
- `fabric doctor` / `fabric doctor --json` / `fabric doctor --fix`
- `fabric store list` / `fabric store bind` / `fabric store switch-write`
- `fabric sync`
- `fabric info`
- `fabric audit` / `fabric audit metrics`
- `fabric inspect`
- `fabric preview`（只读知识预览）
- `fabric first-hit`
- `fabric config`（交互配置；`FABRIC_CONFIG_PLAIN=1` 或 `NO_COLOR` 时追加式 plain 菜单）
- `fabric uninstall`

`fabric doctor --fix` 只修复确定性的派生状态，例如 `.fabric/agents.meta.json`、`.fabric/.cache/knowledge-test.index.json`、缺失的 `.fabric/events.jsonl` 和 stale hashes。知识条目的 demote/archive/default backfill 走 `fabric doctor --fix` 或 `fabric-review`；语义冲突、未完成的初始化确认和本地客户端配置问题仍需要人工处理。

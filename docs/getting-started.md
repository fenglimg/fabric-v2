# Fabric 上手

Fabric v1.0 为维护者提供从本地安装到首条 ledger-backed 协作事件的标准上手路径。若你首次评估 Fabric，从这里开始。

贡献与本地仓库设置见 [Contributing](./contributing.md)。`fabric init` 状态机与更深 mechanics 见 [Initialization Guide](./initialization.md)。产品叙事版见 [Launch Story](./launch-story.md)。

> `fabric` 是主命令，`fab` 是永久别名，两者等价。下文统一使用 `fabric`。

## 阶段 1：安装 Fabric

在机器上全局安装 CLI 一次：

```bash
npm install -g @fenglimg/fabric-cli
```

若在本 monorepo 内验证 Fabric 而非 npm，先构建 workspace：

```bash
pnpm install
pnpm -r build
```

此时应能使用 `fabric`（或其别名 `fab`）命令：

```text
$ fabric --help
Initialize and manage Fabric projects. Use "fabric init" for one-shot setup.
USAGE fabric init|scan|serve|doctor|sync-meta|human-lint|ledger-append|pre-commit
```

## 阶段 2：初始化 Fabric

进入要接入 Fabric 的项目。首次运行建议使用 disposable repository 或干净分支。

```bash
cd ~/projects/my-app
git status --short
fabric init
```

推荐前置条件：

- 尚不存在 `AGENTS.md`。
- 尚不存在 `.fabric/`。
- 在任意写入步骤前，先审阅既有 `.claude/`、`.cursor/`、`.codex/`、`.windsurf/` 或 `.roo/` config。

v1.0 launch story 中的中文本地化 stdout 示例：

```text
$ fabric init

Fabric v1.2 · control plane

正在扫描项目根目录...
检测到项目类型: Cocos Creator 3.8 TypeScript Component project
检测依据:
  - project.config.json
  - creator.version = 3.8.0
  - assets/scripts/*.ts
  - @ccclass + extends Component

正在生成证据包...
证据包摘要 / `.fabric/forensic.json`
  - `framework.kind`: `cocos-creator`
  - `framework.version`: `3.8.0`
  - `framework.subkind`: `typescript-component`
  - `entry_points[0].path`: `assets/scripts/Game.ts`
  - `topology.by_ext[".ts"]`: 3
  - `recommendations_for_skill`: 6 items

Created `AGENTS.md`
Created `.fabric/agents.meta.json`
Created `.fabric/human-lock.json`
Created `.fabric/forensic.json`

正在安装 Claude Code 初始化接力...
Installed `.claude/skills/agents-md-init/SKILL.md`
Installed `.claude/hooks/agents-md-init-reminder.cjs`
Created `.claude/settings.json` with Claude Stop hook

--- Installing bootstrap templates... ---
Installed CLAUDE.md
Installed .cursor/rules/fabric-bootstrap.mdc

--- Configuring MCP clients... ---
Wrote ClaudeCodeCLI config
Wrote Cursor .cursor/mcp.json

--- Installing git hooks... ---
Created .husky/pre-commit
Added prepare script to package.json

已完成一站式初始化。
```

本阶段结束后，仓库具备 fallback contract 与 evidence pack，但在 client-side interview 完成前，semantic initialization 尚未结束。

## 阶段 3：完成 AI Handoff

在 Claude Code 中打开同一仓库，用普通消息继续 initialization transaction：

```text
I just ran fabric init in this repo. Finish AGENTS.md initialization.
```

预期结果：

- `agents-md-init` 读取 `.fabric/forensic.json`。
- 维护者确认 framework facts 与 invariants。
- Fabric 写入 `.fabric/init-context.json` 并更新面向实际项目的 `AGENTS.md`。

更完整的 interview 流程（含 framework-confirm 与 invariants 阶段）见 [Initialization Guide](./initialization.md)。

## 阶段 4：验证 Agents 与 Hooks

`fabric init` 已自动完成 bootstrap、MCP config 与 git hooks 的安装。本阶段只需验证结果。

检查 bootstrap 安装结果：

```text
$ ls CLAUDE.md .cursor/rules/fabric-bootstrap.mdc 2>/dev/null
CLAUDE.md
.cursor/rules/fabric-bootstrap.mdc
```

检查 git hooks：

```text
$ cat .husky/pre-commit | head -3
#!/bin/sh
FAB_BIN=$(command -v fabric || command -v fab || echo "")
```

> 如需对某个阶段做针对性重跑，可使用独立命令：`fabric bootstrap install`、`fabric config install`、`fabric hooks install`。也可通过 `--no-bootstrap`、`--no-mcp`、`--no-hooks` 跳过 `fabric init` 中的对应阶段。

## 阶段 5：启动本地 Control Plane

启动本地 Fabric HTTP server：

```bash
fabric serve
```

当前实现的实际 CLI 输出：

```text
Fabric Dashboard: http://127.0.0.1:7373
```

这是面向维护者的本地 control-plane session。验证 MCP client 或检查 Dashboard 时请保持其运行。

## 阶段 6：验证 MCP 已激活

重启各已配置 client 以重新加载 Fabric MCP entry，然后确认存在以下 Fabric tools：

- `fab_get_rules`
- `fab_append_intent`
- `fab_update_registry`

最小 smoke prompt：

```text
Before editing any file, call fab_get_rules for README.md and summarize the active Fabric rules.
```

成功表现：

- Client 调用 `fab_get_rules`。
- 响应包含 `revision_hash`。
- 响应包含来自 `AGENTS.md` 的 L0 rules。

若 tools 未出现，确认 MCP config 文件包含 `mcpServers.fabric` 或 `[mcp_servers.fabric]`，然后再次重启 client。

## 阶段 7：记录首条 Ledger Entry

做一小段 staged 改动，让 Fabric 通过 hook pipeline 追加首条 intent ledger entry：

```bash
git add README.md
FABRIC_INTENT="docs: refine onboarding copy" fab ledger-append --staged
```

结果：

```text
.intent-ledger.jsonl receives a new append-only JSON line with parent_sha, intent, affected_paths, and diff_stat.
```

至此仓库完成 v1.0 onboarding loop：

1. Fabric 已安装。
2. 项目已初始化。
3. Client rules 通过 MCP 分发。
4. 首条协作事件已写入 ledger。

## 延伸阅读

- [Launch Story](./launch-story.md)
- [Dashboard Tour](./dashboard-tour.md)
- [Contributing](./contributing.md)
- [Initialization Guide](./initialization.md)
- [Roadmap](./roadmap.md)

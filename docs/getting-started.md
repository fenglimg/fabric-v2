# Fabric 上手

Fabric v1.5.0 为维护者提供从本地安装到首条 ledger-backed 协作事件的标准上手路径。若你首次评估 Fabric，从这里开始。

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

- 尚不存在 `.fabric/`。
- 在任意写入步骤前，先审阅既有 `.claude/`、`.cursor/`、`.codex/`、`.windsurf/` 或 `.roo/` config。

Canonical `init` 心智模型：

- `fabric init`
  在 TTY 中启动 wizard，确认 target、阶段选择和 MCP 安装范围后执行。
- `fabric init --yes`
  使用当前 CLI flags 直接执行，不进入 wizard。
- `fabric init --plan`
  仅打印安装计划，不写文件。
- `fabric init --reapply --yes`
  针对已初始化仓库重新应用 Fabric 管理的 scaffold 和后续阶段。

当前推荐的首次初始化路径是：先在 TTY 中运行 `fabric init`，确认 wizard 给出的计划，再让命令执行。若你要在 CI、脚本或非交互终端里运行，请显式使用 `--yes` 或 `--plan`。

`fabric init --plan` 的最小示例：

```text
$ fabric init --plan
Fabric init dry run
Fabric init plan
Target: /path/to/repo
Plan: bootstrap=yes mcp=yes hooks=yes mcp-install=global
Detected clients: Claude Code CLI, Codex CLI
Core writes:
  - /path/to/repo/.fabric/bootstrap/README.md
  - /path/to/repo/.fabric/agents.meta.json
  - /path/to/repo/.fabric/human-lock.json
  - /path/to/repo/.fabric/forensic.json
Mode=default bootstrap=yes mcp=yes hooks=yes
```

非交互执行时的典型调用：

```bash
fabric init --yes
```

当前初始化流程的中文本地化输出应理解为“plan -> scaffold -> stages -> reason”，而不是旧版的单次一把梭示例：

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
  - `assertions`: grouped evidence items
  - `candidate_files`: prioritized review queue

Created `.fabric/bootstrap/README.md`
Created `.fabric/agents.meta.json`
Created `.fabric/human-lock.json`
Created `.fabric/forensic.json`

正在安装 Claude Code 初始化接力...
Installed `.claude/skills/agents-md-init/SKILL.md`
Installed `.claude/hooks/agents-md-init-reminder.cjs`
Created `.claude/settings.json` with Claude Stop hook

--- Installing bootstrap templates... ---
completed bootstrap: ...

--- Configuring MCP clients... ---
Wrote ClaudeCodeCLI config
Wrote Cursor .cursor/mcp.json

--- Installing git hooks... ---
Created .husky/pre-commit
Added prepare script to package.json

已完成一站式初始化。
```

这里的 `bootstrap` 阶段只会确保 `.fabric/bootstrap/README.md` 存在并保持最新，不再生成根级 `AGENTS.md`、`CLAUDE.md` 或 `GEMINI.md`。若仓库已经存在 Fabric 产物，默认 `fabric init` 会保持非破坏性并中止；需要重应用时使用 `fabric init --reapply --yes`。

本阶段结束后，仓库已具备内部 bootstrap guide 与 evidence pack，但在 client-side review 完成前，semantic initialization 尚未结束。

## 阶段 3：完成 AI Handoff

在 Claude Code 或 Codex 中打开同一仓库，用普通消息继续 initialization transaction：

```text
I just ran fabric init in this repo. Finish AGENTS.md initialization.
```

预期结果：

- Claude 的 `agents-md-init` 或 Codex 的 repo skill `fabric-init` 读取 `.fabric/forensic.json`。
- 维护者确认 framework facts 与 invariants。
- Fabric 写入 `.fabric/init-context.json` 并更新项目专属 rule nodes 与 metadata。

若使用 Codex 并希望 hooks 自动提醒，请确认 Codex 配置中已启用 `features.codex_hooks = true`。否则 `.codex/hooks.json` 不会生效，但你仍可手动使用 repo skill `.agents/skills/fabric-init/SKILL.md`。

更完整的 interview 流程（含 framework-confirm 与 invariants 阶段）见 [Initialization Guide](./initialization.md)。

## 阶段 4：验证 Agents 与 Hooks

`fabric init` 已自动完成 bootstrap、MCP config 与 git hooks 的安装。本阶段只需验证结果。

检查 bootstrap 安装结果：

```text
$ ls .fabric/bootstrap/README.md .cursor/mcp.json 2>/dev/null
.fabric/bootstrap/README.md
.cursor/mcp.json
```

检查 git hooks：

```text
$ cat .husky/pre-commit | head -3
#!/bin/sh
FAB_BIN=$(command -v fabric || command -v fab || echo "")
```

> 如需对某个阶段做针对性重跑，可使用独立命令：`fabric bootstrap install`、`fabric config install`、`fabric hooks install`。`--no-bootstrap`、`--no-mcp`、`--no-hooks` 仍可用，但现在属于兼容标志，本质上是在改写 `init` 计划，而不是新的主命令模型。

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
- 响应包含来自 bootstrap guide 或 scoped rule nodes 的 L0/L1/L2 rules。
- 若命中 `activation.tier = "description"` 的节点，响应会包含 `description_stubs`，提示客户端可按描述决定是否进一步加载完整规则。

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

若本次变更有意更新了 `@HUMAN` 保护区，先审查 drift，再批准新的 human-lock hash：

```bash
fabric approve --interactive
```

已经在其他流程里完成逐项审查时，可以使用：

```bash
fabric approve --all
```

至此仓库完成当前稳定版 onboarding loop：

1. Fabric 已安装。
2. 项目已初始化。
3. Client rules 通过 MCP 分发，并可用 Dashboard Rule Topology 检查命中原因。
4. 首条协作事件已写入 ledger。
5. 有意发生的 human-lock drift 已通过 `fabric approve` 明确批准。

## 延伸阅读

- [Launch Story](./launch-story.md)
- [Dashboard Tour](./dashboard-tour.md)
- [Contributing](./contributing.md)
- [Initialization Guide](./initialization.md)
- [Roadmap](./roadmap.md)

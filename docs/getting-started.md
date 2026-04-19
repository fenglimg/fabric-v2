# Fabric 上手

Fabric v1.0 为维护者提供从本地安装到首条 ledger-backed 协作事件的标准上手路径。若你首次评估 Fabric，从这里开始。

贡献与本地仓库设置见 [Contributing](./contributing.md)。`fab init` 状态机与更深 mechanics 见 [Initialization Guide](./initialization.md)。产品叙事版见 [Launch Story](./launch-story.md)。

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

此时应能使用 `fab` 命令：

```text
$ fab --help
Fabric CLI - AI 智能体协作框架 (fab v1.0.0)
USAGE fab bootstrap|init|scan|serve|sync-meta|human-lint|ledger-append|hooks|config|pre-commit
```

## 阶段 2：初始化 Fabric

进入要接入 Fabric 的项目。首次运行建议使用 disposable repository 或干净分支。

```bash
cd ~/projects/my-app
git status --short
fab init
```

推荐前置条件：

- 尚不存在 `AGENTS.md`。
- 尚不存在 `.fabric/`。
- 在任意写入步骤前，先审阅既有 `.claude/`、`.cursor/`、`.codex/`、`.windsurf/` 或 `.roo/` config。

v1.0 launch story 中的中文本地化 stdout 示例：

```text
$ fab init

Fabric v1.0 · control plane

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

已完成首轮落规。
说明:
  - 已写入 fallback `AGENTS.md`
  - 已写入 evidence artifact，供后续 AI interview 复用
  - 当前状态 = initialization pending

Reason: `.fabric/forensic.json` is ready; use the `agents-md-init` skill to finish `AGENTS.md` initialization.
Next: 在 Claude Code 中输入「我刚执行了 fab init，请使用 agents-md-init 完成当前项目初始化。」
Next: 如需先接入提交守卫，继续执行 `fab hooks install`
```

本阶段结束后，仓库具备 fallback contract 与 evidence pack，但在 client-side interview 完成前，semantic initialization 尚未结束。

## 阶段 3：完成 AI Handoff

在 Claude Code 中打开同一仓库，用普通消息继续 initialization transaction：

```text
I just ran fab init in this repo. Finish AGENTS.md initialization.
```

预期结果：

- `agents-md-init` 读取 `.fabric/forensic.json`。
- 维护者确认 framework facts 与 invariants。
- Fabric 写入 `.fabric/init-context.json` 并更新面向实际项目的 `AGENTS.md`。

更完整的 interview 流程（含 framework-confirm 与 invariants 阶段）见 [Initialization Guide](./initialization.md)。

## 阶段 4：配置 Agents 与 Hooks

先安装 Git hook pipeline 与 bootstrap prompts：

```bash
fab hooks install
fab bootstrap install --clients claude,cursor,windsurf,roo,gemini,codex
```

典型输出：

```text
Installed <project>/.husky/pre-commit
Added prepare script to <project>/package.json
Installed <project>/CLAUDE.md
Installed <project>/.cursor/rules/fabric-bootstrap.mdc
Installed <project>/.windsurf/rules/fabric.md
Installed <project>/.roo/rules/fabric.md
Installed <project>/GEMINI.md
Prepended <project>/AGENTS.md
```

然后预览 MCP config 写入：

```bash
fab config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
```

预期输出形态：

```text
[dry-run] ClaudeCodeCLI: would write <path>
[dry-run] Cursor: would write <project>/.cursor/mcp.json
[dry-run] Windsurf: would write <project>/.windsurf/mcp.json
[dry-run] RooCode: would write <project>/.roo/mcp.json
[dry-run] GeminiCLI: would write <path>
[dry-run] CodexCLI: would write <path>
```

若在本 monorepo 运行且需要显式 server entry，见 [Contributing](./contributing.md#fab_server_path)。

## 阶段 5：启动本地 Control Plane

启动本地 Fabric HTTP server：

```bash
fab serve
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

若 tools 未出现，确认 MCP config 文件包含 `mcpServers.fabric` 或 `[mcp.servers.fabric]`，然后再次重启 client。

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

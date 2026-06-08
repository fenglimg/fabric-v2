# Fabric 技术上手

本文只保留工程接入步骤。叙事、发布故事、品牌说明不再作为 `docs/` 的核心入口。

## 1. 安装

全局安装发布版 CLI：

```bash
npm install -g @fenglimg/fabric-cli
```

在本 monorepo 内验证本地源码时，先构建 workspace：

```bash
pnpm install
pnpm -r build
```

检查命令入口：

```bash
fabric --help
fabric doctor --help
```

`fabric` 是 CLI 主命令。

## 2. 初始化目标项目

进入目标仓库，先确认工作区干净或位于可丢弃分支：

```bash
cd /path/to/project
git status --short
fabric install
```

常用模式：

| 命令 | 作用 |
| --- | --- |
| `fabric install` | TTY 下进入 wizard，确认计划后写入。 |
| `fabric install --yes` | 非交互执行当前计划。 |
| `fabric install --plan` | 只打印计划，不写文件。 |
| `fabric install --reapply --yes` | 对已初始化仓库重应用 Fabric 管理文件。 |

初始化会写入或刷新：

- `.fabric/AGENTS.md`
- `.fabric/INITIAL_TAXONOMY.md`
- `.fabric/knowledge/`
- `.fabric/agents.meta.json`
- `.fabric/.cache/knowledge-test.index.json`
- `.fabric/events.jsonl`
- `.fabric/forensic.json`
- `.fabric/init-context.json`（由后续初始化 skill 写入）
- 已检测 AI client 的 MCP 配置
- Git hook 模板

`fabric install` 默认非破坏性。已有 Fabric 产物时，除非显式使用 `--reapply` 或相关 force 行为，否则应中止或跳过冲突写入。

## 3. 完成客户端接力

在 Claude Code、Codex 或其他 MCP-capable client 中打开同一仓库，继续初始化：

```text
我刚运行了 fabric install，请继续完成这个仓库的 Fabric 初始化。
```

预期动作：

- 客户端读取 `.fabric/forensic.json`。
- 维护者确认 framework facts、invariants、受保护区域。
- 初始知识和后续 pending entries 写入 `.fabric/knowledge/`。
- `.fabric/init-context.json` 记录已确认的初始化事实。
- `fabric doctor --fix` 可从 `.fabric/knowledge/` 重建 `.fabric/agents.meta.json` 与 `.fabric/.cache/knowledge-test.index.json`。

Codex hooks 需要本机配置启用 `features.codex_hooks = true`；否则 `.codex/hooks.json` 不会自动触发，但仍可手动执行仓库 skill。

## 4. MCP 接入（stdio-only）

v2.0.0 起 Fabric 仅通过 **stdio MCP transport** 与 client 交互（Claude Code / Cursor / Codex CLI 全部使用 stdio）。`fabric install` 已为每个 client 写好 MCP 配置，client 启动时会 spawn `node packages/server/dist/index.js` 并通过 stdin/stdout 通信，**无需任何本地 HTTP server**。

> v1.8 时代的 `fabric serve`（Express + REST + SSE + Dashboard UI）已在 v2.0.0-rc.37 被 quarantine 到 `packages/server-http-experimental/`（不再 build / test），保留代码仅供未来恢复 web UI 时参考。详情见 [KB 决策 `fabric-serve-quarantine-not-delete`](../.fabric/knowledge/team/decisions/fabric-serve-quarantine-not-delete.md)。

## 5. 验证 MCP 知识分发

重启已配置的 AI client，确认存在 Fabric tools：

- `fab_recall`
- `fab_plan_context`
- `fab_get_knowledge_sections`
- `fab_extract_knowledge`
- `fab_archive_scan`
- `fab_review`

MCP 写入由服务端 instrumentation 自动追加到 `.fabric/events.jsonl`。日常编辑前优先使用 `fab_recall(paths=[...])`，它会直接返回相关 KB 正文；只有当正文过多、需要裁剪噪音时，才退回 `fab_plan_context` + `fab_get_knowledge_sections` 两步流。

最小验证 prompt：

```text
Before editing any file, call fab_recall for README.md and summarize the relevant Fabric knowledge bodies it returns. If the response is too large, call fab_plan_context for README.md, pick the relevant candidates[].stable_id values, then call fab_get_knowledge_sections with the returned selection_token.
```

成功信号：

- 返回 `revision_hash`。
- `fab_recall` 返回 `rules[].body`、`selection_token` 与 structured warnings（如有）。
- `fab_plan_context` 返回 `selection_token`、ranked candidate descriptions。
- `fab_get_knowledge_sections` 返回所选 `stable_id` 的完整正文；调用方按正文中的标题自行扫描需要的信息。
- `client_hash` 与当前 revision 不一致时 `stale: true`。

## 6. 验证 Event Ledger

Fabric 把 MCP 调用和 doctor baseline 接受自动写入 typed Event Ledger：

```text
.fabric/events.jsonl
```

常见事件类型包括：

- `knowledge_context_planned`
- `knowledge_selection`
- `knowledge_sections_fetched`
- `knowledge_proposed`
- `knowledge_promoted`
- `knowledge_archived`
- `mcp_event`

`.fabric/events.jsonl` 是唯一 ledger。`fabric doctor --fix` 可以创建缺失的 events file，但不会迁移或投影其他 ledger。

## 7. 运行 doctor

```bash
fabric doctor
fabric doctor --json
fabric doctor --fix
fabric doctor --fix-knowledge
```

`fabric doctor` 默认只读。`--fix` 只修复可确定重建的派生状态：`.fabric/agents.meta.json`、`.fabric/.cache/knowledge-test.index.json`、缺失的 `.fabric/events.jsonl`、确定性的 bootstrap README 与 stale hashes。知识条目的 demote / archive / default backfill 走 `fabric doctor --fix-knowledge`；语义冲突、未完成的 init-context 确认、MCP client 本地配置问题和业务代码与知识不一致都属于人工处理范围。

## 8. 继续阅读

- [SPEC_INTERNAL](./SPEC_INTERNAL.md)：执行流协议。
- [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md)：源码全景图。
- [ARCHITECTURE_DECISIONS](./ARCHITECTURE_DECISIONS.md)：已实现架构决策。
- [CONVENTIONS](./CONVENTIONS.md)：开发约定。
- [RULE_REGISTRY](./RULE_REGISTRY.md)：Stable ID 与规则注册状态。

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
fab --help
```

`fabric` 是主命令，`fab` 是永久别名。

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

- `.fabric/bootstrap/README.md`
- `.fabric/INITIAL_TAXONOMY.md`
- `.fabric/rules/`
- `.fabric/agents.meta.json`
- `.fabric/rule-test.index.json`
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
- 规则正文写入 `.fabric/rules/`。
- `.fabric/init-context.json` 记录已确认的初始化事实。
- `fabric doctor --fix` 可从 `.fabric/rules/` 重建 `.fabric/agents.meta.json` 与 `.fabric/rule-test.index.json`。

Codex hooks 需要本机配置启用 `features.codex_hooks = true`；否则 `.codex/hooks.json` 不会自动触发，但仍可手动执行仓库 skill。

## 4. 启动本地服务

```bash
fabric serve
```

默认地址：

```text
http://127.0.0.1:7373
```

`fabric serve` 同时承载：

- Dashboard 静态页面
- REST API：`/api/*`
- SSE：`/events`
- Streamable HTTP MCP：`/mcp`

需要非 loopback host 时必须设置 `FABRIC_AUTH_TOKEN`，否则 CLI 会回退到 `127.0.0.1`。

## 5. 验证 MCP 规则分发

重启已配置的 AI client，确认存在 Fabric tools：

- `fab_plan_context`
- `fab_get_rule_sections`

MCP 写入由服务端 instrumentation 自动追加到 `.fabric/events.jsonl`。新流程只需要上述两个 MCP tools。

最小验证 prompt：

```text
Before editing any file, call fab_plan_context for README.md, pick any relevant L1 stable_ids yourself from the returned descriptions, then call fab_get_rule_sections for MISSION_STATEMENT, MANDATORY_INJECTION, BUSINESS_LOGIC_CHUNKS, and CONTEXT_INFO.
```

成功信号：

- 返回 `revision_hash`。
- `fab_plan_context` 返回 `selection_token`、`requirement_profile`、`description_index`。
- `description_index` 中 L0/L2 为 `required: true`，L1 为 `selectable: true`。
- `fab_get_rule_sections` 返回所请求的 section；缺失 section 只返回空字符串和 warning diagnostic，不回退全文。
- L2 规则可提供 `[MISSION_STATEMENT]` 作为脚本职责、物理边界和长期契约的身份握手。
- L2 规则可提供 `[BUSINESS_LOGIC_CHUNKS]` 记录反直觉业务约束；`fabric doctor` 会诊断其中的 `Anchor` 是否 stale、duplicate 或 missing。
- `client_hash` 与当前 revision 不一致时 `stale: true`。

## 6. 验证 Event Ledger

Fabric 把 MCP 调用和 doctor baseline 接受自动写入 typed Event Ledger：

```text
.fabric/events.jsonl
```

常见事件类型包括：

- `rule_context_planned`
- `rule_selection`
- `rule_sections_fetched`
- `rule_drift_detected`
- `rule_baseline_accepted`
- `baseline_synced`
- `mcp_event`

`.fabric/events.jsonl` 是唯一 ledger。`fabric doctor --fix` 可以创建缺失的 events file，但不会迁移或投影其他 ledger。

## 7. 运行 doctor

```bash
fabric doctor
fabric doctor --json
fabric doctor --strict
fabric doctor --fix
```

`fabric doctor` 默认只读。`--fix` 只修复可确定重建的派生状态：`.fabric/agents.meta.json`、`.fabric/rule-test.index.json`、缺失的 `.fabric/events.jsonl`、确定性的 bootstrap README 与 stale hashes。缺失 rule section、语义冲突、未完成的 init-context 确认、MCP client 本地配置问题和业务代码与规则不一致都属于人工处理范围。

## 8. 继续阅读

- [SPEC_INTERNAL](./SPEC_INTERNAL.md)：执行流协议。
- [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md)：源码全景图。
- [ARCHITECTURE_DECISIONS](./ARCHITECTURE_DECISIONS.md)：已实现架构决策。
- [CONVENTIONS](./CONVENTIONS.md)：开发约定。
- [RULE_REGISTRY](./RULE_REGISTRY.md)：Stable ID 与规则注册状态。

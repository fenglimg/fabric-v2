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
fabric init
```

常用模式：

| 命令 | 作用 |
| --- | --- |
| `fabric init` | TTY 下进入 wizard，确认计划后写入。 |
| `fabric init --yes` | 非交互执行当前计划。 |
| `fabric init --plan` | 只打印计划，不写文件。 |
| `fabric init --reapply --yes` | 对已初始化仓库重应用 Fabric 管理文件。 |

初始化会写入或刷新：

- `.fabric/bootstrap/README.md`
- `.fabric/INITIAL_TAXONOMY.md`
- `.fabric/rules/`
- `.fabric/agents.meta.json`
- `.fabric/human-lock.json`
- `.fabric/forensic.json`
- 已检测 AI client 的 MCP 配置
- Git hook 模板

`fabric init` 默认非破坏性。已有 Fabric 产物时，除非显式使用 `--reapply` 或相关 force 行为，否则应中止或跳过冲突写入。

## 3. 完成客户端接力

在 Claude Code、Codex 或其他 MCP-capable client 中打开同一仓库，继续初始化：

```text
我刚运行了 fabric init，请继续完成这个仓库的 Fabric 初始化。
```

预期动作：

- 客户端读取 `.fabric/forensic.json`。
- 维护者确认 framework facts、invariants、受保护区域。
- 规则正文写入 `.fabric/rules/`。
- `.fabric/agents.meta.json` 通过 Fabric tooling 维护 `stable_id`、L0/L1/L2 映射和结构化 description。

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

- `fab_get_rules`
- `fab_plan_context`
- `fab_get_rule_sections`
- `fab_append_intent`
- `fab_update_registry`

最小验证 prompt：

```text
Before editing any file, call fab_plan_context for README.md, pick any relevant L1 stable_ids yourself from the returned descriptions, then call fab_get_rule_sections for MANDATORY_INJECTION and CONTEXT_INFO.
```

成功信号：

- 返回 `revision_hash`。
- `fab_plan_context` 返回 `selection_token`、`requirement_profile`、`description_index`。
- `description_index` 中 L0/L2 为 `required: true`，L1 为 `selectable: true`。
- `fab_get_rule_sections` 返回所请求的 section；缺失 section 只返回空字符串和 warning diagnostic，不回退全文。
- `client_hash` 与当前 revision 不一致时 `stale: true`。

## 6. 写入首条 intent ledger

完成一段真实 staged 改动后追加 intent：

```bash
git add README.md
FABRIC_INTENT="docs: refine onboarding copy" fabric ledger-append --staged
```

当前 ledger 主路径是：

```text
.fabric/.intent-ledger.jsonl
```

旧根路径 `.intent-ledger.jsonl` 只保留兼容读取，迁移应通过 `fabric doctor --fix` 完成。

## 7. 处理 human-lock drift

有意修改受保护区域后，使用 CLI 审批：

```bash
fabric approve --interactive
```

已经完成外部审查时可批量审批：

```bash
fabric approve --all
```

Dashboard 只用于观察状态和定位问题；核心写入动作以 CLI/MCP tool 为准。

## 8. 继续阅读

- [SPEC_INTERNAL](./SPEC_INTERNAL.md)：执行流协议。
- [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md)：源码全景图。
- [ARCHITECTURE_DECISIONS](./ARCHITECTURE_DECISIONS.md)：已实现架构决策。
- [CONVENTIONS](./CONVENTIONS.md)：开发约定。
- [RULE_REGISTRY](./RULE_REGISTRY.md)：Stable ID 与规则注册状态。

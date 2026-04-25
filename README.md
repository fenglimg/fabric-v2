<p align="center">
  <img src="./assets/brand/fabric-wordmark.svg" alt="fabric wordmark" width="220">
</p>

# Fabric v1.5.2

让 AI 与维护者围绕同一套仓库规则协作

The Consensus Plane for AI-Human Collaboration

Fabric v1.5.2 is an MCP-first, cross-client AGENTS.md protocol for six AI clients: Claude Code, Cursor, Windsurf, Roo Code, Gemini CLI, and Codex CLI. It keeps Fabric rule state inside `.fabric/`, distributes scoped rules through a local MCP server, and adds git-level defenses so behavior stays consistent across clients without compiling client-specific rule files first.

> **Current release: v1.5.2**. Fabric 当前开发线已切到 L0/L1/L2 认知分层协议：规则正文进入 `.fabric/rules/`，`.fabric/agents.meta.json` 以 `stable_id` 索引结构化 description，`fab_plan_context` 先返回中立候选池与 `selection_token`，再由 `fab_get_rule_sections` 获取结构化规则段落。初始化流程见 [`docs/initialization.md`](./docs/initialization.md)。

```text
AI Agent <-> Fabric Ledger <-> Human Developer
   asks        records rules        approves
   acts        preserves intent     maintains truth
```

## Architecture

- Regulation: `.fabric/rules/` contains sectioned rule Markdown for the L0/L1/L2 system.
- Metadata: `.fabric/agents.meta.json` stores machine-oriented routing and revision data.
- Intent: `.fabric/.intent-ledger.jsonl` records append-only task intent history. Legacy root `.intent-ledger.jsonl` remains read-only compatible until you run `fabric doctor --fix`.
- Distribution: the Fabric MCP server serves scoped rules to supported clients on demand.
- Defense: pre-commit enforcement protects `@HUMAN` boundaries, metadata integrity, and workflow hygiene.

## 快速开始

1. 安装 Fabric；如果你在这个 monorepo 里验证，再额外构建一次。
2. 在目标项目里运行 `fabric init`。如果当前终端支持 TTY，它会默认进入向导。
3. 启动 `fabric serve`，再去客户端里验证 `fab_plan_context` 与 `fab_get_rule_sections` 是否可用。

`fab` 是永久别名，本文统一使用 `fabric`。
`fabric init` 的常用方式如下：

- `fabric init`
  在 TTY 中打开向导，确认计划后执行。
- `fabric init --yes`
  直接接受当前计划并以非交互方式执行。
- `fabric init --plan`
  仅打印安装计划，不写文件。
- `fabric init --reapply --yes`
  对已有仓库重新应用 Fabric 管理的文件和后续阶段。

`fabric init` 仍会自动执行 bootstrap、MCP 配置和 git hooks。只有在你想单独重跑某个阶段时，才需要使用独立命令。

完整的 7 阶段上手路径、CLI 示例输出和 MCP 检查方式见 [docs/getting-started.md](./docs/getting-started.md)。

## 初始化说明

`fabric init` 不只是生成脚手架。它会先构建安装计划，让 TTY 用户通过向导确认或调整计划，把初始化依据写进 `.fabric/`，安装 Claude/Codex 的后续资产，并把内部初始化说明保留在 `.fabric/bootstrap/README.md`，而不是再生成根目录的 bootstrap 文档。建议先看 [docs/getting-started.md](./docs/getting-started.md)，再用 [docs/initialization.md](./docs/initialization.md) 深入了解状态机、命令参数、bootstrap 协议以及 `agents-md-init` / `fabric-init` 的接力流程。

## Compliance Audit

Enable compliance telemetry reporting in `fabric.config.json`:

```json
{
  "auditMode": "warn"
}
```

Run `fabric doctor --audit` to cross-check AI edit intents against prior rule access events in the last 5 minutes. New clients write `rule_selection` events through `fab_get_rule_sections`; legacy `get_rules` events remain accepted. `warn` prints violations but keeps exit code `0`, `strict` prints violations and exits non-zero, and `off` keeps the audit disabled by default unless you request a manual preview with `--audit`.

## Human-Lock Approval

When a protected region drifts intentionally, approve the new hash from the CLI:

```bash
fabric approve --interactive
fabric approve --all
```

`fabric approve` only updates drifted entries from `.fabric/human-lock.json`; use interactive mode when reviewing each protected range and `--all` only after an external review has already confirmed the drift.

## 规则命中页

`fabric serve` 仍会暴露 `/api/rules/context?path=<file>` 供 Dashboard 做只读观察。MCP 编辑闭环以 `fab_plan_context` + `fab_get_rule_sections` 为准。

## 路线图

后续里程碑见 [docs/roadmap.md](./docs/roadmap.md)，其中包括 `drift-check`、`fabric migrate`、`fabric doctor` 和 Copilot fallback path。

## 进阶命令

只有在需要单独重跑某个阶段时，才使用下面这些命令：

- `fabric bootstrap install`
- `fabric config install`
- `fabric hooks install`

常用 `init` 变体：

- `fabric init --plan`
- `fabric init --yes`
- `fabric init --reapply --yes`
- `fabric approve --interactive`
- `fabric approve --all`

`fabric bootstrap install` 现在只会刷新 `.fabric/bootstrap/README.md` 里的内部初始化说明，不会再生成根级 `AGENTS.md`、`CLAUDE.md` 或 `GEMINI.md`。

## 验证与延伸阅读

- [Fabric 上手](./docs/getting-started.md)
- [初始化指南](./docs/initialization.md)
- [执行流协议](./docs/SPEC_INTERNAL.md)
- [源码全景图](./docs/CODEBASE_LANDSCAPE.md)
- [Release Checklist](./RELEASING.md)

## 当前状态

当前稳定版本是 `v1.5.2`。历史规划仍保留在 `.workflow/`，对外维护的入口以本 README、`docs/` 下的文档和 `.github/workflows/release.yml` 中的发布流程为准。

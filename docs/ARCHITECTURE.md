# Fabric Architecture

本文是当前架构入口。代码、测试、schema 和生成快照是事实源；本文只说明如何定位事实，不复制完整实现细节。

## System Shape

Fabric 是 pnpm monorepo，运行时分为 3 个包：

- `packages/cli`：`fabric` CLI。负责 install、store、sync、info、doctor、config、uninstall、metrics，以及 hook / Skill / MCP client 配置写入。
- `packages/server`：stdio-only MCP server。负责知识检索、提取、review、doctor 服务、event ledger、metrics。
- `packages/shared`：跨 CLI / server 共享的 Zod schema、i18n、错误类型、atomic-write helper 和 resolver 类型。

历史 HTTP / REST / SSE / Dashboard 代码已隔离到 `packages/server-http-experimental`。主线 CLI 不注册 `fabric serve`，server 主线不启动 HTTP listener。

## Runtime Surfaces

Fabric 有 3 个用户可见 surface：

- CLI：人类在 terminal 中运行，例如 `fabric install`、`fabric doctor`、`fabric store`、`fabric sync`、`fabric info`。
- Skill：AI 在对话中做判断，例如 `fabric-archive`、`fabric-review`、`fabric-import`。
- MCP：AI client 调用的 runtime primitive，例如 `fab_recall`、`fab_plan_context`、`fab_get_knowledge_sections`、`fab_extract_knowledge`、`fab_archive_scan`、`fab_review`。

设计规则：确定性 I/O 放 CLI 或 server service；需要 LLM 判断的流程放 Skill；session 内知识读取走 MCP。

## Source Of Truth

不要从 prose 文档推断当前行为。先看这些代码入口：

- CLI registry：`packages/cli/src/commands/index.ts`
- install flags：`packages/cli/src/commands/install-v2.ts` 和 `packages/cli/src/install/pipeline/types.ts`
- install stage order：`packages/cli/src/install/pipeline/index.ts` 与 `packages/cli/src/install/pipeline/*.stage.ts`
- store / sync / info 行为：`packages/cli/src/store/*`、`packages/cli/src/sync/*`、`packages/cli/src/commands/{store,sync,info}.ts`
- MCP tools：`packages/server/src/tools/*.ts`
- MCP server instructions：`packages/server/src/index.ts`
- doctor 行为：`packages/server/src/services/doctor.ts`
- shared contracts：`packages/shared/src/schemas/*.ts`

当本文和代码冲突时，代码胜出；修文档时应让本文指回代码锚点，而不是再写一份完整事实。

## Install Pipeline

当前 `fabric install` 是 pipeline-based install：

1. `preflight`
2. `env`
3. `store`
4. `hooks`
5. `mcp`
6. `validate`
7. `guidance`

公开参数以 `install-v2.ts` 的 citty command 和 `InitArgs` 为准。不要在文档中维护旧的 `--force`、`--reapply`、`--scope`、`--plan` 说明；当前 preview 行为是 `--dry-run`。

## Knowledge Storage

知识条目只生活在 mounted stores 下的 `knowledge/` tree。项目通过 `fabric store bind` 和 `fabric store switch-write` 选择 read/write store。根目录 `AGENTS.md` / `CLAUDE.md` 是 AI policy anchor，不是 MCP 自动加载的知识库。

## Update Policy

架构变化只更新本文的定位信息和必要图景。具体字段、参数、工具输入输出、事件结构，应优先在代码/schema/test 中维护，并让文档链接过去。

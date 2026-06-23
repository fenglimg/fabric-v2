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
- MCP：AI client 调用的 runtime primitive，例如 `fab_recall`、`fab_propose`、`fab_archive_scan`、`fab_review`。

设计规则：确定性 I/O 放 CLI 或 server service；需要 LLM 判断的流程放 Skill；session 内知识读取走 MCP。

## Store-Only Knowledge Architecture

最终架构是 store-only：知识 source of truth 只在 mounted stores 的
`knowledge/` tree 下。项目本地 `.fabric/knowledge` 不是 runtime 知识源；
它只允许作为显式一次性迁移/import 的输入。

Store-only 设计区分 3 个 identity：

- `project_id`：代码库身份。一个 repo/worktree 家族共享它。
- `active_project`：当前工作上下文参与的知识 project scope。运行时一次只
  有一个 active project。
- `workspace_binding_id`：本机 runtime binding key。默认等于
  `project_id`；当某个 worktree 需要不同 active project / write routes /
  hook state 时，用它隔离 `~/.fabric/state/bindings/<id>_resolved.json`。

Scope 与 store 是两个轴：

- `semantic_scope`：逻辑受众，例如 `personal`、`team`、
  `project:fabric-v2`、`org:acme:team:platform`。
- `visibility_store`：条目实际所在 store 的 alias/UUID provenance。
- resolver 负责把 `semantic_scope` 映射到 writable store；Skill/agent 只提出
  scope，server 负责校验和写入。

Personal store 是隐式私有层，不写入项目 `required_stores`。Personal scope
永远写入 personal store；把 personal scope 或 `KP-*` 放入 shared store 是隐私
错误，应由 write path / doctor / sync 阻断。

Shared store 写入使用 `write_routes`：

```json
{
  "active_project": "fabric-v2",
  "write_routes": [
    { "scope": "project:fabric-v2", "store": "team" }
  ]
}
```

单 shared store onboarding 可以自动写 route；多 shared store 场景下缺少
route 是 hard error，不能静默回退到 `active_write_store`。`switch-write` /
`active_write_store` 只保留为兼容/默认提示，不是最终路由语义。

Pending entries 是 review-only，不进入普通 `fab_recall`。`fab_recall` 只读取
canonical store entries，并以 `alias:id` 加 structured provenance 表达引用。

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

知识条目只生活在 mounted stores 下的 `knowledge/` tree。项目通过
`fabric store bind` 声明 read-set，通过 `write_routes` 选择 scope-aware
write target。根目录 `AGENTS.md` / `CLAUDE.md` 是 AI policy anchor，不是
MCP 自动加载的知识库。

## Store-Only Completion Gate

Grill 后锁定的架构不是单个 resolver 改动，而是 surface alignment gate。
完成标准：

- Shared schema/resolver：`semantic_scope`、`visibility_store`、
  `workspace_binding_id`、read-set/write-target contract 有测试。
- CLI install/store：onboarding 写 `project:<active_project> -> store`
  route；multi shared store 缺 route hard fail。
- Server write/MCP：`fab_propose` 接受 `semantic_scope`，写入
  resolved store；MCP schema 不再描述 workspace/home pending root。
- Hooks：只读 generated binding snapshot；snapshot key 为
  `workspace_binding_id`，不自行解析 store tree。
- Skills：使用 scope-first/store-only 语言，不手写旧 pending path 或 ledger
  path。
- Doctor/sync：阻断 personal leak、无效 route、scope metadata 缺失、stale
  snapshot/index。
- Derived index：store-local canonical index + binding-level filtered view；
  markdown 仍是 source of truth。
- Event/metrics：最终 runtime ledger 在 global state，按
  `workspace_binding_id` 分区；project-root event files 仅是 legacy input。

当前 `feat/store-only-surface-alignment` 已完成核心写路由和 binding snapshot
切片；skills、review modify-scope、derived index、global event ledger、sync
hard gates 仍是后续 release-gate 工作，不能在文档或 release note 中声明全
矩阵完成。

## Update Policy

架构变化只更新本文的定位信息和必要图景。具体字段、参数、工具输入输出、事件结构，应优先在代码/schema/test 中维护，并让文档链接过去。

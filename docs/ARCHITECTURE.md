# Fabric Architecture

本文是当前架构入口。代码、测试、schema 和生成快照是事实源；本文只说明如何定位事实，不复制完整实现细节。

## System Shape

Fabric 是 pnpm monorepo，运行时分为 3 个包：

- `packages/cli`：`fabric` CLI。负责 install、store、sync、info、doctor、config、uninstall、audit、inspect，以及 hook / Skill / MCP client 配置写入。
- `packages/server`：stdio-only MCP server。负责知识检索、提取、review、doctor 服务、event ledger、metrics。
- `packages/shared`：跨 CLI / server 共享的 Zod schema、i18n、错误类型、atomic-write helper 和 resolver 类型。

历史 HTTP / REST / SSE / Dashboard 代码已隔离到 `packages/server-http-experimental`。主线 CLI 不注册 `fabric serve`，server 主线不启动 HTTP listener；该 package 被 `pnpm-workspace.yaml` 排除，也不得进入主线 package dependency、module specifier、CI 或 release input。

## Runtime Surfaces

Fabric 有 3 个用户可见 surface：

- CLI：人类在 terminal 中运行，例如 `fabric install`、`fabric doctor`、`fabric store`、`fabric sync`、`fabric info`。
- Skill：AI 在对话中做判断，例如 `fabric-archive`、`fabric-review`、`fabric-import`。
- MCP：AI client 调用的 runtime primitive，例如 `fab_recall`、`fab_propose`、`fab_pending`、`fab_archive_scan`、`fab_review`。

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

## ProjectContext SSOT

项目上下文由 `packages/shared/src/resolver/project-context-resolver.ts` 单一拥有，
server、CLI 与 generated hook runtime 只消费同一个 `ProjectContext` contract：

- `workspaceRoot` 是当前实际工作树；项目相对的读取、写入与提示路径以它为基准。
- `identityRoot` 是 Git common identity 对应的主工作树。linked worktree 默认从这里
  继承 `project_id` 和 store routes。
- `projectId` 来自 `identityRoot/.fabric/fabric-config.json`。
- `bindingId` 默认继承 `projectId`；只有当前 `workspaceRoot` 显式声明
  `workspace_binding_id` 时，才为该 worktree 隔离 resolved binding 和 hook state。
- `source` 记录本次解析来自 `explicit-pin`、`client-root` 或兼容 `cwd` 信号。

解析优先级是 explicit pin > MCP client roots > cwd adapter。shared resolver 对零个
可解析 root 抛出 `FABRIC_PROJECT_CONTEXT_UNRESOLVED`，对多个不同
`workspaceRoot` 抛出 `FABRIC_PROJECT_CONTEXT_AMBIGUOUS`；歧义必须 fail loud，不能
选择最近安装项目。server 的 `ProjectContextProvider.snapshotForCall()` 在 handler
开始时取得并冻结一份快照，因此 roots 在请求处理中更新只影响下一次调用。当前
provider 仍为部分 legacy cwd/marker caller 保留 unresolved compatibility adapter；
新 project/team 边界应直接依赖 typed resolver error，不能扩大该 fallback。

MCP client 配置默认是 dynamic，不持久化 `FABRIC_PROJECT_ROOT`。只有显式 pinned
模式才写入 root 以及 `FABRIC_PROJECT_ROOT_PROVENANCE=operator:v1|project:v1`。
generated CommonJS hook adapter 由 shared resolver entry 构建，提交前运行
`pnpm --filter @fenglimg/fabric-cli build:hook-project-context`；
`hooks-runtime-generated.test.ts` 要求生成结果与
`templates/hooks/lib/project-context-runtime.cjs` byte-identical，禁止手改生成文件。

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
- ProjectContext owner：`packages/shared/src/resolver/project-context-resolver.ts`、
  `git-worktree-identity.ts` 与 `contracts.ts`

当本文和代码冲突时，代码胜出；修文档时应让本文指回代码锚点，而不是再写一份完整事实。

## Extending（加新 MCP tool / Skill / doctor check）

- **MCP tool**：schema 进 `packages/shared/src/schemas/api-contracts.ts`；service 进 `packages/server/src/services/`；tool wrapper 进 `packages/server/src/tools/`；在 `packages/server/src/index.ts` 的 `createFabricServer` 注册。
- **Skill**：canonical 模板在 `packages/cli/templates/skills/<slug>/SKILL.md`；`fabric install` 分发到各 client。
- **Doctor check**：inspection 函数进 `packages/server/src/services/doctor.ts`；i18n key 进 `packages/shared/src/i18n/locales/{zh-CN,en}.ts`；在 `runDoctorReport` 的 checks 列表注册；`packages/server/src/services/doctor.test.ts` 的 snapshot 计数需同步更新。

提交规范：`<type>(<scope>): <中文描述>`，type ∈ feat/fix/refactor/docs/chore/test/perf；多任务计划优先一任务一 commit。

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

## Uninstall Pipeline

`fabric uninstall` 是 install 的对称逆操作，5 个阶段（执行顺序为 install 的逆序）：

1. `bootstrap` — 移除 Skills + hook 脚本，un-merge hook-config，strip bootstrap 指针行，删 snapshot
2. `mcp` — 每个 client 的 `writer.remove('fabric')`
3. `store` — **默认跳过**；仅在 `--unbind-store` 或向导勾选时执行：解绑本项目对 team store 的 binding（清 `required_stores` / `write_routes` / `active_write_store` / `active_project`）
4. `scaffold` — best-effort 删项目本地 `.fabric/` state 文件（`agents.meta.json` / `events.jsonl` / `forensic.json`）
5. `validate` — 确认 bootstrap 产物已清

硬不变量：`~/.fabric/stores/` 下的全局知识 store **永不删除**（任何 flag 都不行，guard 在 `buildUninstallFabricPlan` + `unbindStoreProject`）；所有阶段 best-effort，缺失产物记 `skipped` 不抛错。预览走 `--dry-run`。入口：`packages/cli/src/commands/uninstall.ts`。

## CLI Output（flat-design renderer）

CLI 输出是**纯字符串合成**，不依赖 Ink / React / `.tsx`（历史 TSX 组件已内联删除）。技术栈：

- 命令框架：`citty`（`packages/cli/src/commands/*`）
- 交互 prompt：`@clack/prompts`（select / confirm / multiselect）
- 渲染：`packages/cli/src/tui/ConsoleOutputRenderer.ts` 实现 `OutputRenderer`，用 `headerRule` / `grid` / `tree` 结构原语 + 共享 theme 调色板；`NO_COLOR` / 非 TTY 下每个原语确定性降级
- 阶段行：`● <stage> ✓ <detail>`，每阶段**只渲染一次**（完成时；不再用「占位行 + 光标上移覆盖」，那对中途插入的输出脆弱）；rich detail（MCP client 名 / skill·hook 拆分）折进该行，总结卡只做聚合统计
- team slot：别名与类别词冲突（如别名字面就叫 `team`）时，状态/「保持当前」选项追加 store 短名（mount / remote）消歧，短名与别名相同则省略
- 构建：`tsup`（ESM，`dist/index.js` 为 bin）；文案全走 `packages/shared/src/i18n`（en + zh-CN parity）

事实源是 `ConsoleOutputRenderer.ts` 与各 `*.stage.ts`；本文不复制具体行格式。

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

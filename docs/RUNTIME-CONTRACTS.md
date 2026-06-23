# Fabric Runtime Contracts

本文是 runtime contract 入口。它不维护完整字段清单；字段事实以 Zod schema、tool registration、command definition 和测试为准。

## CLI Contract

当前 top-level CLI registry 在 `packages/cli/src/commands/index.ts`。

Public commands:

- `install`
- `store`
- `sync`
- `info`
- `doctor`
- `uninstall`
- `config`
- `metrics`

Deprecated aliases:

- `whoami`
- `status`
- `scope-explain`

Hidden or script-facing commands:

- `plan-context-hint`
- `onboard-coverage`

Removed from mainline:

- `serve`：HTTP server 已 quarantine 到 `packages/server-http-experimental`
- `scan`：顶层命令已移除，deterministic scanner 只作为 install / doctor 内部能力
- `hooks install`：不再是 public command，hook 写入由 `fabric install` pipeline 管理

Install 参数以 `packages/cli/src/commands/install-v2.ts` 和 `InitArgs` 为准。

## MCP Tool Contract

当前 MCP tool set 在 `packages/server/src/index.ts` 注册：

- `fab_recall`
- `fab_propose`
- `fab_archive_scan`
- `fab_review`

Tool 输入输出 schema 以 `packages/shared/src/schemas/api-contracts.ts` 和 `packages/server/src/tools/*.ts` 为准。server-level guidance 以 `FABRIC_SERVER_INSTRUCTIONS` 为准。

Write-side contract:

- `fab_propose` is scope-first. Callers may provide
  `semantic_scope`; server validates the coordinate and resolves the physical
  store through `write_routes`.
- `layer` is a compatibility audience hint only. It must not be treated as the
  final routing primitive. `semantic_scope: personal` writes as personal; a
  conflicting `semantic_scope`/`layer` pair is rejected.
- The returned `pending_path` is the store-backed pending file path. Runtime
  must not fall back to project-local `.fabric/knowledge/pending`.
- Pending entries are review-only. Normal retrieval tools do not inject pending
  entries.

Preferred retrieval flow:

1. 用 `fab_recall(paths)` 一次拿到候选描述和每条 entry 的 native read path。
2. 需要某条正文时，对返回的 read path 做一次 native Read 按需读取;`fab_recall` 不通过 MCP 投递正文。

## Knowledge Entry Contract

知识类型仍是 5 类：

- `decisions`
- `pitfalls`
- `guidelines`
- `models`
- `processes`

稳定 ID、frontmatter、maturity、scope、store provenance 和事件结构以 shared schema 为准。不要在 prose 文档里重新维护 field table；改 schema 后同步测试，再更新本文的入口说明即可。

## Configuration Contract

项目配置以 `.fabric/fabric-config.json` 和 `packages/shared/src/schemas/fabric-config.ts` 为准。全局 store 配置以 `~/.fabric` 下的 global config / mounted store layout 为准。

Store-only config identities:

- `project_id` identifies the codebase.
- `active_project` identifies the single knowledge project scope active in this
  working context.
- `workspace_binding_id` keys local runtime binding state. Omit it to use
  `project_id`; set it only when a worktree needs isolated bindings.

Store routing:

- `required_stores` declares explicit shared stores in the read-set. Personal
  store is implicit and should not be listed there.
- `write_routes` maps `semantic_scope` coordinates to writable shared stores.
- In multi shared-store mode, a non-personal write without an explicit route or
  default route is a configuration error.
- `active_write_store` / `default_write_store` are compatibility/default
  fields, not the final architecture's primary routing model.

人类修改配置优先使用：

- `fabric config`
- `fabric store ...`
- `fabric install`
- `fabric doctor --fix`

仅当 CLI 无法运行时才手动编辑 JSON，并随后运行 `fabric doctor`。

## Event And Metrics Contract

Audit-grade event ledger 与 metrics sidecar 的格式以 shared schema 和 server service 为准：

- event schema：`packages/shared/src/schemas/event-ledger.ts`
- doctor / history / cite coverage：`packages/server/src/services/doctor*.ts`
- metrics：`packages/server/src/services/metrics.ts`

文档可以描述用途，但不应复制事件字段全集。

Final target: cross-store event/metrics state is global and keyed by
`workspace_binding_id`. Existing project-root `.fabric/events.jsonl` paths are
legacy/runtime debt until the ledger migration lands; do not introduce new
runtime surfaces that depend on project-local event ledgers.

## Drift Rule

如果 runtime 行为变了，优先更新：

1. implementation
2. Zod schema / command definitions
3. tests / snapshots
4. 本文入口说明

不要新增平行的 Markdown contract 表。

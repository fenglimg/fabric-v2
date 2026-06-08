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
- `fab_plan_context`
- `fab_get_knowledge_sections`
- `fab_extract_knowledge`
- `fab_archive_scan`
- `fab_review`

Tool 输入输出 schema 以 `packages/shared/src/schemas/api-contracts.ts` 和 `packages/server/src/tools/*.ts` 为准。server-level guidance 以 `FABRIC_SERVER_INSTRUCTIONS` 为准。

Preferred retrieval flow:

1. 默认用 `fab_recall(paths)` 一次拿到相关知识正文。
2. 只有当正文过大需要裁剪时，才用 `fab_plan_context(paths)` 拿 `selection_token` 和候选描述，再用 `fab_get_knowledge_sections` 拉取选中的正文。

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

## Drift Rule

如果 runtime 行为变了，优先更新：

1. implementation
2. Zod schema / command definitions
3. tests / snapshots
4. 本文入口说明

不要新增平行的 Markdown contract 表。

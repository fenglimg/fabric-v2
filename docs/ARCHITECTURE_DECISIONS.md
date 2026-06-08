# ARCHITECTURE_DECISIONS: 架构决策记录

本文只记录已经有源码证据或已形成明确约束的架构选择。未完全落地的约束必须标明偏离点。

## ADR-001: CLI / Server / Shared 分层（v2.0.0 后 3 层）

决策（v2.0.0）：`cli` 只承载命令面和本地写入编排，`server` 承载 MCP stdio runtime（tools + services + event ledger），`shared` 承载 schema/type/i18n/detector。HTTP/REST/SSE 与 Dashboard package 在 v2.0.0-rc.37 已 quarantine 到 `packages/server-http-experimental/`（不 build / 不 test），见 KB [[fabric-serve-quarantine-not-delete]]。

原因：

- 避免 CLI 复制协议 schema。
- 三个受支持的 client（Claude Code / Cursor / Codex CLI）全部使用 stdio MCP，HTTP server 不再有消费者。
- 保留 quarantine 包以便未来恢复 web UI（参考 `packages/server-http-experimental/README.md`）。

证据：

- CLI subcommands lazy registry：`packages/cli/src/commands/index.ts:1`。
- Server tool registration：`packages/server/src/index.ts:49`。
- Shared schemas 被 server 消费：`packages/server/src/tools/recall.ts`、`packages/server/src/tools/knowledge-sections.ts`。
- 历史 REST routes + Dashboard 实现：`packages/server-http-experimental/src/`（archived）。

## ADR-002: MCP-first Knowledge Distribution

决策：knowledge 通过 MCP tools 按需分发，不预编译进每个 client prompt file。

原因：

- 保持 narrow knowledge 对 path 敏感。
- 允许 clients 传入 `client_hash` / `session_id`，并检测 stale knowledge revisions。
- 将 recall、selection token、description-stub 逻辑集中在 server。

证据：

- `fab_recall` 是默认编辑前召回入口；`fab_plan_context` + `fab_get_knowledge_sections` 是大响应裁剪时的两步回退。
- `client_hash` stale detection 位于 shared/API contract 与 retrieval services。
- Knowledge matching 和 relevance filtering 位于 `packages/server/src/services/plan-context.ts` / `packages/server/src/services/recall.ts`。
- Bootstrap README 保持为 MCP resource：`packages/server/src/index.ts:54`。

## ADR-003: `relevance_paths + maturity + layer` Knowledge Selection

决策：knowledge entry 是否适用由 frontmatter metadata 与 target paths 计算，再按 retrieval ranking 输出。

原因：

- Frontmatter metadata 是 review 后的 canonical contract。
- `relevance_scope` / `relevance_paths` 让 narrow knowledge 只在相关路径出现。
- `maturity` 与 `layer` 决定条目健康和可见性边界。

证据：

- Frontmatter schema 要求 `knowledge_type`、`maturity`、`relevance_scope`、`relevance_paths` 等字段：`packages/shared/src/schemas/api-contracts.ts`。
- `MaturitySchema` 当前为 `draft` / `verified` / `proven`。
- Selection token 与 fetched body contract 位于 `packages/server/src/services/plan-context.ts` / `packages/server/src/services/knowledge-sections.ts`。

## ADR-004: Frontmatter Stable ID Carrier

决策：stable knowledge identity 使用 frontmatter `stable_id` / `id` 作为声明载体：

```yaml
stable_id: KT-DEC-0001
```

原因：

- 兼容 Markdown knowledge files 和 pending review flow。
- frontmatter 同时承载 type、maturity、layer、relevance paths。
- store-qualified refs 可以在多 store read-set 中消除 local id shadow。
- 中文正文可以保留，同时给 clients 一个稳定 ID anchor。

证据：

- Shared schema 支持 `StableIdSchema`：`packages/shared/src/schemas/api-contracts.ts`。
- Multi-store stable id helpers 位于 `packages/shared/src/schemas/store-stable-id.ts`。
- Bootstrap canonical text teaches `KB: <store-alias>:<id>` when needed。

影响：

- 没有 stable id 的 legacy entries 必须经 review / doctor knowledge repair 补齐或隔离。
- `fab_recall` / `fab_get_knowledge_sections` 对 layer flip 后的 id 变化提供 redirect metadata。

## ADR-005: Doctor Fix Rebuilds Derived Knowledge Indexes

决策：derived indexes 由 `fabric doctor --fix` 从 `.fabric/knowledge/` 和 mounted stores 重建，不在 hot path 中手写修复。

原因：

- 保持 retrieval path 足够快。
- 让 Doctor、MCP tools 和 hook hints 消费同一份 derived metadata。
- Revision 可以覆盖 identity 变化。

证据：

- `.fabric/knowledge/` 和 mounted stores 是知识正文真源。
- `.fabric/agents.meta.json` 是 derived machine index。
- Revision source 包含 `id`、`hash`、`stable_id`、`identity_source`。

## ADR-006: Streamable HTTP MCP Uses Per-session Servers

决策：HTTP MCP 为每个 MCP session 创建一个 `McpServer` 和 `StreamableHTTPServerTransport`。

原因：

- MCP HTTP 在 initialize 后需要 session continuity。
- Per-session server 允许 notifications 定向到 active sessions。
- Event store 可以 replay JSON-RPC stream events。

证据：

- 实现已 quarantine 到 `packages/server-http-experimental/src/http.ts`（v2.0.0-rc.37 Wave A2 Part 2，KB [[fabric-serve-quarantine-not-delete]]）；v2.0.0 起 stdio MCP 是唯一受支持的 transport。

## ADR-007: Dashboard Is HTTP Consumer, Not MCP Client（已 quarantine — v2.0.0-rc.37）

历史决策：Dashboard 使用 REST 和 SSE APIs，不使用 MCP tools。Browser UI 需要 fetch/EventSource 语义，所以 MCP 保留为 AI-client runtime protocol，Dashboard 走 HTTP read models。

v2.0.0 现状：Dashboard package 与 HTTP routes 一并 quarantine 到 `packages/server-http-experimental/`（不 build / 不 test）。`fabric serve` 命令不再主线暴露，主线 server 是 stdio MCP only。如需恢复，参考 `packages/server-http-experimental/README.md` 的复活路径与 KB [[fabric-serve-quarantine-not-delete]]。

## ADR-008: Dashboard Write Surface Is Being Constrained Toward Observation（已 quarantine — v2.0.0-rc.37）

历史决策：Dashboard 的架构目标是 observation-first，核心写入保留在 CLI/MCP tooling。防止 browser UI 变成 rule truth source；将可审查的状态变更保留在能追加 ledger/audit context 的 CLI/MCP paths。

v2.0.0 现状：Dashboard package 与全部 HTTP routes 一同 quarantine（见 ADR-007）。Read-only write-surface 边界保留在 server-http-experimental 内部，供未来 web UI 复活时复用。规则真源始终是 `.fabric/`；deterministic derived-state repair 始终走 `fabric doctor --fix`。

## ADR-009: Event Ledger Is The Only Ledger

决策：当前 Event Ledger path 是 `.fabric/events.jsonl`，并且是唯一 ledger。

原因：

- 将 Fabric state 收口到一个 typed Event Ledger。
- 避免多个 ledger 读写路径产生冲突。
- 让 doctor/fix 只负责目标状态诊断和 deterministic repair。

证据：

- Constants：`packages/server/src/services/_shared.ts:9`。
- Event Ledger append/read service：`packages/server/src/services/event-ledger.ts:16`。

## ADR-010: Doctor Is Target-State Diagnosis

决策：`fabric doctor` 默认只读，围绕 target-state MCP readiness 诊断 `.fabric/`。

原因：

- 诊断输出必须可机器读取。
- `--strict` 让 CI 能把 warnings/errors 变成非零退出。
- `--fix` 只修复可确定重建的派生状态。

证据：

- Doctor report categories are `fixable_errors`、`manual_errors`、`warnings`。
- Fixable state includes `.fabric/agents.meta.json`、`.fabric/rule-test.index.json`、missing `.fabric/events.jsonl`、deterministic bootstrap README、stale meta hashes。
- Manual state includes semantic knowledge conflicts、incomplete init-context confirmation、MCP client local config issues、business-code-versus-knowledge mismatch。

## ADR-011: Dashboard Static Served By Server Package（已 quarantine — v2.0.0-rc.37）

历史决策：server package 在 production 中提供已构建的 Dashboard static assets，由 `fabric serve` 同时暴露 MCP、REST、SSE 和 UI。

v2.0.0 现状：三个受支持的 client（Claude Code / Cursor / Codex CLI）全部使用 **stdio MCP transport**，HTTP server 不再有消费者。`fabric serve` 命令及其全部依赖（http.ts / bearer-auth / serve-lock / api routes / Dashboard static handler）已 quarantine 到 `packages/server-http-experimental/`（不 build / 不 test），见 KB [[fabric-serve-quarantine-not-delete]] 设计取舍。

## ADR-012: Localhost Default With Token-required Public Host（已 quarantine — v2.0.0-rc.37）

历史决策：`fabric serve` 默认使用 loopback；请求 non-loopback host 且未设置 `FABRIC_AUTH_TOKEN` 时回退到 `127.0.0.1`。

v2.0.0 现状：随 `fabric serve` quarantine 一并归档；FABRIC_AUTH_TOKEN 不再被主线代码读取。如需恢复，参考 `packages/server-http-experimental/README.md` 的复活路径。

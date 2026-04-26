# ARCHITECTURE_DECISIONS: 架构决策记录

本文只记录已经有源码证据或已形成明确约束的架构选择。未完全落地的约束必须标明偏离点。

## ADR-001: CLI / Server / Shared / Dashboard 分层

决策：`cli` 只承载命令面和本地写入编排，`server` 承载 MCP/HTTP/REST/SSE，`shared` 承载 schema/type/i18n/detector，`dashboard` 只通过 HTTP API 消费数据。

原因：

- 避免 Dashboard 或 CLI 复制协议 schema。
- MCP tool 和 REST API 可以共享 server services。
- Browser 不直接读取 `.fabric/*`，减少文件系统权限和状态竞争。

证据：

- CLI subcommands lazy registry：`packages/cli/src/commands/index.ts:1`。
- Server tool registration：`packages/server/src/index.ts:49`。
- REST APIs 调用 services：`packages/server/src/api/rules-context.ts:17`。
- Dashboard 调用 `/api/rules` 和 `/api/rules/context`：`packages/dashboard/src/api/client.ts:129`。
- Shared schemas 被 server 和 dashboard 消费：`packages/server/src/tools/get-rules.ts:2`, `packages/dashboard/src/api/client.ts:1`。

## ADR-002: MCP-first Rule Distribution

决策：rules 通过 MCP tools 按需分发，不预编译进每个 client prompt file。

原因：

- 保持 scoped rules 对 path 敏感。
- 允许 clients 传入 `client_hash`，并检测 stale rule revisions。
- 将 priority、activation、description-stub 逻辑集中在 server。

证据：

- `fab_plan_context` 和 `fab_get_rule_sections` 是当前 MCP 编辑闭环。
- `client_hash` stale detection：`packages/server/src/services/get-rules.ts:85`。
- Rule matching 和 priority 位于 service：`packages/server/src/services/get-rules.ts:145`。
- Bootstrap README 保持为 MCP resource：`packages/server/src/index.ts:54`。

## ADR-003: `scope_glob + priority + layer` Rule Selection

决策：rule node 是否适用由 metadata fields 计算，再按 priority 和 node id 排序。

原因：

- Metadata 解析和缓存成本低。
- Priority 明确且确定。
- Node id 作为 tie-break，保证输出稳定。

证据：

- Node schema 要求 `scope_glob`、`priority`、`layer`、`topology_type`、`hash`：`packages/shared/src/schemas/agents-meta.ts:23`。
- Priority 顺序是 `high`、`medium`、`low`：`packages/server/src/services/get-rules.ts:77`。
- 先按 priority 再按 node id 排序：`packages/server/src/services/get-rules.ts:150`。

## ADR-004: HTML Comment Stable ID Carrier

决策：stable rule identity 使用 HTML comment header 作为声明载体：

```html
<!-- fab:rule-id scope/name -->
```

原因：

- 兼容 Markdown rule files 和现有 AGENTS-style documents。
- 不需要解析 frontmatter。
- 规则索引 builder 可以低成本提取。
- 中文正文可以保留，同时给 clients 一个稳定英文 anchor。

证据：

- Shared schema 支持 `stable_id` 和 `identity_source`：`packages/shared/src/schemas/agents-meta.ts:31`。
- 已有 derived fallback：`packages/shared/src/schemas/agents-meta.ts:67`。
- 规则索引 builder 用 HTML comment regex 提取 declared id。
- 现有 bootstrap templates 已使用 `fab:rule-id`：`templates/bootstrap/CLAUDE.md:1`, `templates/bootstrap/codex-AGENTS-header.md:1`。

影响：

- 没有 declared IDs 的 rule files 仍可路由，但 `identity_source: "derived"` 应视为 migration warning。
- `fab_plan_context` 已经输出 `derived_identity` diagnostics：`packages/server/src/services/plan-context.ts:172`。

## ADR-005: Doctor Fix Precompiles Rule Identity

决策：stable identity 由 `fabric doctor --fix` 从 `.fabric/rules/` 编译进 `.fabric/agents.meta.json`，不在 rule delivery hot path 中临时提取。

原因：

- 保持 rule delivery path 足够快。
- 让 Dashboard、Doctor、MCP tools 和 shared bundles 消费同一份 identity metadata。
- Revision 可以覆盖 identity 变化。

证据：

- `.fabric/rules/` 是规则正文真源。
- `.fabric/agents.meta.json` 是 derived machine index。
- Revision source 包含 `id`、`hash`、`stable_id`、`identity_source`。

## ADR-006: Streamable HTTP MCP Uses Per-session Servers

决策：HTTP MCP 为每个 MCP session 创建一个 `McpServer` 和 `StreamableHTTPServerTransport`。

原因：

- MCP HTTP 在 initialize 后需要 session continuity。
- Per-session server 允许 notifications 定向到 active sessions。
- Event store 可以 replay JSON-RPC stream events。

证据：

- `/mcp` 读取 `mcp-session-id`：`packages/server/src/http.ts:217`。
- 缺少 session id 时，只有 initialize 请求会被接受：`packages/server/src/http.ts:231`。
- `createSession` 构造 server 和 transport：`packages/server/src/http.ts:272`。
- Transport 使用 `sessionIdGenerator`、`enableJsonResponse`、`eventStore`：`packages/server/src/http.ts:278`。

## ADR-007: Dashboard Is HTTP Consumer, Not MCP Client

决策：Dashboard 使用 REST 和 SSE APIs，不使用 MCP tools。

原因：

- Browser UI 需要低摩擦的 fetch/EventSource 语义。
- MCP 保持为 AI-client runtime protocol。
- REST APIs 可以暴露面向可视化优化的 read models。

证据：

- Dashboard API client 调用 `/api/rules`：`packages/dashboard/src/api/client.ts:129`。
- Dashboard API client 调用 `/api/rules/context`：`packages/dashboard/src/api/client.ts:133`。
- Dashboard SSE client 使用 fetch stream 和 `Last-Event-ID`：`packages/dashboard/src/api/client.ts:194`。
- Server 将 Dashboard REST APIs 与 `/mcp` 分开注册：`packages/server/src/http.ts:208`。

## ADR-008: Dashboard Write Surface Is Being Constrained Toward Observation

决策：Dashboard 的架构目标是 observation-first，核心写入保留在 CLI/MCP tooling。

原因：

- 防止 browser UI 变成 rule truth source。
- 将可审查的状态变更保留在能追加 ledger/audit context 的 CLI/MCP paths。
- 降低 `.fabric/*` 上的 concurrent write ambiguity。

当前目标状态：

- Read-heavy views 读取 rules、doctor、events 和 rules-context read models。
- Dashboard 不作为规则真源。
- Dashboard 不承担 deterministic derived-state repair；使用 `fabric doctor --fix`。

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
- Manual state includes missing rule sections、semantic conflicts、incomplete init-context confirmation、MCP client local config issues、business-code-versus-rule mismatch。

## ADR-011: Dashboard Static Served By Server Package

决策：server package 在 production 中提供已构建的 Dashboard static assets。

原因：

- 一个 `fabric serve` process 同时暴露 MCP、REST、SSE 和 UI。
- CLI 只需要启动 server，不需要管理单独的 frontend server。

证据：

- `fabric serve` 调用 `startHttpServer`：`packages/cli/src/commands/serve.ts:58`。
- HTTP app 最后注册 Dashboard static：`packages/server/src/http.ts:239`。
- dist 缺失时 static handler 返回 404：`packages/server/src/api/static.ts:27`。
- SPA fallback 排除 `/api`、`/mcp`、`/events`：`packages/server/src/api/static.ts:41`。

## ADR-012: Localhost Default With Token-required Public Host

决策：`fabric serve` 默认使用 loopback；请求 non-loopback host 且未设置 `FABRIC_AUTH_TOKEN` 时回退到 `127.0.0.1`。

原因：

- Local control plane 不应意外暴露 project state。
- Authenticated remote binding 仍然可用。

证据：

- Default host：`packages/cli/src/commands/serve.ts:29`。
- Env token read：`packages/cli/src/commands/serve.ts:99`。
- Host fallback：`packages/cli/src/commands/serve.ts:104`。
- token 存在时挂载 Bearer middleware：`packages/server/src/http.ts:201`。

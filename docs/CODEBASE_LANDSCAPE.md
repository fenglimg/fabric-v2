# CODEBASE_LANDSCAPE: 源码全景图

本文是 `packages/` 的开发者地图。修改 `packages/` 后，交付说明必须点名本文中受影响的节点。

## 拓扑

```text
packages/cli
  command surface、init、scan、config writers
  -> serve 时调用 @fenglimg/fabric-server
  -> 使用 @fenglimg/fabric-shared 的 schemas、detector、i18n

packages/server
  MCP stdio + Streamable HTTP + REST + SSE + Dashboard static
  -> 读写 .fabric/*
  -> 导入 @fenglimg/fabric-shared schemas

packages/dashboard
  browser UI
  -> fetch /api/*
  -> 打开 /events
  -> 不直接访问 MCP

packages/shared
  schema、type、i18n、detector contract
  -> 被 cli、server、dashboard 消费
```

数据流：

```text
fabric init
  cli/commands/init.ts
  -> cli/scanner/forensic.ts
  -> shared detector 和 schemas
  -> 写入 .fabric/bootstrap、.fabric/forensic、.fabric/agents.meta、hooks、client config

fabric serve
  cli/commands/serve.ts
  -> server/index.ts startHttpServer
  -> server/http.ts createFabricHttpApp
  -> REST /api/*, SSE /events, MCP /mcp, Dashboard static

fab_get_rules
  MCP client
  -> server/tools/get-rules.ts
  -> server/services/get-rules.ts
  -> meta-reader.ts, read-human-lock.ts, cache.ts
  -> 返回 structuredContent

Dashboard rule view
  dashboard/views/rule-topology.tsx
  -> dashboard/api/client.ts getRules + getRulesContext
  -> server/api/rules.ts + rules-context.ts
  -> server/services/get-rules.ts
```

## `packages/cli`

| 文件 | 职责 | 证据 |
| --- | --- | --- |
| `src/index.ts` | CLI root command、version injection、main entrypoint。 | `packages/cli/src/index.ts:11` |
| `src/commands/index.ts` | Lazy subcommand registry。 | `packages/cli/src/commands/index.ts:1` |
| `src/commands/init.ts` | 一站式 init state machine、wizard、scaffold plan、MCP/bootstrap/hooks phases。 | `packages/cli/src/commands/init.ts:249`, `packages/cli/src/commands/init.ts:317` |
| `src/commands/serve.ts` | 启动本地 HTTP server，并校验 host 和 auth token。 | `packages/cli/src/commands/serve.ts:18`, `packages/cli/src/commands/serve.ts:104` |
| `src/commands/sync-meta.ts` | 将 `.fabric/agents/**/*.md` 编译到 `.fabric/agents.meta.json`；派生 layer、topology、stable id、revision。 | `packages/cli/src/commands/sync-meta.ts:74`, `packages/cli/src/commands/sync-meta.ts:306` |
| `src/commands/bootstrap.ts` | 确保 `.fabric/bootstrap/README.md` 存在；不再写根目录 client docs。 | `packages/cli/src/commands/bootstrap.ts:114` |
| `src/commands/config.ts` | 检测 client config target 并写入 MCP server config。 | `packages/cli/src/commands/config.ts:161` |
| `src/commands/hooks.ts` | 安装 git hook templates。 | command registry：`packages/cli/src/commands/index.ts:14` |
| `src/commands/approve.ts` | CLI human-lock approval surface。 | command registry：`packages/cli/src/commands/index.ts:2` |
| `src/commands/doctor.ts` | Health/audit/fix command surface。 | command registry：`packages/cli/src/commands/index.ts:7` |
| `src/commands/human-lint.ts` | Human-protected range lint command。 | command registry：`packages/cli/src/commands/index.ts:9` |
| `src/commands/ledger-append.ts` | CLI ledger append command。 | command registry：`packages/cli/src/commands/index.ts:10` |
| `src/commands/pre-commit.ts` | Pre-commit orchestration entrypoint。 | command registry：`packages/cli/src/commands/index.ts:11` |
| `src/commands/scan.ts` | 围绕 forensic report generation 的 scan command。 | command registry：`packages/cli/src/commands/index.ts:5` |
| `src/commands/update.ts` | Update command surface。 | command registry：`packages/cli/src/commands/index.ts:4` |
| `src/scanner/forensic.ts` | 生成 `.fabric/forensic.json`：topology、entrypoints、code samples、assertions、recommendations。 | `packages/cli/src/scanner/forensic.ts:174`, `packages/cli/src/scanner/forensic.ts:218` |
| `src/scanner/detector.ts` | 为 CLI re-export shared framework detector。 | `packages/cli/src/scanner/detector.ts:1` |
| `src/scanner/ignores.ts` | Scanner ignore policy。 | source file node |
| `src/scanner/tree-sitter-probe.ts` | Tree-sitter capability probe；当前 workspace 中已有未提交改动。 | git status |
| `src/config/resolver.ts` | 检测 client support 和 config writers。 | init 使用：`packages/cli/src/commands/init.ts:19` |
| `src/config/writer.ts` | Client config writer interface 与 implementations。 | bootstrap/config imports |
| `src/config/json.ts` | JSON config 读写 helper。 | config subsystem |
| `src/config/toml.ts` | TOML config 读写 helper。 | config subsystem |
| `src/config/claude-code.ts` | Claude-specific config support。 | config subsystem |
| `src/bootstrap-guide.ts` | 构造 internal bootstrap guide content。 | init 使用：`packages/cli/src/commands/init.ts:11` |
| `src/dev-mode.ts` | Target resolution 和 dev-mode config。 | serve 使用：`packages/cli/src/commands/serve.ts:6` |
| `src/i18n.ts` | CLI translation facade。 | serve 使用：`packages/cli/src/commands/serve.ts:7` |
| `src/colors.ts` | CLI paint/symbol/display-width helpers。 | serve 使用：`packages/cli/src/commands/serve.ts:5` |

## `packages/server`

| 文件 | 职责 | 证据 |
| --- | --- | --- |
| `src/index.ts` | 创建 MCP server，注册 tools/resources，启动 stdio 或 HTTP server。 | `packages/server/src/index.ts:43`, `packages/server/src/index.ts:79` |
| `src/http.ts` | Express/MCP HTTP app、`/mcp` session lifecycle、JSON-RPC errors、Dashboard static registration、cache watcher。 | `packages/server/src/http.ts:142`, `packages/server/src/http.ts:217` |
| `src/cache.ts` | Process-local cache，覆盖 meta/context/audit cursor。 | `packages/server/src/cache.ts:1` |
| `src/constants.ts` | Shared server constants，例如 bootstrap resource URI。 | import 位置：`packages/server/src/index.ts:9` |
| `src/meta-reader.ts` | 读取并校验 `.fabric/agents.meta.json`；解析 project root。 | `packages/server/src/meta-reader.ts:35`, `packages/server/src/meta-reader.ts:39` |
| `src/middleware/bearer-auth.ts` | HTTP `/api`、`/events`、`/mcp` 的 Bearer auth middleware。 | 挂载位置：`packages/server/src/http.ts:201` |
| `src/api/_error.ts` | API error helpers。 | API modules 使用 |
| `src/api/rules.ts` | `GET /api/rules`，返回解析后的 `AgentsMeta`。 | `packages/server/src/api/rules.ts:4` |
| `src/api/rules-context.ts` | `GET /api/rules/context?path=...`，返回 Dashboard 使用的 rules payload。 | `packages/server/src/api/rules-context.ts:4` |
| `src/api/events.ts` | SSE watch 和 event replay，覆盖 meta、human-lock、forensic、ledger。 | `packages/server/src/api/events.ts:95`, `packages/server/src/api/events.ts:180` |
| `src/api/human-lock.ts` | Human-lock 读取 endpoints，以及当前 HTTP approve 写入口。 | `packages/server/src/api/human-lock.ts:8`, `packages/server/src/api/human-lock.ts:49` |
| `src/api/intent.ts` | 当前 HTTP intent annotation 写入口。 | `packages/server/src/api/intent.ts:7` |
| `src/api/ledger.ts` | Ledger read API。 | 注册位置：`packages/server/src/http.ts:210` |
| `src/api/history.ts` | History replay API。 | 注册位置：`packages/server/src/http.ts:211` |
| `src/api/scan.ts` | 基于 forensic scanner 的 scan API。 | 注册位置：`packages/server/src/http.ts:212` |
| `src/api/doctor.ts` | Doctor report API。 | 注册位置：`packages/server/src/http.ts:213` |
| `src/api/static.ts` | 提供 Dashboard dist 和 SPA fallback。 | `packages/server/src/api/static.ts:16` |
| `src/services/get-rules.ts` | Core rules resolution：context load、matching、priority sort、activation、payload。 | `packages/server/src/services/get-rules.ts:83`, `packages/server/src/services/get-rules.ts:145` |
| `src/services/plan-context.ts` | Batch rules planning 和 shared bundle view。 | `packages/server/src/services/plan-context.ts:52` |
| `src/services/update-registry.ts` | Tool-backed registry mutation 和 revision write。 | `packages/server/src/services/update-registry.ts:20` |
| `src/services/append-intent.ts` | 追加 AI intent ledger entry 和 audit compliance event。 | `packages/server/src/services/append-intent.ts:17` |
| `src/services/audit-log.ts` | Get-rules/edit-intent audit log 和 5-minute compliance window。 | `packages/server/src/services/audit-log.ts:32`, `packages/server/src/services/audit-log.ts:59` |
| `src/services/read-ledger.ts` | Ledger storage/read model。 | append intent 和 events 使用 |
| `src/services/read-human-lock.ts` | Human-lock read 和 drift hash support。 | get-rules 和 API 使用 |
| `src/services/approve-human-lock.ts` | 更新 `.fabric/human-lock.json` 并追加 human ledger entry。 | `packages/server/src/services/approve-human-lock.ts:24` |
| `src/services/annotate-intent.ts` | Intent annotation service。 | 使用位置：`packages/server/src/api/intent.ts:4` |
| `src/services/doctor.ts` | Doctor report/fix/audit service。 | re-export 位置：`packages/server/src/index.ts:17` |
| `src/services/rehydrate-state.ts` | 为 history replay rehydrate state。 | service node |
| `src/services/_shared.ts` | Shared server file constants、atomic write、sha256、path guard。 | `packages/server/src/services/_shared.ts:5` |
| `src/tools/get-rules.ts` | get-rules 的 MCP tool wrapper。 | `packages/server/src/tools/get-rules.ts:31` |
| `src/tools/plan-context.ts` | plan-context 的 MCP tool wrapper。 | `packages/server/src/tools/plan-context.ts:77` |
| `src/tools/update-registry.ts` | registry mutation 的 MCP tool wrapper。 | `packages/server/src/tools/update-registry.ts:43` |
| `src/tools/append-intent.ts` | intent append 的 MCP tool wrapper。 | `packages/server/src/tools/append-intent.ts:33` |

## `packages/dashboard`

| 文件 | 职责 | 证据 |
| --- | --- | --- |
| `src/main.tsx` | Browser entrypoint。 | Dashboard source node，待补精确行号 |
| `src/app.tsx` | App shell 和 view routing。 | Dashboard source node，待补精确行号 |
| `src/api/client.ts` | REST 和 SSE 的 browser API client。 | `packages/dashboard/src/api/client.ts:129`, `packages/dashboard/src/api/client.ts:194` |
| `src/hooks/use-events.ts` | SSE hook layer。 | 使用 API client 的 `openSseConnection` |
| `src/views/rule-topology.tsx` | Rule hit explanation view；调用 `getRules` 和 `getRulesContext`。 | `packages/dashboard/src/views/rule-topology.tsx:23` |
| `src/views/rules-tree.tsx` | Rules tree view；从 `AgentsMeta` 构造分组 tree。 | `packages/dashboard/src/views/rules-tree.tsx:13`, `packages/dashboard/src/views/rules-tree.tsx:125` |
| `src/views/human-lock.tsx` | Human-lock view；当前 UI 会调用 approve API。 | `packages/dashboard/src/views/human-lock.tsx:46` |
| `src/views/intent-timeline.tsx` | Ledger timeline view。 | Dashboard source node，待补精确行号 |
| `src/views/history-replay.tsx` | History replay view。 | Dashboard source node，待补精确行号 |
| `src/views/doctor.tsx` | Doctor report view。 | Dashboard source node，待补精确行号 |
| `src/components/coverage-heatmap.tsx` | Rule coverage visualization。 | rule topology 使用：`packages/dashboard/src/views/rule-topology.tsx:5` |
| `src/components/hit-reason-panel.tsx` | Per-path hit reason panel。 | rule topology 使用：`packages/dashboard/src/views/rule-topology.tsx:5` |
| `src/components/drift-indicator.tsx` | Error/drift banner component。 | rules views 使用 |
| `src/components/tree-node.tsx` | Rules tree node renderer。 | rules tree 使用：`packages/dashboard/src/views/rules-tree.tsx:6` |
| `src/components/lock-card.tsx` | Human-lock card renderer。 | human-lock view 使用：`packages/dashboard/src/views/human-lock.tsx:5` |
| `src/components/approve-button.tsx` | Async action button；证明当前 UI 仍存在写动作。 | `packages/dashboard/src/components/approve-button.tsx:30` |
| `src/components/source-badge.tsx` | Source label component。 | component node |
| `src/components/timeline-entry.tsx` | Ledger event renderer。 | component node |
| `src/i18n/*` | Dashboard i18n runtime/provider/hook。 | views/components 导入 |
| `src/styles/tokens.css` | Dashboard visual token source。 | conventions 引用 |
| `src/styles/app.css` | App layout 和 component styles。 | Dashboard style node |

## `packages/shared`

| 文件 | 职责 | 证据 |
| --- | --- | --- |
| `src/index.ts` | Public shared exports。 | shared package entry |
| `src/node.ts` | Node-side shared exports。 | CLI detector 导入 |
| `src/detector.ts` | Framework detection 和 tech profile contract。 | re-export 位置：`packages/cli/src/scanner/detector.ts:1` |
| `src/schemas/agents-meta.ts` | `AgentsMeta` schema、layer/topology/stable-id derivation。 | `packages/shared/src/schemas/agents-meta.ts:12`, `packages/shared/src/schemas/agents-meta.ts:54` |
| `src/schemas/api-contracts.ts` | HTTP query/body schemas。 | `packages/shared/src/schemas/api-contracts.ts:32`, `packages/shared/src/schemas/api-contracts.ts:52` |
| `src/schemas/events.ts` | SSE event types 和 discriminated union。 | `packages/shared/src/schemas/events.ts:10`, `packages/shared/src/schemas/events.ts:79` |
| `src/schemas/fabric-config.ts` | Fabric config schema。 | shared schema node |
| `src/schemas/forensic-report.ts` | Scanner/server events 消费的 forensic report schema。 | events 导入：`packages/server/src/api/events.ts:9` |
| `src/schemas/human-lock.ts` | Human-lock schema。 | events 导入：`packages/server/src/api/events.ts:10` |
| `src/schemas/init-context.ts` | Init context schema。 | shared schema node |
| `src/schemas/ledger-entry.ts` | Ledger entry schemas。 | append-intent tool 使用：`packages/server/src/tools/append-intent.ts:1` |
| `src/types/agents.ts` | Agent metadata TypeScript types。 | agents-meta schema 导入：`packages/shared/src/schemas/agents-meta.ts:3` |
| `src/types/config.ts` | Fabric config types。 | shared type node |
| `src/types/ledger.ts` | Ledger 和 human-lock types。 | event schema 导入：`packages/shared/src/schemas/events.ts:4` |
| `src/i18n/*` | Shared i18n creation、locale detection、protected tokens。 | CLI/Dashboard i18n layers 使用 |

## 更新规则

修改 `packages/` 后，交付说明必须包含：

```text
CODEBASE_LANDSCAPE sync: <node name> changed because <reason>.
```

新增 core file 时，必须在改动前或同一次改动中把它加入对应 package 表。

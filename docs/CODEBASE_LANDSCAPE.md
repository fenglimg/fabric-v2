# CODEBASE_LANDSCAPE: 源码全景图

本文是 `packages/` 的开发者地图。修改 `packages/` 后，交付说明必须点名本文中受影响的节点。

## 拓扑

```text
packages/cli
  public command surface: install、scan、doctor、uninstall
  -> 客户端通过 MCP 配置 spawn @fenglimg/fabric-server (stdio)
  -> 使用 @fenglimg/fabric-shared 的 schemas、detector、i18n

packages/server
  MCP stdio runtime (tools + services + event ledger)
  -> 读写 .fabric/*
  -> 导入 @fenglimg/fabric-shared schemas

packages/server-http-experimental  (v2.0.0-rc.37 quarantine)
  历史 HTTP/REST/SSE 实现 + Dashboard static handler
  -> 不 build / 不 test，仅供未来恢复 web UI 时参考
  -> KB [[fabric-serve-quarantine-not-delete]]

packages/shared
  schema、type、i18n、detector contract
  -> 被 cli、server 消费
```

数据流：

```text
fabric install
  cli/commands/install.ts
  -> cli/scanner/forensic.ts
  -> shared detector 和 schemas
  -> 写入 .fabric/AGENTS.md、.fabric/INITIAL_TAXONOMY、.fabric/forensic、.fabric/events.jsonl、hooks、client config

fabric serve  # (v2.0.0-rc.37: quarantine 到 packages/server-http-experimental/，主线不再 build)
  -> packages/server-http-experimental/src/{http,middleware/bearer-auth,services/serve-lock}.ts
  -> 详见 KB [[fabric-serve-quarantine-not-delete]]

fab_plan_context / fab_get_knowledge_sections
  MCP client (stdio)
  -> server/tools/plan-context.ts / server/tools/knowledge-sections.ts
  -> server/services/plan-context.ts / server/services/knowledge-sections.ts
  -> meta-reader.ts, event-ledger.ts, cache.ts
  -> 返回 structuredContent

(历史 Dashboard rule view 数据流在 v2.0.0-rc.37 quarantine 时归档；
 复活路径见 packages/server-http-experimental/。)
```

## `packages/cli`

| 文件 | 职责 | 证据 |
| --- | --- | --- |
| `src/index.ts` | CLI root command、version injection、main entrypoint。 | `packages/cli/src/index.ts:11` |
| `src/commands/index.ts` | Public lazy subcommand registry；v2.0.0 public surface is `install`、`scan`、`doctor`、`uninstall`（`serve` 在 v2.0.0-rc.37 已 quarantine）。 | `packages/cli/src/commands/index.ts:1` |
| `src/commands/init.ts` | 一站式 init state machine、wizard、scaffold plan、MCP/bootstrap/hooks phases。 | `packages/cli/src/commands/init.ts:249`, `packages/cli/src/commands/init.ts:317` |
| ~~`src/commands/serve.ts`~~ | (已删 — v2.0.0-rc.37 quarantine 到 `packages/server-http-experimental/`) | git history |
| `src/commands/doctor.ts` | Target-state diagnosis with `--json`、`--strict`、`--fix` modes。 | command registry：`packages/cli/src/commands/index.ts:7` |
| `src/commands/scan.ts` | 围绕 forensic report generation 的 scan command。 | command registry：`packages/cli/src/commands/index.ts:5` |
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
| `src/index.ts` | 创建 MCP server，注册 tools/resources，启动 stdio runtime（v2.0.0-rc.37 起 HTTP 路径已 quarantine）。 | `packages/server/src/index.ts` |
| ~~`src/http.ts`~~ | (已移走 — v2.0.0-rc.37 quarantine 到 `packages/server-http-experimental/src/http.ts`) | git history |
| `src/cache.ts` | Process-local cache，覆盖 meta/context/audit cursor。 | `packages/server/src/cache.ts:1` |
| `src/constants.ts` | Shared server constants，例如 bootstrap resource URI。 | import 位置：`packages/server/src/index.ts:9` |
| `src/meta-reader.ts` | 读取并校验 `.fabric/agents.meta.json`；解析 project root。 | `packages/server/src/meta-reader.ts:35`, `packages/server/src/meta-reader.ts:39` |
| ~~`src/middleware/`、`src/api/*`~~ | (已移走 — v2.0.0-rc.37 quarantine 到 `packages/server-http-experimental/src/{middleware,api}/`) | git history |
| `src/services/legacy-serve-lock-probe.ts` | 只读 probe（`readLockState` + `isAlive`），doctor 用它检测/清理 rc ≤36 遗留的 `.fabric/.serve.lock`。完整 lock 实现已 quarantine。 | `packages/server/src/services/legacy-serve-lock-probe.ts:1` |
| `src/services/get-rules.ts` | Core rules resolution：context load、matching、priority sort、activation、payload。 | `packages/server/src/services/get-rules.ts:83`, `packages/server/src/services/get-rules.ts:145` |
| `src/services/plan-context.ts` | Batch rules planning 和 shared bundle view。 | `packages/server/src/services/plan-context.ts:52` |
| `src/services/event-ledger.ts` | `.fabric/events.jsonl` typed Event Ledger append/read model。 | server services 使用 |
| `src/services/annotate-intent.ts` | Intent annotation service。 | 使用位置：`packages/server/src/api/intent.ts:4` |
| `src/services/doctor.ts` | Doctor report/fix/audit service。 | re-export 位置：`packages/server/src/index.ts:17` |
| `src/services/rehydrate-state.ts` | 为 history replay rehydrate state。 | service node |
| `src/services/_shared.ts` | Shared server file constants、atomic write、sha256、path guard。 | `packages/server/src/services/_shared.ts:5` |
| `src/tools/plan-context.ts` | plan-context 的 MCP tool wrapper。 | `packages/server/src/tools/plan-context.ts:77` |
| `src/tools/rule-sections.ts` | rule-sections 的 MCP tool wrapper。 | MCP server registration |

## `packages/dashboard`（v2.0.0-rc.37 移除）

Dashboard package 在 v2.0.0-rc.37 与 HTTP/REST/SSE 一同 quarantine；package 不再存在于主线 `packages/`。源码与组件结构（views/api/components/i18n/styles）保留在 `packages/server-http-experimental/` 的 historical reference 中，未来恢复 web UI 时参考。复活路径见 KB [[fabric-serve-quarantine-not-delete]]。

## `packages/shared`

| 文件 | 职责 | 证据 |
| --- | --- | --- |
| `src/index.ts` | Public shared exports。 | shared package entry |
| `src/node.ts` | Node-side shared exports。 | CLI detector 导入 |
| `src/detector.ts` | Framework detection 和 tech profile contract。 | re-export 位置：`packages/cli/src/scanner/detector.ts:1` |
| `src/schemas/agents-meta.ts` | `AgentsMeta` schema、layer/topology/stable-id derivation。 | `packages/shared/src/schemas/agents-meta.ts:12`, `packages/shared/src/schemas/agents-meta.ts:54` |
| `src/schemas/api-contracts.ts` | MCP tool contracts（plan-context / knowledge-sections / extract-knowledge / recall / review）的 input/output schemas，外加 R24 structuredWarning。 | `packages/shared/src/schemas/api-contracts.ts` |
| `src/schemas/events.ts` | `.fabric/events.jsonl` 的 typed event discriminated union（archive/cite/doctor 等 ledger 事件）。 | `packages/shared/src/schemas/events.ts:79` |
| `src/schemas/fabric-config.ts` | Fabric config schema。 | shared schema node |
| `src/schemas/forensic-report.ts` | Scanner/server events 消费的 forensic report schema。 | events 导入：`packages/server/src/api/events.ts:9` |
| `src/schemas/init-context.ts` | Init context schema。 | shared schema node |
| `src/schemas/ledger-entry.ts` | Ledger entry schemas。 | append-intent tool 使用：`packages/server/src/tools/append-intent.ts:1` |
| `src/types/agents.ts` | Agent metadata TypeScript types。 | agents-meta schema 导入：`packages/shared/src/schemas/agents-meta.ts:3` |
| `src/types/config.ts` | Fabric config types。 | shared type node |
| `src/types/ledger.ts` | Event Ledger types。 | event schema 导入：`packages/shared/src/schemas/events.ts:4` |
| `src/i18n/*` | Shared i18n creation、locale detection、protected tokens。 | CLI/Dashboard i18n layers 使用 |

## 更新规则

修改 `packages/` 后，交付说明必须包含：

```text
CODEBASE_LANDSCAPE sync: <node name> changed because <reason>.
```

新增 core file 时，必须在改动前或同一次改动中把它加入对应 package 表。

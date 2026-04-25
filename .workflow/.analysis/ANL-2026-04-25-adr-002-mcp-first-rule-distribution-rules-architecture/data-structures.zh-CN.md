# Fabric Rule Architecture Data Structures

生成时间: 2026-04-25T12:18:19+08:00

本文档是讨论清单，不是最终设计。它列出了当前塑造 Fabric rule distribution、governance 和 observation 的 data structures。

## 1. Rule Source Layer

### 1.1 Rule Markdown Files

- 存储位置: `.fabric/agents/**/*.md`、`.fabric/bootstrap/README.md`，以及生成的面向 client 的 bootstrap 变体。
- 角色: 人类可读的 rule body。
- 设计状态: 隐式 file format + 可选的 stable-id HTML comment。
- 证据:
  - server 读取 L0 bootstrap: `packages/server/src/services/get-rules.ts:111`
  - `node.file` 读取匹配到的 rule content: `packages/server/src/services/get-rules.ts:190`
  - stable-id comment ADR: `docs/ARCHITECTURE_DECISIONS.md:56`

架构问题:
- 除 `<!-- fab:rule-id ... -->` 外，rule markdown 是否应有更严格的 header contract？
- rule file 是否应自行携带 activation metadata，还是所有 metadata 都保留在 `.fabric/agents.meta.json`？

### 1.2 Stable Rule Identity

- 结构: `stable_id?: string`, `identity_source?: "declared" | "derived"`。
- declared 来源: 首行 HTML comment `<!-- fab:rule-id scope/name -->`。
- derived 来源: 规范化后的 rule file path 作为 fallback。
- 证据:
  - Schema: `packages/shared/src/schemas/agents-meta.ts:31`
  - Derivation: `packages/shared/src/schemas/agents-meta.ts:67`
  - Extraction: `packages/cli/src/commands/sync-meta.ts:334`

架构问题:
- 长期来看是否允许 derived identity，还是仅作为 migration warning？
- `stable_id` 是否应暴露在所有 delivery payload 中，而不只在 plan shared entries 中？

## 2. Rule Registry Layer

### 2.1 AgentsMeta

```ts
type AgentsMeta = {
  revision: string;
  nodes: Record<string, AgentsMetaNode>;
};
```

- 存储位置: `.fabric/agents.meta.json`。
- 角色: server rule matching 使用的 registry truth source。
- 证据: `packages/shared/src/schemas/agents-meta.ts:49`。

架构问题:
- `revision` 仅是 content hash，还是完整的 registry semantic revision？
- registry 是否应支持 schema versioning，以区分 v1/v2 行为？

### 2.2 AgentsMetaNode

```ts
type AgentsMetaNode = {
  file: string;
  scope_glob: string;
  deps: string[];
  priority: "high" | "medium" | "low";
  layer: "L0" | "L1" | "L2";
  topology_type: "mirror" | "cross-cutting";
  hash: string;
  stable_id?: string;
  identity_source?: "declared" | "derived";
  activation?: {
    tier: "always" | "path" | "description";
    description?: string;
  };
};
```

- 角色: 单条 rule 的 metadata，用于 matching、ordering、topology、identity 和 activation。
- 证据:
  - Type: `packages/shared/src/types/agents.ts:13`
  - Schema: `packages/shared/src/schemas/agents-meta.ts:23`
  - Internal spec: `docs/SPEC_INTERNAL.md:458`

架构问题:
- `deps`: 是否应影响 resolution order/loading，还是只作为 documentation/topology？
- `activation`: `description` 是否仍应遵守 `scope_glob`，还是作为全局 discovery metadata？
- `priority`: 仅在同层内排序，还是在 layer partition 前对所有 matched nodes 统一排序？
- `layer` 与 node id prefix: 哪个应是 canonical？`classifyNode` 当前优先使用 node id prefix，再用 `node.layer`。

### 2.3 Activation Tier

```ts
type AgentsActivationTier = "always" | "path" | "description";
```

- 当前语义:
  - `always`: 匹配所有 path，加载完整 rule content。
  - `path` 或 undefined: 按 `scope_glob` 匹配，加载完整 rule content。
  - `description`: 匹配所有 path，仅返回 stub。
- 证据: `packages/server/src/services/get-rules.ts:275`。

架构问题:
- `description` 是 semantic-discovery index，还是 scoped lazy-load marker？
- 若是全局，是否应增加 tags、domains、max count 等 filter？
- 若是 scoped，`shouldLoadNodeForPath` 可能应在发出 stub 前先应用 `scope_glob`。

### 2.4 Priority

```ts
type Priority = "high" | "medium" | "low";
```

- 当前语义: matched nodes 按 `high -> medium -> low` 排序，再按 node id。
- 证据:
  - Priority 顺序: `packages/server/src/services/get-rules.ts:77`
  - Sort: `packages/server/src/services/get-rules.ts:150`

架构问题:
- L1/L2 partition 是否应先于 priority sort，还是允许跨层 priority？
- priority 表示 rule importance、load order、conflict precedence，还是三者兼有？
- 后续是否应改为 numeric/weighted priority，还是 3-level enum 足够？

## 3. Rule Resolution Layer

### 3.1 GetRulesContext

```ts
type GetRulesContext = {
  meta: AgentsMeta;
  l0Content: string;
  humanLockedNearby: HumanLockedNearby[];
};
```

- 角色: 单个 project root 的 server-side base context cache。
- 证据: `packages/server/src/services/get-rules.ts:51`。

架构问题:
- human-lock 是否应与 meta/L0 content 使用相同 TTL cache？
- context 是否应包含预解析的 rule file metadata，还是仅包含 registry + L0 + locks？

### 3.2 MatchedRuleNode

```ts
type MatchedRuleNode = {
  node_id: string;
  level: "L1" | "L2" | null;
  stable_id: string;
  identity_source: "declared" | "derived";
  node: AgentsMetaNode;
};
```

- 角色: metadata matching 和 sorting 之后的临时 server 结果。
- 证据: `packages/server/src/services/get-rules.ts:69`。

架构问题:
- `level` 是否应只从 `node.layer` 推导，而非 node id prefix？
- matched node 是否应显式保留 hit reason（`always`、`path`、`description`）？

### 3.3 LoadedRulesResult

```ts
type LoadedRulesResult = {
  rules: LoadedRule[];
  stubs: SharedDescriptionStub[];
};
```

- 角色: 将 full content rules 与仅 description 的候选项分离。
- 证据: `packages/server/src/services/get-rules.ts:64`。

架构问题:
- `description` tier 是否应在同一次调用中读取 backing content？
- stubs 是否应包含 priority、scope、node id 以支持 client-side explanation？

### 3.4 RulesPayload

```ts
type RulesPayload = {
  L0: string;
  L1: Array<{ path: string; content: string }>;
  L2: Array<{ path: string; content: string }>;
  human_locked_nearby: Array<{ file: string; excerpt: string }>;
  description_stubs?: Array<{ path: string; description: string }>;
};
```

- 角色: 单目标 rule lookup 的主 delivery payload。
- 使用方: MCP `fab_get_rules`、REST `/api/rules/context`、Dashboard topology。
- 证据:
  - Service type: `packages/server/src/services/get-rules.ts:32`
  - MCP output: `packages/server/src/tools/get-rules.ts:19`
  - REST context API: `packages/server/src/api/rules-context.ts:17`
  - Dashboard type: `packages/dashboard/src/api/client.ts:56`

架构问题:
- L1/L2 entry 是否应包含 `stable_id`、`identity_source`、`priority`、`activation.tier`？
- 若返回的是全部 lock，`human_locked_nearby` 是否应重命名？
- `description_stubs` 应始终返回 `[]` 以简化 client，还是保留 optional 以压缩体积？

### 3.5 GetRulesResult

```ts
type GetRulesResult = {
  revision_hash: string;
  stale: boolean;
  rules: RulesPayload;
};
```

- 角色: 用于 stale 检测的 MCP-level envelope。
- 证据: `packages/server/src/services/get-rules.ts:45`。

架构问题:
- stale 细节是否应包含 `client_hash` 与 server `revision_hash` 的原因说明？
- HTTP `/api/rules/context` 是否也应返回该 envelope，还是仅 rules 对 Dashboard 足够？

## 4. Planning Read Model Layer

### 4.1 PlanContextResult

```ts
type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  entries: Array<{ path: string; rules: RulesPayload }>;
  shared: {
    resolved_bundle_id: string;
    shared_entries: Array<{
      stable_id: string;
      identity_source: "declared" | "derived";
      level: "L1" | "L2";
      path: string;
      content: string;
    }>;
    file_map: Record<string, {
      L1: string[];
      L2: string[];
      description_stubs: string[];
    }>;
    description_stub_union: SharedDescriptionStub[];
    preflight_diagnostics: Diagnostic[];
  };
};
```

- 角色: 用于 planning/architecture review 的 batch query 与 shared bundle view。
- 证据:
  - Type: `packages/server/src/services/plan-context.ts:17`
  - MCP output schema: `packages/server/src/tools/plan-context.ts:29`

架构问题:
- 这是否应成为 canonical 的 architecture-review API，而 `fab_get_rules` 保持为最终编辑前 gate？
- `shared_entries` 应按 stable id 去重还是按 physical path 去重？当前行为在 stable id 不同但文件相同时会保留两份 content。
- diagnostics 是否应支持除 `description_stub_only` 与 `derived_identity` 外的更多 code？

### 4.2 SharedDescriptionStub

```ts
type SharedDescriptionStub = {
  path: string;
  description: string;
  stable_id: string;
  identity_source: "declared" | "derived";
  level: "L1" | "L2";
};
```

- 角色: planning shared view 中更丰富的 description stub 版本。
- 证据: `packages/server/src/services/get-rules.ts:21`。

架构问题:
- 为什么单 path 的 `RulesPayload.description_stubs` 会丢失 `stable_id` 和 `level`？
- client 在看到 stub 后请求 full content 时，应使用 `path` 还是 `stable_id`？

## 5. Human Protection Layer

### 5.1 HumanLockEntry / HumanLockFile

```ts
type HumanLockEntry = {
  file: string;
  start_line: number;
  end_line: number;
  hash: string;
};
type HumanLockFile = {
  locked?: HumanLockEntry[];
};
```

- 存储位置: `.fabric/human-lock.json`。
- 角色: 编辑前需要人工确认的受保护 range。
- 证据:
  - Type: `packages/shared/src/types/ledger.ts:24`
  - Schema: `packages/shared/src/schemas/human-lock.ts:8`

架构问题:
- 除 line range 外，locked range 是否应使用 stable anchor？
- range 是否应携带 reason/owner/created_at metadata？

### 5.2 HumanLockStatus

```ts
type HumanLockStatus = HumanLockEntry & {
  drift: boolean;
  current_hash: string;
};
```

- 角色: 指示受保护内容是否 drift 的 read model。
- 证据: `packages/server/src/services/read-human-lock.ts:14`。

架构问题:
- `current_hash` 是否应暴露给所有 client，还是仅 approval flow 可见？
- drift 状态是否应改为 event-driven/cache，而非每次读取时重新计算？

### 5.3 ApproveHumanLockInput / Result

```ts
type ApproveHumanLockInput = {
  file: string;
  start_line: number;
  end_line: number;
  new_hash: string;
};
type ApproveHumanLockResult = {
  updated: boolean;
  entry: HumanLockStatus;
  ledger_entry?: StoredLedgerEntry;
};
```

- 角色: 对 drifted protected range 进行 approval 的 write-side flow。
- 证据: `packages/server/src/services/approve-human-lock.ts:11`。

架构问题:
- 既然 ADR-008 说明 Dashboard 应趋向 read-only，approval 是否应仅保留 CLI/server？
- approval 是否应要求 intent/reason，而非只提交 new hash？

## 6. Intent, Audit, And Event Layer

### 6.1 LedgerEntry

```ts
type LedgerEntry =
  | { source: "ai"; id?: string; ts: number; commit_sha?: string; intent: string; affected_paths: string[] }
  | { source: "human"; id?: string; ts: number; parent_sha: string; parent_ledger_entry_id?: string; intent: string; affected_paths: string[]; diff_stat: string; annotation?: string };
```

- 存储位置: `.fabric/.intent-ledger.jsonl`，兼容 legacy 根路径。
- 角色: append-only intent history。
- 证据:
  - Type: `packages/shared/src/types/ledger.ts:1`
  - Schema: `packages/shared/src/schemas/ledger-entry.ts:10`
  - Read/append/migration: `packages/server/src/services/read-ledger.ts:54`

架构问题:
- MCP event replay entry 是否应与 ledger entry 共用同一个物理 JSONL？
- intent entry 是否应引用本次编辑使用的 rule revision？

### 6.2 AuditLogEntry

```ts
type AuditLogEntry =
  | { kind: "audit-event"; event: "get_rules"; ts: number; path: string; client_hash?: string }
  | { kind: "audit-event"; event: "edit_intent"; ts: number; path: string; compliant: boolean; intent: string; ledger_entry_id: string; matched_get_rules_ts: number | null; window_ms: number };
```

- 存储位置: `.fabric/audit.jsonl`。
- 角色: best-effort compliance telemetry，将 rule lookup 与后续 edit intent 关联。
- 证据: `packages/server/src/services/audit-log.ts:10`。

架构问题:
- audit 应保持纯 telemetry，还是在 strict mode 下变成 enforcement？
- audit 是否应关联到 `revision_hash` 与 `stable_id` bundle？

### 6.3 FabricEvent

```ts
type FabricEvent =
  | { type: "meta:updated"; payload: AgentsMeta }
  | { type: "lock:drift"; payload: { locked: HumanLockEntry[]; drifted: HumanLockEntry[] } }
  | { type: "lock:approved"; payload: { locked: HumanLockEntry[]; approved: HumanLockEntry[] } }
  | { type: "ledger:appended"; payload: LedgerEntry }
  | { type: "drift:detected"; payload: ForensicReport };
```

- 角色: Dashboard/SSE event contract。
- 证据: `packages/shared/src/schemas/events.ts:10`。

架构问题:
- 是否需要 rule resolution event，还是 audit log 已足够？
- event payload 是否应使用 compact delta 而非完整 AgentsMeta？

### 6.4 StoredMcpEvent

```ts
type StoredMcpEvent = {
  kind: "mcp-event";
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
};
```

- 角色: Streamable HTTP MCP event replay store。
- 证据: `packages/server/src/http.ts:39`。

架构问题:
- MCP event replay 是否应与 intent ledger 共用文件，还是使用独立 protocol log？
- replay retention 是否应设置边界？

## 7. Initialization And Discovery Layer

### 7.1 InitContext

```ts
type InitContext = {
  framework: { kind: string; version: string; subkind: string };
  architecture_patterns: string[];
  invariants: Array<{
    type: "ban" | "require" | "protect";
    rule: string;
    rationale?: string;
    confidence_snapshot?: { confidence: "HIGH" | "MEDIUM" | "LOW"; evidence_refs: string[] };
    source_evidence?: Array<{ file: string; lines: string }>;
  }>;
  domain_groups: Array<{
    name: string;
    paths: string[];
    summary?: string;
    topology_type?: "mirror" | "cross-cutting";
    target_path?: string;
  }>;
  interview_trail: Array<{ phase: string; question: string; answer: string; presentation?: string; user_corrections?: string[] }>;
  forensic_ref: string;
};
```

- 存储位置: 初始化期间写入 `.fabric/init-context.json`。
- 角色: 记录用于 rule scaffold 的 project discovery 与 human interview context。
- 证据: `packages/shared/src/schemas/init-context.ts:43`。

架构问题:
- InitContext 是否应反哺后续 sync-meta/rule generation，还是仅保留历史用途？
- domain_groups 是否应直接映射到 AgentsMetaNode generation？

### 7.2 ForensicReport

- 角色: scanner 输出，包含 framework、topology、entry points、code samples、assertions、candidate files、README quality。
- 证据:
  - Interface: `packages/shared/src/schemas/forensic-report.ts:75`
  - Schema: `packages/shared/src/schemas/forensic-report.ts:160`

架构问题:
- forensic assertions 是否应自动转为 candidate rule nodes？
- `proposed_rule` 是否应规范化为 AgentsMetaNode proposal？

### 7.3 InitScaffoldPlan / InitExecutionPlan

- 角色: CLI 侧计划，用于创建 bootstrap、meta、human-lock、forensic report、client skills/hooks/settings。
- 证据:
  - `InitScaffoldPlan`: `packages/cli/src/commands/init.ts:181`
  - `InitExecutionPlan`: `packages/cli/src/commands/init.ts:207`

架构问题:
- init scaffold output 是否可表达为单个 project state transaction？
- 每个 scaffold artifact 是否应在 ledger 中记录 provenance？

## 8. Config, Health, And Cache Layer

### 8.1 FabricConfig

```ts
type FabricConfig = {
  clientPaths?: {
    claudeCodeCLI?: string;
    claudeCodeDesktop?: string;
    cursor?: string;
    windsurf?: string;
    rooCode?: string;
    geminiCLI?: string;
    codexCLI?: string;
  };
  externalFixturePath?: string;
  scanIgnores?: string[];
  auditMode?: "strict" | "warn" | "off";
  audit_mode?: "strict" | "warn" | "off";
};
```

- 角色: 本地配置，管理 client path、fixtures、ignore 规则与 audit mode。
- 证据: `packages/shared/src/schemas/fabric-config.ts:15`。

架构问题:
- `auditMode` 与 `audit_mode` 是否应长期同时接受？
- rule-distribution 行为是否应引入 config flag，还是保持 schema-driven？

### 8.2 DoctorReport

```ts
type DoctorReport = {
  status: "ok" | "warn" | "error";
  checks: DoctorCheck[];
  summary: DoctorSummary;
  audit: DoctorAuditReport | null;
};
```

- 角色: 面向 metadata、locks、ledger、audit、forensic state 的 health/readiness report。
- 证据: `packages/server/src/services/doctor.ts:60`。

架构问题:
- ADR 中每条 architecture invariant 是否都应对应一个 doctor check？
- DoctorReport 是否应成为展示 derived identity 与 revision drift 的 canonical 位置？

### 8.3 ContextCache / AuditCursor

- 角色: 进程内 hot path cache，覆盖 agents meta、get-rules context 与 audit sliding-window cursor。
- 证据: `packages/server/src/cache.ts:1`。

架构问题:
- 对 rule edit 来说，5s TTL 是否可接受，还是所有状态都应要求 file-watch invalidation？
- 在 GetRulesContext 中 cache human-lock 是否会导致过时 lock warning？

## 9. MCP And HTTP Contract Layer

### 9.1 fab_get_rules

- 输入: `{ path: string; client_hash?: string }`。
- 输出: `{ revision_hash: string; stale: boolean; rules: RulesPayload }`。
- 角色: 最终编辑前、单目标的 rule lookup。
- 证据: `packages/server/src/tools/get-rules.ts:7`。

架构问题:
- `stale: true` 时 client 是否必须停止，还是仅 warning？
- 输出是否应包含 hit reason，而非只有 rule content？

### 9.2 fab_plan_context

- 输入: `{ paths: string[]; client_hash?: string }`，最少 2 个 path。
- 输出: `PlanContextResult`。
- 角色: batch planning/architecture review context。
- 证据: `packages/server/src/tools/plan-context.ts:7`。

架构问题:
- 若调用方有时只有一个未知目标，minimum 2 是否应在 schema 层强制？
- shared bundle 是否应可在后续调用中通过 id 复用？

### 9.3 fab_update_registry

- 当前输入支持 `file`、`scope_glob`、`deps`、`priority`、`layer`、`topology_type`、`hash`。
- 角色: MCP write-side registry mutation，推荐替代直接编辑 `.fabric/agents.meta.json`。
- 证据: `packages/server/src/tools/update-registry.ts:8`。

架构问题:
- 它尚未暴露 `stable_id`、`identity_source`、`activation`；是否应补充？
- 是否应从 file content 重新计算 hash，而不是接受外部 hash 输入？
- 是否应与 sync-meta 共享 revision 计算逻辑？

### 9.4 fab_append_intent

- 输入: `{ intent: string; affected_paths: string[]; commit_sha?: string }`。
- 输出: `{ success: boolean; entry: StoredLedgerEntry }`。
- 角色: 任务完成后追加 AI intent。
- 证据: `packages/server/src/tools/append-intent.ts:8`。

架构问题:
- append intent 是否应要求传入最近一次 `fab_get_rules` 所用 revision？
- audit compliance failure 是否应在工具输出中显式暴露？

### 9.5 REST API Read Models

- `/api/rules`: 返回 `AgentsMeta`。
- `/api/rules/context`: 仅返回 `RulesPayload`。
- `/api/human-lock`: 返回 `HumanLockStatus[]`。
- `/api/doctor`: 返回 `DoctorReport`。
- Dashboard client 以本地 type 镜像这些接口。
- 证据:
  - Rules API: `packages/server/src/api/rules.ts:4`
  - Rules context API: `packages/server/src/api/rules-context.ts:4`
  - Dashboard client: `packages/dashboard/src/api/client.ts:129`

架构问题:
- REST type 是否应从 shared/server schema 生成，以避免重复？
- Dashboard 是否应按 ADR-008 设定保持严格 read-only？

## 10. Design Discussion Summary

当前结构可分为四类:

1. Source-of-truth structures
   - Rule markdown files
   - `AgentsMeta`
   - `HumanLockFile`
   - `LedgerEntry`
   - `FabricConfig`

2. Server-derived read models
   - `GetRulesContext`
   - `MatchedRuleNode`
   - `LoadedRulesResult`
   - `RulesPayload`
   - `PlanContextResult`
   - `HumanLockStatus`
   - `DoctorReport`

3. Protocol contracts
   - MCP tools: `fab_get_rules`、`fab_plan_context`、`fab_update_registry`、`fab_append_intent`
   - REST endpoints: rules、rules-context、human-lock、ledger、doctor、history
   - SSE events: `FabricEvent`

4. Initialization/discovery artifacts
   - `ForensicReport`
   - `InitContext`
   - `InitScaffoldPlan`
   - `InitExecutionPlan`

最重要的架构评审目标:

1. 明确每个字段由哪一层拥有。
2. 决定 `description` activation 是全局 discovery，还是 scoped lazy loading。
3. 在 `sync-meta` 与 `update-registry` 之间统一 revision 语义。
4. 决定 `deps` 是 behavioral 还是 documentary。
5. 决定 `RulesPayload` 是否应暴露 stable ids 与 hit reasons。
6. 决定 human-lock 是否继续采用 line-hash，或引入 stable anchors。
7. 决定 Dashboard/REST read models 是否应从 shared schemas 自动生成。

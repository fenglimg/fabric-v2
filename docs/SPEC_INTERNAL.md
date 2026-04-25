# SPEC_INTERNAL: 执行流协议

本文是 Fabric-v2 核心执行流的协议说明。修改 `packages/` 中核心引擎逻辑前，必须先在本文提交逻辑变更点并经维护者审核。

## 当前闭环

```text
CLI command
  -> packages/cli/src/index.ts 注册 subcommands
  -> fabric serve 启动 server HTTP app
  -> server 注册 MCP tools 和 REST/SSE APIs
  -> client 调用 fab_get_rules 或 fab_plan_context
  -> server 加载 .fabric/agents.meta.json + L0 bootstrap + human-lock
  -> path 按 scope_glob 和 priority 命中 rule nodes
  -> rules payload 返回 L0/L1/L2、human lock 和 description stubs
  -> AI 在取回 rules 后执行修改
  -> fab_append_intent 写入 ledger，并尽力记录 audit compliance
```

证据：

- CLI entry 使用 `citty` 和 lazy subcommand map：`packages/cli/src/index.ts:11`, `packages/cli/src/commands/index.ts:1`。
- `fabric serve` 调用 `@fenglimg/fabric-server` 的 `startHttpServer`：`packages/cli/src/commands/serve.ts:58`。
- Server 集中注册 MCP tools：`packages/server/src/index.ts:43`。
- HTTP app 注册 REST APIs、`/events`、`/mcp` 和 static Dashboard：`packages/server/src/http.ts:208`。
- `fab_get_rules` 包装 `getRules`：`packages/server/src/tools/get-rules.ts:31`。
- `getRules` 加载 context、解析 path rules、追加 audit event：`packages/server/src/services/get-rules.ts:83`。
- Intent append 先写 ledger，再尽力写 compliance audit：`packages/server/src/services/append-intent.ts:17`。

## 核心服务：`fab_get_rules`

MCP tool 名称：

```text
fab_get_rules
```

Input schema：

```ts
type GetRulesInput = {
  path: string;
  client_hash?: string;
};
```

证据：

- Runtime input type：`packages/server/src/services/get-rules.ts:40`。
- Tool zod schema：`packages/server/src/tools/get-rules.ts:7`。

Output schema：

```ts
type GetRulesResult = {
  revision_hash: string;
  stale: boolean;
  rules: {
    L0: string;
    L1: Array<{ path: string; content: string }>;
    L2: Array<{ path: string; content: string }>;
    human_locked_nearby: Array<{ file: string; excerpt: string }>;
    description_stubs?: Array<{ path: string; description: string }>;
  };
};
```

证据：

- Runtime output type：`packages/server/src/services/get-rules.ts:45`。
- Tool output schema：`packages/server/src/tools/get-rules.ts:19`。
- Dashboard mirrored type：`packages/dashboard/src/api/client.ts:56`。

流程：

```ts
async function getRules(projectRoot, input) {
  context = await loadGetRulesContext(projectRoot);
  stale = input.client_hash !== undefined && input.client_hash !== context.meta.revision;
  rules = await resolveRulesForPath(projectRoot, context, input.path);
  try appendGetRulesAuditEvent(projectRoot, input);
  return { revision_hash: context.meta.revision, stale, rules };
}
```

证据：`packages/server/src/services/get-rules.ts:83`。

Context 加载：

```ts
context = {
  meta: read .fabric/agents.meta.json,
  l0Content: read .fabric/bootstrap/README.md,
  humanLockedNearby: read .fabric/human-lock.json and stringify entries
}
```

证据：

- Context cache 读取：`packages/server/src/services/get-rules.ts:105`。
- Meta 读取：`packages/server/src/meta-reader.ts:39`。
- L0 bootstrap 读取：`packages/server/src/services/get-rules.ts:111`。
- Human lock 投影：`packages/server/src/services/get-rules.ts:113`。

## Rule 命中与 Priority

Path 规范化：

```ts
requestedPath = input.path.replaceAll("\\", "/");
```

证据：`packages/server/src/services/get-rules.ts:141`。

Priority 顺序：

```ts
priorityWeight = { high: 0, medium: 1, low: 2 };
```

证据：`packages/server/src/services/get-rules.ts:77`。

伪代码：

```ts
function matchRuleNodes(meta, path) {
  requestedPath = normalize(path);

  return Object.entries(meta.nodes)
    .filter(([id, node]) => shouldLoadNodeForPath(requestedPath, node))
    .sort(([leftId, leftNode], [rightId, rightNode]) => {
      priorityDelta = weight[leftNode.priority] - weight[rightNode.priority];
      if (priorityDelta !== 0) return priorityDelta;
      return leftId.localeCompare(rightId);
    })
    .map(([nodeId, node]) => ({
      node_id: nodeId,
      level: classifyNode(nodeId, node),
      stable_id: node.stable_id ?? nodeId,
      identity_source: node.identity_source ?? "derived",
      node
    }));
}
```

证据：

- Match 与 sort：`packages/server/src/services/get-rules.ts:145`。
- Level classification：`packages/server/src/services/get-rules.ts:223`。
- Stable ID fallback：`packages/server/src/services/get-rules.ts:157`。

Rule 加载：

```ts
for matchedNode:
  if level is null: skip
  if activation.tier == "description":
    emit description_stub only
  else:
    read node.file content into L1 or L2
```

证据：`packages/server/src/services/get-rules.ts:166`。

Payload 构造：

```ts
payload = {
  L0: context.l0Content,
  L1: loaded rules where level == "L1",
  L2: loaded rules where level == "L2",
  human_locked_nearby: context.humanLockedNearby,
  description_stubs: deduped stubs if any
}
```

证据：

- Payload composition：`packages/server/src/services/get-rules.ts:204`。
- L1/L2 partition：`packages/server/src/services/get-rules.ts:238`。

## 核心服务：`fab_plan_context`

用途：在 planning 阶段一次查询 2 个以上 paths，并产出 shared bundle view。

Input：

```ts
type PlanContextInput = {
  paths: string[];
  client_hash?: string;
};
```

证据：

- Runtime input type：`packages/server/src/services/plan-context.ts:12`。
- Tool schema 要求 `paths.min(2)`：`packages/server/src/tools/plan-context.ts:7`。

Output：

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
    preflight_diagnostics: Array<{
      code: "description_stub_only" | "derived_identity";
      severity: "info" | "warn";
      message: string;
      path?: string;
      stable_ids?: string[];
    }>;
  };
};
```

证据：

- Runtime result type：`packages/server/src/services/plan-context.ts:17`。
- Tool output schema：`packages/server/src/tools/plan-context.ts:29`。

流程：

```ts
uniquePaths = normalize and dedupe input.paths;
for each path:
  matchedNodes[path] = matchRuleNodes(meta, path);
  loaded[path] = loadMatchedRules(projectRoot, matchedNodes[path], sharedFileContentCache);
entries = uniquePaths.map(path => buildRulesPayload(..., { dedupeByPath: true }));
shared = buildSharedView(revision, uniquePaths, matchedNodes, loaded);
```

证据：

- Path dedupe：`packages/server/src/services/plan-context.ts:87`。
- Shared file content cache：`packages/server/src/services/plan-context.ts:59`。
- Entries 使用 `dedupeByPath`：`packages/server/src/services/plan-context.ts:71`。
- Shared bundle ID：`packages/server/src/services/plan-context.ts:184`。

## 核心服务：`fab_update_registry`

用途：通过 tool 修改 `.fabric/agents.meta.json`，禁止直接手改。

Input：

```ts
type UpdateRegistryInput = {
  op: "add-node" | "remove-node" | "update-node";
  node_id: string;
  data?: Record<string, unknown>;
};
```

证据：

- Service input：`packages/server/src/services/update-registry.ts:9`。
- Tool input：`packages/server/src/tools/update-registry.ts:8`。

变更语义：

```ts
if op == "remove-node":
  delete nodes[node_id]
if op == "add-node":
  nodes[node_id] = agentsMetaNodeSchema.parse(data)
if op == "update-node":
  nodes[node_id] = agentsMetaNodeSchema.parse({ ...current, ...data })
revision = sha256(sorted node hashes joined)
atomicWrite(.fabric/agents.meta.json, nextMetaWithRevision)
invalidate meta cache
```

证据：

- Operation apply：`packages/server/src/services/update-registry.ts:70`。
- Revision computation：`packages/server/src/services/update-registry.ts:50`。
- Atomic write：`packages/server/src/services/update-registry.ts:29`。
- Cache invalidation：`packages/server/src/services/update-registry.ts:41`。

已知约束：tool schema 目前没有在 `data` 中暴露 `stable_id`、`identity_source` 和 `activation`，但 service parser 支持 schema defaults 和 existing node merge。证据：tool `nodeInputSchema` 位于 `packages/server/src/tools/update-registry.ts:22`；shared node schema 位于 `packages/shared/src/schemas/agents-meta.ts:23`。

## 核心服务：`fab_append_intent`

Input：

```ts
type AppendIntentInput = {
  entry: Omit<AiLedgerEntry, "id" | "source" | "ts">;
};
```

证据：`packages/server/src/tools/append-intent.ts:8`。

Output：

```ts
type AppendIntentResult = {
  success: true;
  timestamp: number;
  entry: StoredLedgerEntry;
  compliance?: {
    compliant: boolean;
    matched_get_rules_ts: string | null;
    window_ms: number;
  };
};
```

证据：

- Tool output schema：`packages/server/src/tools/append-intent.ts:20`。
- Service result type：`packages/server/src/services/append-intent.ts:10`。

流程：

```ts
ts = Date.now();
entry = appendLedgerEntry({ ...input.entry, ts, source: "ai" });
try appendEditIntentAuditEvents(projectRoot, affected_paths, intent, ledger_entry_id, ts);
return { success: true, timestamp: ts, entry, compliance };
```

证据：`packages/server/src/services/append-intent.ts:17`。

## MCP 上的 JSON-RPC

Stdio 模式：

```text
client process
  -> node packages/server/dist/index.js
  -> startStdioServer()
  -> McpServer.connect(StdioServerTransport)
```

证据：

- Stdio transport import：`packages/server/src/index.ts:7`。
- Stdio start：`packages/server/src/index.ts:79`。
- Main module 启动 stdio server：`packages/server/src/index.ts:118`。

HTTP 模式：

```text
POST /mcp initialize without Mcp-Session-Id
  -> createSession()
  -> new StreamableHTTPServerTransport({ sessionIdGenerator, enableJsonResponse, eventStore })
  -> server.connect(transport)
  -> transport.handleRequest(req, res, body)
subsequent POST /mcp with Mcp-Session-Id
  -> find session
  -> transport.handleRequest(req, res, body)
```

证据：

- `/mcp` route：`packages/server/src/http.ts:217`。
- 缺少 session 时，只有 initialize 请求会被接受：`packages/server/src/http.ts:231`。
- Session create：`packages/server/src/http.ts:272`。
- `enableJsonResponse: true`：`packages/server/src/http.ts:278`。
- JSON-RPC error format：`packages/server/src/http.ts:357`。

Initialize request 示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "client", "version": "0.0.0" }
  }
}
```

Initialize 后的 tool call 示例：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "fab_get_rules",
    "arguments": {
      "path": "packages/server/src/services/get-rules.ts",
      "client_hash": "sha256:previous"
    }
  }
}
```

Tool handler response shape：

```json
{
  "content": [{ "type": "text", "text": "{...json...}" }],
  "structuredContent": {
    "revision_hash": "sha256:...",
    "stale": false,
    "rules": {
      "L0": "...",
      "L1": [],
      "L2": [],
      "human_locked_nearby": []
    }
  }
}
```

证据：

- Tool handlers 同时返回 `content` 和 `structuredContent`：`packages/server/src/tools/get-rules.ts:45`, `packages/server/src/tools/plan-context.ts:91`。
- HTTP event store 持久化 JSON-RPC messages：`packages/server/src/http.ts:58`。
- Event replay 使用 event id 和 stream id：`packages/server/src/http.ts:85`。

## Cache 与 Invalidation

Hot-path cache slots：

- `meta`: parsed `.fabric/agents.meta.json`
- `context`: `GetRulesContext`
- `audit`: sliding-window cursor for `.fabric/audit.jsonl`

证据：`packages/server/src/cache.ts:1`。

Invalidation 规则：

- `meta_write` clears meta slot only.
- `file_watch` clears meta and context.
- HTTP app watches `.fabric/agents.meta.json` and `.fabric/bootstrap/README.md`.

证据：

- Cache API：`packages/server/src/cache.ts:43`。
- Invalidation semantics：`packages/server/src/cache.ts:94`。
- Watcher paths：`packages/server/src/http.ts:151`。
- Tool/resource notifications：`packages/server/src/http.ts:169`。

## Stable ID 协议

Schema fields：

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
  activation?: { tier: "always" | "path" | "description"; description?: string };
};
```

证据：`packages/shared/src/schemas/agents-meta.ts:23`。

Derivation 规则：

- `.fabric/bootstrap/README.md` and `AGENTS.md` derive `stable_id = "bootstrap"`.
- Other files derive stable id from depth source and strip `.md`.
- Declared id is parsed from first-line HTML comment `<!-- fab:rule-id ... -->`.

证据：

- Stable ID derivation：`packages/shared/src/schemas/agents-meta.ts:67`。
- Identity source derivation：`packages/shared/src/schemas/agents-meta.ts:77`。
- `sync-meta` declared-id regex：`packages/cli/src/commands/sync-meta.ts:334`。

## 变更门禁

修改下列节点前，必须先更新本文：

- Rule matching, priority, activation, dedupe: `packages/server/src/services/get-rules.ts`
- Batch planning and shared bundle: `packages/server/src/services/plan-context.ts`
- Registry mutation and revision hash: `packages/server/src/services/update-registry.ts`
- MCP transport/session protocol: `packages/server/src/http.ts`, `packages/server/src/index.ts`
- Stable ID derivation: `packages/shared/src/schemas/agents-meta.ts`, `packages/cli/src/commands/sync-meta.ts`
- Init scaffold and metadata generation: `packages/cli/src/commands/init.ts`, `packages/cli/src/commands/sync-meta.ts`

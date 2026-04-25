# Fabric Rule Architecture Data Structures

Generated: 2026-04-25T12:18:19+08:00

This file is a discussion inventory, not a final design. It lists the data structures that currently shape Fabric rule distribution, governance, and observation.

## 1. Rule Source Layer

### 1.1 Rule Markdown Files

- Storage: `.fabric/agents/**/*.md`, `.fabric/bootstrap/README.md`, and generated client-facing bootstrap variants.
- Role: human-readable rule bodies.
- Design status: implicit file format plus optional stable-id HTML comment.
- Evidence:
  - L0 bootstrap read by server: `packages/server/src/services/get-rules.ts:111`
  - matched rule content read by `node.file`: `packages/server/src/services/get-rules.ts:190`
  - stable-id comment ADR: `docs/ARCHITECTURE_DECISIONS.md:56`

Architecture questions:
- Should rule markdown have a stricter header contract beyond `<!-- fab:rule-id ... -->`?
- Should rule files carry activation metadata themselves, or should all metadata stay in `.fabric/agents.meta.json`?

### 1.2 Stable Rule Identity

- Shape: `stable_id?: string`, `identity_source?: "declared" | "derived"`.
- Declared source: first-line HTML comment `<!-- fab:rule-id scope/name -->`.
- Derived source: normalized rule file path fallback.
- Evidence:
  - Schema: `packages/shared/src/schemas/agents-meta.ts:31`
  - Derivation: `packages/shared/src/schemas/agents-meta.ts:67`
  - Extraction: `packages/cli/src/commands/sync-meta.ts:334`

Architecture questions:
- Should derived identities be allowed long term or treated as migration warnings only?
- Should `stable_id` be exposed in all delivery payloads, not only plan shared entries?

## 2. Rule Registry Layer

### 2.1 AgentsMeta

```ts
type AgentsMeta = {
  revision: string;
  nodes: Record<string, AgentsMetaNode>;
};
```

- Storage: `.fabric/agents.meta.json`.
- Role: registry truth source used by server rule matching.
- Evidence: `packages/shared/src/schemas/agents-meta.ts:49`.

Architecture questions:
- Is `revision` only content hash, or full registry semantic revision?
- Should registry support schema versioning to separate v1/v2 behavior?

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

- Role: per-rule metadata for matching, ordering, topology, identity, and activation.
- Evidence:
  - Type: `packages/shared/src/types/agents.ts:13`
  - Schema: `packages/shared/src/schemas/agents-meta.ts:23`
  - Internal spec: `docs/SPEC_INTERNAL.md:458`

Architecture questions:
- `deps`: should this affect resolution order/loading, or remain documentation/topology-only?
- `activation`: should `description` still obey `scope_glob`, or be global discovery metadata?
- `priority`: should it order only within same layer, or across all matched nodes before layer partition?
- `layer` vs node id prefix: should one be canonical? `classifyNode` currently uses node id prefix first, then `node.layer`.

### 2.3 Activation Tier

```ts
type AgentsActivationTier = "always" | "path" | "description";
```

- Current semantics:
  - `always`: match all paths, load full rule content.
  - `path` or undefined: match by `scope_glob`, load full rule content.
  - `description`: match all paths, return stub only.
- Evidence: `packages/server/src/services/get-rules.ts:275`.

Architecture questions:
- Is `description` a semantic-discovery index, or a scoped lazy-load marker?
- If global, should it have additional filters such as tags, domains, or max count?
- If scoped, `shouldLoadNodeForPath` should probably apply `scope_glob` before emitting the stub.

### 2.4 Priority

```ts
type Priority = "high" | "medium" | "low";
```

- Current semantics: matched nodes sort by `high -> medium -> low`, then node id.
- Evidence:
  - Priority order: `packages/server/src/services/get-rules.ts:77`
  - Sort: `packages/server/src/services/get-rules.ts:150`

Architecture questions:
- Should L1/L2 partition happen before priority sort, or is cross-layer priority valid?
- Does priority mean rule importance, load order, conflict precedence, or all three?
- Should priority be numeric/weighted later, or is 3-level enum enough?

## 3. Rule Resolution Layer

### 3.1 GetRulesContext

```ts
type GetRulesContext = {
  meta: AgentsMeta;
  l0Content: string;
  humanLockedNearby: HumanLockedNearby[];
};
```

- Role: cached server-side base context for one project root.
- Evidence: `packages/server/src/services/get-rules.ts:51`.

Architecture questions:
- Should human-lock be cached with the same TTL as meta/L0 content?
- Should context include pre-parsed rule file metadata or only registry + L0 + locks?

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

- Role: transient server result after metadata matching and sorting.
- Evidence: `packages/server/src/services/get-rules.ts:69`.

Architecture questions:
- Should `level` derive only from `node.layer`, not from node id prefix?
- Should matched nodes preserve hit reason (`always`, `path`, `description`) explicitly?

### 3.3 LoadedRulesResult

```ts
type LoadedRulesResult = {
  rules: LoadedRule[];
  stubs: SharedDescriptionStub[];
};
```

- Role: separates full content rules from description-only candidates.
- Evidence: `packages/server/src/services/get-rules.ts:64`.

Architecture questions:
- Should `description` tier ever read backing content in the same call?
- Should stubs include priority, scope, and node id for client-side explanation?

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

- Role: main delivery payload for single-target rule lookup.
- Used by: MCP `fab_get_rules`, REST `/api/rules/context`, Dashboard topology.
- Evidence:
  - Service type: `packages/server/src/services/get-rules.ts:32`
  - MCP output: `packages/server/src/tools/get-rules.ts:19`
  - REST context API: `packages/server/src/api/rules-context.ts:17`
  - Dashboard type: `packages/dashboard/src/api/client.ts:56`

Architecture questions:
- Should L1/L2 entries include `stable_id`, `identity_source`, `priority`, and `activation.tier`?
- Should `human_locked_nearby` be renamed if it returns all locks?
- Should `description_stubs` be always present as `[]` for easier clients, or optional for compactness?

### 3.5 GetRulesResult

```ts
type GetRulesResult = {
  revision_hash: string;
  stale: boolean;
  rules: RulesPayload;
};
```

- Role: MCP-level envelope for stale detection.
- Evidence: `packages/server/src/services/get-rules.ts:45`.

Architecture questions:
- Should stale detail include `client_hash` and server `revision_hash` reason?
- Should HTTP `/api/rules/context` return the envelope too, or is rules-only enough for Dashboard?

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

- Role: batch query and shared bundle view for planning/architecture review.
- Evidence:
  - Type: `packages/server/src/services/plan-context.ts:17`
  - MCP output schema: `packages/server/src/tools/plan-context.ts:29`

Architecture questions:
- Should this become the canonical architecture-review API while `fab_get_rules` remains final edit gate?
- Should `shared_entries` dedupe by stable id or by physical path? Current behavior can keep same file content twice if stable ids differ.
- Should diagnostics support more codes beyond `description_stub_only` and `derived_identity`?

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

- Role: richer version of description stub for planning shared view.
- Evidence: `packages/server/src/services/get-rules.ts:21`.

Architecture questions:
- Why does single-path `RulesPayload.description_stubs` drop `stable_id` and `level`?
- Should clients use `path` or `stable_id` when requesting full content after seeing a stub?

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

- Storage: `.fabric/human-lock.json`.
- Role: protected ranges that require human confirmation before editing.
- Evidence:
  - Type: `packages/shared/src/types/ledger.ts:24`
  - Schema: `packages/shared/src/schemas/human-lock.ts:8`

Architecture questions:
- Should locked ranges use stable anchors in addition to line ranges?
- Should ranges carry reason/owner/created_at metadata?

### 5.2 HumanLockStatus

```ts
type HumanLockStatus = HumanLockEntry & {
  drift: boolean;
  current_hash: string;
};
```

- Role: read model that indicates whether protected content drifted.
- Evidence: `packages/server/src/services/read-human-lock.ts:14`.

Architecture questions:
- Should `current_hash` be exposed to all clients, or only approval flows?
- Should drift state be event-driven/cached instead of recomputed per read?

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

- Role: write-side approval flow for drifted protected ranges.
- Evidence: `packages/server/src/services/approve-human-lock.ts:11`.

Architecture questions:
- Should approval remain CLI/server only, given ADR-008 says Dashboard should trend read-only?
- Should approval require intent/reason, not just new hash?

## 6. Intent, Audit, And Event Layer

### 6.1 LedgerEntry

```ts
type LedgerEntry =
  | { source: "ai"; id?: string; ts: number; commit_sha?: string; intent: string; affected_paths: string[] }
  | { source: "human"; id?: string; ts: number; parent_sha: string; parent_ledger_entry_id?: string; intent: string; affected_paths: string[]; diff_stat: string; annotation?: string };
```

- Storage: `.fabric/.intent-ledger.jsonl`, with legacy root path compatibility.
- Role: append-only intent history.
- Evidence:
  - Type: `packages/shared/src/types/ledger.ts:1`
  - Schema: `packages/shared/src/schemas/ledger-entry.ts:10`
  - Read/append/migration: `packages/server/src/services/read-ledger.ts:54`

Architecture questions:
- Should MCP event replay entries live in the same physical JSONL as ledger entries?
- Should intent entries reference rule revision used for the edit?

### 6.2 AuditLogEntry

```ts
type AuditLogEntry =
  | { kind: "audit-event"; event: "get_rules"; ts: number; path: string; client_hash?: string }
  | { kind: "audit-event"; event: "edit_intent"; ts: number; path: string; compliant: boolean; intent: string; ledger_entry_id: string; matched_get_rules_ts: number | null; window_ms: number };
```

- Storage: `.fabric/audit.jsonl`.
- Role: best-effort compliance telemetry linking rule lookup to later edit intent.
- Evidence: `packages/server/src/services/audit-log.ts:10`.

Architecture questions:
- Should audit be purely telemetry, or can it become enforcement in strict mode?
- Should audit link to `revision_hash` and `stable_id` bundle?

### 6.3 FabricEvent

```ts
type FabricEvent =
  | { type: "meta:updated"; payload: AgentsMeta }
  | { type: "lock:drift"; payload: { locked: HumanLockEntry[]; drifted: HumanLockEntry[] } }
  | { type: "lock:approved"; payload: { locked: HumanLockEntry[]; approved: HumanLockEntry[] } }
  | { type: "ledger:appended"; payload: LedgerEntry }
  | { type: "drift:detected"; payload: ForensicReport };
```

- Role: Dashboard/SSE event contract.
- Evidence: `packages/shared/src/schemas/events.ts:10`.

Architecture questions:
- Should rule resolution events exist, or is audit log sufficient?
- Should event payloads use compact deltas instead of full AgentsMeta?

### 6.4 StoredMcpEvent

```ts
type StoredMcpEvent = {
  kind: "mcp-event";
  eventId: EventId;
  streamId: StreamId;
  message: JSONRPCMessage;
};
```

- Role: Streamable HTTP MCP event replay store.
- Evidence: `packages/server/src/http.ts:39`.

Architecture questions:
- Should MCP event replay share the intent ledger file, or use a separate protocol log?
- Should replay retention be bounded?

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

- Storage: `.fabric/init-context.json` during initialization.
- Role: remembers project discovery and human interview context used to scaffold rules.
- Evidence: `packages/shared/src/schemas/init-context.ts:43`.

Architecture questions:
- Should InitContext feed later sync-meta/rule generation, or remain historical only?
- Should domain_groups map directly to AgentsMetaNode generation?

### 7.2 ForensicReport

- Role: scanner output with framework, topology, entry points, code samples, assertions, candidate files, README quality.
- Evidence:
  - Interface: `packages/shared/src/schemas/forensic-report.ts:75`
  - Schema: `packages/shared/src/schemas/forensic-report.ts:160`

Architecture questions:
- Should forensic assertions become candidate rule nodes automatically?
- Should `proposed_rule` be normalized into AgentsMetaNode proposals?

### 7.3 InitScaffoldPlan / InitExecutionPlan

- Role: CLI-side plan for creating bootstrap, meta, human-lock, forensic report, client skills/hooks/settings.
- Evidence:
  - `InitScaffoldPlan`: `packages/cli/src/commands/init.ts:181`
  - `InitExecutionPlan`: `packages/cli/src/commands/init.ts:207`

Architecture questions:
- Should init scaffold outputs be expressible as a single project state transaction?
- Should each scaffolded artifact record provenance in ledger?

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

- Role: local config for client paths, fixtures, ignores, and audit mode.
- Evidence: `packages/shared/src/schemas/fabric-config.ts:15`.

Architecture questions:
- Should both `auditMode` and `audit_mode` remain accepted indefinitely?
- Should rule-distribution behavior have config flags, or stay schema-driven?

### 8.2 DoctorReport

```ts
type DoctorReport = {
  status: "ok" | "warn" | "error";
  checks: DoctorCheck[];
  summary: DoctorSummary;
  audit: DoctorAuditReport | null;
};
```

- Role: health/readiness report for metadata, locks, ledger, audit, forensic state.
- Evidence: `packages/server/src/services/doctor.ts:60`.

Architecture questions:
- Should every architecture invariant in ADRs have a corresponding doctor check?
- Should DoctorReport be the canonical place to surface derived identity and revision drift?

### 8.3 ContextCache / AuditCursor

- Role: in-process hot path cache for agents meta, get-rules context, and audit sliding-window cursor.
- Evidence: `packages/server/src/cache.ts:1`.

Architecture questions:
- Is 5s TTL acceptable for rule edits, or should file-watch invalidation be required for all state?
- Does caching human-lock in GetRulesContext create stale lock warnings?

## 9. MCP And HTTP Contract Layer

### 9.1 fab_get_rules

- Input: `{ path: string; client_hash?: string }`.
- Output: `{ revision_hash: string; stale: boolean; rules: RulesPayload }`.
- Role: final pre-edit single-target rule lookup.
- Evidence: `packages/server/src/tools/get-rules.ts:7`.

Architecture questions:
- Should clients be required to stop on `stale: true`, or only warn?
- Should output include hit reasons instead of only rule content?

### 9.2 fab_plan_context

- Input: `{ paths: string[]; client_hash?: string }`, minimum 2 paths.
- Output: `PlanContextResult`.
- Role: batch planning/architecture review context.
- Evidence: `packages/server/src/tools/plan-context.ts:7`.

Architecture questions:
- Should minimum 2 be enforced at schema level if callers sometimes have one unknown target?
- Should shared bundle become reusable by id in subsequent calls?

### 9.3 fab_update_registry

- Input currently supports `file`, `scope_glob`, `deps`, `priority`, `layer`, `topology_type`, `hash`.
- Role: MCP write-side registry mutation, recommended instead of directly editing `.fabric/agents.meta.json`.
- Evidence: `packages/server/src/tools/update-registry.ts:8`.

Architecture questions:
- It does not expose `stable_id`, `identity_source`, or `activation`; should it?
- Should it recompute hash from file content instead of accepting hash input?
- Should it share revision calculation with sync-meta?

### 9.4 fab_append_intent

- Input: `{ intent: string; affected_paths: string[]; commit_sha?: string }`.
- Output: `{ success: boolean; entry: StoredLedgerEntry }`.
- Role: append AI intent after a completed task.
- Evidence: `packages/server/src/tools/append-intent.ts:8`.

Architecture questions:
- Should append intent require the last `fab_get_rules` revision used?
- Should audit compliance failure be surfaced in the tool output?

### 9.5 REST API Read Models

- `/api/rules`: returns `AgentsMeta`.
- `/api/rules/context`: returns `RulesPayload` only.
- `/api/human-lock`: returns `HumanLockStatus[]`.
- `/api/doctor`: returns `DoctorReport`.
- Dashboard client mirrors these as local types.
- Evidence:
  - Rules API: `packages/server/src/api/rules.ts:4`
  - Rules context API: `packages/server/src/api/rules-context.ts:4`
  - Dashboard client: `packages/dashboard/src/api/client.ts:129`

Architecture questions:
- Should REST types be generated from shared/server schemas to avoid duplication?
- Should Dashboard remain strictly read-only as ADR-008 intends?

## 10. Design Discussion Summary

The current structures fall into four categories:

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
   - MCP tools: `fab_get_rules`, `fab_plan_context`, `fab_update_registry`, `fab_append_intent`
   - REST endpoints: rules, rules-context, human-lock, ledger, doctor, history
   - SSE events: `FabricEvent`

4. Initialization/discovery artifacts
   - `ForensicReport`
   - `InitContext`
   - `InitScaffoldPlan`
   - `InitExecutionPlan`

Most important architecture review targets:

1. Define which layer owns each field.
2. Decide whether `description` activation is global discovery or scoped lazy loading.
3. Unify revision semantics across `sync-meta` and `update-registry`.
4. Decide whether `deps` is behavioral or documentary.
5. Decide whether `RulesPayload` should expose stable ids and hit reasons.
6. Decide whether human-lock should remain line-hash based or gain stable anchors.
7. Decide whether Dashboard/REST read models should be generated from shared schemas.

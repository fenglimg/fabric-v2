# SPEC_INTERNAL: Knowledge Execution Protocol

本文是 Fabric-v2 核心执行流的当前协议说明。修改 `packages/` 中核心引擎逻辑前，必须先同步本文的逻辑变更点。

## 当前闭环

```text
fabric install
  -> 写入 / 刷新 .fabric/AGENTS.md、.fabric/INITIAL_TAXONOMY.md、.fabric/events.jsonl
  -> 初始化 .fabric/knowledge/ 与客户端 hooks / skills / MCP 配置

MCP server (stdio transport — v2.0.0 起主线唯一受支持 transport)
  -> client 通过其 MCP 配置 spawn server，stdio 通信
  -> 默认调用 fab_recall(paths=[...])
  -> server 内部执行 planContext + knowledgeSections 路径
  -> 返回候选索引、selection_token、完整 markdown body 和 selected_stable_ids
  -> AI 读取知识正文后执行修改
  -> 如 fab_recall 响应过大，client 可改走 fab_plan_context -> fab_get_knowledge_sections
  -> MCP、doctor、skills 写入 .fabric/events.jsonl typed Event Ledger
```

## 存储与身份

- `.fabric/knowledge/` 是 team knowledge 默认根；`~/.fabric/knowledge/` 是 personal knowledge 默认根。
- 多 store 场景下，read-set 可挂载额外 store，运行时通过 store alias 区分来源。
- `stable_id` 是知识条目的稳定身份，通常形如 `KT-DEC-0001` / `KP-PIT-0001`。
- frontmatter 中的 `id` / `stable_id` 是身份声明；文件路径和 slug 不是身份真源。
- 当前 maturity vocabulary 是 `draft`、`verified`、`proven`。
- 当前 type vocabulary 是 `models`、`decisions`、`guidelines`、`pitfalls`、`processes`。
- `.fabric/agents.meta.json` 是派生运行时索引，不是手写真源；不要直接编辑。

## Candidate Shape

`fab_plan_context` 和 `fab_recall` 暴露的候选项为 `{ stable_id, description }`，其中 `description` 承载选择信号：

```ts
type KnowledgeDescription = {
  summary: string;
  intent_clues: string[];
  tech_stack: string[];
  impact: string[];
  must_read_if: string;
  entities?: string[];
  id?: string;
  knowledge_type?: "models" | "decisions" | "guidelines" | "pitfalls" | "processes";
  maturity?: "draft" | "verified" | "proven";
  knowledge_layer?: "personal" | "team";
  tags?: string[];
  relevance_scope?: "narrow" | "broad";
  relevance_paths?: string[];
  related?: string[];
};
```

旧 L0/L1/L2 selection ceremony 已退役为内部兼容细节。当前 API 不再要求客户端按层级选择，也不返回 legacy `sections` 枚举。

## `fab_recall`

用途：编辑或架构规划前的默认读入口，一次返回相关知识候选和正文。

Input 要点：

```ts
type RecallInput = {
  paths: string[];
  intent?: string;
  known_tech?: string[];
  detected_entities?: Record<string, string[]>;
  client_hash?: string;
  correlation_id?: string;
  session_id?: string;
  layer_filter?: "team" | "personal" | "both";
  target_paths?: string[];
  ids?: string[];
  include_related?: boolean;
};
```

Output 要点：

```ts
type RecallResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: Array<{ path: string; requirement_profile: RequirementProfile }>;
  candidates: Array<{ stable_id: string; description: KnowledgeDescription }>;
  rules: Array<{ stable_id: string; level: "L0" | "L1" | "L2"; path: string; body: string }>;
  selected_stable_ids: string[];
  diagnostics: Array<{ code: "missing_knowledge_metadata" | "unresolved_selected_id"; severity: "warn"; stable_id: string; message: string }>;
  redirects?: Record<string, string>;
};
```

规则：

- 常规编辑前优先调用 `fab_recall(paths=[...])`。
- `ids` 省略时，返回 plan-context surfaced 的全部可读正文；传入 `ids` 时只取指定 stable IDs。
- `include_related` 只追加候选集中存在的一跳 related entries。
- `session_id` 建议传入当前 client session id，便于 archive-history 和 cross-session debt 统计。

## `fab_plan_context` + `fab_get_knowledge_sections`

用途：当 `fab_recall` 响应过大、噪音过多，或调用方需要精确挑选 stable IDs 时，使用两步流。

`fab_plan_context` 返回：

- `revision_hash`
- `stale`
- `selection_token`
- `entries[]` 的 path + requirement profile
- `candidates[]` 的 `{ stable_id, description }`
- `omitted_candidate_count?`
- `preflight_diagnostics[]`
- `redirects?`

`fab_get_knowledge_sections` 输入：

```ts
type KnowledgeSectionsInput = {
  selection_token: string;
  ai_selected_stable_ids: string[];
  ai_selection_reasons?: Record<string, string>;
  correlation_id?: string;
  session_id?: string;
  client_hash?: string;
};
```

`fab_get_knowledge_sections` 输出完整 markdown body：

```ts
type KnowledgeSectionsResult = {
  revision_hash: string;
  selected_stable_ids: string[];
  rules: Array<{ stable_id: string; level: "L0" | "L1" | "L2"; path: string; body: string }>;
  diagnostics: Array<{ code: "missing_knowledge_metadata" | "unresolved_selected_id"; severity: "warn"; stable_id: string; message: string }>;
  redirect_to?: { stable_id: string } | Record<string, string>;
};
```

规则：

- `selection_token` 必须来自最近一次 `fab_plan_context` 或 `fab_recall`。
- `ai_selected_stable_ids` 应从 `candidates[].stable_id` 中选择。
- `sections` 参数已删除；调用方读取 `body` 后自行扫描需要的 heading。
- 缺失 metadata 是 warning；未知或无法解析的 stable ID 会进入 diagnostics。

## Write Tools

- `fab_extract_knowledge`：从会话内容提取候选 knowledge，写入 `.fabric/knowledge/pending/<type>/`。
- `fab_archive_scan`：为 archive skill 扫描 session / event ledger / recent paths，返回候选归档上下文。
- `fab_review`：对 pending 或 canonical knowledge 执行 `list`、`approve`、`reject`、`modify`、`search`、`defer` 等动作。

`fab_review.approve` 负责 stable ID 分配和 canonical 落盘；失败时 counter 不回滚，orphan slot 由 doctor 报告。

## Event Ledger

`.fabric/events.jsonl` 是主 ledger。关键事件包括：

- `knowledge_context_planned`：`fab_plan_context` / `fab_recall` 规划候选。
- `knowledge_selection`：两步流或 recall 内部选择 stable IDs。
- `knowledge_sections_fetched`：`fab_get_knowledge_sections` / `fab_recall` 读取完整正文。
- `knowledge_proposed`：pending entry 写入。
- `knowledge_promote_started` / `knowledge_promoted` / `knowledge_promote_failed`：review approve 事务。
- `knowledge_layer_changed`：review modify layer flip。
- `knowledge_rejected` / `knowledge_deferred` / `knowledge_archived`：review 或 doctor governance 动作。

`fabric doctor` 检查 ledger 是否存在、可写、可解析，并可在 `--fix` / `--fix-knowledge` 模式下写入确定性治理事件。

## Static Test Traceability

V1 静态 traceability 仍使用 `// @fabric-verify <stable_id>` 声明测试与 stable ID 的关系。它只记录声明覆盖和 hash drift 信号，不运行测试，也不证明语义覆盖。

```ts
// @fabric-verify KT-DEC-0001
describe("knowledge-visible behavior", () => {
  it("preserves the documented contract", () => {
    // project-owned assertions
  });
});
```

`fabric doctor --fix` 可刷新派生 sidecar 和 deterministic metadata；`fabric doctor --fix-knowledge` 面向 knowledge lint / pending overdue / stale archive 等知识治理修复。

## Target Command And State Surface

Public CLI commands:

```text
fabric install
fabric store
fabric sync
fabric info
fabric doctor
fabric uninstall
fabric config
```

Compatibility / hidden commands:

```text
fabric whoami
fabric status
fabric scope-explain
fabric plan-context-hint
fabric onboard-coverage
fabric metrics
```

> v1.x / rc 时代的 `fabric serve` 已在 v2.0.0-rc.37 quarantine 到 `packages/server-http-experimental/`。v2.0.0 起 client 通过 stdio MCP 直连 server，不再需要本地 HTTP 进程。

Target `.fabric/` state:

- `.fabric/AGENTS.md`
- `.fabric/INITIAL_TAXONOMY.md`
- `.fabric/fabric-config.json`
- `.fabric/knowledge/`
- `.fabric/events.jsonl`
- `.fabric/metrics.jsonl`
- `.fabric/.cache/`
- `.fabric/agents.meta.json`（派生，不手写）

`.fabric/knowledge/` 是知识真源。`.fabric/events.jsonl` 是审计 ledger。`fabric doctor --fix` 可重建 deterministic 派生状态；`fabric doctor --fix-knowledge` 可执行明确的 knowledge maintenance 修复；二者都不能替用户裁决语义冲突或业务代码是否符合知识条目。

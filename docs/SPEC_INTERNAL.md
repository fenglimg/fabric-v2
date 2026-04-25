# SPEC_INTERNAL: 执行流协议

本文是 Fabric-v2 核心执行流的当前协议说明。修改 `packages/` 中核心引擎逻辑前，必须先同步本文的逻辑变更点。

## 当前闭环

```text
fabric init
  -> 写入 .fabric/bootstrap/README.md、.fabric/INITIAL_TAXONOMY.md、.fabric/agents.meta.json
  -> 规则正文进入 .fabric/rules/

fabric serve
  -> 注册 MCP tools
  -> client 先调用 fab_plan_context
  -> server 返回中立 requirement_profile、L0/L1/L2 description_index、selection_token
  -> AI 只对 L1 自行选择 stable_id，并给出 ai_selection_reasons
  -> client 调用 fab_get_rule_sections
  -> server 合并 required L0/L2 + AI-selected L1
  -> server 返回结构化 sections，并写入 .fabric/audit.jsonl 的 rule_selection
  -> AI 在取回规则段落后执行修改
  -> fab_append_intent 写入 ledger
```

## 分层与身份

- `stable_id` 是唯一规则身份。`description.id` 禁止出现。
- L0 是全局协作稳定性规则。
- L1 是领域/模块规则，由 AI 从候选 description 中选择。
- L2 是具体脚本或资源的本地规则，由 server 自动要求。
- 跨层 precedence 固定为 `L2 > L1 > L0`。
- `priority` 只在同层内排序，不改变跨层 precedence。

## Registry Shape

`.fabric/agents.meta.json` 的 rule node 关键字段：

```ts
type RuleDescription = {
  summary: string;
  intent_clues: string[];
  tech_stack: string[];
  impact: string[];
  must_read_if: string;
  entities?: string[];
};

type RuleNode = {
  stable_id: string;
  level: "L0" | "L1" | "L2";
  layer: "L0" | "L1" | "L2";
  file: string;
  content_ref?: string;
  scope_glob: string;
  priority: "high" | "medium" | "low";
  description: RuleDescription;
};
```

规则正文优先放在 `.fabric/rules/`，`content_ref` 指向要读取的 Markdown。

## `fab_plan_context`

用途：编辑或架构规划前，返回中立的规则候选索引和一次性选择 token。

Input：

```ts
type PlanContextInput = {
  paths: string[];
  intent?: string;
  known_tech?: string[];
  detected_entities?: Record<string, string[]>;
  client_hash?: string;
};
```

Output 要点：

- `selection_token`
- 每个 path 的轻量 `requirement_profile`
- `description_index[]`
- `required_stable_ids[]`：L0/L2
- `ai_selectable_stable_ids[]`：L1
- `initial_selected_stable_ids[]`：只包含 required ids

`fab_plan_context` 不返回 L1 的 `score`、`confidence`、`match_reasons`、`negative_reasons` 或 `matched_profile_fields`。L1 判断由 AI 在读取 description 后自行完成。

## `fab_get_rule_sections`

用途：在 AI 选择 L1 后，按结构化 section 获取真正注入上下文。

Input：

```ts
type GetRuleSectionsInput = {
  selection_token: string;
  sections: Array<"MANDATORY_INJECTION" | "CONTEXT_INFO">;
  ai_selected_stable_ids: string[];
  ai_selection_reasons: Record<string, string>;
};
```

规则：

- `selection_token` 缺失或过期是 hard error。
- AI 只能选择 token 中的 L1 stable_ids。
- 选择 L0/L2、未知 stable_id、或缺少 selection reason 都是 hard error。
- server 最终合并 `required_stable_ids + ai_selected_stable_ids`。
- 缺失 section 返回空字符串和 warning diagnostic，禁止回退全文。
- 成功解析后追加 `rule_selection` audit event。

Output 要点：

```ts
type GetRuleSectionsResult = {
  revision_hash: string;
  precedence: ["L2", "L1", "L0"];
  selected_stable_ids: string[];
  rules: Array<{
    stable_id: string;
    level: "L0" | "L1" | "L2";
    path: string;
    sections: Record<string, string>;
  }>;
  diagnostics: Array<{
    code: "missing_section";
    severity: "warn";
    stable_id: string;
    section: string;
    message: string;
  }>;
};
```

## Audit

`fab_get_rule_sections` 写入 `.fabric/audit.jsonl`：

```ts
type RuleSelectionAuditEntry = {
  kind: "audit-event";
  event: "rule_selection";
  ts: number;
  path: string;
  selection_token: string;
  target_paths: string[];
  required_stable_ids: string[];
  ai_selectable_stable_ids: string[];
  ai_selected_stable_ids: string[];
  final_stable_ids: string[];
  ai_selection_reasons: Record<string, string>;
  rejected_stable_ids: string[];
  ignored_stable_ids: string[];
};
```

`fabric doctor --audit` 接受新 `rule_selection` 事件，也兼容旧 `get_rules` 事件。

## Legacy Surface

`fab_get_rules` 和旧 rules context API 仍可作为旧代码与 Dashboard 只读观察面存在，但 MCP 编辑闭环不再依赖它们。新客户端应使用：

```text
fab_plan_context -> fab_get_rule_sections -> edit -> fab_append_intent
```

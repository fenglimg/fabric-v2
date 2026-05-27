# SPEC_INTERNAL: 执行流协议

本文是 Fabric-v2 核心执行流的当前协议说明。修改 `packages/` 中核心引擎逻辑前，必须先同步本文的逻辑变更点。

## 当前闭环

```text
fabric install
  -> 写入 .fabric/AGENTS.md、.fabric/INITIAL_TAXONOMY.md、.fabric/forensic.json、.fabric/events.jsonl
  -> 规则正文进入 .fabric/rules/

MCP server (stdio transport — v2.0.0 唯一受支持 transport)
  -> client 通过其 MCP 配置 spawn `node packages/server/dist/index.js`，stdio 通信
  -> client 先调用 fab_plan_context
  -> server 返回中立 requirement_profile、L0/L1/L2 description_index、selection_token
  -> AI 只对 L1 自行选择 stable_id，并给出 ai_selection_reasons
  -> client 调用 fab_get_rule_sections
  -> server 合并 required L0/L2 + AI-selected L1
  -> server 返回结构化 sections，并写入 .fabric/events.jsonl 的 rule_selection event
  -> AI 在取回规则段落后执行修改
  -> MCP、doctor 自动写入 .fabric/events.jsonl typed Event Ledger
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

规则正文必须放在 `.fabric/rules/`，`content_ref` 指向要读取的 Markdown。`.fabric/agents.meta.json` 是派生机器索引，不是规则真源。

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
  sections: Array<
    | "MISSION_STATEMENT"
    | "MANDATORY_INJECTION"
    | "BUSINESS_LOGIC_CHUNKS"
    | "CONTEXT_INFO"
  >;
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
- 成功解析后追加 `rule_selection` event。

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

## Event Ledger

`fab_get_rule_sections` 写入 `.fabric/events.jsonl`。这是唯一 Fabric ledger：

```ts
type RuleSelectionAuditEntry = {
  kind: "fabric-event";
  event_type: "rule_selection";
  schema_version: 1;
  id: string;
  ts: number;
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

`fabric doctor` 检查 `.fabric/events.jsonl` 是否存在、可写、可解析。

`fabric doctor` also reports L2 `[BUSINESS_LOGIC_CHUNKS]` anchor health when rule nodes declare that section:

- `missing`: a chunk omits a valid `Anchor`.
- `stale`: a chunk anchor has no matching `@fabric-anchor <ID>` in source.
- `duplicate`: the same source `@fabric-anchor <ID>` appears more than once.

This is diagnostic-only. Fabric does not block commits for deleted anchors and does not dynamically prune business chunks.

## RuleTestIndex V1

V1 only implements static rule-test traceability. It records declared coverage and hash drift signals; it does not prove that a test passed or that the test semantically covers the rule.

Tests declare a rule link with a static comment:

```ts
// @fabric-verify <stable_id>
```

Example for an L2 script test:

```ts
// @fabric-verify assets/scripts/seer
describe("seer script contract", () => {
  it("preserves the inspected-player result shape", () => {
    // ordinary Jest assertions stay project-owned
  });
});
```

`fabric doctor --fix` scans test files for `@fabric-verify` comments and writes `.fabric/rule-test.index.json` as a generated sidecar. The sidecar is separate from `.fabric/agents.meta.json` so rule selection metadata stays focused on rule discovery and precedence.

V1 `RuleTestIndex` entries record static facts:

```ts
type RuleTestIndexEntry = {
  stable_id: string;
  rule_hash: string;
  test_path: string;
  test_hash: string;
  previous_rule_hash?: string;
  previous_test_hash?: string;
  line?: number;
};
```

When regenerating the sidecar, `fabric doctor --fix` preserves `previous_rule_hash` and `previous_test_hash` from the last index entry. This lets `fabric doctor` distinguish ordinary coverage from drift, for example a rule hash changing while the linked test hash stayed the same.

`fabric doctor` uses the sidecar for static contract checks only:

- `covered`: a rule has at least one declared `@fabric-verify` entry.
- `stale_rule`: the current rule hash differs from the indexed rule hash and the linked test did not move with it.
- `stale_test`: the indexed test hash no longer matches the current test file.
- `orphan`: an index entry references a stable_id that is not present in the current rule registry.
- `missing`: a rule that requires declared coverage has no current index entry.

Explicit V1 exclusions:

- No Jest runner or test execution.
- No pass/fail evidence.
- No `.fabric/rule-test.results.jsonl`.
- No separate acknowledgement flow outside `doctor --fix`.
- No AI audit or test quality analysis.
- No config hash.
- No semantic coverage proof.

## Target Command And State Surface

Public CLI commands:

```text
fabric install
fabric scan
fabric doctor
fabric uninstall
```

> v1.8 时代的 `fabric serve` 已在 v2.0.0-rc.37 quarantine 到 `packages/server-http-experimental/`（KB [[fabric-serve-quarantine-not-delete]]）。v2.0.0 起 client 通过 stdio MCP 直连 server，不再需要本地 HTTP 进程。

Doctor modes:

```text
fabric doctor --json
fabric doctor --strict
fabric doctor --fix
```

Target `.fabric/` state:

- `.fabric/AGENTS.md`
- `.fabric/INITIAL_TAXONOMY.md`
- `.fabric/forensic.json`
- `.fabric/init-context.json`
- `.fabric/rules/`
- `.fabric/agents.meta.json`
- `.fabric/rule-test.index.json`
- `.fabric/events.jsonl`

`.fabric/rules/` is the rule source of truth. `.fabric/events.jsonl` is the only ledger. `fabric doctor --fix` may rebuild deterministic derived state and append `rule_baseline_accepted` / `baseline_synced` typed events, but it must not repair missing rule sections, rule semantic conflicts, incomplete init-context confirmation, MCP client local config issues, or business-code-versus-rule mismatch.

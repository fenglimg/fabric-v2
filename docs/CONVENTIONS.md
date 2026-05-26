# Fabric 开发约定

本文是 Fabric-v2 的开发约定。它合并中文命名、品牌调性、文档边界和协作契约；不承载产品叙事。

## 文档边界

- `docs/` 只保留工程参考：上手、内部协议、源码地图、架构决策、开发约定、规则注册。
- 删除或归档叙事文档、发布故事、仪式化 smoke 文档。
- 新增核心引擎行为前，先更新 [SPEC_INTERNAL](./SPEC_INTERNAL.md) 的逻辑变更点，经维护者审核后再改 `packages/` 代码。
- 修改 `packages/` 后，必须说明 [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md) 中哪个节点需要同步更新。

## 命名

| 形式 | 用途 | 约束 |
| --- | --- | --- |
| `fabric` | CLI 主命令、包名语境、普通 shell 示例 | 小写 monospace。 |
| `fab` | CLI 永久别名、MCP tool 前缀 | 小写 monospace。 |
| `Fabric` | 产品/框架名 | 正文、标题、release note 使用 title case。 |
| `FABRIC_*` | 环境变量 | 仅用于 env var，不作为产品名。 |

## 中文表达

- 用户界面先说动作和状态，再补机制。
- 深入协议文档可保留字段名、协议名、文件名。
- 禁止把内部黑话放到主标题。
- 受保护 token 不翻译：`AGENTS.md`、`FABRIC.md`、`.fabric/rules/`、`.fabric/agents.meta.json`、`.fabric/events.jsonl`、`agent_meta`、`MUST`、`NEVER`。

推荐译名：

| 技术词 | 中文主叫法 |
| --- | --- |
| `Rule Topology` | 规则命中 |
| `Rules Tree` | 规则树 |
| `History Replay` | 历史回放 |
| `follow-up` / `handoff` | 后续初始化 |
| `evidence pack` | 初始化依据 |
| `semantic initialization` | 后续初始化 |
| `description stub` | 描述占位规则 |
| `revision` | 版本 |

禁用倾向：

- `模块 A / 模块 B / 模块 C / 模块 D`
- `认知取证`
- `历史账本`
- `仪式化写入`
- `Canonical init 心智模型`
- 未解释的 `semantic initialization`
- 未解释的 `evidence pack`

## 语气

- 精准：写明规则、状态、失败原因、下一步。
- 协作：区分 AI Agent、Fabric Ledger、Human Developer 的责任边界。
- 透明：保留可审计证据，例如 CLI 输出、typed Event Ledger entry、metadata revision、源码行号。
- 文档不写承诺式口号，不把愿景当实现。

## UI 与品牌资产

Dashboard 的视觉 token 以 `packages/dashboard/src/styles/tokens.css` 为准。文档不复制长色板，只引用真实来源。

约束：

- CLI 和协议字段用 monospace。
- 解释性 UI、表格和文档正文使用普通文本。
- 公开文档不把色彩、字体和 wordmark 当架构依据；只有 UI 实现和品牌资产维护时才引用。

## Stable ID

- 每个核心规则模块必须有唯一 Stable ID。
- 首选声明形式是文件开头 HTML comment：`<!-- fab:rule-id scope/name -->`。
- `fab doctor --fix` 负责把 Stable ID 从 `.fabric/rules/` 预编译进 `.fabric/agents.meta.json`。
- `identity_source` 必须标明 `declared` 或 `derived`。
- Stable ID 变更必须同步 [RULE_REGISTRY](./RULE_REGISTRY.md)。

## Rule-Test 静态可追踪

- V1 只维护静态声明覆盖：测试文件用 `// @fabric-verify <stable_id>` 声明自己覆盖某条规则。
- `fab doctor --fix` 负责扫描声明并生成 `.fabric/rule-test.index.json` sidecar，同时保留 previous rule/test hash。
- `fab doctor` 只做静态检查，报告 covered、stale_rule、stale_test、orphan、missing 等状态。
- `@fabric-verify` 不能替代 Jest 断言、代码评审或测试质量判断。
- 文档和交付说明不得把 V1 描述为运行 Jest、记录 pass/fail、AI audit、config hash 或语义覆盖证明。

L2 script test 的最小写法：

```ts
// @fabric-verify assets/scripts/seer
describe("seer script contract", () => {
  it("keeps the rule-visible behavior stable", () => {
    // normal project assertions
  });
});
```

## 协作契约

1. 先更图，后改码：核心引擎逻辑变化先写入 [SPEC_INTERNAL](./SPEC_INTERNAL.md)，维护者审核后再改源码。
2. Stable ID 绑定：规则、核心服务、协议文档节点必须能被稳定引用。
3. 自动化同步：改 `packages/` 后，必须在交付说明中点名 [CODEBASE_LANDSCAPE](./CODEBASE_LANDSCAPE.md) 对应节点。
4. 不直接编辑 `.fabric/agents.meta.json`：规则正文变更必须落在 `.fabric/rules/`，再通过 `fab doctor --fix` 接受派生 baseline。
5. Dashboard 默认观察优先：不要把 Dashboard 变成规则真源或任意写入口。

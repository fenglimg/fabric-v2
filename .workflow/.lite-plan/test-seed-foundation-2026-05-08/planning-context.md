# Planning Context — test-seed Foundation

## Source
- Analysis session: `ANL-2026-05-08-fabric-test-cases`
- Grill-me: 11 decisions locked
- Implementation scope: Rec #7 + Rec #1（含三份 seed AI 起草）
- Out of scope (this iteration): Rec #2/2a (dashboard), Rec #3 (fast-check), Rec #4 (--help drift), Rec #5 (cycle), Rec #6 (vitest projects)

## 11 Locked Decisions (设计共识)
| # | 主题 | 决策 |
|---|---|---|
| Q1 | 消费者 | integration-test-cycle |
| Q2 | 受众 | 双受众（cycle + 维护者） |
| Q3 | 注入方式 | prompt 引用种子路径 |
| Q4 | source of truth | 代码（含测试 + zod schema） |
| Q5 | 修改触发 | intent 变更 + 重大事件后追加 §3 |
| Q6 | 跑法 | 按包独立跑（3 个 session） |
| Q7 | 完成判定 | coverage + invariants 双门 |
| Q8 | 冲突处理 | cycle 标记 ⚠️ → 人工裁定 |
| Q9 | 初版起草 | AI 起草 + 人 review |
| Q10 | CI 强度 | release gate（非每 PR） |
| Q11 | 测试落地 | `__tests__/integration/`（独立子目录） |

## Evidence Paths
- README.md (root) — 4 命令 / MCP tools / doctor 模式
- CHANGELOG.md — 1.8.0 ~30 项原子特性
- docs/CODEBASE_LANDSCAPE.md — 文件级责任表
- docs/SPEC_INTERNAL.md — 协议 spec
- docs/ARCHITECTURE_DECISIONS.md — ADR 不变量
- docs/initialization.md — init state machine
- docs/RULE_REGISTRY.md — stable-id 契约
- packages/cli/src/commands/index.ts — 4 命令注册
- packages/server/src/index.ts — server exports
- packages/server/src/api/* — 12 endpoints
- packages/server/src/services/* — 14 services
- packages/server/src/tools/* — 2 MCP tools
- packages/shared/src/schemas/* — 11 zod 数据契约
- packages/shared/src/errors/* — FabricError 5 子树
- packages/shared/package.json — exports 子路径
- 最近 git: TASK-038（doctor i18n）、TASK-039（init_context_missing）— Known-Tricky 候选

## Synthesized Understanding
落地动作分两层：
1. **架构层**（README + 模块口径）—— 决定后续所有种子的形式约束
2. **内容层**（3 份种子）—— 抽取自 evidence paths，三段式（feature surface / invariants / known-tricky）

约束：
- 单文件 ≤200 行
- §1 来源 = 代码（机器可抽取）；§2 = 行为契约 5–10 条；§3 = 3–5 条边界
- 不写 Gherkin / 不枚举每个测试用例 / 不描述实现细节

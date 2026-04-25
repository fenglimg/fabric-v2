# Analysis Discussion

**Session ID**: ANL-2026-04-25-l2规则使命宣言业务伤疤融入评判
**Topic**: 评判 L2 规则 [MISSION_STATEMENT] 与 [BUSINESS_LOGIC_CHUNKS] 应如何融入 Fabric-v2
**Started**: 2026-04-25T23:40:00+08:00
**Dimensions**: architecture, implementation, decision
**Depth**: standard

## Table of Contents

- [Current Understanding](#current-understanding)
- [Analysis Context](#analysis-context)
- [Discussion Timeline](#discussion-timeline)
- [Intent Coverage Matrix](#intent-coverage-matrix)
- [Findings Coverage Matrix](#findings-coverage-matrix)
- [Synthesis & Conclusions](#synthesis--conclusions)
- [Decision Trail](#decision-trail)

## Current Understanding

### What We Established

- `[MISSION_STATEMENT]` 应作为 L2 rule Markdown 的新结构化 section 接入，由现有 L2 path-required 机制保证“脚本意图涉及即强制触发”。
- `[BUSINESS_LOGIC_CHUNKS]` 应作为 L2 rule section 注入给 Agent，但它本质上还要求一个代码锚点治理层：扫描 `@fabric-anchor`、提交时发现锚点删除、doctor 诊断 stale chunk、必要时归档。
- 两者不应该塞进 `RuleDescription`。`RuleDescription` 是 plan 阶段的中性索引，应该轻量、不可泄露全文；使命和业务伤疤属于 fetch 阶段的规则正文。

### What Was Clarified

- ~~把业务伤疤只写进 L2 Markdown 就够了~~ -> 只能完成“读到”，不能完成“代码移动后仍定位、删除锚点触发警告、旧 chunk 归档”。
- ~~动态剪枝可以直接自动删除旧 chunk~~ -> 初期应做 diagnostics + archive，避免 Fabric 丢失历史事故知识。

### Key Insights

- 这个需求不是新增一棵规则树，而是扩展当前 `fab_plan_context -> fab_get_rule_sections -> pre-commit/doctor` 的闭环。
- `[MISSION_STATEMENT]` 是身份握手；`[BUSINESS_LOGIC_CHUNKS]` 是反优化护栏。前者偏阅读顺序，后者偏生命周期治理。

## Analysis Context

- Focus areas: L2 section protocol, path-triggered injection, anchor-bound business memory, commit-time governance
- Perspectives: Technical + Architectural
- Existing related sessions: `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案`, `.workflow/active/WFS-fabric-v2-cognitive-alignment-tdd`

## Discussion Timeline

### Round 1 - Exploration (2026-04-25T23:40:00+08:00)

#### User Input

用户提出两个 L2 规则区块：

- `[MISSION_STATEMENT]`: 脚本的主权宣言，路径强制触发，包含核心主权、物理边界、长期契约、工程价值。
- `[BUSINESS_LOGIC_CHUNKS]`: 业务直觉补丁，只记录反直觉 hack、线上事故妥协、业务禁忌，并通过 `// @fabric-anchor BL-...` 与代码强绑定。

#### Decision Log

> **Decision**: 将需求拆成“section 注入协议”和“锚点治理机制”两层。
> - **Context**: 现有实现已有 L2 path-required 和 section fetch，但没有代码锚点生命周期检查。
> - **Options considered**: 仅扩展 Markdown section；扩展 agents.meta schema；扩展 section 并新增 anchor-lint/doctor。
> - **Chosen**: section 承载内容，anchor-lint/doctor 承载治理。
> - **Rejected**: 仅扩展 section 无法在提交时发现锚点删除；塞入 agents.meta 会让 registry 变成业务正文仓库。
> - **Impact**: 实施应分两阶段：先让 Agent 读到，再让系统管住锚点。

#### Key Findings

> **Finding**: 当前 `fab_plan_context` 已经具备路径命中 L2 必读能力。
> - **Confidence**: High — **Why**: `PlanContextResult.selection_policy.required_levels` 固定为 `["L0", "L2"]`，`buildDescriptionIndex` 中 L0/L2 `required: true`。
> - **Hypothesis Impact**: Confirms hypothesis "MISSION_STATEMENT can ride current L2 trigger."
> - **Scope**: `packages/server/src/services/plan-context.ts`

> **Finding**: 当前 `fab_get_rule_sections` 只支持 `MANDATORY_INJECTION` 与 `CONTEXT_INFO`。
> - **Confidence**: High — **Why**: `RULE_SECTION_NAMES` 是字面量白名单。
> - **Hypothesis Impact**: Modifies hypothesis "new blocks can be added only in docs" -> code and tests must change.
> - **Scope**: `packages/server/src/services/rule-sections.ts`

> **Finding**: pre-commit 没有业务锚点保护。
> - **Confidence**: High — **Why**: pre-commit 只运行 sync-meta、human-lint、ledger-append。
> - **Hypothesis Impact**: Confirms hypothesis "BUSINESS_LOGIC_CHUNKS needs additional governance."
> - **Scope**: `packages/cli/src/commands/pre-commit.ts`

#### Technical Solutions

> **Solution**: Add `MISSION_STATEMENT` and `BUSINESS_LOGIC_CHUNKS` to structured rule sections.
> - **Status**: Proposed
> - **Problem**: Agent can only request existing sections today.
> - **Rationale**: Reuses existing parser, selection token, L2 required IDs, and audit telemetry.
> - **Alternatives**: Put into `RuleDescription`; rejected because plan-context should stay neutral and lightweight.
> - **Evidence**: `packages/server/src/services/rule-sections.ts:11`, `packages/server/src/services/plan-context.ts:37`
> - **Next Action**: Implement section enum/test/tool schema updates.

> **Solution**: Add Fabric anchor diagnostics for business chunks.
> - **Status**: Proposed
> - **Problem**: Markdown scars can drift from code when anchors are deleted or moved.
> - **Rationale**: Commit-time warning and doctor diagnostics match existing governance surfaces.
> - **Alternatives**: Rely on Agent instruction to preserve comments; rejected because the requirement explicitly asks for commit warning.
> - **Evidence**: `packages/cli/src/commands/pre-commit.ts:98`, `packages/server/src/services/doctor.ts`
> - **Next Action**: Define anchor parser/index and integrate with pre-commit/doctor.

#### Analysis Results

- `MISSION_STATEMENT` should be fetched before `MANDATORY_INJECTION` when a caller asks for all edit-critical sections. It is not a hard rule by itself; it frames script identity before hard constraints are read.
- `BUSINESS_LOGIC_CHUNKS` should be normalized around `ID`, `Anchor`, `Intent`, `Scars`, and `Constraint`. The non-triviality rule should be linted: chunks without `Scars` or `Constraint` should warn.
- `@fabric-anchor` belongs in source code as a stable locator. The rule chunk owns the meaning; the code comment owns the coordinate.
- The first implementation should not attempt true semantic merging. Same `ID` should mean replace/upsert. Semantic duplicate detection can be a later AI-assisted doctor suggestion.

#### Open Items

- Decide exact anchor comment forms for non-TypeScript languages.
- Decide whether deleted anchors should fail commit or warn only. User wording says “触发警告”, so the initial mode should be warning with optional strict config.
- Decide where archived chunks live. Recommended default: `.fabric/archive/business-logic-chunks.jsonl`.

#### Narrative Synthesis

**起点**: 从用户给出的两个 L2 区块定义切入，先判断现有规则分发链路是否已经能承载路径强制触发。
**关键进展**: 代码确认 L2 required 已存在，section fetch 已存在，但锚点治理缺失。
**决策影响**: 分析方向从“新增区块”收敛为“扩展 rule section + 新增 anchor lifecycle”。
**当前理解**: `[MISSION_STATEMENT]` 是轻量 section 扩展；`[BUSINESS_LOGIC_CHUNKS]` 是 section + governance。
**遗留问题**: 严格提交失败还是警告、归档路径、跨语言注释格式。

## Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|---|
| 1 | L2 `[MISSION_STATEMENT]` 作为脚本第一层筛选与身份确认 | Addressed | Round 1, Conclusion #1 | 通过 L2 required + section fetch 实现 |
| 2 | 路径强制触发，涉及脚本即返回区块 | Addressed | Round 1, Conclusion #1 | 复用 `fab_plan_context` required L2 |
| 3 | 内容包括核心主权、物理边界、长期契约、工程价值 | Addressed | Recommendation #1 | 作为 Markdown section 模板规范 |
| 4 | L2 `[BUSINESS_LOGIC_CHUNKS]` 只存反直觉业务记忆 | Addressed | Recommendation #2 | 需要 lint 非平凡性 |
| 5 | Chunk 包含 Intent/Scars/Constraint | Addressed | Recommendation #2 | 建议结构化 grammar |
| 6 | 语义合并 + 动态剪枝 | Transformed | Recommendation #4 | 初期用 ID upsert + stale diagnostics/archive；语义合并后置 |
| 7 | `@fabric-anchor` 与 chunk 强绑定，删除注释提交警告 | Addressed | Recommendation #3 | 需要 anchor-lint/pre-commit/doctor |

## Findings Coverage Matrix

| # | Finding | Disposition | Target |
|---|---|---|---|
| 1 | L2 required path trigger already exists | recommendation | Rec #1 |
| 2 | Section whitelist currently lacks the new names | recommendation | Rec #1, Rec #2 |
| 3 | Business chunks require anchor lifecycle checks | recommendation | Rec #3 |
| 4 | Dynamic pruning should not silently delete scars | recommendation | Rec #4 |
| 5 | Tooling manifest is precedent but not target registry | informational | Keep as design reference |

## Synthesis & Conclusions

### Key Conclusions

1. `[MISSION_STATEMENT]` 应融入为 L2 规则正文的第一 section，而不是新 registry 字段。路径强制触发已经由 L2 required 稳定提供。
2. `[BUSINESS_LOGIC_CHUNKS]` 应融入为 L2 section，但不能止步于注入；必须有 `@fabric-anchor` 扫描、stale 诊断和提交警告。
3. 初期治理应保守：ID-based upsert、重复/缺失 anchor 诊断、stale chunk 归档建议。不要自动从规则文件删除历史 chunk。
4. 这两个区块不应污染 `RuleDescription`。`RuleDescription` 仍只承担 plan 阶段“要不要读规则”的轻量说明。

### Recommendations

1. **扩展 rule section 协议** [high]
   - Add `MISSION_STATEMENT` and `BUSINESS_LOGIC_CHUNKS` to `RULE_SECTION_NAMES`.
   - Update service/tool/shared API tests.
   - Document recommended fetch order: `MISSION_STATEMENT` -> `MANDATORY_INJECTION` -> `BUSINESS_LOGIC_CHUNKS` -> `CONTEXT_INFO`.

2. **定义 L2 Markdown 模板** [high]
   - `MISSION_STATEMENT` fields: Sovereignty, Physical Boundary, Long-term Contract, Engineering Value.
   - `BUSINESS_LOGIC_CHUNKS` fields: ID, Anchor, Intent, Scars, Constraint.
   - Reject or warn on trivial chunks lacking scars/constraints.

3. **新增 anchor governance** [high]
   - Parse `@fabric-anchor <ID>` from staged source files.
   - Validate each business chunk anchor resolves to exactly one code location.
   - Integrate warning into pre-commit; expose full diagnostics in doctor.

4. **把动态剪枝降级为可审计归档流程** [medium]
   - Same ID replaces old chunk.
   - Missing anchor marks chunk stale.
   - `doctor --fix` may archive stale chunks to `.fabric/archive/business-logic-chunks.jsonl` after explicit action.

5. **补初始化和文档样例** [medium]
   - `INITIAL_TAXONOMY.md`/docs should explain when L2 needs mission and business chunks.
   - Cocos example can include the delayed `asset.decRef()` case as a canonical fixture.

## Decision Trail

> **Decision**: Treat `MISSION_STATEMENT` as section content, not metadata.
> - **Context**: It is read after a concrete script/path is known.
> - **Chosen**: L2 Markdown section.
> - **Rejected**: `RuleDescription` field, because plan-context should stay neutral and lightweight.
> - **Impact**: Minimal schema disruption; mostly service/tool/doc/test updates.

> **Decision**: Treat `BUSINESS_LOGIC_CHUNKS` as section plus governance.
> - **Context**: User requires code anchor binding and commit warning.
> - **Chosen**: Section parser + anchor-lint/doctor/pre-commit integration.
> - **Rejected**: Pure prompt instruction, because it cannot enforce anchor preservation.
> - **Impact**: Requires a new validation surface beyond `fab_get_rule_sections`.

> **Decision**: Defer true semantic merge.
> - **Context**: Semantic merge and dynamic pruning are risky if implemented as automatic deletion.
> - **Chosen**: ID upsert and stale archive diagnostics first.
> - **Rejected**: Silent pruning from Markdown.
> - **Impact**: Safer first milestone with clear path to richer AI-assisted cleanup later.

## Session Statistics

- Rounds: 1
- Key findings: 5
- Recommendations: 5
- Source files modified: none
- Artifacts generated: `discussion.md`, `exploration-codebase.json`, `conclusions.json`

## Implementation Scope Update

2026-04-25 后续用户确认了范围收敛：

- 保留 `[MISSION_STATEMENT]`，作为 L2 section 接入。
- 保留 `[BUSINESS_LOGIC_CHUNKS]`，作为 L2 section 接入。
- 不实现提交时删除 anchor 的 pre-commit 警告。
- 不实现动态剪枝或自动归档。
- 仅在 `fabric doctor` 中报告 business chunk anchor 的 `missing`、`stale`、`duplicate` 诊断。

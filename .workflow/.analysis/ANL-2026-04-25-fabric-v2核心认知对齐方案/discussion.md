# Analysis Discussion

**Session ID**: ANL-2026-04-25-fabric-v2核心认知对齐方案
**Topic**: Fabric-v2 核心认知对齐方案架构分析与实施准备
**Started**: 2026-04-25T00:00:00+08:00
**Dimensions**: architecture, implementation, decision
**Depth**: standard

## Current Understanding

### What We Established
- 用户提出的 L0/L1/L2 重新定义是正确方向：L0 应是全局协作宪法，L1 应是领域/模块规则，L2 应是脚本或资源级局部规则。
- 当前源码仍以 `.fabric/agents/**/*.md` 作为规则正文来源，并由 `fabric sync-meta` 编译到 `.fabric/agents.meta.json`。
- 当前 `agents.meta.json` 已经承担索引职责，但 Description 仍是 `activation.description` 字符串，缺少结构化画像匹配字段。
- 当前 `fab_plan_context` 已支持 description stub 的两阶段雏形，但还没有 Requirement Profile，也没有 L1 description 打分选择。
- 当前规则正文是整篇 MD 注入，尚未支持 `[MANDATORY_INJECTION]` 等分区读取。
- 冲突优先级目前主要由 `priority` 与 node id 排序决定，尚未明确编码为 L2 > L1 > L0。

### What Was Clarified
- ~~完全丢弃所有规则 MD 文件~~ -> 更稳妥的目标是丢弃影子物理目录拓扑，把 `agents.meta.json` 作为唯一路由索引；规则正文仍可保存在 `.fabric/rules/*.md` 或等价 content store 中。
- ~~L1 由路径深度自动推断~~ -> L1 应由领域分类和描述画像决定，路径只是证据之一。

### Key Insights
- “Registry-first + Content-addressed rules” 比 “Meta-only stores everything” 更接近可维护上限：meta 负责索引、匹配、版本和 description；MD 负责人类可维护规则正文。
- 用户的两阶段发现协议应落成三个 API 层次：preflight descriptions、profile-ranked selection、mandatory block fetch。

## Analysis Context
- Focus areas: registry model, init contract, L1 discovery, structured injection, conflict priority
- Perspectives: architectural and technical
- Depth: standard

## Initial Decisions

> **Decision**: 将分析范围限定为核心 rule routing / init / MCP delivery，不展开 Dashboard UI 设计。
> - **Context**: 用户要求评估 Fabric-v2 核心认知对齐方案并准备实施。
> - **Options considered**: 全产品分析；核心协议分析；直接实现。
> - **Chosen**: 核心协议分析。**Reason**: 方案影响最大的是 `init`、`agents.meta.json`、`fab_plan_context`、`fab_get_rules`、`sync-meta`。
> - **Rejected**: 全产品分析会稀释关键架构判断；直接实现会在 schema 未定前扩大返工。
> - **Impact**: 输出聚焦于可执行的协议与代码边界。

---

## Discussion Timeline

### Round 1 - Exploration

#### User Input
用户给出一套明确的 Fabric-v2 核心认知对齐方案，包括 L0/L1/L2 分层哲学、初始化契约、元数据索引、两阶段发现协议、结构化 MD 注入和 L2 > L1 > L0 冲突协议。

#### Decision Log

> **Decision**: 接受用户方案的主轴，但将“丢弃影子物理目录”解释为“丢弃路径镜像拓扑”，不是“把规则正文塞进 JSON”。
> - **Context**: 当前实现用 `.fabric/agents/**/*.md` 扫描生成 meta，用户希望统一在 `agents.meta.json` 中建立映射。
> - **Options considered**: A. meta-only 存储全部规则正文；B. registry-first，规则正文仍外置；C. 保留现状。
> - **Chosen**: B。**Reason**: 既满足 meta 统一索引，也保留 Markdown 的可读、可审查、可 diff 特性。
> - **Rejected**: A 会让 JSON 变成人类难维护的规则正文数据库；C 无法解决 L1 语义匹配问题。
> - **Impact**: 实施时新增 schema 字段与 content pointer，而不是删除规则正文文件能力。

> **Decision**: Requirement Profile 应由 server/service 生成，而不是要求 AI client 自行临时拼接。
> - **Context**: 用户提出 Target Path、Known Tech、User Intent、Detected Entities 画像。
> - **Options considered**: client-side profile；server-side profile；混合。
> - **Chosen**: server-side profile with optional client hints。**Reason**: server 具备稳定 schema、测试和可视化能力；client hints 可补充用户意图。
> - **Rejected**: 纯 client-side 不可测试且不同 AI client 行为漂移。
> - **Impact**: `fab_plan_context` 应扩展 input/output，而不是只改提示词。

#### Key Findings

> **Finding**: 当前 `agentsMetaNodeSchema` 只有 `activation.description?: string`，没有 `intent_clues`、`tech_stack`、`must_read_if` 等结构化字段。
> - **Confidence**: High — Evidence: `packages/shared/src/schemas/agents-meta.ts:23`
> - **Hypothesis Impact**: Confirms hypothesis "Description 需要 Schema 化"
> - **Scope**: shared schema、server matching、dashboard display、tests

> **Finding**: 当前 L0 内容固定从 `.fabric/bootstrap/README.md` 读取，L1/L2 从 meta 命中的 `node.file` 读取。
> - **Confidence**: High — Evidence: `packages/server/src/services/get-rules.ts:105`
> - **Hypothesis Impact**: Modifies hypothesis "meta 可作为唯一索引"
> - **Scope**: get-rules hot path、init scaffold、sync-meta migration

> **Finding**: 当前 `sync-meta` 扫描 `.fabric/agents/**/*.md`，并通过路径深度派生 layer、scope 和 node id。
> - **Confidence**: High — Evidence: `packages/cli/src/commands/sync-meta.ts:74`
> - **Hypothesis Impact**: Confirms hypothesis "影子物理目录仍是现状核心依赖"
> - **Scope**: CLI sync-meta、fixture tests、docs

> **Finding**: 当前 `fab_plan_context` 已有 description stub union 和 stub-only diagnostics，但只返回字符串 description，不做画像匹配。
> - **Confidence**: High — Evidence: `packages/server/src/services/plan-context.ts:102`
> - **Hypothesis Impact**: Confirms hypothesis "两阶段协议已有雏形但不足"
> - **Scope**: MCP output contract、dashboard rules context、tests

> **Finding**: 当前 init 只生成 L0 meta 和 bootstrap/forensic/human-lock，不生成 `INITIAL_TAXONOMY.md`。
> - **Confidence**: High — Evidence: `packages/cli/src/commands/init.ts:480`
> - **Hypothesis Impact**: Confirms hypothesis "初始化契约缺失"
> - **Scope**: init plan/result types、execution plan、tests、docs

#### Technical Solutions

> **Solution**: Introduce `RuleDescriptionSchema` and `RequirementProfileSchema` in shared, extend `fab_plan_context` with profile-ranked description candidates.
> - **Status**: Proposed
> - **Problem**: L1 现在只能全部命中或靠字符串描述，无法做到高命中率预判。
> - **Rationale**: 画像和 description 同为结构化数据后，匹配可以测试、解释和可视化。
> - **Alternatives**: 继续用 prompt 语义判断；引入向量数据库。前者不可控，后者过重。
> - **Evidence**: `packages/shared/src/schemas/agents-meta.ts:33`, `packages/server/src/services/plan-context.ts:153`
> - **Next Action**: 实施 shared schema 与 plan-context ranking。

> **Solution**: Replace shadow-mirroring derivation with explicit registry nodes while keeping rule MD content as referenced artifacts.
> - **Status**: Proposed
> - **Problem**: 路径深度派生 L1/L2 与用户定义的 Domain/Module 分层冲突。
> - **Rationale**: `agents.meta.json` 成为路由真源，MD 文件只作为 content source。
> - **Alternatives**: meta-only JSON content；保留 `.fabric/agents` 镜像目录。前者难维护，后者认知模型错误。
> - **Evidence**: `packages/cli/src/commands/sync-meta.ts:139`, `packages/shared/src/schemas/agents-meta.ts:88`
> - **Next Action**: 新增 registry-first migration path，保留 legacy sync 兼容。

#### Analysis Results
- 方案总体可行，且比现状更符合 Fabric 的核心价值：减少 AI 上下文漂移，让规则在正确时机、正确粒度注入。
- 需要修正的最大点是“丢弃影子物理目录”的表述。完美方案不是把正文塞进 `agents.meta.json`，而是让 `agents.meta.json` 成为唯一权威索引，规则正文通过 `content_ref` 指向非镜像化 MD。
- L0 的“三层分治宪法”应该由 `fabric init` 生成，并写入 `.fabric/bootstrap/README.md`；`INITIAL_TAXONOMY.md` 是初始化认知留痕，应从 forensic evidence 与用户确认结果生成。
- L1 description schema 必须是第一等公民，不应藏在 `activation.description` 字符串里。
- `[MANDATORY_INJECTION]` 的正确抽象是 rule sections，不是简单字符串截取；MCP 应提供按 stable_id 批量获取 section 的接口。
- 冲突协议应在 payload 中显式输出 effective order：L0 baseline -> L1 domain -> L2 local，执行层覆盖优先级为 L2 > L1 > L0。

#### Open Items
- 是否保留 `.fabric/agents/` 作为 legacy import path，建议保留一到两个版本周期。
- 是否新建 `fab_get_rule_sections`，或扩展 `fab_get_rules` 增加 `sections` 参数。建议新建批量接口，避免破坏当前 tool contract。
- 是否为 requirement profile 引入代码实体扫描。建议先用路径、扩展名、forensic framework、用户意图和 import/entity regex，后续再加 AST。

#### Narrative Synthesis
**起点**: 用户已经给出完整方向，本轮验证它与当前实现的差异。
**关键进展**: 确认当前实现已有 description stub 雏形，但核心仍受影子目录与路径深度派生约束。
**决策影响**: 分析方向从“是否可行”推进到“如何最小代价落地且保留迁移兼容”。
**当前理解**: 最优架构是 registry-first、profile-ranked、section-injected、priority-explicit。
**遗留问题**: 实施时需要明确 schema 命名、迁移策略和 API 兼容边界。

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|
| 1 | L0/L1/L2 分层哲学 | Addressed | Round 1, Conclusion #1 | 接受并建议编码为 schema/enforcement |
| 2 | init 下发三层分治宪法并生成 INITIAL_TAXONOMY.md | Addressed | Round 1, Recommendation #1 | 当前缺失，应实施 |
| 3 | 丢弃影子物理目录，统一 agents.meta.json 映射 | Transformed | Round 1, Recommendation #2 | 转为 registry-first + content_ref |
| 4 | Description Schema 化 | Addressed | Round 1, Recommendation #3 | 应进入 shared schema |
| 5 | 两阶段发现协议和 Requirement Profile | Addressed | Round 1, Recommendation #4 | 应扩展 plan-context |
| 6 | 结构化 MD 注入 | Addressed | Round 1, Recommendation #5 | 建议独立 rule sections API |
| 7 | L2 > L1 > L0 冲突协议 | Addressed | Round 1, Recommendation #6 | 当前需要显式编码 |

### Findings Coverage Matrix

| # | Finding | Disposition | Target |
|---|---|---|---|
| 1 | Description 目前非结构化 | recommendation | Rec #3 |
| 2 | L0/L1/L2 读取模型仍依赖外置 MD | absorbed | Rec #2, Rec #5 |
| 3 | sync-meta 仍扫描影子目录 | recommendation | Rec #2 |
| 4 | plan-context 已有 stub 但无画像匹配 | recommendation | Rec #4 |
| 5 | init 不生成 taxonomy | recommendation | Rec #1 |

## Synthesis & Conclusions

### Executive Summary
用户方案的方向正确，但要避免走向“JSON 存全部规则正文”的极端。推荐的更优方案是：`agents.meta.json` 成为唯一权威索引；规则正文保留为可读 MD，通过 `content_ref` 指向；Description 与 Requirement Profile 都 Schema 化；`fab_plan_context` 负责预发现与排序；编辑前再通过批量 section API 拉取 `[MANDATORY_INJECTION]`。

### Key Conclusions
1. L1 不能再由路径深度派生，必须由 domain/module taxonomy 与 description schema 决定。
2. 初始化必须留下 taxonomy rationale，否则后续 AI 无法判断为什么某条规则属于 UI、Gameplay、Asset 或 Optimization。
3. `fab_plan_context` 应从“批量拿规则”升级为“批量预判规则候选”，`fab_get_rules` 或新接口再负责编辑前强制注入。
4. 冲突协议应成为 payload contract，而不是提示词约定。

### Recommendations
1. **Implement init taxonomy contract** [high]
   - Add `.fabric/INITIAL_TAXONOMY.md` to init scaffold.
   - Update bootstrap guide with the three-tier constitution.
   - Use forensic evidence to prefill L1 bucket rationale.

2. **Move to registry-first rule topology** [high]
   - Extend `AgentsMetaNode` with explicit `level`, `domain`, `content_ref`, and structured `description`.
   - Stop deriving L1/L2 from `.fabric/agents/` depth for new nodes.
   - Keep legacy `.fabric/agents/**/*.md` importer for migration.

3. **Schema-ize Description** [high]
   - Replace `activation.description?: string` with structured fields: `summary`, `intent_clues`, `tech_stack`, `impact`, `must_read_if`, `entities`, `confidence`.
   - Preserve backward compatibility by wrapping legacy strings into `summary`.

4. **Add Requirement Profile matching to `fab_plan_context`** [high]
   - Accept optional `intent`, `detected_entities`, `known_tech`.
   - Generate server-side profile per path.
   - Return ranked L1/L2 candidates with match reasons and scores.

5. **Add structured MD section extraction** [medium]
   - Parse sections such as `[MANDATORY_INJECTION]`, `[CONTEXT_INFO]`, `[EXAMPLES]`.
   - Add a batch API to fetch selected sections by stable_id.
   - Keep full-content fetch available for debugging and migration.

6. **Encode conflict precedence explicitly** [medium]
   - Return effective ordering and conflict notes in rules payload.
   - Ensure L2 overrides L1 overrides L0 at execution guidance level.
   - Add tests proving deterministic order.

## Decision Trail
- Chose registry-first rather than meta-only content storage.
- Chose server-side Requirement Profile generation with optional client hints.
- Chose a new section-oriented rule delivery layer rather than forcing full MD injection.

## Plan Checklist

> This is a plan only. No source code was modified in this analysis session.

### 1. Init taxonomy contract
- Target files: `packages/cli/src/commands/init.ts`, `packages/cli/src/bootstrap-guide.ts`, `docs/initialization.md`, init tests.
- Done when: `fabric init` writes `.fabric/INITIAL_TAXONOMY.md`; tests assert content and plan result.

### 2. Registry-first schema
- Target files: `packages/shared/src/types/agents.ts`, `packages/shared/src/schemas/agents-meta.ts`, `packages/cli/src/commands/sync-meta.ts`, server services.
- Done when: new nodes can be created without `.fabric/agents/` path-derived semantics; legacy fixtures still pass.

### 3. Description and Requirement Profile matching
- Target files: shared schemas, `packages/server/src/services/plan-context.ts`, tool schemas, tests.
- Done when: `fab_plan_context` returns ranked candidates and match reasons.

### 4. Rule section injection
- Target files: server rule parser/service/tool, shared API contracts, tests.
- Done when: selected `[MANDATORY_INJECTION]` blocks can be fetched in batch by stable_id.

### 5. Conflict precedence
- Target files: `packages/server/src/services/get-rules.ts`, `packages/server/src/services/plan-context.ts`, docs/tests.
- Done when: payload explicitly documents L2 > L1 > L0 and tests cover conflict ordering.

## Session Statistics
- Rounds completed: 1
- Key findings: 5
- Recommendations: 6
- Source code modified: no

---

### Round 2 - TDD Refactor Preflight Concerns (2026-04-25)

#### User Input
用户要求延续本会话，并在按照 TDD 重构前，先说出所有顾虑和未对齐的地方。用户明确表达当前项目已经偏离预期、失去掌控，因此本轮目标不是继续实现，而是阻止未经对齐的重构扩大偏差。

#### Decision Log

> **Decision**: 暂停直接实现，将下一步定义为 TDD 前置对齐与红灯测试设计。
> - **Context**: 用户希望最终按 TDD 重构，但要求先说清顾虑和未对齐点。
> - **Options considered**: 直接按上一轮 recommendations 开始实现；先给口头顾虑；记录成可追踪分析产物并提出测试切分。
> - **Chosen**: 记录成 `tdd-preflight-concerns.md`，并把主讨论推进到第二轮。**Reason**: 当前偏移风险来自对象边界不清，必须先把协议、schema、API 时机和测试边界钉住。
> - **Rejected**: 直接实现会把未拍板的问题编码成事实；只给口头顾虑无法进入后续 TDD 计划。
> - **Impact**: 后续执行应先做 Phase A-F 的红灯测试，而不是一次性大改。

> **Decision**: 将“规则出现时机”提升为协议问题，而不是提示词问题。
> - **Context**: 用户定义规则出现在“查看具体脚本后，编辑前”。
> - **Options considered**: 仅更新工具描述；在 payload 中显式表达 discovery/pre-edit/mandatory delivery mode；依赖 client 自觉。
> - **Chosen**: 在后续设计中把 delivery mode 和 section fetch 时机显式化。**Reason**: 工具描述无法防止 AI client 漂移，TDD 也无法稳定断言。
> - **Rejected**: 只改提示词不可测试；依赖 client 自觉会让不同 AI 工具行为不一致。
> - **Impact**: `fab_plan_context` 应保持候选/预判语义，mandatory sections 应由独立批量接口或明确参数在编辑前获取。

#### Key Findings

> **Finding**: 当前 schema 仍允许 `layer` 从路径深度派生，这与 L1 = Domain/Module 的目标存在直接张力。
> - **Confidence**: High — **Why**: `withDerivedAgentsMetaNodeDefaults` 在缺失 layer 时调用 `deriveAgentsMetaLayer`；该函数按 `.fabric/agents/` 目录深度推导 L0/L1/L2。
> - **Hypothesis Impact**: Modifies hypothesis "只要新增 domain 字段即可"；必须处理 legacy path-derived semantics。
> - **Scope**: shared schema、sync-meta、legacy migration、tests。

> **Finding**: 当前 `PlanContextInput` 没有 requirement profile hints，无法承载用户提出的 Target Path / Known Tech / User Intent / Detected Entities。
> - **Confidence**: High — **Why**: `PlanContextInput` 只有 `paths` 和 `client_hash`。
> - **Hypothesis Impact**: Confirms hypothesis "fab_plan_context 需要从批量规则查询升级为 profile-ranked discovery"。
> - **Scope**: server service、MCP tool schema、dashboard/HTTP consumers、tests。

> **Finding**: 当前 description tier 是全局 candidate 行为，不受 `scope_glob` 限制。
> - **Confidence**: High — **Why**: `shouldLoadNodeForPath` 对 `activation.tier === "description"` 直接返回 true；现有测试也锁住了该行为。
> - **Hypothesis Impact**: Modifies hypothesis "L1 通常命中所有是 bug"；更准确地说，它可以作为 candidate pool，但不能作为 mandatory injection。
> - **Scope**: L1 降噪策略、ranking、section fetch、tool docs。

> **Finding**: 当前规则正文读取仍直接绑定 `node.file` 整篇读取，没有 content resolver 或 section parser。
> - **Confidence**: High — **Why**: `loadMatchedRules` 直接 `readRuleContent(projectRoot, matchedNode.node.file)`。
> - **Hypothesis Impact**: Confirms hypothesis "结构化 MD 需要单独 parser/API，不应混在 get-rules 里临时截取"。
> - **Scope**: get-rules service、new section API、rule content storage。

> **Finding**: 当前跨层冲突优先级没有协议化，只有同一匹配集合内的 priority 排序和 L1/L2 payload 分区。
> - **Confidence**: High — **Why**: `matchRuleNodes` 先按 priority 再按 node id 排序；payload 没有 precedence metadata。
> - **Hypothesis Impact**: Confirms hypothesis "L2 > L1 > L0 必须成为 payload contract"。
> - **Scope**: get-rules、plan-context、tool schema、docs/tests。

#### Technical Solutions

> **Solution**: 将后续实施拆为 Phase A-F 的 TDD 序列：characterization -> init taxonomy -> schema migration -> profile ranking -> section API -> conflict protocol。
> - **Status**: Proposed
> - **Problem**: 一次性重构会同时改变 init、schema、matching、delivery、docs，风险不可控。
> - **Rationale**: 每个 phase 都有明确红灯测试和兼容边界，可逐步恢复项目掌控。
> - **Alternatives**: 直接大改；只改 init；只改 plan-context。前者风险过高，后两者无法解决整体认知漂移。
> - **Evidence**: `tdd-preflight-concerns.md`。
> - **Next Action**: 先确认 8 个拍板问题，再进入 TDD planning。

#### Analysis Results
详细顾虑、未对齐点和 TDD 切分已写入：

- `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/tdd-preflight-concerns.md`

本轮最关键的判断：

1. 现在不应直接开改；应先把“规则出现时机”协议化。
2. L1 candidate pool 可以全局，但 mandatory injection 不能全局。
3. `priority` 应只保留同层排序，跨层固定 L2 > L1 > L0。
4. Requirement Profile 第一版应 deterministic，先不依赖 AST/tree-sitter。
5. `.fabric/INITIAL_TAXONOMY.md` 应先作为 init contract 的测试目标。
6. 需要确认新规则正文目录、Description id 与 stable_id、section API 形态等 8 个未拍板问题。

#### Open Items
- 新规则正文目录采用 `.fabric/rules/`，还是继续 `.fabric/agents/` 但改变语义？
- `Description.id` 是否取消，统一使用 node `stable_id`？
- L1 candidate pool 是否允许全局进入，并完全交给 profile ranking 降噪？
- Requirement Profile 第一版是否只做 deterministic hints，不做 AST？
- section API 是新建 `fab_get_rule_sections`，还是扩展 `fab_get_rules`？
- `.fabric/INITIAL_TAXONOMY.md` 是否需要 machine-readable sidecar？
- L0 是否继续保存在 `.fabric/bootstrap/README.md`，还是也进入统一 `content_ref`？
- `priority` 是否正式降级为同层排序，跨层永远固定 L2 > L1 > L0？

#### Intent Coverage Check
- ✅ L0/L1/L2 重新定义：已确认方向，但要求测试中处理 legacy path-derived layer。
- ✅ 初始化 taxonomy：已提升为 Phase B 的红灯测试目标。
- ✅ `agents.meta.json` 索引：已明确需要 registry-first + content resolver，不建议 JSON-only。
- ✅ Description Schema：已列出字段语义未拍板点。
- ✅ `fab_plan_context` Profile：已确认当前 input/output 不足。
- ✅ 结构化 MD：已确认需要 parser + batch API。
- ✅ L2 > L1 > L0：已确认必须成为 payload contract。
- ✅ TDD 重构顾虑：已独立形成 preflight concerns 文档。

#### Narrative Synthesis
**起点**: 上一轮已经形成可实施建议，但用户担心项目继续偏离，希望先暴露所有顾虑。
**关键进展**: 本轮把“方案可行”收敛成“必须先测试锁定的协议边界”，尤其是规则出现时机、legacy layer 派生、L1 全局候选、section injection 和冲突覆盖语义。
**决策影响**: 后续不应从代码实现开始，而应从 TDD 红灯测试和 8 个拍板问题开始。
**当前理解**: 核心方向正确，但尚未到可直接实现状态；下一步是把 Phase A-F 转成测试驱动的重构计划。
**遗留问题**: 需要用户确认 8 个设计选择，否则任何实现都会把未确认假设固化进系统。

## Session Statistics Update
- Rounds completed: 2
- New artifact: `tdd-preflight-concerns.md`
- Source code modified: no

---

### Round 3 - Decision Locks and Requirement Profile Design (2026-04-25)

#### User Input
用户逐项确认了 8 个拍板问题：

1. 新规则正文使用 `.fabric/rules/`，不用强行兼容 `.fabric/agents/`。
2. 保留以前的 `stable_id` 逻辑，不改成 `Description.id`。
3. L1 可以全局进入候选池，但必须 ranking 后选择。
4. Requirement Profile 需要先解释预期实现。
5. 新建 `fab_get_rule_sections`，原有 `fab_get_rules` 可以直接丢弃。
6. `.fabric/INITIAL_TAXONOMY.md` 先只做 Markdown。
7. L0 可以直接迁移进新模型。
8. `priority` 只管同层，跨层固定 `L2 > L1 > L0`。

#### Decision Log

> **Decision**: 将兼容性从本轮重构目标中移除。
> - **Context**: 用户确认当前产品无人使用，不需要强行兼容旧 `.fabric/agents/` 逻辑。
> - **Options considered**: 保留 legacy importer；软迁移；直接新模型。
> - **Chosen**: 直接新模型。**Reason**: 没有外部用户时，兼容层只会增加认知负担和测试面。
> - **Rejected**: legacy importer 会继续保留 path-depth 语义，削弱 L1 = Domain/Module 的新定义。
> - **Impact**: TDD plan 可以删除 legacy-preservation 任务，直接围绕 `.fabric/rules/`、explicit level、content_ref 和 sections 设计。

> **Decision**: 保留 node-level `stable_id` 作为唯一身份，不引入 `Description.id`。
> - **Context**: 用户明确不希望把以前 stable_id 逻辑改成 Description.id。
> - **Options considered**: Description 自带 id；node stable_id；两者并存。
> - **Chosen**: node stable_id。**Reason**: 身份属于规则节点，而 description 是匹配画像；两者并存会产生漂移。
> - **Rejected**: Description.id 会让同一规则出现两个身份源。
> - **Impact**: RuleDescription schema 不包含 id，plan-context candidates 使用 stable_id。

> **Decision**: 用 `fab_get_rule_sections` 替代 `fab_get_rules`，而不是兼容两套规则获取协议。
> - **Context**: 用户确认旧 `fab_get_rules` 可以不用。
> - **Options considered**: 扩展 fab_get_rules；新增并保留旧工具；新增并淘汰旧工具。
> - **Chosen**: 新增 `fab_get_rule_sections` 并淘汰旧工具。**Reason**: 新协议强调编辑前按 stable_id 批量获取结构化 section，旧工具整篇拉取模型会干扰新心智。
> - **Rejected**: 扩展旧工具会让 full-rule 与 section-injection 语义混杂。
> - **Impact**: TDD 应直接覆盖 section parser/tool，不需要维护 old get-rules output contract。

#### Technical Solutions

> **Solution**: Requirement Profile 采用 server-generated deterministic profile + transparent weighted ranking。
> - **Status**: Proposed
> - **Problem**: L1 全局候选池会产生噪声，必须用可测试的 profile/ranking 选择相关规则。
> - **Rationale**: 先使用 path、extension、intent、known_tech、detected_entities hints，不依赖 AST/tree-sitter，保证 TDD 可收敛。
> - **Alternatives**: LLM 语义判断；AST-first；向量检索。三者都更难解释和测试。
> - **Evidence**: `requirement-profile-design.md`。
> - **Next Action**: 将该设计转换为 TDD 红灯测试。

#### Analysis Results
新增两个锁定文档：

- `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/decision-locks.md`
- `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/requirement-profile-design.md`

Requirement Profile 预期实现摘要：

- `fab_plan_context` 接收 `paths`, `intent`, `known_tech`, `detected_entities`, `client_hash`。
- server 为每个 path 生成 deterministic `RequirementProfile`。
- profile 包含 target path、path segments、extension、inferred domain、known tech、intent tokens、impact hints、detected entities、confidence。
- RuleDescription 不含 id，身份使用 node `stable_id`。
- ranking 使用可解释权重：tech stack、intent clues、impact、entities、path domain。
- L1 允许全局进候选池，但只有 score 达标才 `selected: true`。
- `priority` 只作为同层 tie-breaker，不参与跨层优先级。
- full mandatory rule content 不由 `fab_plan_context` 返回，编辑前通过 `fab_get_rule_sections` 按 stable_id 批量获取。

#### Open Items
- 是否立即进入 TDD plan，把这些锁定决策转成 Phase A-F 的失败测试？
- 是否在 TDD plan 中先删除旧 `fab_get_rules`，还是先让新工具通过后再移除旧注册？

#### Narrative Synthesis
**起点**: Round 2 暴露了 8 个必须拍板的问题。  
**关键进展**: 用户已确认全部核心设计选择，并明确降低兼容性要求。  
**决策影响**: 后续重构可以更直接：`.fabric/rules/`、stable_id、profile ranking、new section tool、Markdown taxonomy、L0 迁移、同层 priority、跨层固定 precedence。  
**当前理解**: 现在已具备生成 TDD 重构计划的条件。  
**遗留问题**: 需要决定是否立即进入 TDD plan，以及旧 `fab_get_rules` 的删除时机。

## Session Statistics Update 2
- Rounds completed: 3
- New artifacts: `decision-locks.md`, `requirement-profile-design.md`
- Source code modified: no

---

### Round 4 - Selection Token Protocol (2026-04-25)

#### User Input
用户确认：`fab_plan_context` 可以返回 L0/L1/L2 的 description index，但 AI 在这一层只处理 L1。L0 和 L2 由系统自发现并自动加入最终 selected stable ids。需要确保获取规则时一定包括所有 selected stable ids。

#### Decision Log

> **Decision**: `fab_plan_context` 返回统一 L0/L1/L2 description index，但选择责任分层。
> - **Context**: 用户担心只返回 L1 index 会让最终 section fetch 漏掉 L0/L2。
> - **Options considered**: 只返回 L1；返回 L0/L1/L2 并让 AI 全部选择；返回统一 index 但只允许 AI 选择 L1。
> - **Chosen**: 返回统一 index，L0/L2 required，L1 AI-selectable。**Reason**: 这样 AI 能看到全局规则地图，但不会承担 L0/L2 选择责任。
> - **Rejected**: 只返回 L1 会降低可解释性；让 AI 选择全部层级会引入漏选和误选风险。
> - **Impact**: plan-context output 需要包含 `required_stable_ids`、`ai_selectable_stable_ids` 和 selection policy。

> **Decision**: 引入 `selection_token`，由 `fab_get_rule_sections` 服务端自动合并 required L0/L2 与 AI-selected L1。
> - **Context**: 需要确保最终获取规则时一定包含所有 required stable ids。
> - **Options considered**: 要求 AI 手动传全量 stable_ids；传 required_stable_ids 做校验；使用 selection_token 由 server 还原 required set。
> - **Chosen**: `selection_token + ai_selected_stable_ids`。**Reason**: server 可以根据 token 自动合并 required ids，并校验 AI 选择是否来自 L1 candidate pool。
> - **Rejected**: 手动传全量 ids 容易漏；仅校验 required_stable_ids 仍把合并责任放在 client。
> - **Impact**: `fab_get_rule_sections` 的输入应围绕 selection token 设计，而不是裸 stable_ids 列表。

#### Technical Solutions

> **Solution**: Selection Token Protocol。
> - **Status**: Validated
> - **Problem**: L0/L2 必须自动包含，L1 又需要 AI 语义选择，最终 section fetch 不能漏规则。
> - **Rationale**: selection token 把 required set 固定在 server 可验证状态中，AI 只提交 L1 selection。
> - **Alternatives**: AI 手动合并；plan_context 只返回 L1；sections tool 接受裸 stable_ids。
> - **Evidence**: `selection-token-protocol.md`。
> - **Next Action**: TDD plan 中加入 token lifecycle、required merge、invalid L1 selection diagnostics。

#### Analysis Results
新增协议文档：

- `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/selection-token-protocol.md`

最终协议摘要：

1. `fab_plan_context` 返回 L0/L1/L2 的 `description_index`。
2. L0/L2 自动进入 `required_stable_ids`。
3. L1 进入 `ai_selectable_stable_ids`。
4. `selection_token` 绑定本轮 required set 和 candidate pool。
5. AI 只提交 `ai_selected_stable_ids` 和选择理由。
6. `fab_get_rule_sections` 用 token 自动合并：
   - `final_stable_ids = required_stable_ids + ai_selected_stable_ids`
7. 如果 AI 选择了不在 candidate pool 中的 stable_id，server 返回 deterministic diagnostic。
8. 最终 section payload 仍按固定跨层优先级解释：`L2 > L1 > L0`。

#### Open Items
- `selection_token` 存储在内存 cache、stateless signed payload，还是可复算 hash？
- token 过期策略是否需要第一版实现，还是只在同一进程内短期缓存？
- `fab_get_rule_sections` 对非法 AI selection 是 hard error 还是 warning + ignore？

#### Narrative Synthesis
**起点**: Round 3 已锁定 L1 由 AI 选择，但还需要确保 L0/L2 不会漏进最终规则获取。  
**关键进展**: 本轮确认了统一 description index + selection token 协议，把 AI 的职责限制在 L1 语义选择。  
**决策影响**: `fab_plan_context` 不再只是 ranked candidates，而是负责生成 required/candidate selection state；`fab_get_rule_sections` 负责 server-side final stable id merge。  
**当前理解**: 这是目前最稳的 L1 AI 自查方案：保留 AI 语义判断力，同时用 server token 防漏、防越权、可审计。  
**遗留问题**: token 的实现形态和非法选择处理策略还需要在 TDD plan 中明确。

## Session Statistics Update 3
- Rounds completed: 4
- New artifact: `selection-token-protocol.md`
- Source code modified: no

---

### Round 5 - L1 Selection Reasons and Telemetry (2026-04-25)

#### User Input
用户指出：`fab_plan_context` 中具体 L1 的选择原因也需要加入，因为后续要打点记录并改善选择效果。

#### Decision Log

> **Decision**: L1 选择原因必须成为协议字段，而不是只写进自然语言日志。
> - **Context**: 用户希望后续能打点分析并改善 L1 选择效果。
> - **Options considered**: 不记录原因；只让 AI 在回答里说明；把 selection reasons 作为 tool input/output 的结构化字段。
> - **Chosen**: 结构化字段。**Reason**: 只有结构化原因才能被审计、统计和回放，用于改进 description、ranking threshold 和 negative clues。
> - **Rejected**: 自然语言回答无法稳定聚合；不记录原因会让 L1 选择不可调试。
> - **Impact**: `fab_plan_context` candidates 需要 `match_reasons`、`negative_reasons`、`confidence`、`matched_profile_fields`；`fab_get_rule_sections` input 需要 `ai_selection_reasons`。

#### Technical Solutions

> **Solution**: Add L1 selection reason contract and rule selection audit event.
> - **Status**: Validated
> - **Problem**: L1 AI 选择如果没有原因和 evidence，后续无法知道 description 是写得好、误导、缺字段，还是模型选择漂移。
> - **Rationale**: 让每个 L1 candidate 和 AI-selected rule 都带上可聚合原因字段。
> - **Alternatives**: 只记录 selected ids；只记录 final stable ids；只靠 audit 文本。都不足以支持效果改善。
> - **Evidence**: `selection-token-protocol.md`, `requirement-profile-design.md`。
> - **Next Action**: TDD plan 中加入 selection reason schema、missing reason diagnostic、audit event tests。

#### Analysis Results
协议补充：

- `fab_plan_context` 对 L1 candidate 返回：
  - `score`
  - `confidence`
  - `match_reasons`
  - `negative_reasons`
  - `matched_profile_fields`
- AI 调 `fab_get_rule_sections` 时提交：
  - `ai_selected_stable_ids`
  - `ai_selection_reasons`
- section tool 解析 token 后追加 `rule_selection` audit event，记录：
  - required stable ids
  - AI-selectable stable ids
  - AI-selected stable ids
  - final stable ids
  - selection reasons
  - rejected or ignored ids

第一版建议：如果 AI 选了 L1 但没给完整 reason，先返回 warning diagnostic；等客户端协议稳定后再升级成 hard error。

#### Open Items
- `ai_selection_reasons` 缺失时第一版是否 warning，第二版 hard error？
- audit event 写入 `.fabric/audit.jsonl`，还是独立 `.fabric/rule-selection.jsonl`？
- 是否需要 Dashboard 后续展示 L1 selection quality metrics？

#### Narrative Synthesis
**起点**: Round 4 已解决“如何不漏 L0/L2”，但 L1 选择质量还缺少反馈闭环。  
**关键进展**: 本轮把 L1 选择原因提升为协议字段和 audit event，为后续优化 description 与 ranking 提供数据。  
**决策影响**: TDD plan 需要覆盖原因字段、缺失原因 warning、非法选择 diagnostic 和 audit event。  
**当前理解**: L1 AI 自查可行，但必须留下结构化选择证据，否则无法长期改善效果。  
**遗留问题**: audit 存储位置和 reason 缺失的严格程度仍需在实现计划中定。

## Session Statistics Update 4
- Rounds completed: 5
- Updated artifacts: `selection-token-protocol.md`, `requirement-profile-design.md`
- Source code modified: no

---

### Round 6 - Keep Plan Context Neutral for L1 Selection (2026-04-25)

#### User Input
用户修正预期：`fab_plan_context` 的 L1 candidate 不应该返回 `score`、`confidence`、`match_reasons`、`negative_reasons`、`matched_profile_fields`，这些会影响和干扰 AI 自己的判断。`fab_plan_context` 只返回 description 即可；具体选择原因放到 `fab_get_rule_sections` 的 `ai_selected_stable_ids` 和 `ai_selection_reasons`。

#### Decision Log

> **Decision**: `fab_plan_context` 对 L1 保持中立，只返回 description index，不返回 server-side 评分或原因。
> - **Context**: 用户指出 score/reasons 会影响 AI 自己的 L1 判断。
> - **Options considered**: server 返回完整 ranking reasons；server 返回轻量 score；server 只返回 description index。
> - **Chosen**: 只返回 description index。**Reason**: L1 选择的核心价值是 AI 在看过具体文件后进行语义判断，server-side reason 会成为暗示和偏置。
> - **Rejected**: score/reasons 虽然利于调试，但会污染选择过程；轻量 score 仍然是偏置。
> - **Impact**: `fab_plan_context` output 应包含 L0/L1/L2 descriptions、required/ai-selectable 标记和 selection token；L1 selection reasons 只在 `fab_get_rule_sections` input 中由 AI 提交。

#### Technical Solutions

> **Solution**: Neutral plan context + reasoned section fetch。
> - **Status**: Validated
> - **Problem**: 既要避免 L1 自选失控，又不能用 server ranking 影响 AI 判断。
> - **Rationale**: plan 阶段只提供结构化候选材料；section 阶段要求 AI 提交选择理由并打点。
> - **Alternatives**: plan 阶段输出 ranking；完全不记录原因。前者污染判断，后者无法改善效果。
> - **Evidence**: `selection-token-protocol.md`, `requirement-profile-design.md`。
> - **Next Action**: TDD plan 应断言 plan-context 不输出 L1 score/reasons，同时 sections tool 接收并审计 AI selection reasons。

#### Analysis Results
协议修正：

- `fab_plan_context`:
  - 返回 L0/L1/L2 `description_index`
  - 返回 `required_stable_ids`
  - 返回 `ai_selectable_stable_ids`
  - 返回 `selection_token`
  - 不返回 L1 `score/confidence/match_reasons/negative_reasons/matched_profile_fields`
- `fab_get_rule_sections`:
  - 接收 `selection_token`
  - 接收 `ai_selected_stable_ids`
  - 接收 `ai_selection_reasons`
  - server 合并 required L0/L2 和 AI-selected L1
  - 记录 selection telemetry

#### Narrative Synthesis
**起点**: Round 5 曾把 L1 reasons 放到 plan-context candidate 输出中，以便打点。  
**关键进展**: 用户指出这会影响 AI 自己判断，本轮修正为 plan-context 中立、section fetch 记录 AI 的选择理由。  
**决策影响**: Requirement Profile 仍可作为内部构建 index/token 的对象，但不应把 server 的 L1 判断暴露给 AI。  
**当前理解**: 最合适的职责边界是：plan-context 提供候选材料和选择边界；AI 自主选择 L1；get-rule-sections 收集选择理由并审计。  
**遗留问题**: TDD plan 需要明确“plan output 不含 ranking reasons”的反向测试。

## Session Statistics Update 5
- Rounds completed: 6
- Updated artifacts: `selection-token-protocol.md`, `requirement-profile-design.md`
- Source code modified: no

---

### Round 7 - Description Identity Correction (2026-04-25)

#### User Input
用户指出：之前对 description 的认知有误，应取消 `Description.id`，统一用 `stable_id`。

#### Decision Log

> **Decision**: `RuleDescription` 不拥有身份字段，规则身份统一由 node-level `stable_id` 承担。
> - **Context**: 用户修正了之前关于 Description.id 的表达。
> - **Options considered**: Description.id；Description.id 与 stable_id 并存；只使用 stable_id。
> - **Chosen**: 只使用 stable_id。**Reason**: Description 是匹配材料，不是规则实体；身份分裂会影响 selection_token、audit、section fetch 和后续指标聚合。
> - **Rejected**: Description.id 会创造第二身份源；并存会导致 drift。
> - **Impact**: RuleDescription schema 不定义 id；description index item 使用外层 `stable_id`；TDD 应加入“description 不含 id”的 schema/输出断言。

#### Analysis Results
已同步修正：

- `decision-locks.md`: 明确 RuleDescription 是 matching metadata，不定义身份字段。
- `requirement-profile-design.md`: RuleDescription schema 不含 id，并说明身份在 RuleNode.stable_id。
- `tdd-preflight-concerns.md`: 将 Description.id 从开放问题改为已修正认知。

#### Narrative Synthesis
**起点**: 前面已倾向使用 stable_id，但早期文档里仍保留了 Description.id 作为待拍板/历史问题。  
**关键进展**: 本轮把它收敛为明确协议：Description 不承担身份。  
**决策影响**: 所有 selection、audit、section fetch、metrics 聚合都只围绕 stable_id。  
**当前理解**: Description 是可读、可匹配、可优化的规则画像；stable_id 是唯一稳定身份。  
**遗留问题**: TDD plan 需要加入 schema negative test，防止未来把 id 放回 RuleDescription。

## Session Statistics Update 6
- Rounds completed: 7
- Updated artifacts: `decision-locks.md`, `requirement-profile-design.md`, `tdd-preflight-concerns.md`
- Source code modified: no

---

### Round 8 - TDD Entry Decisions (2026-04-25)

#### User Input
用户确认进入 TDD 前剩余 7 个协议细节：

1. `selection_token` 第一版使用内存 cache + TTL。
2. 非法 L1 selection 第一版 hard error。
3. 缺少 `ai_selection_reasons` hard error，保证 telemetry 完整。
4. `rule_selection` audit 写入 `.fabric/audit.jsonl`。
5. `fab_plan_context` 可返回轻量 `requirement_profile`，但不包含 server 对 L1 的判断。
6. `description_index` 最小 schema 只包含 `stable_id`、`level`、`required`、`selectable`、`description`；不加 score/confidence/match_reasons。
7. 缺失 section 返回空 section + warning diagnostic，不 fallback 全文。

#### Decision Log

> **Decision**: 锁定 TDD 入口协议细节，下一步可进入 TDD 计划。
> - **Context**: 前面核心架构已确定，但 token、错误策略、audit、profile 和 section 缺失行为仍需固定。
> - **Options considered**: 继续保留开放问题；实现时再决定；现在锁定并写入 TDD entry decisions。
> - **Chosen**: 现在锁定。**Reason**: TDD 的红灯测试必须基于稳定协议，否则测试本身会反复返工。
> - **Rejected**: 实现时再决定会把协议判断混进代码细节；继续开放会阻塞 TDD plan。
> - **Impact**: 后续 TDD plan 可以直接覆盖 token cache/TTL、hard errors、audit append、neutral profile、minimal description index、missing section warning。

#### Analysis Results
新增最终入口决策文档：

- `.workflow/.analysis/ANL-2026-04-25-fabric-v2核心认知对齐方案/tdd-entry-decisions.md`

同步更新：

- `selection-token-protocol.md`: hard error 策略、内存 cache + TTL、audit destination。
- `requirement-profile-design.md`: neutral requirement profile、missing section behavior。

#### Narrative Synthesis
**起点**: Round 7 已完成 Description 身份修正，协议主干基本闭合。  
**关键进展**: 本轮锁定了进入 TDD 前最后一组运行时行为。  
**决策影响**: 测试计划不再需要在 warning/hard error、token 存储、audit 文件、section fallback 等问题上分叉。  
**当前理解**: 现在可以进入 TDD 计划生成；剩余问题属于实现拆分而非产品语义。  
**遗留问题**: 无阻塞级语义问题；下一步应生成 TDD plan。

## Session Statistics Update 7
- Rounds completed: 8
- New artifact: `tdd-entry-decisions.md`
- Updated artifacts: `selection-token-protocol.md`, `requirement-profile-design.md`
- Source code modified: no

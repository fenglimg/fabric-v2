# Analysis Discussion

**Session ID**: ANL-2026-04-25-adr-002-mcp-first-rule-distribution-rules-architecture
**Topic**: ADR-002: MCP-first Rule Distribution 中 priority、activation、human-lock、description-stub 规则架构是否合理；并梳理当前规则相关数据结构设计
**Started**: 2026-04-25T12:18:19+08:00
**Dimensions**: architecture, decision, implementation, concept
**Depth**: standard

## Table of Contents
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
- [Data Structure Inventory](#data-structure-inventory)
- [Decision Trail](#decision-trail)

## Current Understanding

### What We Established
- ADR-002 的核心不是单个字段设计，而是把规则分发的判断权集中到 server service，再通过 MCP/HTTP 输出给客户端。
- 当前至少存在四层数据结构：规则注册表元数据、server 解析中间结构、MCP/HTTP 输出 payload、人类保护 human-lock 状态。
- `priority` 和 `activation` 属于规则元数据；`description_stubs` 和 `human_locked_nearby` 属于服务端解析后的上下文输出；human-lock 的真实源是 `.fabric/human-lock.json`。
- server/MCP 与具体规则结构的区别：server/MCP 是“如何查询、解析、排序、分发规则”的协议和运行时；具体规则结构是“有哪些规则、适用什么路径、何时加载、优先级如何”的数据模型。

### What Was Clarified
- ~~把 priority、activation、human-lock、description-stub 都理解为同一种规则字段~~ -> 它们分布在不同对象边界上：metadata field、derived payload、state file、service diagnostic。
- ~~MCP-first 等于所有规则都只存在 MCP 内部~~ -> 规则仍在 `.fabric/agents` 与 `.fabric/agents.meta.json` 中；MCP-first 指客户端不直接预编译/复制规则，而是按需向 server 查询。

### Key Insights
- 这套架构总体方向合理：它避免每个 AI client 重写规则匹配逻辑，并让 stale detection、优先级、activation、human-lock 统一。
- 当前最大风险不是 ADR-002 思路错误，而是数据结构边界还需要更明确命名和治理：哪些是真源、哪些是 read model、哪些是 MCP contract。
- 用户当前希望先重新思考相关数据结构设计，因此下一阶段应以结构盘点和问题框架为主，不急于裁决。

## Analysis Context
- Focus areas: 架构取舍、数据结构设计整体审核、server/MCP 与具体规则结构边界解释
- Perspectives: Architectural + Technical
- Depth: standard
- Constraint: 本仓库当前缺少 `.fabric/agents.meta.json`，`fab_get_rules` 无法为本次分析提供本仓库自身的 Fabric rule context；改以源码、测试和文档为证据。

## Initial Questions
- ADR-002 把规则分发集中在 server/MCP 是否合理？
- `priority`、`activation`、`human-lock`、`description-stub` 是否属于同一层抽象？
- 当前有哪些核心数据结构，需要一起做架构审核？
- server/MCP 和具体规则结构到底有什么区别？

## Initial Decisions

> **Decision**: 将本轮范围从 ADR-002 单点判断扩大为“规则协议对象模型”审核。
> - **Context**: 用户补充希望知道当前一共有哪些数据结构设计，并厘清 server/MCP 与具体规则结构的区别。
> - **Options considered**: 只评审 ADR-002；扩大到全部规则相关数据结构；先做外部 MCP 标准研究。
> - **Chosen**: 扩大到规则相关数据结构，同时保留 ADR-002 为主线。- **Reason**: ADR-002 的合理性取决于对象边界是否清楚，不能只看一句“集中在 server”。
> - **Rejected**: 只评审 ADR-002 会遗漏 metadata/payload/state 的边界；先做外部研究对当前问题帮助较小，因为问题主要来自项目内部结构。
> - **Impact**: Round 1 会输出数据结构清单和分层解释，再判断 ADR-002。

---

## Discussion Timeline

### Round 1 - Exploration (2026-04-25T12:18:19+08:00)

#### User Input
用户选择“架构取舍”，并补充：同时想知道当前一共存在哪些数据结构设计，需要整体拉出来进行架构审核和讨论；也不太清楚 server/MCP 和具体规则的结构设计有什么区别。

#### Decision Log

> **Decision**: 本轮不修改代码，只做架构对象模型分析并记录证据。
> - **Context**: 使用 analyze-with-file，目标是讨论 ADR-002 规则架构是否合理。
> - **Options considered**: 直接给口头结论；读取 ADR/源码/测试后形成证据链；进入实现修改。
> - **Chosen**: 读取 ADR、schema、server services、tool contracts、tests、Dashboard consumer 后形成证据链。- **Reason**: 这是架构讨论，必须先确认实际落点。
> - **Rejected**: 直接口头结论缺少可追溯性；实现修改尚未形成需求。
> - **Impact**: 结论会以对象边界和证据行号为基础。

#### Key Findings

> **Finding**: ADR-002 明确选择 rules 通过 MCP tools 按需分发，并把 priority、activation、human-lock、description-stub 逻辑集中在 server。
> - **Confidence**: High - **Why**: `docs/ARCHITECTURE_DECISIONS.md:23` 到 `docs/ARCHITECTURE_DECISIONS.md:38` 直接记录该决策、原因和证据。
> - **Hypothesis Impact**: Confirms hypothesis "MCP-first 是规则分发边界，而不是规则存储格式"。
> - **Scope**: 影响 AI client、server service、Dashboard read model、规则元数据。

> **Finding**: 规则元数据真源是 `AgentsMetaNode`，字段包括 `file`、`scope_glob`、`deps`、`priority`、`layer`、`topology_type`、`hash`、`stable_id`、`identity_source`、`activation`。
> - **Confidence**: High - **Why**: schema/type 分别位于 `packages/shared/src/schemas/agents-meta.ts:23` 和 `packages/shared/src/types/agents.ts:13`。
> - **Hypothesis Impact**: Modifies hypothesis "priority/activation/human-lock/stub 同层"；只有 priority/activation 是规则元数据字段。
> - **Scope**: `.fabric/agents.meta.json`、sync-meta、update-registry、rule matching。

> **Finding**: MCP 单文件查询输出的是解析后的 `RulesPayload`，不是 agents meta 原样返回。
> - **Confidence**: High - **Why**: `fab_get_rules` output schema 在 `packages/server/src/tools/get-rules.ts:19` 到 `packages/server/src/tools/get-rules.ts:29`，返回 `revision_hash`、`stale`、`rules.L0/L1/L2/human_locked_nearby/description_stubs`。
> - **Hypothesis Impact**: Confirms hypothesis "MCP contract 是消费视图"。
> - **Scope**: AI client runtime、stale detection、rule delivery。

> **Finding**: `fab_plan_context` 是批量规划 read model，已经引入 shared bundle、file_map、description_stub_union、preflight_diagnostics。
> - **Confidence**: High - **Why**: `packages/server/src/tools/plan-context.ts:29` 到 `packages/server/src/tools/plan-context.ts:75` 定义输出，`packages/server/src/services/plan-context.ts:102` 到 `packages/server/src/services/plan-context.ts:190` 构建 shared view。
> - **Hypothesis Impact**: Confirms hypothesis "规划阶段与执行前单文件确认是两个不同 API 场景"。
> - **Scope**: 架构评审、批量路径分析、减少重复规则内容读取。

> **Finding**: `activation.tier = description` 当前无视 `scope_glob`，会对所有路径返回 description stub。
> - **Confidence**: High - **Why**: `shouldLoadNodeForPath` 中 `description` 分支直接 `return true`，见 `packages/server/src/services/get-rules.ts:279` 到 `packages/server/src/services/get-rules.ts:287`；测试也显示 description node 即使 `scope_glob: "**/*.ts"`，查询 `docs/guide.md` 仍返回 stub，见 `packages/server/src/services/get-rules.test.ts:57` 到 `packages/server/src/services/get-rules.test.ts:92`。
> - **Hypothesis Impact**: Modifies hypothesis "description stub 是 path-scoped 轻量规则"；当前实现更像全局候选提示。
> - **Scope**: description-stub 语义、上下文噪声、未来规则规模。

> **Finding**: human-lock 不是规则节点字段，而是单独 state file，经 server 读取后作为规则上下文的保护提示输出。
> - **Confidence**: High - **Why**: human-lock schema 在 `packages/shared/src/schemas/human-lock.ts:8`，读取和 drift hash 在 `packages/server/src/services/read-human-lock.ts:19` 到 `packages/server/src/services/read-human-lock.ts:32`，`get-rules` 把它放入 `human_locked_nearby` 见 `packages/server/src/services/get-rules.ts:111` 到 `packages/server/src/services/get-rules.ts:116`。
> - **Hypothesis Impact**: Refutes hypothesis "human-lock 是规则架构字段之一"；它是编辑安全状态，被规则分发 payload 携带。
> - **Scope**: human approval workflow、Dashboard human-lock view、MCP safety context。

#### Technical Solutions

> **Solution**: 使用三层对象模型解释当前规则架构：Source of Truth -> Resolution Service -> Delivery Contract。
> - **Status**: Proposed
> - **Problem**: 用户不清楚 server/MCP 与具体规则结构的区别。
> - **Rationale**: 该模型能把 `.fabric/agents.meta.json`、server matching、MCP payload、Dashboard read model 分开，避免把字段混成一类。
> - **Alternatives**: 按文件夹解释；按功能解释；按 API 解释。按对象生命周期解释更适合架构审核。
> - **Evidence**: `packages/shared/src/schemas/agents-meta.ts:23`; `packages/server/src/services/get-rules.ts:145`; `packages/server/src/tools/get-rules.ts:19`; `packages/server/src/tools/plan-context.ts:29`。
> - **Next Action**: Round 2 可决定是否把这个模型固化成 ADR 补充或 SPEC_INTERNAL 图。

#### Analysis Results

##### 当前规则相关数据结构清单

1. Rule source files
   - 位置：`.fabric/agents/**/*.md`、`.fabric/bootstrap/README.md`。
   - 职责：保存实际规则正文。
   - 证据：server 读取 L0 bootstrap 在 `packages/server/src/services/get-rules.ts:111` 到 `packages/server/src/services/get-rules.ts:112`；规则正文按 node.file 读取在 `packages/server/src/services/get-rules.ts:190` 到 `packages/server/src/services/get-rules.ts:197`。

2. AgentsMeta / AgentsMetaNode
   - 位置：`.fabric/agents.meta.json`，schema 在 shared。
   - 职责：规则注册表，描述规则文件、适用范围、优先级、层级、拓扑、内容 hash、稳定身份和激活策略。
   - 核心字段：`file`、`scope_glob`、`deps`、`priority`、`layer`、`topology_type`、`hash`、`stable_id`、`identity_source`、`activation`。
   - 证据：`packages/shared/src/schemas/agents-meta.ts:23` 到 `packages/shared/src/schemas/agents-meta.ts:39`。

3. Stable identity
   - 职责：给规则一个比 file path 更稳定的引用名。
   - 来源：HTML comment `<!-- fab:rule-id ... -->` 或 derived fallback。
   - 证据：ADR-004 在 `docs/ARCHITECTURE_DECISIONS.md:56` 到 `docs/ARCHITECTURE_DECISIONS.md:81`；sync-meta 提取在 `packages/cli/src/commands/sync-meta.ts:306` 到 `packages/cli/src/commands/sync-meta.ts:336`。

4. Revision hash
   - 职责：让 client 判断规则上下文是否 stale。
   - 当前存在两套计算路径：sync-meta 把 node id、hash、stable_id、identity_source 纳入 revision；update-registry 只拼 node.hash。
   - 证据：sync-meta revision 在 `packages/cli/src/commands/sync-meta.ts:272` 到 `packages/cli/src/commands/sync-meta.ts:276`；update-registry revision 在 `packages/server/src/services/update-registry.ts:50` 到 `packages/server/src/services/update-registry.ts:56`。
   - 架构风险：同名概念不同算法，可能让 registry mutation 后的 stale 语义弱于 sync-meta。

5. Matching model
   - 职责：按 path 决定哪些规则命中。
   - 实现：`matchRuleNodes` 先调用 `shouldLoadNodeForPath`，再按 priority 和 node id 排序。
   - 证据：`packages/server/src/services/get-rules.ts:145` 到 `packages/server/src/services/get-rules.ts:164`。

6. Activation model
   - 职责：决定规则何时加载。
   - tier：`always` 全局加载；`path` 或未声明走 `scope_glob`；`description` 当前只返回 stub 且全局出现。
   - 证据：schema 在 `packages/shared/src/schemas/agents-meta.ts:33` 到 `packages/shared/src/schemas/agents-meta.ts:38`；行为在 `packages/server/src/services/get-rules.ts:275` 到 `packages/server/src/services/get-rules.ts:287`。

7. RulesPayload
   - 职责：MCP/HTTP 给客户端的实际规则上下文。
   - 字段：`L0`、`L1[]`、`L2[]`、`human_locked_nearby[]`、`description_stubs?`。
   - 证据：service type 在 `packages/server/src/services/get-rules.ts:32` 到 `packages/server/src/services/get-rules.ts:38`；MCP output schema 在 `packages/server/src/tools/get-rules.ts:19` 到 `packages/server/src/tools/get-rules.ts:29`。

8. HumanLockFile / HumanLockStatus
   - 职责：记录人类保护范围，并检测 protected range 是否 drift。
   - 字段：`file`、`start_line`、`end_line`、`hash`，读取后附加 `drift`、`current_hash`。
   - 证据：schema 在 `packages/shared/src/schemas/human-lock.ts:8` 到 `packages/shared/src/schemas/human-lock.ts:13`；status type 在 `packages/server/src/services/read-human-lock.ts:14` 到 `packages/server/src/services/read-human-lock.ts:17`。

9. PlanContextResult / shared bundle
   - 职责：规划阶段一次查多个路径，输出 per-path rules 和 shared union。
   - 字段：`entries[]`、`shared.resolved_bundle_id`、`shared_entries`、`file_map`、`description_stub_union`、`preflight_diagnostics`。
   - 证据：`packages/server/src/services/plan-context.ts:17` 到 `packages/server/src/services/plan-context.ts:50`。

10. Dashboard read model
   - 职责：观察规则拓扑和命中原因，不直接成为规则真源。
   - 证据：Dashboard 调 `/api/rules` 和 `/api/rules/context`，见 `packages/dashboard/src/api/client.ts:129` 到 `packages/dashboard/src/api/client.ts:137`；HitReasonPanel 把 meta + rulesContext 组合成命中理由，见 `packages/dashboard/src/components/hit-reason-panel.tsx:60` 到 `packages/dashboard/src/components/hit-reason-panel.tsx:99`。

##### server/MCP 与具体规则结构的区别

- 具体规则结构是数据真源层：规则文件写什么、metadata 如何声明、某条规则属于 L1 还是 L2、priority 是 high 还是 low、activation 是 path 还是 description。
- server 是规则解析层：读取 meta 和 human-lock，执行 match/sort/load/dedupe/stale/audit，把真源数据变成客户端可消费的上下文。
- MCP 是 AI client 的协议入口：定义工具输入输出、readOnly/destructive hints、single-path 与 multi-path 使用场景。
- HTTP/Dashboard 是观察入口：复用 server service，但输出更适合 UI 展示。

##### ADR-002 合理性初判

合理的部分：
- 把规则分发逻辑集中在 server 是合理的。否则 Claude/Codex/Cursor/Gemini 等 client 都需要复制 minimatch、priority、activation、stale、human-lock 逻辑，行为会漂移。
- MCP-first 很适合 AI client 场景。它允许“修改前按目标路径取规则”，与 bootstrap 中的强制调用规则一致。
- `description_stubs` 放在 server 输出而不是规则正文里是合理的，因为它是一个上下文压缩/延迟加载机制。
- human-lock 由 server 读取后注入 payload 是合理的，因为 client 只需要知道“哪里要停下请示”，不应该自己解释 `.fabric/human-lock.json` 的 drift hash。

需要讨论或修正的部分：
- `description` tier 当前全局命中，可能导致规模变大后 stub 噪声升高；如果语义是“候选描述”，合理，但文档需要明确；如果语义是“path-scoped description”，实现需要改为先匹配 scope_glob。
- `revision` 算法存在不一致风险：sync-meta 包含 identity 字段，update-registry 只包含 hash。若通过 MCP 更新 priority、activation、scope_glob，revision 是否变化需要重新审核。
- `deps` 在 schema 中存在，但当前 rule resolution 未使用它进行依赖展开或排序解释；这会让数据结构看起来比行为更强。
- `human_locked_nearby` 当前名字像“nearby”，但实现是读取所有 human-lock entry 后全部返回；命名与行为可能不一致。
- `fab_update_registry` tool schema 目前没有暴露 `stable_id`、`identity_source`、`activation`，但 shared schema 和 service parser 支持这些字段。这会造成“只能读到新字段，不能通过 tool 完整维护新字段”的协议缺口。

#### Corrected Assumptions
- ~~ADR-002 里的 priority、activation、human-lock、description-stub 都是规则字段~~ -> priority/activation 是 metadata 字段；human-lock 是独立状态；description_stub 是解析输出。
- ~~server/MCP 是规则内容的一部分~~ -> server/MCP 是规则分发协议和运行时，规则内容与 metadata 才是具体规则结构。

#### Open Items
- `description` tier 到底应该全局出现，还是仍受 `scope_glob` 限制？
- `revision` 是否应该统一为 sync-meta 的算法，保证 priority/activation/scope/stable identity 变化都触发 stale？
- `deps` 是否应进入 resolution semantics，还是从 schema 降级为纯拓扑/文档字段？
- `human_locked_nearby` 是否应该改名或实现真正的 path proximity？
- `fab_update_registry` 是否应补齐 activation/stable_id/identity_source 的输入能力？

#### Initial Intent Coverage Check (Post-Exploration)
- Addressed: 判断 ADR-002 规则架构是否合理 - 已给出初判：方向合理，但若干字段边界和实现语义需讨论。
- Addressed: 列出当前一共有哪些数据结构设计 - 已整理 10 类对象。
- Addressed: 解释 server/MCP 与具体规则结构的区别 - 已用 Source of Truth / Resolution Service / Delivery Contract 分层说明。
- In progress: 架构审核和讨论 - 需要用户选择下一轮深入项。

#### Narrative Synthesis
**起点**: 本轮从 ADR-002 的字段疑问切入，但用户补充要求先看全局数据结构。
**关键进展**: 证据显示 Fabric 的规则架构不是单层 schema，而是由 agents meta、resolution service、MCP payload、human-lock state、Dashboard read model 组成。
**决策影响**: 用户选择架构取舍并要求解释边界，导致分析方向从单条 ADR 扩大为对象模型审核。
**当前理解**: ADR-002 总体合理，因为规则匹配和分发确实应集中在 server/MCP；但 description、revision、deps、human-lock 命名、update-registry 输入面是需要进一步讨论的架构点。
**遗留问题**: 下一轮应优先决定哪些风险是必须修正，哪些只是文档澄清。

---

### Round 2 - Data Structure Inventory (2026-04-25T12:18:19+08:00)

#### User Input
用户选择“None of the above”，并说明：需要提供识别到所有的数据结构设计，以便重新思考相关数据结构的设计探讨。

#### Decision Log

> **Decision**: 暂停架构裁决，先产出数据结构盘点底稿。
> - **Context**: 用户不想立即进入三组选项，而是需要完整识别当前数据结构。
> - **Options considered**: 继续 ADR 合理性裁决；转成风险修正清单；产出数据结构 inventory。
> - **Chosen**: 产出 `data-structures.md`，按结构层级而非文件名列出。- **Reason**: 重新设计需要先看清对象边界和每个对象的问题。
> - **Rejected**: 直接裁决会过早锁定方案；风险修正清单会遗漏用户正在重构心智模型的需求。
> - **Impact**: 讨论会进入“对象模型设计”阶段。

#### Key Findings

> **Finding**: 除规则核心结构外，Fabric 还存在 initialization/discovery、ledger/audit/event、doctor/cache/config 等治理结构，它们会影响规则架构边界。
> - **Confidence**: High - **Why**: shared schemas、server services、CLI init plan、Dashboard API types 均有对应结构定义。
> - **Hypothesis Impact**: Modifies hypothesis "只需要讨论 rules metadata"；实际需要讨论 source-of-truth、read model、protocol contract、governance artifact 的关系。
> - **Scope**: 规则架构设计、ADR 补充、未来 schema migration。

#### Analysis Results
已生成独立盘点文件：

- `.workflow/.analysis/ANL-2026-04-25-adr-002-mcp-first-rule-distribution-rules-architecture/data-structures.md`

该文件按 10 组列出当前识别到的数据结构：

1. Rule Source Layer
2. Rule Registry Layer
3. Rule Resolution Layer
4. Planning Read Model Layer
5. Human Protection Layer
6. Intent, Audit, And Event Layer
7. Initialization And Discovery Layer
8. Config, Health, And Cache Layer
9. MCP And HTTP Contract Layer
10. Design Discussion Summary

#### Open Items
- 哪些结构是真源，哪些只是 read model？
- 是否需要为所有核心结构建立统一 schema version？
- MCP contract 是否应该暴露更多 stable identity / hit reason？
- 初始化发现结构是否应该继续参与后续规则演进？

#### Intent Coverage Check
- Addressed: 提供识别到的数据结构设计 - 已生成 `data-structures.md`。
- In progress: 重新思考相关数据结构设计 - 等待用户基于清单提出下一轮讨论方向。
- Addressed: server/MCP 与具体规则结构区别 - 已在 Round 1 和清单中按层级拆开。

#### Narrative Synthesis
**起点**: 基于 Round 1 的 ADR 初判，用户要求先拉出所有数据结构。
**关键进展**: 本轮从代码中扩展识别出规则核心、治理状态、初始化发现、协议输出、Dashboard read model 等结构。
**决策影响**: 用户选择暂停裁决，导致输出从“建议”转为“讨论底稿”。
**当前理解**: 规则架构讨论需要先确定对象分层和真源边界，再讨论具体字段是否合理。
**遗留问题**: 用户需要基于数据结构清单选择下一步重构或裁剪方向。

## Data Structure Inventory

See `data-structures.md` in this session folder.

---

## Decision Trail

> Will be consolidated after interactive rounds.

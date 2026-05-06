# Analysis Discussion

**Session ID**: ANL-2026-04-28-init规则目录与taxonomy设计讨论
**Topic**: fab init 后 `.fabric` 目录、规则层级、bootstrap、INITIAL_TAXONOMY 与结构化 rule section 的设计讨论
**Started**: 2026-04-28T12:58:00+08:00
**Dimensions**: architecture, implementation, concept, decision
**Depth**: standard

## Table of Contents
- [Current Understanding](#current-understanding)
- [Analysis Context](#analysis-context)
- [Discussion Timeline](#discussion-timeline)
- [Synthesis & Conclusions](#synthesis--conclusions)
- [Decision Trail](#decision-trail)

## Current Understanding

### What We Established
- werewolf 初始化后 `.fabric` 同时存在协议入口、证据包、规则源、元数据和 taxonomy：`bootstrap/README.md`、`forensic.json`、`rules/root.md`、`rules/_cross/cocos-creator.md`、`agents.meta.json`、`INITIAL_TAXONOMY.md`。
- 当前 L0/L1/L2 不是由 `rules/l0|l1|l2` 目录显式表达，而是由 `.fabric/agents.meta.json` 的 `level/layer` 字段表达；该字段在 pcf 实现里主要由路径深度和 `_cross` 规则推导。
- `INITIAL_TAXONOMY.md` 由 CLI init 阶段直接根据 `forensic.json` 自动生成；不是 fabric-init skill 的交互式产物。
- 真正被 MCP `fab_get_rule_sections` 结构化读取的是 `.fabric/rules/**/*.md` 中的 `## [MISSION_STATEMENT]`、`## [MANDATORY_INJECTION]`、`## [BUSINESS_LOGIC_CHUNKS]`、`## [CONTEXT_INFO]`。
- `.fabric/bootstrap/README.md` 当前是 bootstrap contract，不符合结构化 rule section 规范；它被作为 L0 节点进入 meta，但主要承担启动协议，不承担业务规则正文。

### What Was Clarified
- ~~目录看起来没有 L0/L1/L2，所以规则无法区分~~ -> 实际区分存在于 `agents.meta.json`，但可读性不足。
- ~~INITIAL_TAXONOMY 是 fabric-init skill 生成~~ -> 代码显示它由 `buildInitialTaxonomyMarkdown()` 生成，fabric-init/agents-md-init 更多负责后续确认、写 init-context 和规则节点。

### Key Insights
- 显式 `rules/l0|l1|l2` 能提升人类可读性，但会和现有“路径深度推导 layer”的机制产生迁移成本；更稳的方案是先保留 `.fabric/rules/` 源树，再增加视图型说明或 taxonomy 文件夹。
- bootstrap 是否进入 `rules/l0` 本质上取决于是否把它从“启动协议”改成“规则正文”。当前实现不建议直接搬迁，除非同步改 doctor、rule-meta-builder、bootstrap-guide、模板和兼容逻辑。

## Analysis Context
- Target initialized repo: `/Users/wepie/Desktop/projects/werewolf-minigame/.fabric`
- Implementation repo: `/Users/wepie/Desktop/personal-projects/pcf`
- User questions: 7 项，覆盖目录层级、bootstrap 归属、taxonomy 来源、中文规则表达、section 规范、CONTEXT_INFO 意义、taxonomy 放置位置。

## Discussion Timeline

### Round 1 - Exploration (2026-04-28T12:58:00+08:00)

#### User Input
用户希望基于刚初始化的 werewolf `.fabric` 目录，讨论初始化产物是否合理，尤其是 L0/L1/L2 可见性、bootstrap 和 rules 的关系、taxonomy 生成方式、中文规则表达、结构化 section 规范，以及 `CONTEXT_INFO` 的实际意义。

#### Decision Log
> **Decision**: 将本轮作为只读架构分析，不修改 pcf 或 werewolf 源码。
> - **Context**: 用户使用 `$analyze-with-file`，该 skill 明确是分析与文档记录流程。
> - **Options considered**: 直接实现目录迁移；先做分析结论；只口头回答。
> - **Chosen**: 先做分析结论并记录文件。**Reason**: 这些问题涉及协议兼容和元数据推导，直接改目录风险较高。
> - **Rejected**: 直接迁移目录，因为会影响 doctor、MCP selection、meta 生成和模板。
> - **Impact**: 输出聚焦于可实施建议，而不是本轮落代码。

#### Key Findings
> **Finding**: `INITIAL_TAXONOMY.md` 是 CLI init 阶段自动生成，不是 fabric-init skill 生成。
> - **Confidence**: High — **Why**: `packages/cli/src/commands/init.ts` 中 `buildInitFabricPlan()` 调用 `buildInitialTaxonomyMarkdown(forensicReport)`，并写入 `.fabric/INITIAL_TAXONOMY.md`。
> - **Hypothesis Impact**: Refutes hypothesis "taxonomy 应该是 fabric-init skill 现有生成物"。
> - **Scope**: init 产物归属、后续交互式初始化边界。

> **Finding**: 当前 L0/L1/L2 由 meta 表达，目录不显式表达；规则层级推导依赖路径深度和 `_cross`。
> - **Confidence**: High — **Why**: `agents.meta.json` 已含 `L0`、`L0/root`、`L1/_cross/cocos-creator`；`deriveAgentsMetaLayer()` 对 `.fabric/bootstrap/README.md` 返回 L0，对 `_cross` 返回 L1，否则按路径深度返回。
> - **Hypothesis Impact**: Modifies hypothesis "需要 rules/l0/l1/l2 才能区分层级"。
> - **Scope**: 规则树布局、meta 可读性、迁移方案。

> **Finding**: bootstrap README 被 meta 识别为 L0，但它不按 rule section 结构解析。
> - **Confidence**: High — **Why**: bootstrap 模板使用 `## CORE RULES (DO NOT TRANSLATE)`；`parseRuleSections()` 只识别 `## [SECTION_NAME]`。
> - **Hypothesis Impact**: Confirms issue "bootstrap README 与规则文档规范不一致"。
> - **Scope**: bootstrap 与 rules 概念边界。

> **Finding**: 中文规则正文是可行的，section 标题和 protected tokens 保持稳定即可。
> - **Confidence**: High — **Why**: `rule-sections.test.ts` 已验证中文正文可在 `## [MISSION_STATEMENT]` 等 section 下被解析。
> - **Hypothesis Impact**: Confirms hypothesis "可用 MUST: 中文描述形式"。
> - **Scope**: 中文母语者体验、模板本地化。

#### Technical Solutions
> **Solution**: 保留 `.fabric/rules/` 作为规则源树，不立即改成 `rules/l0|l1|l2`，但在 taxonomy 或 meta 可视化中显式展示 layer。
> - **Status**: Proposed
> - **Problem**: 当前文件夹排布让人很难从路径上看出 L0/L1/L2。
> - **Rationale**: 能提升可读性，又避免破坏路径深度推导和 mirror path 语义。
> - **Alternatives**: 直接迁移到 `rules/l0|l1|l2`；完全维持现状。
> - **Evidence**: `packages/shared/src/schemas/agents-meta.ts:114`，`packages/server/src/services/rule-meta-builder.ts:477`。
> - **Next Action**: 若执行，应先设计 meta 推导兼容层。

> **Solution**: 将 `INITIAL_TAXONOMY.md` 移入 `.fabric/taxonomy/INITIAL.md` 或 `.fabric/taxonomy/README.md`，保留旧路径兼容期。
> - **Status**: Proposed
> - **Problem**: taxonomy 与运行期核心文件平铺在 `.fabric` 根下，语义不清。
> - **Rationale**: taxonomy 是规划/解释产物，不是 rule source 或 runtime ledger。
> - **Alternatives**: 继续放根目录；放进 `.fabric/rules/`。
> - **Evidence**: `packages/cli/src/commands/init.ts:491`，`packages/server/src/services/doctor.ts:182`。
> - **Next Action**: 需要 doctor 和 init tests 同步兼容。

#### Analysis Results
- werewolf 当前 rule source 只有两个结构化规则文件：`.fabric/rules/root.md` 和 `.fabric/rules/_cross/cocos-creator.md`。
- `.fabric/rules/root.md` 已包含四个结构化 section，并且 `CONTEXT_INFO` 存放 evidence 指针、init-context 位置和 workflow 线索。
- `CONTEXT_INFO` 的合理定位不是“必须执行的规则”，而是给 AI 选择/理解规则时使用的背景信息：证据来源、关联文件、历史上下文、低风险提示。
- bootstrap README 当前更像“协议启动器”：告诉 AI 必须先走 `fab_plan_context` / `fab_get_rule_sections`，不要承载 Cocos 业务规则。
- 若将 bootstrap README 直接移入 `rules/l0`，需要同步改变 `.fabric/bootstrap/README.md` 作为 doctor 必需文件、hook 提示、bootstrap-guide 模板、meta 特判和旧仓库兼容。

#### Corrected Assumptions
- ~~bootstrap README 是普通规则文档~~ -> 它目前是 bootstrap contract，虽然 meta 中是 L0，但不使用 structured section。
- ~~CONTEXT_INFO 可能没必要~~ -> 它有意义，但应该限制为 evidence/context，不应该放 MUST/NEVER 约束。

#### Open Items
- 是否接受新增 `.fabric/taxonomy/` 目录，并保留旧路径兼容？
- 是否要将 bootstrap README 改成也包含结构化 section，还是保持协议启动器身份？
- 是否要让中文 rule templates 成为默认输出？

#### Narrative Synthesis
**起点**: 用户对刚初始化后的 `.fabric` 目录可读性和产物职责产生疑问。  
**关键进展**: 本轮确认了现状的机制边界：layer 存在但不显式在目录中；taxonomy 是 CLI 生成；rules 才是结构化 section 的解析对象。  
**决策影响**: 分析方向从“目录看起来乱”收敛到“职责边界和人类可读性需要重新表达”。  
**当前理解**: 当前实现技术上可工作，但初始化后的信息架构对中文用户和人工维护者不够直接。  
**遗留问题**: 需要决定是做轻量信息架构调整，还是做目录协议迁移。

## Synthesis & Conclusions

### Intent Coverage Matrix
| # | Original Intent | Status | Where Addressed | Notes |
|---|---|---|---|---|
| 1 | 是否需要 `rules/l0`, `rules/l1`, `rules/l2` 区分 | Addressed | Round 1, Rec #1 | 建议先不直接迁移，先增强显式 layer 表达 |
| 2 | bootstrap README 放到 `rules/l0` 是否可行 | Addressed | Round 1, Rec #2 | 可行但不建议直接搬，需要协议迁移 |
| 3 | INITIAL_TAXONOMY 怎么生成，是否应由 skill 指导 | Addressed | Round 1, Rec #3 | 当前 CLI 自动生成；建议改为 draft + skill review |
| 4 | 中文规则能否用 `MUST: 中文...` | Addressed | Round 1, Rec #4 | 可行，需保留 section 名和 protected tokens |
| 5 | bootstrap README 不符合 section 规范 | Addressed | Round 1, Rec #2 | 确认属实；取决于 bootstrap 是否仍是协议入口 |
| 6 | CONTEXT_INFO 意义 | Addressed | Round 1, Rec #5 | 背景、证据和检索提示，不是强规则 |
| 7 | INITIAL_TAXONOMY 是否放专门文件夹 | Addressed | Round 1, Rec #6 | 建议迁入 `.fabric/taxonomy/` 并兼容旧路径 |

### Recommendations
1. **不要立刻把规则源树改成 `rules/l0|l1|l2`；先在 taxonomy/doctor/dashboard 中显式展示 layer。**
   - Priority: High
   - Rationale: 当前层级推导依赖 mirror path，直接目录迁移会影响稳定 id、scope glob 和兼容性。

2. **保留 `.fabric/bootstrap/README.md` 作为 bootstrap contract；如需 section 规范，优先增加“结构化摘要”而不是直接搬到 `rules/l0`。**
   - Priority: High
   - Rationale: bootstrap 被多个组件硬编码为初始化入口，迁移成本高。

3. **将 `INITIAL_TAXONOMY.md` 定位为 CLI 自动生成的 taxonomy draft，再由 fabric-init/agents-md-init 做 review 与确认。**
   - Priority: High
   - Rationale: 自动 forensic 只能生成候选结构，不能替代用户或 skill 的确认流程。

4. **中文规则正文可以默认采用 `MUST: 中文动作`，但 section heading 保持英文 token。**
   - Priority: Medium
   - Rationale: 解析器只依赖英文 section heading；正文可中文化以提升母语用户可读性。

5. **明确 `CONTEXT_INFO` 只放背景和证据，不放必须执行的约束。**
   - Priority: Medium
   - Rationale: 可降低规则注入噪音，避免背景信息和硬规则混淆。

6. **将 taxonomy 文件迁入 `.fabric/taxonomy/`，并保留 `.fabric/INITIAL_TAXONOMY.md` 兼容期。**
   - Priority: Medium
   - Rationale: taxonomy 是规划解释物，独立目录更清晰。

## Decision Trail
- D1: 本轮只读分析，不实施迁移。
- D2: 将 bootstrap 与 rules 区分为“协议入口”和“规则源正文”。
- D3: 将 taxonomy 视为 draft，而不是最终规则源。

## Session Statistics
- Rounds: 1
- Key findings: 4
- Recommendations: 6
- Source code modified: no

# Analysis Discussion

**Session**: ANL-2026-05-08-fabric-test-cases
**Topic**: 在使用 integration-test-cycle 之前，先输出 fabric 系统功能模块测试用例 / 或寻找更好的功能点记录与全面验证方式
**Started**: 2026-05-08T03:13:18Z (UTC+8 11:13)
**Dimensions**: decision, implementation, concept
**Depth**: Standard
**Perspectives**: Technical, Architectural, Domain Expert (合并到 Round 1 综合分析)

## Table of Contents
- [Current Understanding](#current-understanding)
- [Analysis Context](#analysis-context)
- [Initial Questions](#initial-questions)
- [Initial Decisions](#initial-decisions)
- [Discussion Timeline](#discussion-timeline)
  - [Round 1 - Exploration](#round-1---exploration)
- Synthesis & Conclusions (pending)

---

## Current Understanding

### What We Established

1. **fabric 已有分布式的功能清单（无中心化"测试用例文档"）**：README + CHANGELOG（1.8.0 列 ~30 项原子特性）+ docs/CODEBASE_LANDSCAPE.md（文件级表）+ docs/SPEC_INTERNAL.md（协议 spec）+ docs/ARCHITECTURE_DECISIONS.md（ADR 不变量）+ packages/shared/src/schemas/*（11 个 zod 数据契约）+ doctor check 列表（每个 check 名即一条验证场景）。
2. **测试本身就是活文档**：61 测试文件、439 个 it/describe/test、命名高度描述性（BDD-leaning）。`tool-contracts.test.ts` 用 zod-to-json-schema 做 golden snapshot —— 契约即测试模式已落地。
3. **包级测试密度严重不均**：shared ~89 it() 高、server ~210 it() 高、cli ~140 it()（其中 11 个 init-* 文件极重）、**dashboard ~8 it() 极稀疏**（4 views + 8 组件，仅 3 个测试文件）。
4. **业界共识**：AI 测试生成代理用"最小种子"（≤1 页：feature surface + 不变量 + tricky cases）效果最好；"先写完整模块测试用例文档再喂给 cycle"是反模式（双重维护、Gherkin step 爆炸、文档脱队）。

### What Was Clarified

- 用户原始假设"先输出每个模块测试用例 → 喂给 integration-test-cycle"在证据下被弱化：fabric 已有足够文档原料，再写一层独立的测试用例 markdown 是冗余、易过期、且不是 AI agent 最爱的输入形态。
- 真正的 gap 不是"缺测试用例文档"，而是 **(a) dashboard 测试稀疏**；**(b) 没有把分布式文档汇成 cycle 可消费的种子**；**(c) "功能模块"口径未冻结**（package vs 命令/视图/服务 vs 单 it()）。

### Key Insights

- **种子（seed）≠ 规范（spec）**。种子是 ≤1 页/包的薄层（feature surface + invariants + known-tricky），存在感低、改动少。规范是几十页 Gherkin —— 在内部 monorepo 里几乎一定会过期。
- **"functional point 全面性"应分层达成**：types/zod schema 保 shape；golden snapshot 保契约；`it()` 描述性命名保意图；coverage 阈值堵窟窿；fast-check 保不变量。这五者已有四种在用，缺的是后者。
- **Dashboard 是当前最显著、最务实的下一步**，不需要先做用例文档化也能动手补。

---

## Analysis Context

**Focus Areas** (用户选择):
1. 测试用例产物形态
2. 覆盖度与全面性方法
3. 与 integration-test-cycle 的衔接
4. 成本与维护性权衡

**Perspectives**: Technical + Architectural + Domain Expert（合并综合）

**Depth**: Standard

## Initial Questions

(见原始版本，所有问题均已在 Round 1 中得到答案或转化)

## Initial Decisions

> **Decision**: 选择 decision + implementation + concept 三维度（决策 + 落地 + 方法论并重）
> - **Impact**: Round 1 同时使用代码探索 + 外部研究

> **Decision**: 三视角并行 → 改为合并综合（depth=Standard 下避免冗余）
> - **Reason**: Layer 1 + research 已饱和，再启动 3 个 perspective agent 会重复分析
> - **Trade-off**: 牺牲少量视角独立性，换取更快进入用户交互

---

## Discussion Timeline

### Round 1 - Exploration (2026-05-08T03:30:00Z)

#### Key Findings

> **Finding**: fabric 已经存在 6+ 种"分布式功能清单"，不需要从零写"测试用例文档"
> - **Confidence**: High — 证据：README、CHANGELOG (1.8.0 ~30 项)、docs/CODEBASE_LANDSCAPE.md、docs/SPEC_INTERNAL.md、docs/ARCHITECTURE_DECISIONS.md、packages/shared/src/schemas/* (11 zod)、doctor check 名称
> - **Hypothesis Impact**: Refutes "需要先输出独立测试用例文档"
> - **Scope**: 全 monorepo

> **Finding**: 测试已 BDD-leaning，本身即活文档
> - **Confidence**: High — 439 个 it() 调用，命名高度描述性（如 "throws RuleValidationError with fab doctor --fix hint on broken frontmatter"）
> - **Hypothesis Impact**: Refutes "测试代码不可读，需要外部用例描述"
> - **Scope**: cli/server/shared

> **Finding**: 已有 golden-snapshot 契约测试 + knip 零基线 + lint-protected-tokens —— 防止"形状/死代码"漂移的护栏已建
> - **Confidence**: High — 证据：packages/server/__tests__/tool-contracts.test.ts、knip.config.ts、lint-protected-tokens.test.ts
> - **Scope**: server + shared

> **Finding**: Dashboard 是最显著的覆盖缺口
> - **Confidence**: High — 4 views + 8 组件 → 仅 3 测试文件 / ~8 it() 调用；package.json 甚至没有 test 脚本
> - **Hypothesis Impact**: Refines 用户问题 —— 真正的 actionable gap 不是"用例文档化"，而是 dashboard 测试补齐
> - **Scope**: packages/dashboard

> **Finding**: AI 测试生成代理在"无种子"模式下系统性遗漏 business-rule 边界情况和跨模块意图
> - **Confidence**: High — 来源：Codoid 实证、O'Reilly Osmani、arxiv 2409.05808
> - **Hypothesis Impact**: Modifies "直接跑 cycle 即可" —— cycle 仍需薄种子作为意图输入
> - **Scope**: 决策层

#### Technical Solutions

> **Solution**: 用"≤1 页/包的种子文档"替代"模块化测试用例文档"
> - **Status**: Proposed
> - **Problem**: 用户想保证全面性 + 给 cycle 提供输入；但完整模块用例文档维护成本极高
> - **Rationale**: 种子捕捉**意图**，意图变化频率远低于实现；与 cycle 的最佳输入形态吻合（来自外部研究 HIGH 置信）
> - **结构**：(1) Feature surface — bullet 列表（CLI 用 `--help` 自动生成快照；server 列 endpoints/services；shared 列 exports；dashboard 列 routes/components）；(2) Invariants — 5-10 条必须成立的命题（如 "doctor 仅在所有 check 通过时退出 0"、"init 未带 --force 不会覆盖"）；(3) Known-tricky cases — 3-5 个最近 commit 暴露的边界（如 init_context_missing action_hint、doctor i18n）
> - **Alternatives**: ❌ 完整 Gherkin specs（高仪式低产出，BDD 已被业界判定走偏）；❌ 跳过种子直接跑 cycle（漏 business-rule 边界）；✅ 种子 + cycle（hybrid，empirically 最优）
> - **Evidence**: docs/CODEBASE_LANDSCAPE.md:1, packages/shared/src/schemas/api-contracts.ts, README.md（已有材料可直接抽取，写作成本低）
> - **Next Action**: 与用户确认是否接受"种子方案"代替"完整模块用例方案"

> **Solution**: Dashboard 包专项补测（独立于 cycle 启动前）
> - **Status**: Proposed
> - **Problem**: 4 views + 8 组件却只有 3 测试文件；package.json 没有 test 脚本
> - **Rationale**: 这是当前 fabric 最大、最具体的覆盖缺口；不需要任何用例文档就能动手；可作为 cycle 的"练手对象"
> - **Alternatives**: 等所有种子写完再补 / 用 cycle 直接生成（dashboard 测试形态特殊：组件渲染 + DOM 断言 + SSE mock，cycle 不一定胜任）
> - **Evidence**: packages/dashboard/package.json（无 test script）, packages/dashboard/src/views/*（4 views 无对应 test）

> **Solution**: 引入 fast-check（property-based）补 shared 层不变量
> - **Status**: Proposed
> - **Problem**: 用户目标是"全面验证功能正确性"；枚举测试天然有边界遗漏
> - **Rationale**: shared 层多为纯函数（zod parse、atomic-write、detector、payload-guard），property-based 一条测试可覆盖数千输入；与已有 golden-snapshot 互补
> - **Evidence**: packages/shared/src/schemas/*（高度纯函数）, packages/shared/test/errors.test.ts（27 it()，可补不变量）

> **Solution**: 冻结"功能模块"口径
> - **Status**: Proposed
> - **Problem**: 当前可指 4 个 package、~30 个命令/视图/服务、439 个 it() 单测
> - **Rationale**: 投入用例工作前必须先确定粒度，否则同一段工作做两次
> - **建议**: 用**中层（命令/视图/服务级）**作为"功能模块"主单位 —— 与现有 docs/CODEBASE_LANDSCAPE.md 表的粒度一致，且测试文件多按此粒度组织

#### Multi-Perspective Synthesis

**Convergent themes**（三视角一致）：
- 不要做完整模块测试用例 markdown
- fabric 已有大量可复用的"功能清单原料"
- Dashboard 缺口最大
- AI cycle 需要薄种子作为意图输入

**Conflicting views**（视角分歧）：
- *Technical* 视角倾向"先给 cycle 跑一轮看产出再决定补什么"
- *Domain Expert* 视角倾向"先写不变量种子再跑 cycle"
- *Architectural* 视角倾向"先解决 dashboard 测试稀疏（最大架构债）"

→ 综合：**三者并行不矛盾**：先写极薄种子（数小时）→ 同时启 dashboard 补测（独立轨道）→ cycle 覆盖剩余 cli/server。

**Unique contributions**：
- *Technical*: 复用 `--help` 快照、zod schema、CHANGELOG 作为种子来源（成本最低）
- *Architectural*: 不同 package 用不同测试形态（CLI=spawn-and-assert, server=contract+integration, shared=unit+property-based, dashboard=component+route）
- *Domain Expert*: 引入 fast-check 处理 shared 不变量；避免 BDD/Gherkin 仪式

**External research integration**：
- 已确认"AI agent 用最小种子最优"（O'Reilly Osmani，HIGH）
- 已确认"完整 spec 双重维护必死"（QualityKiosk，HIGH）
- 已确认"vitest projects 是 monorepo 标准模式"（HIGH）
- **codebase_gaps**：fabric 没有 `vitest projects` 统一配置（每包独立 vitest.config.ts），未来若引入 cycle 多包并跑会更顺

#### Analysis Results

完整模块测试用例文档**不应**先做。改用"种子 + cycle + dashboard 补测 + property-based shared"四线并行。

#### Confidence Score (Baseline)

| Dimension | Findings Depth (0.30) | Evidence Strength (0.25) | Coverage Breadth (0.20) | User Validation (0.15) | Consistency (0.10) | Score |
|-----------|---|---|---|---|---|-------|
| decision | 0.85 | 0.90 | 0.85 | 0.00 | 0.95 | **0.74** |
| implementation | 0.80 | 0.85 | 0.85 | 0.00 | 0.90 | **0.70** |
| concept | 0.85 | 0.90 | 0.80 | 0.00 | 0.90 | **0.72** |

**Overall**: 0.72 | **Weakest**: implementation (0.70) | 用户尚未验证

> 60-80% 区间：可选深入或收敛。建议进入 Phase 3 与用户确认决策方向 → user_validation 一旦上升即可收敛。

#### Intent Coverage Check

| # | Intent | Status | Where |
|---|--------|--------|-------|
| 1 | 测试用例产物形态 | ✅ | Solution #1（种子三段式） |
| 2 | 覆盖度与全面性方法 | ✅ | Solution #1+#3+多视角综合（5 层组合） |
| 3 | 与 integration-test-cycle 的衔接 | ✅ | Round 1（薄种子作为输入；cycle 是消费者非源头） |
| 4 | 成本与维护性权衡 | ✅ | Round 1 patterns + research（双重维护反模式 vs 种子薄层） |

#### Narrative Synthesis

**起点**: 用户的初始假设是"完整模块测试用例文档先于 cycle"。
**关键进展**: Layer 1 探索揭示 fabric 已有充分的分布式功能清单（CHANGELOG、CODEBASE_LANDSCAPE、SPEC_INTERNAL、ADR、zod schema、doctor checks），且测试已 BDD-leaning（439 个描述性 it() 调用）。外部研究 HIGH 置信地指出"完整模块用例 → AI cycle"是双重维护反模式；最优是"≤1 页种子"。
**决策影响**: 原方案被弱化但意图被保留 —— 用更轻量的种子代替完整文档。同时浮现真正 actionable 的 gap：dashboard 测试稀疏。
**当前理解**: fabric 不缺"可读的功能描述"，缺的是 **(a) 把分布式描述抽成 cycle 可消费的薄种子；(b) dashboard 包专项补测；(c) 冻结"功能模块"口径**。
**遗留问题**: 用户是否接受"种子代替完整文档"的方向调整？是否同意把 dashboard 补测作为优先并行轨道？是否要冻结中层粒度作为模块单位？

### Round 2 - Convergence + Pressure Pass (2026-05-08T03:35:00Z)

#### User Input
> 用户选择 "接受方向，进入总结" — 同意"薄种子 + dashboard 补测 + property-based shared"路线。

#### Pressure Pass (mandatory)

**Target finding**: "fabric 已存在 6+ 种分布式功能清单，无需中心化测试用例文档"（最高置信发现）

1. **Evidence demand** — 列举的 6 种来源（README、CHANGELOG、CODEBASE_LANDSCAPE、SPEC_INTERNAL、ADR、zod schemas、doctor check 名）是否真覆盖所有"功能点"？
   - 反例：dashboard 4 views 在哪份文档里有清单？答：CODEBASE_LANDSCAPE 提到包结构，但 view-level user journey 没人写过。
   - 反例：CLI 4 命令的 flag 组合矩阵在哪？答：README 列出主要 flag，但 `--scope project|user × --force × --reapply` 的组合语义只在测试中。
   - **结论**: 分布式来源覆盖**约 80%**功能点，但 **(a) view-level 用户旅程；(b) flag 组合矩阵语义；(c) 错误路径意图** 三类有缝隙。这正是种子文档要补的。

2. **Assumption probe** — 假设"分布式 = 充分"，潜在问题：分布式来源对**人类**够用，但对 **AI cycle 作为单点输入**不够 —— agent 没法同时读 6 个文件并合成意图。
   - **修正**: 这恰恰强化了"种子"方案的必要性 —— 种子是分布式来源的**精炼汇编**，不是替代品。

3. **Boundary/tradeoff** — 接受"分布式即可"则排除：(a) 法规审计场景（无单一可签字文档）；(b) 新人入职"一文了解全貌"。但 fabric 当前是内部工具+OSS、无审计需求 → tradeoff 可接受。

4. **Root cause check** — dashboard 稀疏是"症状"还是"根因"？
   - 根因实为 **package.json 没有 test 脚本** → CI 不强制 → 写测试无激励。
   - 修复 dashboard 测试**之前**应先在 dashboard/package.json 加 `"test": "vitest run"` 并接入 CI。
   - **新增 actionable**: "dashboard 测试基础设施补齐"作为前置步骤。

> **Pressure Pass Outcome**: Finding 被**修正而非推翻** — 分布式来源仍有效，但需种子作为汇编层；同时浮现 dashboard 根因（缺 test 脚本）。

#### Corrected Assumptions

> ~~"分布式功能清单足够，cycle 可直接消费"~~ → "分布式来源覆盖 ~80% 功能点，但需薄种子作为汇编层；尤其缺 view-level 旅程、flag 组合矩阵、错误路径意图"

> ~~"dashboard 稀疏是优先补测目标"~~ → "dashboard 稀疏的根因是 package.json 缺 test 脚本 + CI 未拦截，应先补基础设施再补测试"

#### Confidence Score (Round 2)

| Dimension | Score | Δ |
|-----------|-------|---|
| decision | 0.84 | +0.10 |
| implementation | 0.82 | +0.12 |
| concept | 0.80 | +0.08 |

**Overall**: 0.82 (was 0.72) | **User validation**: ✅ 接受方向 → 三维度 user_validation 因子从 0.0 升至 0.7+

#### Readiness Gate

- [x] All 4 user intents covered
- [x] No dimension below 40% confidence (lowest 80%)
- [x] Pressure pass executed
- [x] No unresolved technical solution ambiguities (4 solutions all accepted in direction)

**Gate**: ✅ Pass → Phase 4

---

## Synthesis & Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| 1 | 测试用例产物形态 | ✅ Addressed | Round 1 Solution #1, Rec #1 | 三段式薄种子（feature surface + invariants + tricky） |
| 2 | 覆盖度与全面性方法 | 🔀 Transformed | Round 1 综合, Rec #1+#3+#5 | 原: 单一文档枚举 → 终: 五层组合（types / golden snapshot / BDD it() / coverage / property-based） |
| 3 | 与 integration-test-cycle 的衔接 | ✅ Addressed | Round 1, Rec #2 | 薄种子作为 cycle 输入；dashboard 由 cycle 优先消化 |
| 4 | 成本与维护性权衡 | ✅ Addressed | Round 1+2, Rec #4+#6 | 种子 ≤1 页/包；refresh 仅在 intent 变更；--help 快照做 CI drift gate |
| 5 (new) | "功能模块"口径冻结 | ✅ Addressed | Round 1, Rec #7 | 中层（命令/视图/服务）作为模块单位 |
| 6 (new, from R2) | dashboard 测试基础设施 | ✅ Addressed | Round 2 root cause, Rec #2a | 先补 test 脚本 + CI 接入再补测试 |

### Findings Coverage Matrix

| Finding | Disposition |
|---------|-------------|
| fabric 已有 6+ 种分布式功能清单 | recommendation #1 (作为种子来源) |
| 测试已 BDD-leaning (439 it()) | informational (现状基线) |
| Golden snapshot 契约测试已有 | informational (基线) + recommendation #5 (扩展到 dashboard route) |
| Dashboard 是最大缺口 | recommendation #2 (补测) + #2a (基础设施) |
| AI cycle 无种子会漏 business-rule 边界 | recommendation #1 (种子) + #2 (cycle 消费) |
| vitest projects 是 monorepo 标准（缺失） | recommendation #6 |
| --help 快照可作 CI drift gate | recommendation #4 |
| flag 组合矩阵 / view-level 旅程 / 错误路径意图 在分布式来源中缺失 | recommendation #1 (种子专门补这三类) |

### Executive Summary

**结论一句话**：**不要写完整模块测试用例文档。改用"≤1 页/包薄种子 + 修复 dashboard 测试基础设施 + 引入 fast-check + 用 integration-test-cycle 收尾"。**

fabric 不是缺测试或缺文档，而是缺一份能让 AI cycle "一眼看完意图"的薄种子，以及缺补 dashboard 这块明确的覆盖洼地。完整模块用例化在该规模/受众下被业界判定为反模式。

### Key Conclusions

1. **fabric 已具备充分测试与文档原料**（HIGH 置信）—— 6+ 种分布式来源覆盖 ~80% 功能点；剩 20%（view-level 旅程、flag 组合矩阵、错误路径意图）由薄种子专门补。
2. **薄种子 > 完整文档**（HIGH 置信，外部研究 + 代码现状一致）—— ≤1 页/包，三段式（feature surface + invariants + tricky cases）。
3. **Dashboard 是当前最大、最具体的覆盖缺口**（HIGH 置信）—— 但根因是基础设施缺失，先加 test 脚本 + CI 再补测试。
4. **integration-test-cycle 应在种子完成 + dashboard 基础设施修复后启动**，否则会复刻 happy-path 偏差。

### Recommendations

> **Recommendation #1 — 写薄种子（priority: HIGH）**
> - **Action**: 创建 `docs/test-seed/<package>.md` 4 份，每份 ≤1 页，三段式（feature surface / invariants / known-tricky cases）。来源直接抽取自 README + CHANGELOG + CODEBASE_LANDSCAPE + zod schemas + doctor check 列表。
> - **Rationale**: 给 AI cycle 一个单点意图入口；专门补"分布式来源覆盖不到的 20%"（flag 组合、view 旅程、错误路径）。
> - **Evidence**: docs/CODEBASE_LANDSCAPE.md（已有原料）, packages/shared/src/schemas/api-contracts.ts（已有契约）, README.md（已有命令清单）
> - **Steps**:
>   1. cli 种子 — 4 命令 + flag 组合（最关键 init `--scope × --force × --reapply`）+ doctor check 失败语义
>   2. server 种子 — 12 endpoints + 14 services + 2 MCP tools 不变量
>   3. shared 种子 — 11 zod schema round-trip 不变量 + FabricError 5 子树语义
>   4. dashboard 种子 — 4 views user journey + SSE/REST 错误路径
> - **Verification**: 每份种子由维护者 review；CI 加 lint 强制 ≤200 行

> **Recommendation #2a — Dashboard 测试基础设施（priority: HIGH，blocks #2）**
> - **Action**: 在 `packages/dashboard/package.json` 加 `"scripts": { "test": "vitest run" }`；新建 `packages/dashboard/vitest.config.ts`（jsdom env + Preact 适配）；接入根 `pnpm -r test`；补测试到 CI 必跑列表
> - **Rationale**: 当前 dashboard 测试稀疏的**根因**，不是测试懒得写而是没基础设施
> - **Evidence**: packages/dashboard/package.json（无 test script，pnpm -r --if-present test 直接跳过）
> - **Verification**: `pnpm --filter @fenglimg/fabric-dashboard test` 能跑通且 CI 强制

> **Recommendation #2 — Dashboard 补测（priority: HIGH，after #2a）**
> - **Action**: 4 views 各加 1 个渲染冒烟测试 + 1 个 happy-path 交互测试；SSE 客户端 mock；coverage 阈值起步 50%
> - **Rationale**: 4 views + 8 组件 vs 仅 3 测试文件 / 8 it() —— 当前最大覆盖洼地
> - **Evidence**: packages/dashboard/src/views/*（4 views）, packages/dashboard/src/components/*（8 组件）

> **Recommendation #3 — 引入 fast-check 到 shared（priority: MEDIUM）**
> - **Action**: 加入 `@fast-check/vitest`，对 zod schema parse round-trip / atomic-write 幂等 / mcp-payload-guard 边界做 property-based
> - **Rationale**: 用户原意"全面验证"用 property-based 的代价远低于枚举；shared 多为纯函数适配
> - **Evidence**: packages/shared/test/errors.test.ts (27 it()), packages/shared/test/atomic-write.test.ts

> **Recommendation #4 — CLI --help 快照作为 drift gate（priority: MEDIUM）**
> - **Action**: 加 `__tests__/cli-surface.test.ts`（如已有 init-cli-surface 可扩展）—— 跑 `fab --help` / `fab init --help` 等捕获并 toMatchSnapshot；种子 feature surface 需匹配
> - **Rationale**: 防止"种子文档与 CLI 实际命令不一致"静默漂移；零维护开销
> - **Evidence**: packages/cli/__tests__/init-cli-surface.test.ts（已有先例）

> **Recommendation #5 — 启动 integration-test-cycle（priority: MEDIUM，after #1+#2a+#2）**
> - **Action**: 用薄种子作为 prompt input，启 `Skill(workflow:integration-test-cycle)`，目标重点 cli + server 跨模块路径（init → serve → MCP tool 调用 → ledger 写入）
> - **Rationale**: 现在才是 cycle 的最佳时机 —— 种子提供意图、dashboard 已有基础设施、shared 已有 property-based 兜底
> - **Verification**: cycle 反思阶段对照种子 invariants 是否全部命中

> **Recommendation #6 — 引入 vitest projects 统一配置（priority: LOW）**
> - **Action**: 根 `vitest.config.ts` 用 `projects: [...]` 引用各 package；保留 per-package config 但通过统一 runner 跑
> - **Rationale**: 支持 cycle 跨包跑测试 + 统一 coverage 报告；社区标准
> - **Evidence**: 当前各包独立配置 → cycle 多包并行不便

> **Recommendation #7 — 冻结"功能模块"口径（priority: HIGH，启动 #1 前）**
> - **Action**: 在种子文档头部明确声明：模块 = 中层（CLI 命令 / Dashboard view / Server service+endpoint+tool / Shared export 子路径）
> - **Rationale**: 避免在用例工作中口径漂移；与现有 docs/CODEBASE_LANDSCAPE.md 表的粒度一致
> - **Verification**: 4 份种子中"feature surface"的颗粒度一致

### Open Questions

- 是否要做 dashboard 测试的具体技术选型（@testing-library/preact vs preact/test-utils）？— 留给 Recommendation #2a 实施时决定
- vitest projects 配置的迁移成本是否值得现在投入？— 留给 #6 实施时评估

### Follow-Up Suggestions

下一动作建议链：
1. `lite-plan` 起步 Recommendation #7（冻结口径）+ #1（写种子）+ #2a（dashboard 基础设施）
2. 完成后启动 #2（dashboard 补测）+ #3（fast-check）+ #4（--help 快照）—— 可并行
3. 最后启动 #5（integration-test-cycle）+ #6（vitest projects）

---

## Decision Trail

| Decision | Round | Reason | Impact |
|----------|-------|--------|--------|
| 三维度并重（decision+implementation+concept）| Phase 1 | 用户问题是决策 + 落地 + 方法论交织 | Phase 2 双轨：代码探索 + 外部研究 |
| 跳过多视角并行 deep-dive，合并综合 | Phase 2 | Layer 1 + research 已饱和 | 节省 ~3 个 agent 调用，提速进入用户交互 |
| 推翻"完整模块测试用例文档"假设 | Round 1 | 6+ 种分布式来源已存在 + 测试已 BDD-leaning + 业界共识反对 | 转向"薄种子"路线 |
| 浮现 dashboard 测试基础设施根因 | Round 2 Pressure Pass | 根因分析：缺 test 脚本而非"懒得写" | 拆出 Rec #2a 作为 #2 前置 |
| 冻结模块口径=中层（命令/视图/服务） | Round 1 + Rec #7 | 与现有文档粒度一致 + 测试组织已按此粒度 | 给后续种子写作提供单位 |

## Session Statistics

- **Rounds**: 2 (1 exploration + 1 convergence)
- **Key findings**: 6
- **Dimensions**: decision, implementation, concept
- **Decisions in trail**: 5
- **Final confidence**: 0.82 overall
- **Quality signals**: pressure_pass_done=true; challenge modes used: Devil's Advocate (implicitly via Pressure Pass step 3); root_cause_probe via Pressure Pass step 4; readiness_gate_passed=true
- **Recommendations**: 7 (3 HIGH / 3 MEDIUM / 1 LOW)
- **Files scanned**: 48
- **External sources**: 12+


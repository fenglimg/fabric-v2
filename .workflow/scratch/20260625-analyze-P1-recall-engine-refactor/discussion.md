# Analyze: Phase 1 — 召回引擎重构与统一

**Session**: ANL-recall-engine-refactor-2026-06-25
**Scope**: phase (Phase 1 of milestone M-recall-align-20260625)
**Upstream**: grill:GRL-20260625-knowledge-recall-align (14 locked decisions)
**Dimensions**: implementation, decision, risk, comparison (focus: 实现方案 + 风险)
**Perspectives**: architectural (cli-explore-agent) + technical/feasibility (codex delegate)
**Depth**: standard

## Table of Contents
- [User Intent](#user-intent)
- [Current Understanding](#current-understanding)
- [Round 1: Exploration](#round-1-exploration)

## User Intent

把 Phase 1 的 5 波(W1 score透出+瘦item / W2 截断次序+磁盘缓存 / W3 RRF融合 / W4 CJK语义默认开 / W5 fab_pending统一)的**实现方案钉死**,尤其降 W3(RRF 重构,唯一 High 风险)的风险。具体要回答:
1. RRF 怎么接进 scoreDescriptionItem,结构信号(maturity/recency/locality)如何与排名融合共存?
2. 无 query 的 broad 探针路径如何保持行为不变?
3. 行为保持测试怎么设计(现有 1433 行 plan-context.test 锁的是顺序)?
4. W5 把 pending search 接入 planContext 又不丢 triage 完整性,pending 草稿缺字段怎么降级?
5. W1 透出 score 改 schema 的向后兼容?

## Current Understanding

5 波的实现路径已由双视角(架构+技术)收敛钉死,且校验出 grill 的两处偏差:① W2"截断按位置误杀"是高估——`trimToPayloadBudget` 按尾裁(相关度正确),W2 缩水为瘦item+磁盘缓存;② W3 不能 naive RRF——只融合 BM25/vector content 通道,结构信号保持原加法,no-query 走旧路径。W3 = Conditional Go(78),前提是先补 shadow-ranker/snapshot 测试 + zero-match 不进 ranker + content scale 主导。唯一 High 风险集中在 W3 与 W5,均有明确护栏。

## Round 1: Exploration

**Sources**: cli-explore-agent(改造面 file:line 锚点 + 12 个测试文件)+ codex delegate(独立实现风险,78/100)。

**Key findings (with anchors)**:
- W3 fusion 现状 additive(plan-context.ts:1094-1144);RRF 只接 content,结构信号保持(L1051-1080 常量)。
- W1 score-drop 在 plan-context.ts:466(survivingScored.map(e=>e.item));改 recallOutputSchema(api-contracts.ts:497/514)加 optional score+breakdown。
- W2 校正:trimToPayloadBudget 尾裁(mcp-payload-guard.ts:99)→ 截断已相关度正确 → 重排次序近 no-op。
- W4 真阻塞=fastembed 可选包不在 deps(vector-retrieval.ts:40),模型已默认 CJK(config-loader.ts:99)。
- W5 抽纯 rankDescriptionItems(items,ctx,mode);pending corpus 不在 planContext(plan-context.ts:352)需扩 + 重套 lifecycle 过滤。

**Decision (locked, evidence-backed)**:
> **Solution**: RRF 仅融合 BM25/vector,finalScore = RRF_content + structuralBoost(原常量)
> - **Status**: Validated(两源收敛)
> - **Problem**: 裸加法量纲不齐(BM25 uncalibrated ~2-4 unbounded ×50 vs cosine [-1,1] ×30)
> - **Rationale**: RRF 解 content 通道 scale mismatch;结构信号是已校准离散 boost 不该塞进 RRF
> - **Alternatives**: z-score(No-Go,小语料不稳)/ min-max(fallback)/ naive RRF-all(破结构校准)
> - **Evidence**: plan-context.ts:1094-1144 + delegate verdict + plan-context.test.ts:1089/1203 不变量
> - **Next Action**: shadow-ranker 测试锁 no-query diff=空

#### 压力测试 (Pressure Pass)
- **最高置信发现**: "RRF 仅融合 content 通道"。
- **证据需求**: 现有不变量测试(maturity 只 tie-break test:1089/1107、content 压 locality test:1203)→ 若 RRF 把结构信号一起 rank,这些不变量会破 → 故必须分层。✓ 站得住。
- **假设探测**: "no-query 路径不变"是否真安全? plan-context.ts:391 BM25 仅 queryTerms>0 构建,L452 floor query-gated → no-query 本就不碰 content fusion,旧 additive structural 原样跑。✓ 站得住。
- **边界**: zero-match 文档若进 RRF ranker 会得尾名次正分 → 破 floor。护栏:bm25Raw>0/vectorRaw>0 才进 ranker。✓ delegate 已识别。
- **结论**: 顶发现经压力测试成立,护栏明确。

#### Baseline Confidence (Step 4.6)
| Dimension | findings_depth(.30) | evidence(.25) | coverage(.20) | user_valid(.15) | consistency(.10) | Score |
|-----------|---|---|---|---|---|---|
| implementation | 5 | 5 | 4 | 2 | 5 | **84%** |
| risk | 5 | 5 | 4 | 2 | 5 | **84%** |
| decision | 4 | 5 | 4 | 2 | 5 | **80%** |
| comparison | 4 | 4 | 5 | 3 | 5 | **82%** |

Overall ~82.5% — 超 80% 收敛阈值。user_validation 低(尚未确认 rollout 取舍),由 Round 2 一次用户决策补足。

### Round 1: Narrative Synthesis
**起点**: phase-1 5 波实现方案 + W3 降风险。
**关键进展**: 双源收敛 RRF-content-only;校验推翻 grill 的 W2 截断误杀(尾裁本已正确),W2 缩水。
**决策影响**: 维持方向,W3 设护栏,W2 降级。
**当前理解**: 实现路径全锚定,唯一 High 风险 W3/W5 有护栏。
**遗留问题**: W3 rollout 取舍(flag 门控 vs 直接切)需用户拍 —— Round 2。

## Round 2: 用户决策

**5.3 反馈**: 用户拍两个价值÷成本取舍。

> **Decision**: W3 RRF flag 门控,验证后翻默认
> - **Context**: RRF 是唯一 High 风险,动核心打分
> - **Chosen**: 加 config `fusion: additive|rrf`,默认 additive;shadow-ranker 测试**用真实 team 知识库**跑绿后翻 rrf 默认
> - **Reason**: 便宜保险 + 零风险回滚;用户明确真实语料可用作 oracle(强于合成 fixture)
> - **Evidence**: user input + delegate Conditional Go(78)
> - **Impact**: W3 拆成"实现(flag off)"+"翻默认(验证后)"两步,降落地风险

> **Decision**: W4 fastembed 进 optionalDependencies + 默认开 + 懒加载/降级
> - **Context**: 用户问 maestro 做法 + 倾向默认加入
> - **Options**: 保持纯可选 / 硬声明 regular dep(maestro 做法)/ optionalDependencies(综合)
> - **Chosen**: optionalDependencies —— npm 默认尝试装(开箱即用,满足用户倾向),装不上则 server 仍成功 + 文本降级(跨平台稳)
> - **Reason**: 比 maestro 裸 regular dep 更稳(onnxruntime native 平台相关);比纯可选更进(默认装);契合 lean+跨平台
> - **Evidence**: maestro package.json:58(硬声明)+ embedding.ts:242(动态 import 降级);Fabric vector-retrieval.ts:40(已懒加载)
> - **Impact**: W4 = optionalDependencies + 翻 embed_enabled 默认 + 复用现有降级

**5.8 Confidence re-score**: implementation 84→88, risk 84→87, decision 80→90(user_validation 补足), comparison 82→85。Overall ~82.5%→~87.5%(+5%)。user_validation 由 2 升至 5。

### Round 2: Narrative Synthesis
**起点**: 两个 rollout 取舍待用户拍。
**关键进展**: W3 落地拆两步降险;W4 用 optionalDependencies 综合"默认装+跨平台稳",优于 maestro 裸 dep。
**决策影响**: user_validation 补足,整体置信度 +5% 至 ~87.5%,可进 synthesis。
**当前理解**: 5 波实现方案 + 风险护栏 + rollout 策略全锚定。
**遗留问题**: 无阻塞性;进 6 维打分。

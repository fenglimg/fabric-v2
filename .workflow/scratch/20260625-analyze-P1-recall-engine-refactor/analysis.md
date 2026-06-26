# Analysis: Phase 1 — 召回引擎重构与统一

**Session**: ANL-recall-engine-refactor-2026-06-25 | **Scope**: phase (M-recall-align-20260625 / P1)
**Recommendation**: **CONDITIONAL GO** | **Overall confidence**: ~87.5%

## Executive Summary

5 波实现方案经双视角(cli-explore-agent 架构面 + codex delegate 技术风险)收敛锚定。唯一 High 风险 W3(RRF 重构)定为 **Conditional Go**,护栏明确:RRF 仅融合 BM25/vector content 通道、结构信号保持原加法、no-query 走旧路径、zero-match 不进 ranker、content scale 主导、flag 门控 + 真实 team 知识库 shadow-ranker 测试后翻默认。analyze 还校验推翻 grill 的 W2"截断按位置误杀"判断(尾裁本已相关度正确),W2 缩水。

## 6-Dimension Scoring

| Dimension | Score | Confidence | Evidence |
|-----------|-------|-----------|----------|
| **Feasibility** | 4/5 | 88% | 改造面全锚定 file:line(plan-context.ts:1094/466/444-466/804、recall.ts:161、review.ts:1376、config-loader.ts:99/113);现有 ~5000 行测试作行为保持 harness |
| **Impact** | 4/5 | 85% | 解决可观测性(score 透出)+ 排序质量(RRF 量纲对齐)+ CJK 语义 + 冷启动 + 双 search 去重;直接对齐用户痛点 |
| **Risk** | 3/5 | 87% | W3 动核心打分(High),W5 改 triage(High);均有护栏 + flag 门控 + shadow 测试。次要:vector cosine [-1,1] 注释错、schema strip、pending 缺字段 |
| **Complexity** | 3/5 | 85% | W2 BM25 闭包不可序列化(磁盘缓存需抽内部 stats);W5 需扩 planContext corpus 走 pending + 重套 lifecycle 过滤 |
| **Dependencies** | 4/5 | 86% | fastembed(optionalDependencies);computeReadSetRevision 作缓存 key 已存在;无新外部服务 |
| **Alternatives** | N/A | — | 融合:RRF(选)/ min-max(fallback)/ z-score(No-Go);W5:纯 ranker(选)/ 复用 planContext(否决,丢 triage 完整性)/ 保留 substring(否决,drift) |

## Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| RRF 给 zero-match 正分破 floor + triage 噪声 | High | High | bm25Raw>0/vectorRaw>0 才进 ranker;RRF normalize 后加 structural boost |
| no-query broad-probe 行为变化 | Medium | High | queryTerms.length===0 走旧 additive 原路径;snapshot 锁死 diff=空 |
| content/locality 校准被破坏 | Medium | High | content scale > LOCALITY(100)+SALIENCE(15)+RECENCY(25);保留 test:1203/1089 |
| W5 复用 planContext 丢 pending 或被 top_k/floor 截断 | High | High | 抽纯 rankDescriptionItems(mode);triage mode 全匹配无 floor |
| pending draft 缺字段 ranking crash/错降权 | Medium | Medium | adapter 默认 draft/[]/filename;缺 created_at 不加 recency |
| score 字段被 Zod schema strip | Medium | Medium | 更新 recallOutputSchema + round-trip parse 测试(body_in_context 先例) |
| BM25 闭包不可序列化阻塞磁盘缓存 | Medium | Medium | 抽内部 stats(perDoc/df/avgFieldLength)序列化 + rehydrate scoreDoc |
| fastembed native 装不上炸 server | Low | Medium | optionalDependencies(装不上 server 仍成功)+ 文本降级 |

## Go/No-Go

- **CONDITIONAL GO** 整体(~87.5%)。
- **W3 RRF**: Conditional Go(delegate 78)——条件:仅融合 content、no-query 旧路径、纯 ranker、shadow/snapshot 测试先行、zero-match 排除、content scale 主导、flag 门控真实语料验证后翻默认。
- **z-score**: No-Go。
- **W2 截断重排**: 降级近 no-op(尾裁本已相关度正确);保留瘦 item + 磁盘缓存。

## Boundary Grill Results
无新边界冲突(范围边界已在上游 grill GRL-...-knowledge-recall-align 锁定:fab_review/propose/archive_scan OUT;daemon/代码索引 defer)。

## Intent Coverage Matrix

| # | Original Intent | Status | Where |
|---|----------------|--------|-------|
| 1 | RRF 怎么接、结构信号如何共存 | ✅ Addressed | Round 1 决策 + 风险表(content-only 分层) |
| 2 | no-query 路径如何保持不变 | ✅ Addressed | 压力测试 + 决策(queryTerms===0 旧路径) |
| 3 | 行为保持测试怎么设计 | ✅ Addressed | shadow-ranker + snapshot(真实 team KB) |
| 4 | W5 pending 统一不丢完整性 + 缺字段降级 | ✅ Addressed | 纯 ranker mode + pending adapter 默认 |
| 5 | W1 透出 score schema 向后兼容 | ✅ Addressed | optional 字段 + recallOutputSchema 更新 |
| 6 | (校验)W2 截断是否真有误杀 | 🔀 Transformed | 原判"误杀"→ 实为尾裁正确,W2 降级 |

## Confidence Summary
- Baseline ~82.5% → post-user ~87.5%(+5%,user_validation 2→5)。
- Pressure pass: "RRF 仅融合 content" 经证据需求/假设探测/边界三级,成立。
- Residual risks: RRF 实测排序漂移(由真实语料 shadow 测试 + flag 门控兜底)。

# Context: Phase 1 — 召回引擎重构与统一

**Date**: 2026-06-25
**Areas discussed**: RRF 融合策略 / no-query 保持 / 行为保持测试 / W5 triage 统一 / score 透出 schema / W4 嵌入依赖 / W2 截断校验

## Decisions

### Decision 1: RRF 仅融合 content 通道
- **Context**: 裸加法量纲不齐(BM25 ×50 unbounded vs cosine [-1,1] ×30)
- **Chosen**: finalScore = RRF(bm25,vector) + structuralBoost(maturity/recency/locality 原常量);结构信号不进 RRF
- **Reason**: RRF 解 content scale mismatch;结构信号是已校准离散 boost

### Decision 2: W3 flag 门控,真实语料验证后翻默认
- **Chosen**: config `fusion: additive|rrf` 默认 additive;shadow-ranker 测试用真实 team 知识库跑绿后翻 rrf
- **Reason**: 唯一 High 风险,零风险回滚;用户确认真实语料可用作 oracle

### Decision 3: W4 fastembed → optionalDependencies
- **Options**: 纯可选 / 硬声明(maestro)/ optionalDependencies
- **Chosen**: optionalDependencies + embed 默认开 + 懒加载降级
- **Reason**: 默认装(开箱即用)+ 装不上 server 不崩(跨平台稳),优于 maestro 裸 regular dep

### Decision 4: W5 抽纯 ranker,非复用 planContext
- **Chosen**: rankDescriptionItems(items,ctx,mode);recall=top_k+floor,triage=全匹配无floor
- **Reason**: 直接复用 planContext 会丢 pending corpus + 被 top_k/floor 截断,伤 triage 完整性

### Decision 5: W2 截断重排降级
- **Context**: grill 原判"byte-trim 按位置误杀相关"
- **Chosen**: 取消"重排截断次序";保留瘦 item + BM25 磁盘缓存
- **Reason**: trimToPayloadBudget 尾裁(mcp-payload-guard.ts:99)已相关度正确,重排近 no-op

## Constraints

### Locked
- RRF 仅融合 BM25/vector content 通道,结构信号(maturity/recency/locality)保持原常量加法
- no-query(queryTerms.length===0)走旧 additive structural 路径,行为不变(snapshot diff 必须空)
- zero/negative match(bm25Raw<=0 或 vectorRaw<=0)不进 RRF ranker
- content scale 必须 > LOCALITY_SAME_FILE(100)+SALIENCE_PROVEN(15)+RECENCY_BOOST(25)
- W3 RRF flag 门控(默认 additive),shadow-ranker 测试用真实 team 知识库,跑绿后翻 rrf 默认
- W1 score+score_breakdown 为 optional 字段,必须同步更新 recallOutputSchema(防 Zod strip)+ round-trip 测试
- W5 抽纯 rankDescriptionItems(mode);triage mode 无 top_k 无 floor,保匹配完整性;先 substring filter 再 rank all matches
- W5 删除 review.ts searchEntries 子串实现
- pending adapter 缺字段降级:maturity??draft / relevance_paths??[] / summary??title??filename / 缺 created_at 不加 recency
- fastembed 进 optionalDependencies;embed_enabled 默认开;缺包文本降级 + 一次性提示
- z-score 不作为融合方案(No-Go);min-max 仅 fallback
- 保 lean read_path:score/breakdown 只加数字与小对象,不包装 body

### Free
- RRF 的 k 值起点(建议 k=10,用真实 team KB shadow 测试反推校准)
- content scale 归一后的乘数系数(经验值,以保住 test:1203 不变量为约束)
- BM25 磁盘缓存的存储格式(序列化 perDoc/df/avgFieldLength)
- 缺 fastembed 提示文案与频次

### Deferred
- 常驻 daemon(触发:W2 磁盘缓存落地后实测 hook 仍瓶颈;须 per-repo+per-session 隔离)
- 代码符号索引/KG(YAGNI;便宜版退路=knowledge 增 relevance_symbols)
- BM25 磁盘缓存增量失效(先整体 revision-hash 失效)
- fab_pending 独立语义/嵌入排序(triage BM25 够用)

## Code Context
- 融合: plan-context.ts:1094-1144(scoreDescriptionItem) · 常量 L1051-1080 · BM25_WEIGHT=50 L1069
- score-drop: plan-context.ts:466 · recall.ts:161-171 · schema api-contracts.ts:497/514
- 截断: plan-context.ts:444-466 + 543-588 · trimToPayloadBudget mcp-payload-guard.ts:99(尾裁)
- BM25 缓存: plan-context.ts:804-824 · 内部 stats bm25.ts:82-125 · key computeReadSetRevision cross-store-recall.ts:450
- 嵌入: vector-retrieval.ts:40(可选包)/120/151(cosine) · config-loader.ts:99(CJK 默认模型)/113(embed_enabled)
- W5: review.ts:1376-1504(searchEntries)/1359(maturity 默认)/386(lifecycle) · plan-context.ts:352(corpus canonical-only)
- 测试: plan-context.test.ts(1433,含 :852/:1006/:1089/:1107/:1161/:1203) · plan-context-scope-rank.test.ts:120 · review.test.ts(1991) · pending.test.ts(280) · recall.test.ts:394

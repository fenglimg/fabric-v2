# 决策包 — 同空间 hybrid retrieval 调研 → Fabric 吸收

> session 20260529-hybrid-retrieval-absorption · mode② 五门全绿 · 2026-05-30
> 双冷评 PASS: gemini Fabric 侧 100% grounded / codex 产品源端 89%(7 CONFIRMED + 2 PARTIAL + **0 REFUTED**)
> 证据数据集见 hybrid-retrieval-phase1-scan.md;本文件是决策结论

## 中心问题 grounded verdict

> 同空间 memory/KB 产品几乎一致选 BM25+vector+RRF hybrid,而上一轮因"maestro 选纯 lexical"reject 了向量(A-INFRA-6)+图(A-INFRA-5)。本轮以 ≥4 产品 file:line 重评:

### ① Hybrid RRF — CONDITIONAL ABSORB
- **证据**: 真 RRF k=60 公式 `1/(60+rank)` 在 ≥6 产品落地(codex CONFIRMED): valence retrieval.py:37/221-277 · OpenAkashic retrieval.py:150-193(:186 公式) · persistor search.go:260-273 · lokb store.rs:1390 · llm_wiki search.rs:285-288 · GitNexus hybrid-search.ts。**不是营销词**。
- **关键适配**: 8 产品里 5 个 RRF 是 SQL-native(postgres/pgvector),Fabric 无 DB。**仅 lokb 是 in-process file-based** —— 证明文件形态 RRF 可行。Fabric 须照 lokb 走**内存累加**,不能照搬 SQL CTE。
- **最小可行**: BM25(已 absorb A-INFRA-1)+ locality 做 in-memory RRF = 零新依赖的 hybrid 雏形。

### ② 向量 A-INFRA-6 — reject → CONDITIONAL ABSORB(**推翻上轮**)
- **推翻理由**: lokb(最对标 Fabric 的 local-first CLI)用 fastembed ONNX e5-small(384d,~120MB)做向量,**大幅削弱**上一轮"离线零依赖+CLI 形态不容向量栈"的反对。TS 等价物 fastembed-js v2.1.0 + onnxruntime-node 存在。
- **codex 诚实校正**(纳入): lokb 源码确认默认 e5-small(lib.rs:15)+"首次下载"(lib.rs:13)+本地 TextEmbedding(:27-28),但**未显式 pin offline/cache-only 也未强制 CPU** —— 离线/纯 CPU 是 fastembed/ONNX **缺省行为推断**,非 lokb 源码硬证。**Fabric 落地须自行 pin cache-only + CPU provider**。
- **条件**: 可选依赖(`--no-embed` flag 默认跳过,仿 lokb scale-gate store.rs:287)+ text-only fallback(C7)兜底 + scale 分级(小库可用,>1M defer LanceDB)。
- **成本**: npm +150-180MB,ARM/Alpine native 编译风险,冷启 +10-50ms(MCP 长连摊薄)。

### ③ 重图 A-INFRA-5 — reject **确认**
- **证据**(≥4 产品无主图检索): lokb lokb-graph/src/lib.rs **纯 1 行 stub**(codex CONFIRMED) · GitNexus 图仅 Sigma 可视化无 traverse API · valence 无 multi-hop · llm_wiki graph-search.ts 仅可视化。
- **纠偏**: 轻量 1-hop link expansion **是真实模式**(OpenAkashic _expand_related_claims:238-242/479-533 默认开启,codex CONFIRMED;persistor neighbors)—— 但作为 RRF 后的二级 re-rank 层,非主检索,且依赖 Fabric 尚未建的 relevance graph(W2-5)。**重图 reject,1-hop expansion defer 到 W2-5**。

### 反向信号处理(memory 选 hybrid vs maestro 选 lexical)
maestro 是 **workflow 编排器**(临时任务上下文,任务名 lexical 匹配够用);8 个产品是**持久知识库**(跨改写的语义召回是刚需)。**Fabric 是持久知识库(同 8 产品,非 maestro)** —— 故同空间信号权重 >> maestro,重开 A-INFRA-6 方向正确。但 8 产品 hybrid 全 SQL-backed(都有 DB),Fabric 文件形态决定:**零依赖的 salience+endorsement 先行,向量是可选第二步**。

## 吸收优先级(按 ROI / 依赖成本)

| Tier | 候选 | verdict | pain | 成本 | 落点 |
|---|---|---|---|---|---|
| **1** | C3 salience 公式 | absorb | ① | 零(maturity/lifecycle)~中(access_count) | scoreDescriptionItem +maturity/lifecycle 权重即得 20-30% |
| **1** | C4 endorsement scoring | conditional-absorb | ① | 零(maturity)~中(cite count) | maturity→review_status 映射 + cite-rollup 供 confirm/dispute |
| **1** | C5 token budget | absorb | ② | 零(纯 TS) | noosphere ContextBudgetManager 移植注入层 |
| **1** | C6 top_k 截断 | absorb | ② | 零(一行) | candidates(:262)加 .sort().slice(0,N) |
| **2** | C1 hybrid RRF(in-memory) | conditional-absorb | ① | 低(BM25+locality)~中(加向量) | 内存累加 1/(60+rank) |
| **2** | C2 向量层(fastembed-js) | conditional-absorb | ① | 高(+180MB,native) | 可选依赖, pin cache-only+CPU |
| **2** | C7 text-only fallback | conditional-absorb | ① | 低 | C2 的离线前提, 同接口透明降级 |
| **—** | C8 重图 A-INFRA-5 | **reject** | — | — | 1-hop expansion defer W2-5 |

**核心结论**: 痛①的**大头由零依赖的 Tier1(salience+endorsement)拿下**,完全不碰向量/离线冲突;向量(Tier2)是锦上添花的可选第二步,且 A-INFRA-6 从 reject 转为 **conditional absorb**(诚实:离线性强但需 Fabric 自 pin)。痛②由 top_k + token budget 双层解。

## Fabric 锚点(gemini 100% grounded 坐实)
- scoreDescriptionItem(plan-context.ts:619)真仅 recency+locality 无内容相关性 ✓
- candidates(:262 dedupeDescriptionIndex 后)真无 top_k 截断 ✓
- maturity enum(draft/verified/proven)+ impact 字段真存在(agents-meta.ts:68 ruleDescriptionSchema)→ Tier1 零成本 ✓
- cite-rollup.ts(日聚合)+ event-ledger.ts(append-only)真存在;per-rule access/confirm/dispute **未聚合** → Tier2 需 instrumentation 是 HIGH cost(诚实)✓

## 实施分期(本 session 只产决策, 实施另起)
- **Phase A(即刻, 零依赖)**: C3 maturity/lifecycle 权重 + C6 top_k + C5 token budget → scoreDescriptionItem 从 2 信号升 4-5 信号 + payload 治理。
- **Phase B(中成本)**: C4 cite-rollup expose citeStats + C3 access_count 聚合(pre-aggregated rollup, 禁热路径扫 ledger — gemini 建议)。
- **Phase C(可选, 高成本)**: C1 in-memory RRF + C2 fastembed-js 可选向量 + C7 fallback。
- **defer**: C8 1-hop expansion 待 W2-5 relevance graph。

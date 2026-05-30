# Phase 1 速扫数据集 — 8 同空间产品检索 infra (file 级证据)

> session 20260529-hybrid-retrieval-absorption · 真源 status.json · 本文件为 Phase1 证据数据集
> 严禁信 README 营销词, 全部 file:line 核实

## 打分矩阵

| Repo | Cat | 痛①注入质量 | 痛②payload | A-INFRA-6向量 | A-INFRA-5图 | RRF真假 |
|---|---|---|---|---|---|---|
| deepwiki-open | A | 3 | 2 | 3 | 1 | ❌无RRF, 纯FAISS向量 |
| GitNexus | A/B | 3 | 4 | 4 | 1 | ✅真RRF, 图仅可视化 |
| llm_wiki | A | 3 | 4 | 3 | 1 | ✅真RRF k=60(测试覆盖) |
| valence | B | 4 | 3 | 4 | 2 | ✅真RRF k=60 SQL原生 |
| noosphere | B | 2 | 4 | 3 | 2 | ❌无RRF, FTS only, token预算最佳 |
| OpenAkashic | B | 4 | 5 | 2 | 1 | ✅真RRF k=60+endorsement |
| persistor | B | 4 | 3 | 3 | 2 | ✅真RRF k=60+salience+fallback |
| lokb | B | 2 | 1 | 4 | 0 | ✅真RRF k=60+离线e5+CLI |

**Phase2 top-4**: lokb · valence · OpenAkashic · persistor

## file:line 证据要点

### S1 deepwiki-open (Cat-A, 纯向量)
- 检索: `api/rag.py:41` import FAISSRetriever; `:385-390` init; `:427` retriever(query)
- embedding: `api/tools/embedder.py` + `api/config/embedder.json` — OpenAI text-embedding-3-small(256d)/Gemini/Bedrock/Ollama nomic-embed-text
- BM25/RRF/图: **全无**。纯向量 FAISS, top_k=20 硬写 (`embedder.json:38`)
- 洞察: 纯向量有天花板(长尾/罕见词/API名失效), 缺 BM25 互补

### S2 GitNexus (Cat-A→B, 图仅可视化)
- 图构建: Tree-Sitter AST → 12-phase DAG (`gitnexus/src/core/ingestion/pipeline-phases/`), 存 KuzuDB
- **图不用于检索**: `gitnexus-web/src/lib/graph-adapter.ts` 仅 Sigma.js 布局; 图容器(`core/graph/types.ts`)无 getNeighbors/traverse API
- 检索绕过图: `core/search/hybrid-search.ts` 真 RRF 融合 BM25(FTS)+semantic(向量, HuggingFace ONNX); 向量不可用降级 exact-scan
- augmentation(`core/augmentation/engine.ts`): BM25 找符号 → Cypher 查 1-hop callers/callees (硬编码, 非图遍历API)

### S3 llm_wiki (Cat-A, Tauri 个人知识库)
- 混合检索: `src-tauri/src/commands/search.rs` keyword+vector RRF
- 向量: LanceDB per-chunk (`vectorstore.rs:8-20` v2 table), 任意 OpenAI-compat endpoint, auto-halve retry
- **真 RRF**: `search.rs:285-288` `1.0/(RRF_K+rank)`, RRF_K=60; 测试 `:1031-1048` 验证 1/61+1/61≈0.0328
- CJK tokenization 真支持(2-gram+unigram); top_k default 20/max 50, vector 阶段 top_k*3 聚合
- 图: wikilink 图仅可视化(`graph-search.ts` 词匹配), 检索零使用

### S4 valence (Cat-B 顶级, epistemic substrate)
- hybrid: `src/valence/core/retrieval.py`(724行) SQL 双轨 vector(KNN)+text(tsv), **真 RRF** `1/(k+rank_vec)+1/(k+rank_text)` k=60 (`:250-280` SQL)
- 多信号融合: RRF→min-max normalize→similarity(0.50)+confidence(0.35)+freshness(0.15) final_score (`:665-710`)
- embedding: BAAI/bge-small-en-v1.5(384d)/OpenAI(1536d), lazy 首次 retrieval 触发, federation strip/regen
- **provenance**: `core/provenance.py` article_sources 4 关系(originates/confirms/supersedes/contradicts/contends) + claim trace (对标 cite contract, 更细但无 contract operator)
- **contention**: `core/contention.py`(605行) LLM-driven + heuristic fallback, degraded flag
- MCP: 34 tools; knowledge_search hardlimit `min(limit,200)` default 10
- degraded flag: LLM 不可用→heuristic→degraded=True (Fabric 无此机制)

### S5 noosphere (Cat-B, recall 编排 + token 预算)
- recall: `src/lib/memory/orchestrator.ts`(608行) fanOut→rank→dedup→conflict→budget→inject
- **token-bounded injection(痛②最佳)**: `src/lib/memory/budget.ts`(272行) ContextBudgetManager — maxResults(20)+maxTokens(2000) 双 cap, summary fallback, 按序保留, 详细 dropped/trimmed 统计, verbosity(minimal/standard/detailed)
- 排序: computeBaseCompositeScore(relevance 0.4+confidence 0.25+recency 0.2+curation 0.15)
- **无向量/BM25/RRF**: PostgreSQL FTS tsvector only; 向量+rerank 都 "planned" 无代码
- dedup: `dedup.ts` canonicalRef 分组 + provenance 保留; conflict 5 策略; promotion ephemeral→managed→curated

### S6 OpenAkashic (Cat-B, RRF 最完整)
- 三路并联: `api/app/retrieval.py` lexical(FTS ts_rank_cd 0.55+pg_trgm 0.35+ILIKE 0.25)+semantic(pgvector)+RRF
- **真 RRF**: `:185` `1/(k+rank_lex)+1/(k+rank_sem)` k=60 可配; 三模式(embedding_only/lexical_only/fts+pgvector+rrf)
- embedding: bge-m3(1024d) via Ollama, insert/update 同步 embed, NULL→backfill cron, L2-normalized
- **endorsement scoring(痛①)**: mention_boost(3层 0.35/0.25/sim*0.20)+confirm_count(LEAST(c,12)*0.015)+dispute(-0.035)+review_status(confirmed+0.14/disputed-0.18/superseded-0.42)+role(core+0.10)
- **one-shot packing(对标 fab_recall)**: query_memory(`:203`) 单次 embed+并联检索+RRF+expansion+dedup+mentions+evidences+projection, 无额外往返
- top_k 贯穿三路, **痛②=5 fully solved**
- 图: claim_links 表(related/supports/conflicts/supersedes)存在但**检索未用**(_expand_related_claims 不走 link_type)

### S7 persistor (Cat-B, salience 公式对标痛①)
- **salience(痛①核心)**: `internal/store/salience.go:12-19` `GREATEST(0.1, 1.0 + log2(access+1)*0.3 + recency_180d*0.5 + boosted?2.0 + superseded?-0.5)`
- vs Fabric scoreDescriptionItem(仅 recency+locality): persistor 加 access frequency + explicit boost + supersession, 缺 locality(靠 RRF 补)
- **真 RRF**: `internal/store/search.go:185-215` `1/(60+row_num)` FULL OUTER JOIN, final=combined*0.85+salience/100*0.15
- 向量: pgvector + Ollama qwen3-embedding:0.6b, embedding text 有 prioritized keys(`models/node_embedding_text.go:11-24`)
- **text-only fallback(对 Fabric 离线关键)**: `internal/api/search.go:92-110` hybrid 失败自动降级 fulltext, 用户透明
- top_k: limit 贯穿三层 default 10/20

### S8 lokb (Cat-B, 最对标 Fabric CLI 形态)
- pipeline: RAW→OPTIMIZED→DERIVED 多索引并行
- BM25: `lokb-search/src/fts.rs`(246行) Tantivy, TopDocs.with_limit(limit*3)→隐私+源过滤
- **向量离线(A-INFRA-6 关键证据)**: `lokb-embed/src/lib.rs` fastembed ONNX multilingual-e5-small(384d,~120MB), **纯 CPU 本地离线, 零大型依赖**(仅 fastembed v5, 无 transformers/python)
- **真 RRF**: `lokb-cli/src/store.rs:1339-1445` `1/(60+rank)` FTS+Vector 各计分求和, k=60 硬编码
- vector 存储: vectors.json(线性膨胀, 注释标 "future LanceDB IVF-PQ"), 暴力 cosine O(n), ~100K chunks 前可用
- ingest gate: `store.rs:287` 50K+ docs 自动跳 embedding
- **KG 纯 stub**: `lokb-graph/src/lib.rs` 2行 placeholder, ADR-009 未落地
- MCP: JSON-RPC stdio (`lokb-serve/src/mcp.rs`), tools search/read/entity/substring, 冷启 5-30s
- 痛②=1(SearchInput 无 top_k override, default 20 硬编码)

## 横向 grounded 结论 (Phase1 已可断言)

1. **A-INFRA-5 图检索 reject 确认**: 8 产品**无一**真把图用于检索 —— lokb stub(0)/GitNexus 仅可视化(1)/OpenAkashic links 不用(1)/llm_wiki 图不入检索(1)/deepwiki 无图(1)/valence provenance 无 multi-hop(2)/noosphere 不用图(2)/persistor 图遍历独立于检索(2)。≥4 file:line 证据。
2. **真 RRF k=60 是行业事实标准**: ≥6 产品落地真公式 `1/(60+rank)`, 非营销词。
3. **A-INFRA-6 向量主要反对理由(离线零依赖)被 lokb 击破**: fastembed ONNX e5-small 384d 纯 CPU 本地离线, 零大型依赖, CLI 形态可跑。但需分级(小库可用, >1M defer)。
4. **痛①最佳进化路径**: persistor salience 公式(纯数值, 零依赖) + OpenAkashic endorsement scoring, 都不依赖向量即可大幅升级 scoreDescriptionItem。
5. **痛②最佳方案**: noosphere ContextBudgetManager(token 双 cap+summary fallback+按序保留) + OpenAkashic top_k 贯穿。

# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| 召回 (recall) | 把已存知识在合适时机喷给 AI 客户端的全过程 | services/recall.ts:81 | locked |
| planContext | Fabric 唯一统一排序管道，所有出口最终汇此 | plan-context.ts:298 | locked |
| 加法融合 (additive fusion) | Fabric 现状缺陷：BM25×50 + 向量×w + 各信号直接相加，量纲不统一 | plan-context.ts:1094-1144 | locked |
| RRF (Reciprocal Rank Fusion) | 拟采纳：按排名而非分数融合多源，量纲无关 score=w/(k+rank+1) | embedding.ts:121-124 (maestro) | locked |
| 召回出口 (recall surface) | 知识喷出的三个时机：fab_recall / SessionStart broad / PreToolUse narrow | hooks + tools/recall.ts:26 | locked |
| 三轴 scope | semantic_scope ⊥ relevance_scope ⊥ store，正交过滤决定是否浮现 | KT-MOD-0001 | locked |
| lean 召回 | 只给 description+read_path，正文按需读一次，不每轮重灌；对齐时必守不可退回 | KT-GLD-0005 | locked |
| 相对地板 (ratio-to-top floor) | 现状唯一相关度闸：score≥maxScore×ratio，且仅 hasQuery 时生效 | plan-context.ts:447-465 | locked |
| 绝对分数地板 | 拟新增可选 config 旋钮：score<阈值不召回，补 broad 路径的分数闸缺口 | (proposed) | locked |
| score 透出 | 拟新增：entries[] 暴露内部已算的 score(+信号分解)，补可观测性 | recall.ts:49-56 (缺) | locked |
| 选择性对齐 (selective alignment) | 本次定调：对齐 maestro 知识检索半套，拒代码图谱半套，daemon 降级 | grill D1 | locked |
| 知识检索半套 | maestro 召回中域内可移植部分：Wiki BM25F + 嵌入 + RRF + 多语言模型 | maestro embedding.ts/search.ts | locked |
| 代码图谱半套 | maestro 召回中 Fabric 域外部分：code_fts + KG callers/callees + 源权重 | maestro kg/query/*.ts | locked |
| 常驻热进程 vs 冷启动 hook | fab_recall 在持久 MCP server(embedder 可热) vs 两 hook 每次冷 spawn CLI | tools/recall.ts vs knowledge-hint-*.cjs | locked |
| CJK 嵌入钩子 | Fabric 已有 embed_model 配置项(支持 fast-bge-small-zh)，默认 OFF | vector-retrieval.ts:42-65 | locked |
| 多窗口并发约束 | 用户常多客户端窗口并发改同一 repo，使共享 daemon 有 session 串味风险 | user_multiwindow_concurrent_dev | locked |
| revision hash 缓存 key | computeReadSetRevision 内容指纹，可作 BM25/store-walk 磁盘缓存失效 key | cross-store-recall.ts:450 | locked |

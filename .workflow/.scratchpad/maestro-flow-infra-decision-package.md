# maestro-flow 基础设施层 → Fabric 吸收决策包

> session `20260529-maestro-flow-infra` · mode ② 审计 · 2026-05-29
> 所有 maestro 源码 file:line 以 `/Users/wepie/Desktop/personal-projects/maestro-flow` 为准;Fabric 以 `pcf/packages/server` 为准。

## 0. 两侧基础设施核实矩阵(file:line 实证)

| infra 子系统 | maestro 有无 + file:line | Fabric 现状 + file:line |
|---|---|---|
| **B1 内容相关性打分** | ✅ 真 BM25-lite。idf=ln(1+(N−df+0.5)/(df+0.5)),k1=1.5/b=0.75,字段加权 3×title/2×tags。`dashboard/src/server/wiki/search.ts:7-8,91-99,134-163`;另一套无打分 keyword 倒排 `src/tools/spec-keyword-index.ts:35-89` | ❌ 仅 recency(+100/7d 内)+locality(path: same-file 100/same-dir 50/same-pkg 25),**零内容相关性**。`packages/server/src/services/plan-context.ts:619-649` |
| **B2 索引构建/持久化** | ✅ `WikiIndexer` cache+single-flight 懒重建 `wiki-indexer.ts:64-121`;`invalidate()` 全量 null 非增量 `:123-127`;`persistIndex` 剥 body 写轻量 `.workflow/wiki-index.json` `:527-552` | ~ `agents.meta.json` 派生索引(已存在,非本轮瓶颈) |
| **B3 payload top_k/截断** | ✅ 全链路:`searchBM25 limit=50 .slice(0,limit)` `search.ts:137,162`;注入 `MAX_ENTRIES_PER_INJECTION=5 .slice(0,5)` `keyword-spec-injector.ts:58,142`;summary `slice(0,240)`;决策 ctx `MAX_CONTEXT_CHARS=4000` `graph-walker.ts:466,471-473` | ❌ `candidates=dedupe(...)` `plan-context.ts:262`→`.sort()` `:458`**无 `.slice(0,k)`**,返全候选;`recall.ts:56` 映射全 candidateIds,无 top_k |
| **B4 CJK tokenization** | ✅ `search.ts:37-89` CJK_RUN+2-3gram+混排+查询/文档**同 tokenizer**;`spec-keyword-index.ts:76-83` 2-4gram;`keyword-spec-injector.ts:205-224` 2-4gram+CJK_STOP_WORDS | ❌ recall/plan-context 无任何 CJK 分词 |
| **B5 图遍历检索** | ~ `graph-walker.ts` = **workflow 编排状态机**(command/decision/fork/join,与 KB 检索无关,OUT);真 KB 图 `graph-analysis.ts:42-150` 仅做**治理/健康度**(buildGraph/detectHubs topN=10/detectOrphans/computeHealth)。**`query()/search()` 检索路径不做图遍历扩展**(`wiki-indexer.ts:129-181` 仅 filter+BM25,backlinks 只喂 health) | ❌ 有 `related:[[id]]` 但无图遍历;**maestro 自己也不把图用于检索** |
| **B6 向量/语义层** | ❌ 全仓 grep `embedding\|cosineSimilarity\|text-embedding\|vector` **零行** | ❌ 全仓 grep 同样**零行** |

**关键甄别(B5)**:本轮最重要的诚实结论——"图遍历检索"作为**检索机制在 maestro 中也不存在**。maestro 的图设施是 governance(孤儿/枢纽/健康分),不是 retrieval-time N-hop 扩展。Fabric 已有 doctor lint 覆盖同类治理,故 B5 无可吸收的检索设施。

## 1. 吸收候选(candidate schema 全字段)

### A-INFRA-1 · BM25 内容相关性打分 【absorb=YES · P1 · pain=injection-quality】
- **source**: B1 `search.ts:134-163` + `:91-99`(字段加权)
- **mechanism**: 对 (title+summary+keywords) 建内存倒排索引,BM25 打分(idf×tf 饱和),与现有 recency+locality 线性合并。
- **feasibility**: HIGH。纯函数 ~160 行零依赖;Fabric `description_index` 已含 title/summary/keywords 可直接作语料;语料规模小(几十~几百条)内存倒排足够,recall 时按需建+缓存(可借 B2 single-flight 模式作载体)。no-server-filter 松绑后不再被一票否决。
- **effect**: 改 `plan-context.ts:619 scoreDescriptionItem` 增内容相关性项 → `compareDescriptionIndexItems:590` 排序让"标题/正文命中查询/edit-context"的条目浮顶。当前 query "auth jwt refresh" 无法把标题含 JWT 的条目排到无关 recent 条目之上;吸收后可以。是 A-INFRA-3 top_k 安全的前提(先排好序才能安全砍尾)。
- **moat_conflict**: no-server-filter(松绑,非阻断)——BM25 是**排序非过滤**,仍返全候选只是改顺序,即便严解也兼容(LLM 仍见全部)。MCP-first/cite-contract 无冲突。
- **verdict**: absorb-yes · **priority P1**

### A-INFRA-2 · CJK n-gram tokenization 【absorb=YES · P1 · pain=injection-quality】
- **source**: B4 `search.ts:37-89`(2-3gram,查询/文档同 tokenizer)
- **mechanism**: 2-3字 n-gram 切分 CJK run + 混排 CJK/Latin,查询与文档用同一 tokenizer 使 n-gram 在倒排索引相交。
- **feasibility**: HIGH ~40 行。**是 A-INFRA-1 在中文语料生效的前提**——Fabric KB 全中文,无 CJK 分词则 BM25 在中文上完全失效("注入选择"无法匹配"选择质量")。与 A-INFRA-1 是一个单元一起落。
- **effect**: 为 A-INFRA-1 的倒排索引提供分词器;不单独改某文件,是 A-INFRA-1 的子组件。
- **moat_conflict**: 无。
- **verdict**: absorb-yes(与 A-INFRA-1 绑定)· **priority P1**

### A-INFRA-3 · top_k + score cutoff payload 上限 【absorb=YES · P0 · pain=mcp-payload-scale】
- **source**: B3 `search.ts:137,162` + `keyword-spec-injector.ts:58,142`
- **mechanism**: 排序后 `.slice(0, MAX_CANDIDATES)` 兜底上限(非语义过滤,只在候选数大时生效砍最低相关性尾部)。
- **feasibility**: HIGH(代码),但**必须排在 A-INFRA-1 之后**:无 BM25 排序的 top_k 会任意砍掉相关条目(危险);有 BM25 排序的 top_k 砍的是最低相关性尾(安全)。
- **effect**: `plan-context.ts:458` sort 后加 `.slice(0, MAX_CANDIDATES)`,`recall.ts` 同。直接为 MCP payload 设上界——KB 从 50→500 条时 payload 不再无界膨胀。**直击痛点②**。
- **moat_conflict**: no-server-filter(松绑→"非必须可重评")。诚实标注张力:top_k 是 server 侧截断,但作为**有界上限**(非语义筛选)且依赖 A-INFRA-1 排序才安全 → 故 sequencing = A-INFRA-1 先行。
- **verdict**: absorb-yes · **priority P0(直击痛点②,依赖 A-INFRA-1 保证安全)**

### A-INFRA-4 · 懒 single-flight 索引 + 缓存失效 【absorb=NO · 无 pain 对齐】
- **source**: B2 `wiki-indexer.ts:64-127,167-172`
- **mechanism**: cache+inflight single-flight,invalidate 全量 null 懒重建,searchCache 按需建。
- **feasibility**: MEDIUM(模式可行,但 Fabric 当前规模索引构建非瓶颈,属过早优化)。
- **effect**: 弱——不直接解两痛点之一。**唯一相关价值是作 A-INFRA-1 倒排索引的缓存载体**,届时随 A-INFRA-1 一并引入即可,不作独立候选。
- **moat_conflict**: 无。
- **verdict**: absorb-no(defer;诚实标"不为吸收而吸收",仅在 A-INFRA-1 落地时复用其缓存模式)

### A-INFRA-5 · 图遍历检索 【absorb=NO · maestro 自己也不用于检索】
- **source**: B5 `graph-analysis.ts:42-150` / `graph-walker.ts`(编排,OUT)
- **mechanism**: backlinks/forwardLinks/hubs/orphans——但仅治理/健康度,无 retrieval-time N-hop 扩展。
- **feasibility**: 检索用途 LOW value。
- **effect**: 投机——related[] 1-hop 扩展会**增大** payload(逆痛点②)且稀释相关性;maestro+Fabric 两侧均无检索时图扩展的实证。
- **moat_conflict**: 与痛点②冲突(扩展涨 payload);治理面 Fabric doctor lint 已覆盖。
- **verdict**: absorb-no(诚实:图设施是 governance 非 retrieval,无可吸收的检索机制)

### A-INFRA-6 · 向量/语义层 【absorb=NO · 两边都没有,跟随成熟产品的 lexical 选择】
- **source**: B6 两侧 grep 零行
- **mechanism**: 无(maestro+Fabric 均纯 lexical)。
- **feasibility**: 新建成本高——模型依赖+索引构建+API/本地模型运行时+维护;Fabric 几十~几百条规模 BM25+CJK 已够。
- **effect**: 对 BM25(A-INFRA-1)边际增益小、成本高。
- **moat_conflict**: MCP-first(embedding 需模型服务/捆绑模型,对 CLI 过重)+离线零依赖哲学。
- **verdict**: absorb-no/don't-build。同空间更成熟的 maestro **主动选了 lexical 而非 embedding**——强信号(遵循 same-space-products-over-articles)。仅当 KB 规模上千且 lexical recall 实测失效再复评。

## 2. 落地序列(若进 ① 实现 session)

```
P0/P1 单元(注入选择质量 + payload scale 一并解):
  1. A-INFRA-2 CJK tokenizer  (前提)
  2. A-INFRA-1 BM25 内容相关性打分 → 合并进 scoreDescriptionItem  (痛点①)
  3. A-INFRA-3 top_k 上限 → sort 后 .slice  (痛点②,依赖 1+2 排序安全)
  4. A-INFRA-4 缓存模式随 A-INFRA-1 倒排索引一并引入(非独立任务)
defer/不做: A-INFRA-5(图非检索)· A-INFRA-6(向量,跟随 lexical 选择)
```

## 3. 痛点对齐自检
- absorb=yes = {A-INFRA-1, A-INFRA-2, A-INFRA-3},全部带 pain_target ∈ {injection-quality ×2, mcp-payload-scale ×1} → G-PAIN-ALIGN 100%。
- absorb=no = {A-INFRA-4, A-INFRA-5, A-INFRA-6},均给三判定(feasibility/effect/moat_conflict)非空 + 诚实 rationale。

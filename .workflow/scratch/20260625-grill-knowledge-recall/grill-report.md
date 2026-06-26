# Grill Report: 知识召回路径对比与优化（Fabric vs maestro-flow）

**Session**: 20260625-grill-knowledge-recall
**Depth**: standard (5 branches)
**Date**: 2026-06-25
**Upstream**: none（接续本会话召回机制调查）

## Discovery Summary

### Project Context
Fabric（pcf）是跨客户端（Claude Code + Codex CLI）AI 知识层。召回 = 把存好的 team/project/personal knowledge 在合适时机喷给 AI。本次目标：摸清当前召回所有路径与实现，对比 maestro-flow 的召回架构，找可借鉴的优化点。

### Codebase Surface — Fabric 召回（事实底座）

**统一排序引擎**：`packages/server/src/services/plan-context.ts:298` `planContext()`

打分公式（`scoreDescriptionItem()` plan-context.ts:1094-1144，**加法线性组合**）：
```
score = BM25_WEIGHT(50) × bm25.scoreDoc(id, queryTerms)   // 4 字段 BM25F：title(boost3) tags(boost2) summary(boost1.5) body(boost1)
      + vectorWeight × vectorScores.get(id)                // 默认 OFF，需 embed_enabled + fastembed
      + salience(maturity)                                 // proven15 / verified8 / draft0
      + recency(+25 if created_at ≤ 7d)
      + locality(同文件+100 / 同目录+50 / 同包+25)
```
后处理：top_k 截断 → ratio-to-top 相关度地板（仅 query 存在时）→ payload 字节预算裁剪 → related 一跳图扩展。

**3 个召回出口**：
| 路径 | 入口 file:line | 触发 | 排序 | 输出 |
|------|---------------|------|------|------|
| fab_recall (MCP) | tools/recall.ts:26 → services/recall.ts:81 → plan-context.ts:298 | AI 改文件前调 | 完整加法打分 | entries[{rank,description,read_path,store,body_in_context}] + dropped[] |
| SessionStart broad | .codex/hooks/knowledge-hint-broad.cjs (~1395行) → CLI `fabric plan-context-hint --all` | 会话开始 | 无 query，breadth-first | always-active 正文 + reference 索引 + census |
| PreToolUse narrow | .codex/hooks/knowledge-hint-narrow.cjs (~1680行) → CLI `--paths p1,p2` | 编辑文件 | file context 为 query | narrow 条目 stderr 清单，top_k 默认5，dedup-window 默认5轮 |

**三轴 scope 过滤**（KT-MOD-0001）：semantic_scope（team/project/personal）⊥ relevance_scope（broad/narrow）⊥ store（物理库）。
**跨库**：cross-store-recall.ts:222 `buildCrossStoreRawItems()` 走 read-set 所有挂载 store。
**关键设计约束**：① 向量默认 OFF；② hook = 无状态 .cjs，每次冷启动 CLI（2s 超时）；③ 正文不灌只给 read_path（lean，KT-GLD-0005）；④ rc.37 retired 两步 selection_token+get_sections，单步 fab_recall + native Read。

### Codebase Surface — maestro-flow 召回（对照系）

**双索引**：Wiki BM25F（5 字段）+ KG FTS5（SQLite，code_fts/knowledge_fts 双表）。
**嵌入层**：`Xenova/multilingual-e5-small`（22M，多语言/CJK 友好），ONNX 后端，`.workflow/embedding-index.bin` 二进制，内容 hash 增量。
**常驻 daemon**：`src/search/daemon.ts` resident 进程，热 ONNX 模型 + WikiIndexer 在内存，30min 空闲关，TCP line-JSON 协议，首搜冷则后台 spawn。
**融合（关键差异）**：`embedding.ts:110 mergeHybrid()`——**RRF**（rank fusion，k=10，bm25Weight0.6/vectorWeight0.4）→ 分数归一化 → alpha 混合（0.4×RRF + 0.6×BM25norm）。对比 Fabric 的裸加法。
**动态源权重**：search.ts:682 isCodeIdentifier(query) 判定 → 代码0.6/wiki0.4 或反之。
**KG 上下文注入**：hooks/kg-context-injector.ts PreToolUse:Agent，调用图 1-hop callers/callees 注入 `<maestro-context>`。
**credibility 衰减**：spec 半衰期 60 天，credibility<0.5 告警（vs Fabric 的 maturity 离散三档）。

### 核心差异速览
| 维度 | Fabric | maestro-flow |
|------|--------|--------------|
| 融合方式 | 裸加法（BM25×50 + cos×w，量纲不齐） | RRF + 归一化 + alpha 混合（量纲无关） |
| 嵌入模型 | fastembed 默认 OFF | multilingual-e5-small 默认 ON |
| 进程模型 | 无状态 .cjs hook，冷启动 2s | 常驻 daemon，热模型 |
| 索引 | 单统一 description index | Wiki BM25F + KG FTS5 双索引 |
| 正文策略 | lean，只给 read_path | 直接返回 snippet |
| 排序信号 | +locality +recency +maturity | +credibility decay +动态源权重 |

### Upstream Material
N/A

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries | 🟢 Done | 痛点=全部+可观测性+返回契约 | 这次走多远 |
| 2 | Data Model & State (打分/融合) | 🟢 Done | RRF + score透出 + 绝对地板 + 扁平返回保 read_path | - |
| 3 | Edge Cases & Failure Modes (CJK/语义) | 🟢 Done | 中文嵌入默认开+预热(钩子已有) | - |
| 4 | Integration & Dependencies (进程模型) | 🟢 Done | 不上 daemon,热 MCP+磁盘缓存;不加代码索引 | 多窗口并发约束 |
| 5 | Scale & Performance (冷启动) | 🟢 Done | BM25/store-walk 落磁盘按 revision hash | daemon 留触发条件 |
| 6 | 返回结构与截断 (追加) | 🟢 Done | 瘦 item + 先相关度后字节 + MCP/CLI 统一形状 | 字节闸误杀根因 |
| 7 | fab 工具面普查与边界 (追加) | 🟢 Done | fab_pending=独立子串机器,统一接入 W5 | triage 完整性 ≠ 召回相关度 |

---

## Branch 1: Scope & Boundaries

**Status**: 🟢 Done

### Q1.1: Fabric 召回"不够好"的真实痛点是哪一类?

**Answer**: 用户选「全部」(排序/CJK/延迟/全面看),并主动追加三个更具体的痛点:
1. **返回结构"挺怪"** + MCP 返回别扭 — `entries[]` 契约本身体验差
2. **没有具体评分、不好观测** — 分数对调用方不可见
3. **怀疑只有大小限制、没有分数限制** — 只有 payload 字节预算在裁,没有绝对分数闸
4. 体验/性能"比 maestro 差好多"

**Evidence**(代码核实,KT-PIT-0022):
- **痛点②证实**: `RecallEntry` (recall.ts:49-56) 字段仅 `stable_id/rank/description/read_path/store/body_in_context`,**无 score**。但 score 内部算了 (plan-context.ts:431 `scoredSorted` 带 score,1094 `scoreDescriptionItem`),映射 entries 时 (recall.ts:161-171) 仅留 `rank` 序数 → score 被丢。
- **痛点③证实**: 唯一相关度闸是 ratio-to-top 相对地板 (plan-context.ts:447-465),`score ≥ maxScore×ratio` 且 `hasQuery` 门控。broad 路径 (无 query) 只剩 top_k (444) + payload 字节预算 (543-585)。无绝对分数线。
- **痛点①证实**: tools/recall.ts:97-108 注释记录 entries[] 曾撑爆 16KB warn,现拆 content.text glance + structuredContent 全量;嵌套 `description` 子对象 + envelope 层 directive/next_steps/warnings = "结构怪"来源。
- **性能归因**: fab_recall 跑常驻 MCP server (embedder 进程内缓存,vector-retrieval loadEmbedder once-per-process);两 hook 是冷启动 .cjs spawn `fabric plan-context-hint` (2s 超时)。冷启动税集中在 hook 路径。

**Decision**: locked — 范围 = 召回排序质量 + 可观测性 + 返回契约 + (可选)进程/嵌入。痛点全部成立,非错觉。
**Constraint**: MUST 把"暴露 score 与信号分解"作为可观测性基线;MUST 区分 fab_recall(常驻可热)与 hook(冷启动)两条性能路径,不可一刀切上 daemon。

### Q1.2: 是否应"全面对齐 maestro"?(用户中途反悔,倾向全面对齐)

**Answer**: 用户认为 maestro 设计好、有现成参考、创新风险小,"只是数据结构有差异"。Orchestrator 顶回:差异不止数据结构,是**进程架构 + 域**的根本不同。
**Evidence**:
- maestro 召回 = 知识检索半套(Wiki BM25F + 嵌入) **+ 代码图谱半套**(code_fts/KG callers-callees/code-identifier 源权重)。两半缝在一起(search.ts:682 动态源权重)。
- Fabric 只索引 knowledge markdown:bm25.ts / cross-store-recall.ts / vector-retrieval.ts,**无 code_fts、无 SQLite KG**(grep 确认)。代码图谱半套对 Fabric 是"为不存在的问题造机器"。
- maestro daemon 成立的前提是它是**单进程 CLI**;Fabric 召回寄生在客户端生命周期(MCP server + 无状态 .cjs hook),且用户**多窗口并发改同一 repo**(user_multiwindow_concurrent_dev) → 共享 daemon 有 session 串味风险。
**Decision**: locked — 目标从"全面对齐"修正为"**选择性对齐**":对齐知识检索半套,拒代码图谱半套,daemon 降级。
**Constraint**: MUST NOT cargo-cult maestro 的代码图谱机器;对齐限于知识检索域内可移植项。

---

## Branch 2: Data Model & State — 打分与融合

**Status**: 🟢 Done

### Q2.1: 裸加法融合 vs RRF?

**Answer**: 采纳 RRF + 分数归一化。
**Evidence**: plan-context.ts:1094 `scoreDescriptionItem` 是 `BM25_WEIGHT(50)×bm25 + vectorWeight×cos + salience + recency + locality` 直接相加;注释自承 BM25 是 "uncalibrated cross-query scale"(plan-context.ts:449)。把未归一的 BM25(可能 0.5 或 50)与 cos∈[0,1] 加权相加,量纲不齐。maestro embedding.ts:121 用 RRF(score=w/(k+rank+1))按排名融合,量纲无关。
**Decision**: locked
**Constraint**: SHOULD 用 RRF 或 min-max/z-score 归一化替代裸加法融合 BM25+向量;salience/recency/locality 作为归一化后的有界 boost,不再与未归一 BM25 同台相加。

### Q2.2: score 不透出 + 无绝对地板?

**Answer**: 透出 score(+信号分解);补可选绝对分数地板。
**Evidence**: RecallEntry(recall.ts:49-56) 无 score 字段,内部 score 在 plan-context.ts:431/1094 算了被丢。唯一闸是 ratio-to-top 相对地板(plan-context.ts:447-465,hasQuery 门控),broad 路径只有 top_k+payload 字节预算。
**Decision**: locked
**Constraint**: MUST 在 entries[] 暴露 `score`(并考虑 signal 分解 bm25/vector/locality/recency/salience);MAY 增可选绝对分数地板 config 旋钮(默认 0=保持现状,不破坏向后兼容)。

---

## Branch 3: Edge Cases & Failure Modes — CJK / 语义召回

**Status**: 🟢 Done

### Q3.1: 中文"换说法就召不回"该不该一等目标?

**Answer**: 是,一等目标,对齐 maestro。
**Evidence**: Fabric vector-retrieval.ts:42-65 **已留 embed_model 钩子**,注释明确支持 `fast-bge-small-zh-v1.5`,"the Chinese-heavy KB no longer embeds against fastembed's English default" —— CJK 嵌入支持已存在,默认 OFF。maestro 用 multilingual-e5-small 默认 ON。
**Decision**: locked
**Constraint**: SHOULD 把 CJK 嵌入模型设为合理默认 + 在常驻 fab_recall 路径默认启用语义召回(MCP server 进程内 embedder 缓存,warm 后零冷启动税)。

### Q3.2: 嵌入在哪条路径价值最高?

**Answer**: fab_recall 最高,两条 hook 最低(反直觉)。
**Evidence**: SessionStart broad 是 no-query breadth-first 探(plan-context.ts:452-456),无 query 则 BM25/vector 均不参与打分(scoreDescriptionItem:1100 `queryTerms.length>0` 门控) → 嵌入对它无效。PreToolUse narrow 靠 locality(relevance_paths) 不靠语义。fab_recall 带 intent,嵌入价值最高且已在热进程。
**Decision**: locked
**Constraint**: 语义嵌入投资优先 fab_recall 路径;不为给 hook 上嵌入而引入 daemon(收益错配)。

---

## Branch 4: Integration & Dependencies — 进程模型与代码索引

**Status**: 🟢 Done

### Q4.1: 上 daemon 吗?(风险 vs 收益)

**Answer**: 现在不上 daemon。
**Evidence/Reasoning**:
- 收益:仅加速 hook 路径延迟(几百 ms→几十 ms),而 hook 是 nudge 层(KT-DEC-0007)非正确性关键路径;fab_recall 已热。
- 成本:进程生命周期(起/停/崩溃/PID/端口) + 跨平台含 Win + 跨两端协议面。
- 风险:user_multiwindow_concurrent_dev —— 多窗口共享 daemon,只读索引可共享,但 session 态(dedup-window/edit-counter/emit-gate cache)绝不能共享。
- 收益错配:daemon 主解锁=hook 跑嵌入,但嵌入在 hook 价值最低(Q3.2)。
**Decision**: locked(defer with trigger)
**Constraint**: MUST NOT 现在建 daemon。触发条件:热 MCP + 磁盘缓存落地后,**实测** hook 延迟仍为瓶颈,方重评 daemon(且必须 per-repo+per-session 隔离)。

### Q4.2: 给 Fabric 加代码索引吗?

**Answer**: 不引入。
**Evidence/Reasoning**:
- 优势仅边际:符号级二阶链接(编辑调用方牵出被调方知识),且与现有 relevance_paths(locality) + detected_entities(BM25) + related 手工边重叠。
- 成本=maestro 引擎一半:多语言 parser + KG + FTS5 + 增量同步 + staleness。
- 副作用:模糊 Fabric 知识层身份,违 lean/clean-slate。
**Decision**: locked
**Constraint**: MUST NOT 给 Fabric 加代码符号索引/KG。若未来需符号级链接,便宜版=knowledge 增 `relevance_symbols` 字段 + narrow hook 匹配编辑文件符号(YAGNI,暂不做)。

---

## Branch 5: Scale & Performance — 冷启动税

**Status**: 🟢 Done

### Q5.1: 不上 daemon,冷启动税怎么榨?

**Answer**: BM25 模型 + store-walk 索引按 revision hash 落磁盘。
**Evidence**: hook 冷启动成本 = Node spawn(~不可约) + store-walk(cross-store-recall.ts 内存缓存,冷进程丢) + BM25 build(plan-context.ts:392 `getOrBuildBm25Model` 按 revision 缓存,内存,冷进程丢) + 嵌入模型加载(秒级,故 hook 不跑嵌入)。Fabric 已有 computeReadSetRevision(cross-store-recall.ts:450) 作内容指纹 → 可做磁盘缓存 key。
**Decision**: locked
**Constraint**: SHOULD 把 BM25 model + store-walk 描述索引序列化到磁盘(`.fabric/.cache/`),key=read-set revision hash;冷 hook 命中缓存即跳过重建。这砍掉冷启动大头且零并发风险。

### Q5.2: 性能"比 maestro 差好多"的真因?

**Answer**: 主要差在 hook 冷启动 + 无 RRF 导致排序观感差,非 fab_recall 本身。
**Evidence**: fab_recall 在常驻 MCP server(tools/recall.ts 进程持久),embedder once-per-process 缓存。maestro 的"快"来自 daemon 热模型 —— 对应 Fabric 的 MCP server 已具备同等"热"。差距集中在冷启动的 hook 与裸加法排序。
**Decision**: locked
**Constraint**: 性能优化次序 = ① 磁盘缓存榨冷启动 ② RRF 改善排序观感 ③ fab_recall 语义召回默认开;daemon 殿后。

---

## Branch 6: 返回结构与截断逻辑(追加 — 用户二次追问)

**Status**: 🟢 Done

### Q6.1: Fabric 返回 item 形状 vs maestro?

**Answer**: Fabric 嵌套胖,maestro 扁平瘦;采纳"瘦 item"。
**Evidence**:
- Fabric RecallEntry = `{stable_id, rank, description:{summary,intent_clues,must_read_if,related}, read_path, store, body_in_context}`(recall.ts:49-56),无 score 无 snippet。
- maestro item = `{id,type,title,category,score(归一 score/maxScore),snippet(extractSnippet 高亮),source}`(search.ts:163-173) + merged `{name,kind,detail,normalizedScore,snippet}`(search.ts:713-733),扁平且 score 可见。
**Decision**: locked
**Constraint**: SHOULD 默认返回瘦 item `{id, summary, score, 一行 snippet}`;胖 description / 正文留 read_path 懒读(守 KT-GLD-0005,比 maestro 还 lean)。

### Q6.2: 截断策略 vs maestro?字节 vs 条数?

**Answer**: 机制不换(Fabric 更先进),换次序——先相关度后字节。
**Evidence**:
- Fabric 截断 = byte budget(~16KB,tools/recall.ts:99 注释)+ top_k(plan-context.ts:444)+ ratio-floor(447-465);有 dropped[]{id,reason}(214/581)。byte-trim(543-585)**按位置砍**(迭代 slice candidates 数组),前面啰嗦条目挤掉后面相关条目。
- maestro 截断 = count(limit=20,over-fetch limit×3,search.ts:97-160)+ 防刷 CATEGORY_CAPS(仅无显式 filter 时);按 normalizedScore 排序后 slice(736-737)。无字节预算(CLI 打终端)。
- 因果链:胖 description 占满 16KB → 触发 byte-trim → 按位置误杀相关条目。截断痛点是返回啰嗦的下游症状。
**Decision**: locked
**Constraint**: SHOULD 截断次序改为 top_k + ratio-floor(相关度)先行,字节闸退为安全网(item 瘦后极少触发);dropped[]{id,reason} 保留并常态可见。

### Q6.3: 召回该设计成 MCP 还是 CLI?

**Answer**: 各司其职,字节预算是 MCP 的固有产物。
**Evidence**:
- fab_recall 是 MCP(tools/recall.ts:26,structuredContent 结构化工具响应,给 agent);hook 走 CLI `fabric plan-context-hint`(无状态注入)。maestro 纯 CLI(agent 当 Bash 命令调 `maestro search`),无 MCP-embedded 工具上下文 → 无 wire 限制 → 无字节预算。
- 字节预算正是 MCP 结构化响应的实际 wire 上限造成的(避免灌爆 context);CLI 打终端不受限,故 maestro 按 count 砍。
**Decision**: locked
**Constraint**: MUST 保持 fab_recall=MCP(agent 一等工具) + hook=CLI 的双投递(Fabric 跨客户端模型正确);SHOULD 统一两者返回成同一个瘦 item 形状(现状 MCP envelope 与 hook 渲染不一致)。MUST NOT 为规避字节预算把 fab_recall 改成 CLI(误诊)。

---

## Branch 7: fab 工具面普查与范围边界(追加 — 用户掀范围)

**Status**: 🟢 Done

### Q7.1: 全部 fab CLI/MCP 都 grill 了吗?fab_pending search 是不是同一需求?

**Answer**: 没有,只 grill 了召回路径;普查后确认 fab_pending search 是**独立的子串浏览机器**,非同一需求。
**Evidence**(census before narrowing,memory feedback):
- 实际注册 MCP 工具 5 个(index.ts:241-246):registerRecall/ArchiveScan/ExtractKnowledge/Review/Pending。fab_plan_context / fab_get_knowledge_sections **已 retired**(rc.37),无活的重复。
- fab_recall = planContext(BM25+向量+locality+recency+salience,ranked,top_k+ratio-floor+字节)。
- fab_pending search → reviewPending → **searchEntries**(review.ts:1376-1498):纯子串 `haystack.includes(lowerQuery)` 扫 title/summary/tags/filename,**零排序零打分零 top_k**,仅字节预算(enforcePayloadLimit)兜底。两套机器、两个目的(运行时召回 vs 审核浏览)。
- fab_review/propose/archive_scan/extract = 写/扫描路径,域外。
**Decision**: locked
**Constraint**: roadmap 主范围 = planContext 召回机(fab_recall + plan-context-hint CLI hook);fab_review/propose/archive_scan/extract MUST NOT 纳入。

### Q7.2: fab_pending 怎么纳入?横切还是统一?

**Answer**: 统一接入 planContext 引擎,但作为最后一波 W5(不织进早期波次)。maestro 参考=一个排序引擎多个过滤视图(maestro 从不为浏览重写一套子串 search)。
**Evidence/Reasoning**:
- maestro `search`=唯一 ranked 引擎(WikiIndexer),`--type/--category`=过滤视图,`load --list`=纯过滤;不维护第二套 search。Fabric 现有两套(planContext + searchEntries)=drift 根源。
- 统一=让 fab_pending search 走 planContext,scope 到 pending+canonical+rejected + review 过滤器,白嫖 BM25/score/snippet。净删 searchEntries。
- 次序:核心引擎先在 W1-W4 改好,再接入(避免 churn) → W5。
**Decision**: locked
**Constraint**: SHOULD W5 把 fab_pending search 接入统一 planContext 引擎并删 searchEntries 子串实现。

### Q7.3: 统一的设计陷阱?

**Answer**: triage 要完整性,不能套召回的 ratio-floor。
**Evidence/Reasoning**: 召回意图=最相关的少数(top_k+ratio-floor);triage 意图=完整不漏(逐条批,漏一条=漏一条)。ratio-floor 用在 triage 会悄悄藏掉待审条目。planContext 打分依赖 canonical 字段(maturity/relevance_paths/created_at),pending 草稿常缺 → 降级纯 BM25 文本排序。
**Decision**: locked
**Constraint**: MUST 统一**引擎**(共享打分+score+snippet)但按视图分**截断策略**:召回 top_k+ratio-floor;triage 排序排序+count-limit+字节安全网,**不设 ratio-floor**。MUST NOT 让 triage 视图丢失匹配完整性。

---

## Synthesis

### Decision Summary

| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|
| D1 | 目标=选择性对齐 maestro 知识检索半套,非全面对齐 | Locked | 1 | MUST NOT cargo-cult 代码图谱半套 |
| D2 | RRF/归一化替代裸加法融合 | Locked | 2 | SHOULD |
| D3 | entries[] 暴露 score(+信号分解) | Locked | 2 | MUST |
| D4 | 可选绝对分数地板 config 旋钮(默认 0) | Locked | 2 | MAY |
| D5 | CJK 嵌入设合理默认 + fab_recall 默认开语义召回 | Locked | 3 | SHOULD |
| D6 | 返回结构对齐:加 score/snippet 但**保 read_path 懒加载** | Locked | 1/2 | MUST(守 KT-GLD-0005) |
| D7 | 不上 daemon(defer with trigger) | Locked | 4 | MUST NOT(现在) |
| D8 | 不加代码符号索引/KG | Locked | 4 | MUST NOT |
| D9 | BM25/store-walk 落磁盘缓存榨冷启动 | Locked | 5 | SHOULD |
| D10 | 瘦 item:默认 {id,summary,score,一行snippet},正文留 read_path | Locked | 6 | SHOULD(比 maestro 更 lean) |
| D11 | 截断次序:先相关度(top_k+ratio-floor)后字节(安全网) | Locked | 6 | SHOULD |
| D12 | 保 fab_recall=MCP + hook=CLI 双投递,但统一瘦 item 形状 | Locked | 6 | MUST 保双投递 / SHOULD 统一形状 |
| D13 | fab_pending search 统一接入 planContext 引擎(W5),删 searchEntries | Locked | 7 | SHOULD |
| D14 | triage 视图截断 ≠ 召回:排序但不设 ratio-floor,保完整性 | Locked | 7 | MUST(防藏待审条目) |

### Verified Constraints(代码锚定)
- 裸加法融合: plan-context.ts:1094-1144;BM25 uncalibrated 自承: :449
- score 内部算了未透出: plan-context.ts:431 → recall.ts:161-171
- 相对地板 hasQuery 门控: plan-context.ts:447-465
- CJK 嵌入钩子已存在: vector-retrieval.ts:42-65
- 嵌入门控 queryTerms>0: plan-context.ts:1100
- fab_recall 常驻热进程 vs hook 冷启动: tools/recall.ts vs knowledge-hint-*.cjs
- revision hash 可作缓存 key: cross-store-recall.ts:450

### Open Questions
- 绝对分数地板的默认阈值校准(需真实查询分布,先上旋钮默认 0,观测 score 分布后再定)。
- 磁盘缓存的失效粒度(revision hash 整体失效 vs 增量,先整体)。

### Risk Register

| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | RRF 重构动核心打分,回归风险 | 2 | High | 行为保持测试;保留旧路径 flag;对比 before/after top-k 排序快照 |
| R2 | score 透出改 MCP outputSchema(契约) | 2 | Medium | 纯增字段向后兼容;rebuild dist(shared schema 改必 rebuild) |
| R3 | CJK 嵌入默认开增 fastembed 安装/首跑成本 | 3 | Medium | 仅 fab_recall 默认开(热进程);fastembed 仍 optional,缺则降级文本召回 |
| R4 | 磁盘缓存与 doctor/sync 的 staleness 交互 | 5 | Medium | key=revision hash,内容变即失效;复用现有 computeReadSetRevision |
| R5 | 用户初衷"全面对齐"被 orchestrator 收窄,可能仍想要 daemon/代码索引 | 1/4 | Low | 已给 defer-with-trigger + 便宜版 relevance_symbols 退路,非永久关门 |

### Recommended Next Step
范围已清晰(14 条 locked decision + 锚定证据),适合直接进 roadmap。建议波次(按风险升序):
- **W1 可观测性 + 瘦 item(低风险纯增)**:D3 score 透出 + D10 瘦 item(默认 {id,summary,score,一行snippet}) + D4 绝对地板旋钮(默认 0)。
- **W2 截断次序 + 冷启动**:D11 先相关度后字节 + D9 BM25/store-walk 磁盘缓存。
- **W3 RRF 融合重构(带行为保持测试,R1 高风险)**:D2 RRF/归一化替代裸加法。
- **W4 语义召回 + 形状统一**:D5 fab_recall CJK 嵌入默认开 + D12 MCP/CLI 瘦 item 统一。
- **W5 fab_pending 统一接入(中风险)**:D13 fab_pending search 接入 planContext 引擎 + 删 searchEntries + D14 triage 视图不设 ratio-floor 保完整性。
- **defer**:D7 daemon(触发:W2 后实测 hook 仍瓶颈) / D8 代码索引(YAGNI)。
- **范围边界**:fab_review/propose/archive_scan/extract = 写/扫描路径,本需求 OUT。

---

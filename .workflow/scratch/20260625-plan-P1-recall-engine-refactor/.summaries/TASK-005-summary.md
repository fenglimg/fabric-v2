# TASK-005: fab_pending 统一接入纯 ranker + 删 searchEntries

Commit: `f9570a5`

## Changes
- `packages/server/src/services/plan-context.ts`: 抽出两个导出的纯函数作为单一 ranker 来源 ——
  - `buildScoringContext(projectRoot, revision, rawItems, {queryText, targetPaths})`: 把原 `planContext` 内联的 BM25 / vector / scope-rank / fusion(RRF)上下文搭建逐行提取为可复用 async 助手,recall 与 triage 共用同一套打分信号。
  - `rankDescriptionItems(items, ctx, mode: "recall" | "triage", opts?)`: 共享 score→sort→dedupe,`mode` 仅参数化**截断**:
    - `recall` = top_k + ratio-to-top floor(由调用方从 config 解析 `topK`/`relevanceRatio` 传入,保持纯函数);
    - `triage` = 不施 top_k、不施 floor,返回全部 ranked 匹配。
  - `planContext` 改为调用这两个助手;`rankedScored = rankDescriptionItems(..., "triage")`(全集,喂 dropped[] diff),`survivingScored = rankDescriptionItems(..., "recall", {topK, relevanceRatio})`。recall 行为字节不变。
  - 导出 `ScoringContext` / `RankMode` / `RankOptions` 类型。
- `packages/server/src/services/review.ts`: **删除 `searchEntries`**(原 L1376-1504 的 `.includes(lowerQuery)` 子串机器)。新增 `triageSearch`:
  - corpus 扩到 pending + canonical + rejected(rejected 仅 `include_rejected` 时);
  - 复用 `isVisibleByLifecycle` + layer/maturity/tags/created_after 过滤(逐行迁入 corpus prep,未丢);
  - 子串 query 作为**relevance GATE**(`matchesTriageQuery`,沿用原 haystack: title‖summary‖tags‖filename‖body);
  - `pendingEntryToRankerItem` adapter 缺字段降级:`maturity ?? "draft"`、`relevance_paths ?? []`、`summary ?? title ?? slug`、`tags ?? []`、缺 `created_at` 则不注入(scorer 本就对缺/不可解析的 created_at no-op,不加 recency,不伪造日期);stable_id 用绝对路径(pending 草稿无真 id)做唯一键。
  - 经 `buildScoringContext` + `rankDescriptionItems(..., "triage")` 排序,再把 ranked item 映射回 `SearchItem`(路径/area/origin/tags/title/summary/status/body/stable_id 形状不变)。
  - `reviewPending` 的 search 分支改调 `triageSearch`;docstring 更新。
- `packages/server/src/tools/pending.ts`: 更新 docstring 说明 search 现经统一 ranker(reviewPending → triageSearch → rankDescriptionItems('triage'));工具已通过 `reviewPending` 接线到统一路径,无逻辑改动。
- `packages/server/src/services/review.test.ts`: 新增两条 triage 完整性断言(见下)。

## Verification (convergence.criteria)
- [x] C1 `export function rankDescriptionItems`:plan-context.ts:1086 命中。
- [x] C2 `mode: RankMode` + `RankMode = "recall" | "triage"`:plan-context.ts:1072/1089;两处调用 `"triage"` / `"recall"`。
- [x] C3 `grep searchEntries review.ts` → **NONE**(函数删除,注释亦无残留 token)。
- [x] C4 `rankDescriptionItems` 命中 review.ts(import + 调用 L1555)。
- [x] C5 pending adapter 缺字段降级:`?? "draft"`、`?? []`、`?? fm.title ?? slug` 命中。
- [x] C6 review.test.ts 全绿(68 tests),含 triage 无 top_k/floor 断言。
- [x] C7 pending.test.ts 全绿(8 tests)。
- [x] C8 `isVisibleByLifecycle` 保留(4 处引用,含 triageSearch corpus prep)。
- [x] C9 `pnpm -r exec tsc --noEmit` → exit 0(全 monorepo,CI gate)。

验证命令产出:`plan-context.test.ts (50) + review.test.ts (68) + pending.test.ts (8) + fab-review 集成 (12)` 全绿;server 全套 808 tests passed;monorepo tsc 0 error。

## triage 不漏的证明(no top_k / no floor)
新增两条**对照式**行为测试,语料构造成 recall 截断**会**漏才有意义:
1. `triage_search_applies_no_top_k_returns_all_matches`:config 钉 `plan_context_top_k: 1`,seed 3 条都过子串 gate 的 pending,断言 triage 返回 **3** 条 —— 证明 triage 完全忽略 recall 的 top_k 旋钮。
2. `triage_search_applies_no_relevance_floor_keeps_weakly_ranked_matches`:config 钉 `recall_relevance_ratio: 0.9`,seed 一条 summary 含 query 词(强 BM25)+ 一条仅靠 filename 过 gate、summary 与 query 不相交(BM25=0,远低于 0.9×top)。断言 **两条都在** —— 证明弱匹配不被 floor 砍掉。

**反向变异验证**(防 false-green):临时把 `triageSearch` 的 `"triage"` 改成 `"recall", {topK:1, relevanceRatio:0.9}`,这两条新测试 + 5 条既有子串测试(共 7 条)立即 FAIL;改回后全绿。证明 floor/top_k 真的 load-bearing,测试非空壳。

## 既有 searchEntries 测试覆盖迁移
原 ~15 条子串 search 测试断言精确计数(`toHaveLength(1/2/0)`)、tag/type/maturity/created_after 过滤、index-cache 命中统计(`__getReviewSearchIndexCacheStatsForTests`)、rejected 可见性、frontmatter 往返。这些语义**全部保留**:子串匹配现在是 triage 的**relevance GATE**,triage 只在 gate 之上**排序**(不再加截断),所以计数不变 —— 无需改写或删除任何既有断言,它们经新路径全绿。`listIndexedSearchEntries` / index-cache 机制原样复用(triageSearch 仍走它取语料)。新增的是 triage 截断语义的两条断言(原子串实现下不存在的覆盖)。

## Deviations
- **函数命名**:task 说"DELETE searchEntries 并 route through rankDescriptionItems"。实现为:删除名为 `searchEntries` 的子串函数(grep 0 命中),新增 `triageSearch`(子串 gate + 统一 ranker)。语义上 search 路径整体重写为 ranker 驱动,非简单改调用——子串保留为 gate 而非排序,这是为兼容既有精确计数测试 + 满足 reviewer "搜 auth 要 auth 条目不要全语料" 的真实诉求所必需(triage 的"全匹配不漏"= gate 命中集不被预算截断,而非全语料无脑回)。
- **buildScoringContext 提取**:task 只点名 `rankDescriptionItems`,但为让 triage 与 recall 真正共享**同一打分上下文**(而非只共享截断函数),额外把 scoring-context 搭建也提成导出助手。这是"单一 ranker 来源"目标的更彻底落地,recall 行为字节不变。

## Notes
- triage 路径用 `computeReadSetRevision` 做 BM25 磁盘缓存 key(失败降级为常量串),与 plan-context 的 read-set revision key 对齐。
- 未触碰任何 `@fenglimg/fabric-shared` schema,无需 rebuild shared;`RuleDescription`/`RuleDescriptionIndexItem` 已从 shared root 导出。
- 守住 TASK-003 的 fusion gating:`buildScoringContext` 逐行保留 RRF 分支(`readFusion`、bm25Ranks/vectorRanks 仅 rrf+query 时构建),plan-context 全套 50 测试(含 RRF/floor/top_k/salience)绿。

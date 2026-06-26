# TASK-002: 瘦 item 默认 + BM25 model 磁盘缓存

Commit: `5843a5f` (`feat: 瘦 item 默认 + BM25 模型磁盘缓存榨冷启动`)

## Changes
- `packages/server/src/services/bm25.ts`: 抽内部统计为 plain JSON-safe 结构 `SerializedBm25Model`（version / totalDocs / documentFrequency[term,count] / avgFieldLength / perDoc[{id, fieldTermFreq[term,freq], fieldLength}]）。新增单一 `modelFromStats(serialized)` 评分引擎；`buildBm25Model` 现在先 flatten 出 snapshot 再走 `modelFromStats`，runtime model 附带 `__serialized` 只读快照。新增导出 `serializeBm25Model(model)` / `rehydrateBm25Model(serialized)` —— 二者与 build 路径共用同一引擎，scoreDoc 数值同构。
- `packages/server/src/services/plan-context.ts`: `getOrBuildBm25Model` 改 async + 两层缓存。Tier1 进程内存（原有 revision-keyed）；Tier2 磁盘 `.fabric/cache/bm25/<revision>.json`，key = `computeReadSetRevision`。内存未命中→查磁盘→命中即 `rehydrateBm25Model` 跳过重建；全 miss→build 一次→写穿内存+磁盘。磁盘读写全 best-effort（坏读/写失败退化为 rebuild，不阻断排序）。version!==1 的旧 snapshot 直接判 miss。
- `packages/server/src/services/bm25.test.ts`: 新增 round-trip describe（2 用例）—— 多 field/多 doc/含 CJK 语料，JSON 往返后 rehydrated.scoreDoc(id,q) === original.scoreDoc(id,q)（跨 a/b/zh/missing × 6 query），并守一个非零分确保等式有意义。
- `packages/server/src/services/recall.test.ts`: 新增 lean payload 用例 —— 默认 entry 带 description 索引 + read_path，但序列化后的整封 envelope 不含 markdown body 文本（`# Auth body` / `# UI body`）。
- `packages/server/src/services/plan-context.test.ts`: 新增 2 用例 —— 冷进程磁盘命中（首调 build=1 写盘 → `__resetBm25Cache` 清内存模拟冷 hook → 同 revision 再调 build 仍=0，且排序不变）；以及无磁盘快照诚实 miss（build=1）。
- `.gitignore`: 加 `.fabric/cache/`（新缓存目录是运行态产物，与 events.jsonl/metrics.jsonl 同类，不进 source contract）。

## Verification (convergence.criteria 逐条)
- [x] `grep 'serializeBm25Model\|rehydrateBm25Model' bm25.ts` 命中两个导出 → bm25.ts:251 / 262。
- [x] `grep 'computeReadSetRevision' plan-context.ts` 命中且作为缓存 key → L346 算出 revision，L411 传入 `getOrBuildBm25Model(projectRoot, revision, ...)`，`bm25CachePath` 用它做文件名。
- [x] bm25.test.ts round-trip：rehydrate(serialize(m)).scoreDoc === m.scoreDoc 数值相等 —— 9 tests 全绿（原 7 + 新 2）。
- [x] recall 默认 payload：entry 不含 body 全文（`# Auth body`/`# UI body` absent）、仍含 read_path —— recall.test.ts 13 tests 全绿。
- [x] 缓存命中：相同 revision 第二次（清内存后）命中磁盘，buildBm25Model 不被再次调用（`__bm25CacheStats().builds` 保持 0）—— plan-context.test.ts 50 tests 全绿。
- [x] `pnpm test -- bm25.test.ts recall.test.ts plan-context.test.ts` → 全包 799 tests 通过（原 794 +5 新用例）。
- [x] `pnpm -r exec tsc --noEmit` → exit 0，无 error。

## Deviations
- **Part A 按 KT-DEC-0019 重新解读（不裁瘦 description）**：任务原文要求「默认 entry 只含 id+summary+score+单行 snippet，胖 description 不进 payload」。但 KB 锁定约束 KT-DEC-0019 明文 `impact[1]`：「硬砍丢描述会背叛 no-server-filter 哲学并漏可发现性」，KT-GLD-0005/KT-DEC-0026 同义：**description = 发现层索引（须保全），body = 按需 read_path（已不进 payload）**。且 shared `_ruleDescriptionSchema` 把 summary/intent_clues/tech_stack/impact/must_read_if 全列为 required，裁瘦会直接令 `recallOutputSchema` 校验失败。现状 recall.ts 返回的就是 description 索引 + read_path，**markdown body 从不进 payload —— lean 契约本就满足**。故 Part A 落地为「加守护测试断言 body 缺席 + read_path 在场」而非破坏 description。`dismissed: 无 —— 按 KT-DEC-0019 修正 Part A 语义（description≠body）`。
- 无其它 scope 外改动；`.gitignore` 改动为新缓存目录的必要配套（已在上文记 rationale）。

## Notes
- 磁盘缓存粒度 = 整 revision-hash（chosen，无 incremental）：读集任意非 pending 内容变 → revision 变 → 文件名变 → miss → 重建。多窗并发只可能并发写**同一** revision 的**同一**内容（snapshot 确定性），最坏是冗余覆盖写，无 torn-state 正确性风险（best-effort 写已兜底）。
- `__serialized` 是 runtime model 的唯一状态来源，serialize 零拷贝直接返回它；rehydrate 与 build 共用 `modelFromStats`，所以二者 scoreDoc 同构是构造性保证，不靠测试运气。
- 未动 TASK-001 的 score 暴露：candidate_scores 仍是 plan-context runtime-only Map，recall 折进 entry.score/score_breakdown，磁盘 snapshot 只存 BM25 语料统计、不含 score，wire 零增量。

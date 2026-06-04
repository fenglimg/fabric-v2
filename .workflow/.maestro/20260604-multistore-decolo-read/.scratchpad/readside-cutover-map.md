# 读侧 cutover map (W5 R 簇 census 实证产物)

> M 簇已绿(migrate + dogfood)。本文件记 R1-R6 精确消费者面 + 承重设计决策。
> 核心反frame: .fabric/knowledge 已空 → buildKnowledgeMeta 派生空 nodes → projectRawItems 已返回空。
> 故 R 簇本质 = **退役已死 co-location 机器** + 一个承重设计(store revision hash), 非重写行为。

## 三件套机制(待退役)
- `meta-reader.ts` — `readAgentsMeta(projectRoot)` 读 co-location `.fabric/agents.meta.json`
- `knowledge-meta-builder.ts` — `buildKnowledgeMeta(projectRoot)` 从 `.fabric/knowledge` 派生 nodes 索引
- `load-active-meta.ts` — `loadActiveMeta`/`loadActiveMetaOrStale` = readAgentsMeta + buildKnowledgeMeta + compare/auto-heal

## 目标范式(已存在, cross-store-recall.ts)
- `walkReadSetStores(projectRoot)` → CrossStoreEntry[](qualifiedId/file/layer/semanticScope/source)
- `buildCrossStoreRawItems` → RuleDescriptionIndexItem[](候选描述)
- `buildCrossStoreBodyIndex` → Map<qualifiedId, {file,layer}>(body 投递)
- `collectStoreKnowledgeSummaries` → 摘要(doctor opacity lint 用)
- 底层 `readKnowledgeAcrossStores(MountedStoreDir[])` (shared/store/core.ts:134)

## 精确消费者面(grep 实证, 真调用点)
| Task | 文件 | 当前用法 | cutover |
|---|---|---|---|
| R1 | plan-context.ts:286 | `loadActiveMetaOrStale` → projectRawItems(370) + auto-heal(314-338) + meta.revision(407/500/518/524) | 删 meta 加载/auto-heal/projectRawItems; rawItems=storeRawItems only; revision 换 store-corpus hash |
| R3 | knowledge-sections.ts:153 | `loadActiveMeta` → meta(body 索引) | 走 buildCrossStoreBodyIndex 取 body |
| R3 | get-knowledge.ts:95,144 | `loadActiveMeta` + `readAgentsMeta` | 同上 |
| R3 | extract-knowledge.ts:178 | `loadActiveMeta` | store on-the-fly |
| R4 | doctor.ts:2570 | `buildKnowledgeMeta`(tryBuildRuleMeta) + readAgentsMeta(62) | inspectMeta/index-drift/counter-reconcile 重定向 per-store(reconcileStoreCounters) |
| R4 | doctor-conflict.ts:52 | `readAgentsMeta` | store |
| R4 | doctor-cite-coverage.ts:804 | `readAgentsMeta` | store |
| R5 | cache.ts | meta watch(invalidation) | watch store 路径 |
| R6 | server/index.ts:68 | buildKnowledgeMeta export 串 | MCP tool 包装层确认 |
| R6 | server-http-exp api/{events,knowledge,ledger},http,bearer-auth | readAgentsMeta? | 确认读侧(http-exp 是 experimental, 可能整体 out-of-scope, 待 census) |
| sync | knowledge-sync.ts:666-667 | buildKnowledgeMeta + readAgentsMeta(reconcile) | **边界待定**: sync reconcile 是写侧 producer? 还是读? 用户 scope 未列 sync 读 — 待 R 簇推进时判 |
| R2 | load-active-meta.ts / knowledge-meta-builder.ts | 中枢 | **最后退役**: R1/R3/R4 cut 完, 零 consumer 后删(或仅留 counter-envelope shim) |

## 承重设计决策: store-corpus revision hash
- **问题**: meta.revision 当前 = sha256(meta.nodes); co-location 空后 = sha256("")(M2 实证 e3b0c44...)。
  它用于: BM25 cache key / selection_token 绑定(createSelectionToken)/ 响应 revision_hash / stale 检测。
- **shared 无现成 helper**(grep 实证)。
- **方案**: 新建 `computeReadSetRevision(projectRoot)` — over walkReadSetStores 的 (qualifiedId + content sha) 排序后哈希。store 内容变 → revision 变 → stale 检测/token 失效正确触发。
- **落点**: shared/store 或 server/services/cross-store-recall.ts(walkReadSetStores 已在此)。
- **风险**: selection_token round-trip(plan-context emit → get-knowledge-sections validate)两侧都要换同一 revision 源, 否则 token 校验恒 fail。R1+R3 必须同批改 token 两端。

## 退役顺序(依赖铁律)
1. 新建 store-corpus revision helper(foundational, R1 前置)
2. R1 plan-context: 换 revision 源 + 删 projectRawItems/auto-heal/loadActiveMetaOrStale
3. R3 knowledge-sections/get-knowledge/extract-knowledge: body 走 buildCrossStoreBodyIndex; token validate 端换 revision
4. R4 doctor 三类: 重定向 per-store
5. R5 cache watch
6. R6 MCP/http-exp 确认(http-exp 可能整体 out-of-scope)
7. R2 load-active-meta/buildKnowledgeMeta 退役(零 consumer 后)
8. R7 fixture 迁 store
9. I1/I2 install
10. Z1 收口

## 进度 (2026-06-04 W5 loop)
- ✅ M(migrate+dogfood)= G-MIGRATE-DOGFOOD 绿 · commit 12bac23
- ✅ R0(computeReadSetRevision)+ R1(plan-context store-only)+ plan-context.test 38 绿 · f21ff79
- ✅ R3(knowledge-sections + extract-knowledge 读 store; get-knowledge 改判归 R2)· 0f3cd9e
- ⏳ R4 doctor(下一步, 见下)→ R5 cache → R6 MCP/http 确认 → R2 退役簇 → R7 余 fixture → I1/I2 → Z1

## R4 doctor.ts 精确 cutover 计划(~58 触点, 8000+ 行, load-bearing)
**原则**: co-location agents.meta(Z1 会删)→ 读它的 doctor 检查要么删(纯 co-location)要么重定向 per-store。
**纯 co-location 检查 → 删除/退役**(检查的文件 Z1 后不存在):
- `inspectMeta`(2497)读 `.fabric/agents.meta.json` → 退役(或返空)
- `inspectIndexDrift`(7922-, createIndexDriftCheck 1368, applyIndexDriftFix 1967)→ agents.meta.nodes vs disk 漂移检查, co-location 专属 → 删
- `inspectMetaManuallyDiverged`(5086)→ 同上删
- `reconcileKnowledge`(doctor 触发 1623/1802)→ 重建 co-location nodes, 退役
- content_ref_missing(3767)→ co-location node content_ref 检查, 删
- `tryBuildRuleMeta`/`buildKnowledgeMeta`(2568)→ 退役
**counter 类 → 重定向 per-store**(W4 已给 reconcileStoreCounters):
- counter_desync(2409, 5282)读 agents.meta.json#counters → 改读 per-store counters.json(reconcileStoreCounters)
- counter index-drift fix(8290 rewriteCountersEnvelope)→ per-store
**已 store-aware(W4-A6, 保留)**: doctor-scope-lint.ts(lintStoreScopes)
**测试**: doctor.test.ts(20 agents.meta refs)→ 删纯 co-location 检查的测试 + counter 测试迁 per-store fixture。可委派子代理。
**风险**: doctor 主流程(runDoctor ~1139)按顺序跑 checks; 删 check 要同步删其在报告 assembly + i18n 串的引用, 否则 tsc/lint 断。

## ⚠️ R2 reconcileKnowledge 纠缠发现(2026-06-04, 比原计划大)
`reconcileKnowledge`(knowledge-sync.ts:593, 重建 co-location agents.meta)仍有 4 真 caller:
- **index.ts:309** server 启动 `trigger:"startup"` —— **Z1 删 agents.meta 后启动会重建它**(破坏删档验证), 必删
- **review.ts:724** post-approve · **review.ts:1122** post-modify —— 写后重建 co-location 派生索引(已无人读)
- **knowledge-sync.ts:539** 内部 auto-heal-after-drift
退役策略: 4 处调用全删 + reconcileKnowledge 函数退役 + 其用的 buildKnowledgeMeta/writeKnowledgeMeta/readAgentsMeta(knowledge-sync 内)退役。review 写侧已 store-only(W4 cross-store-write), post-approve/modify 的 reconcile 是多余的 co-location 派生维护, 删即可(写已落 store)。**sync open question 由此关闭: sync 的 co-location reconcile 整体退役。** first-reconcile-gate.ts(startup gate)可能也需调整/退役。
**R7 连带破**: knowledge-sync.test / review.test / get-knowledge.test / rehydrate-state.test / mcp-server.test + 删 knowledge-meta-builder.test / load-active-meta.test / knowledge-id-allocator.test。

## 已完成读侧(6 commit 全绿)
M 12bac23 · R0/R1 f21ff79 · R3 0f3cd9e · R4 a3e4f76 · R6 4f9a08b · (R5 absorbed)
读路径 cutover 完毕: plan-context/knowledge-sections/get-knowledge-sections/extract/doctor 检查/doctor-conflict/doctor-cite-coverage 全 store-only。剩 R2(退役+startup/review reconcile)→ R7(测试)→ I1/I2(install)→ Z1(green)。

## R2 退役簇(R4/R5 后, 零 consumer 时)
- 删 load-active-meta.ts(loadActiveMeta/loadActiveMetaOrStale)
- 删/瘦 knowledge-meta-builder.ts: buildKnowledgeMeta/writeKnowledgeMeta 退役; **保留** deriveRuleIdentity + extractRuleDescription(cross-store-recall.ts 用!)
- 删 meta-reader.ts(readAgentsMeta) 或仅留 AgentsMeta 类型 + counter envelope schema 复用
- get-knowledge.ts: 删 getKnowledge/loadGetKnowledgeContext/resolveKnowledgeForPath/matchRuleNodes; **保留 normalizeKnowledgePath**(plan-context/其他用); 同步处理 quarantined http-exp/api/knowledge-context.ts 的 import(可删该 endpoint)
- 删测试: knowledge-id-allocator.test.ts(整删, allocator co-location 退役)· knowledge-meta-builder.test.ts(瘦/删)· load-active-meta.test.ts(删)
- knowledge-sync.ts(666-667 buildKnowledgeMeta+readAgentsMeta reconcile): 见 sync open question

## R7 余 fixture 迁移面(R4/R2 触发的测试破)
doctor.test.ts(20)· knowledge-sync.test.ts(7)· rehydrate-state.test.ts(4)· review.test.ts(2)· recall.test.ts(1)· mcp-server.test.ts(2)· doctor-audience-tag.test.ts(2)· doctor-meta-error-humanize.test.ts(1)· cross-store-recall*.test(已 store, 应不破)。删除类: knowledge-id-allocator.test / knowledge-meta-builder.test / load-active-meta.test。
**模板**: plan-context.test.ts + knowledge-sections.test.ts(已迁, store fixture helper 范例)。可批量委派子代理。

## I1/I2 install
- install.ts: 不再 scaffold .fabric/agents.meta.json + 空 knowledge 柜(保留 AGENTS.md/fabric-config.json bootstrap)。grep install.ts 的 agents.meta + knowledge dir scaffold 点。
- install integration test 断言生成物清单不含 agents.meta + 空柜。

## Z1 收口
pnpm --filter shared build + pnpm -r exec tsc --noEmit + pnpm -r test 0 fail + 删 .fabric/knowledge & .fabric/agents.meta.json 验证。

## sync 边界 open question
knowledge-sync.ts 用 buildKnowledgeMeta+readAgentsMeta 做 reconcile。用户 scope 列了 "doctor counter-reconcile 重定向" 但没明列 sync。sync 是 store 间 push/pull,reconcile meta 可能是其内部一致性步骤。R 簇推进到此时判:若 sync reconcile 依赖 co-location meta → 一并 cut;若已 store-aware → 不动。记录待 R6 时定。

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

## sync 边界 open question
knowledge-sync.ts 用 buildKnowledgeMeta+readAgentsMeta 做 reconcile。用户 scope 列了 "doctor counter-reconcile 重定向" 但没明列 sync。sync 是 store 间 push/pull,reconcile meta 可能是其内部一致性步骤。R 簇推进到此时判:若 sync reconcile 依赖 co-location meta → 一并 cut;若已 store-aware → 不动。记录待 R6 时定。

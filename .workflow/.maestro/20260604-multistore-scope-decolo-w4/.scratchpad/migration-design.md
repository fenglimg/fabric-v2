# W4 agents.meta 退役 — 迁移设计 (round 1 架构调查产物)

## 当前真实模型 (调查实证)
- `agents.meta.json` 双职责: (1) **counters** {KP,KT}×5type 单调 stable_id 分配 (KnowledgeIdAllocator, file lock); (2) **nodes** 每文件派生索引 (file→{hash,stable_id,description,sections})。
- **写侧已 store-only** (cross-store-write.ts "v2.2 全砍 Stage2 B2 cutover"): 知识落 `~/.fabric/stores/<uuid>/knowledge/`,dual-root fallback 已删。
- **读侧 store 路径已绕过 agents.meta**: cross-store-recall.ts 用 `readKnowledgeAcrossStores` + `extractRuleDescription`/`deriveRuleIdentity` 从 frontmatter 即时建索引。store `.gitignore` 排除 agents.meta ("deterministically rebuilt, never committed", store/core.ts:33)。
- **残留不一致 (核心待修)**: `review.ts:510/992` 仍 `new KnowledgeIdAllocator(projectRoot/.fabric/agents.meta.json)` —— 知识入 store 但 counter 记在项目 co-location。
- **doctor** 大量 co-location agents.meta 逻辑: inspectMeta / index-drift counter reconcile (2404/2493/5041/8247) / content-ref / reconcileKnowledge 重建 nodes。

## 承重决策: counter 新家 = per-store committed `counters.json`
- **为何不放回 disk-derive**: 删最高 id 后 disk-max+1 会重用该 id,破坏 cite 历史 (KT-DEC-0004 单调不变量)。必须持久化。
- **为何 committed (非 gitignored 的 per-store agents.meta)**: counter 须随 store clone 旅行,否则新 clone 从 disk-max 重建→跨 clone 重号。与 projects.json 同理 (committed)。
- **schema**: 复用 AgentsMetaCountersSchema 的 {KP,KT}×{MOD,DEC,GLD,PIT,PRO} envelope,落 `<storeDir>/counters.json`。
- **代价 (记 needs_adjudication, round 末浮, 非阻塞)**: 团队 store 多人并发铸号→counters.json git 冲突。解=merge 取 max;doctor --fix counter-repair 重定向到 per-store 后可愈。clean-slate 零用户期可接受。
- **per-uid namespace**: personal store 的 KP 计数天然随 personal store 隔离 (该 store 仅本机 uid)。

## 退役顺序 (依赖铁律)
1. **W4-B3a (foundational)**: 新建 shared `store-counters.ts` (committed counters.json read/alloc/persist, file lock) + schema + 测试。← 一切依赖此
2. **W4-B3b**: review.ts allocator 重定向到 write-target store 的 counters.json (传 storeDir 而非 projectRoot/.fabric)。
3. **W4-B1/B2**: doctor + 残留 nodes-index 读者切 store on-the-fly;doctor counter-reconcile/index-drift 重定向 per-store counters,删 co-location-only check。
4. **W4-B3c**: 彻底删 co-location agents.meta 读/写;meta-reader.ts 退役或仅留 shim;cache invalidation watch 改 store。
5. **W4-B4**: install 不 scaffold `.fabric/agents.meta.json` + 空 knowledge 柜 (留 AGENTS.md/fabric-config.json bootstrap)。
6. **W4-A6**: doctor 三类 scope lint (缺 semantic_scope / personal 泄 team / dangling project)。
7. **W4-A7**: re-scope/promote 工具。
8. **W4-Z1**: shared rebuild + 全量 tsc + 全测试绿 + 删柜验证。

## 消费者面 census (grep 实证, 非测试生产读者)
server/services: doctor.ts(58) · knowledge-meta-builder.ts(12) · knowledge-id-allocator.ts(8) · meta-reader.ts(8) · knowledge-sync.ts(11) · knowledge-sections.ts(5) · cross-store-recall.ts(5) · review.ts(3) · rehydrate-state.ts(3) · doctor-cite-coverage.ts(2) · doctor-conflict.ts · extract-knowledge.ts · cache.ts(2)
cli: install.ts(11) · doctor.ts(2) · plan-context-hint.ts(2) · sync/run-sync.ts(2)
server-http-exp: http.ts(3) · api/events.ts(3) · middleware/bearer-auth.ts
shared: schemas/agents-meta.ts(7, schema 定义本身) · store/core.ts(2, gitignore 串) · templates/bootstrap-canonical.ts(3)
> 注: 许多 doctor 引用是 reconcile/重建 producer 侧,随 nodes 索引退役一并清理或重定向。

## B3c 读侧退役 — readAgentsMeta 生产消费者精确面 (B3a/b 后普查)
中枢: **load-active-meta.ts**(loadActiveMetaOrStale,带 stale-rebuild,多数 consumer 走它)+ meta-reader.ts(readAgentsMeta 底座)。
直接/间接消费 readAgentsMeta:
- server/services: plan-context · knowledge-sections · get-knowledge · extract-knowledge · knowledge-sync · doctor · doctor-cite-coverage · doctor-conflict · load-active-meta
- server/tools (MCP 包装): review · extract-knowledge · knowledge-sections · plan-context · archive-scan · recall
- server-http-experimental: api/knowledge · api/ledger · http · api/events · middleware/bearer-auth
- cli: install · uninstall · doctor · sync/run-sync
退役策略 (待后续 continue 逐一): 读 nodes 索引者 → 改 cross-store on-the-fly(已有 buildCrossStoreRawItems/buildCrossStoreBodyIndex 范式);plan-context 去 meta.nodes 源 + auto-heal reconcile;counter-reconcile/index-drift → reconcileStoreCounters(per-store);最后删 meta-reader/load-active-meta + agents.meta schema 仅留 counter envelope 复用。
**注意**: 这是 W4 主体工作量(~18 consumer),非单步;每个 continue 取一簇(如先 doctor 簇、再 plan-context 读簇、再 MCP tools 簇)逐步绿。

## 已完成 (counter 子系统,2 commit 全绿)
- b8d93f8 W4-B3a/b: store-counters 模块 + review.ts 铸号重定向
- 5a3945d W4-F1: reconcileStoreCounters + store-migrate seed (producer↔consumer 防撞号)

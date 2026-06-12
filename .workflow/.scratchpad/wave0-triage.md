# Wave 0 — 删除候选清单 + 定性(knip 全扫 + grep 验证)

> 验证方法:每项 grep live importer(排除 test + 自身)。**重大修正:原"整文件删"判断错误,实为 export 级外科手术。**

## A. knip 死 exports — 逐条定性

| 符号 | 文件 | live 消费者? | 定性 | 动作 |
|---|---|---|---|---|
| `buildKnowledgeMeta` | knowledge-meta-builder.ts | 无 | 🔴 co-location 死 | 删 |
| `computeKnowledgeBasedAgentsMeta` | 同上 | 无 | 🔴 死 | 删 |
| `computeKnowledgeTestIndex` | 同上 | 无 | 🔴 死 | 删 |
| `loadKbIdTypeMap` | 同上 | 无 | 🔴 死 | 删 |
| `deriveKnowledgeMetaLayer` / `deriveKnowledgeMetaTopologyType` | 同上 | 无 | 🔴 死 | 删 |
| `isSameKnowledgeTestIndex` / `stableStringify` | 同上 | 无 | 🔴 死 | 删 |
| `__knowledgeMetaCacheStats` / `__resetKnowledgeMetaCache` / `__knowledgeTestIndexCacheStats` / `__resetKnowledgeTestIndexCache` | 同上 | 仅测试 | ⚠️ 随死函数 | 删(连其测试) |
| `KnowledgeMetaBuildSource` (type) | 同上 | 无 | 🔴 死 | 删 |
| **`deriveRuleIdentity` / `extractRuleDescription`** | 同上 | **cross-store-recall.ts(live)** | 🟢 **活** | **保留** |
| `writeKnowledgeMeta` | 同上 | 仅 doctor.test.ts / doctor-i18n.test.ts 当 fixture | ⚠️ **逐个判** | 见 §C |
| `isForbiddenCrossLayerEdge` | 同上(内部自用 @1255,属死的 meta 构建) | 仅 -related.test.ts | 🔴 死 | 删(连其测试) |
| `isAlive` / `readLockState` | legacy-serve-lock-probe.ts | **doctor.ts:82(live)** | 🟢 **活** | **保留**(名字误导,非 legacy) |
| `LockState` (type) | 同上 | 无(消费者用函数不用 type) | 🔴 死 type | 顺手摘 |
| `resolveStoreByAliasOrUuid` | cli/store/store-ops.ts | store-ops.ts:353 自用 | 🟢 活,export 多余 | 保留(可摘 export) |
| `computeExposedAndMutated` | doctor-cite-coverage.ts | 仅注释引用 | 🔴 疑死 | 待精验后删 |
| `sanitizeInjectionPatterns` | extract-knowledge.ts | extract-knowledge.ts:97/105 自用 | 🟢 活,export 多余 | 保留 |
| `extractBody` | recall.ts:420 | **无(已被 _shared.ts 共享实现取代,knowledge-sections 用的是 _shared 版)** | 🔴 **死重复** | **删** |
| `RecallTruncation` / `RecallBodyTier` | recall.ts | recall.ts 内部返回形状自用 | 🟢 活,export 多余 | 保留 |
| `defaultPush` / `defaultCommitDirty` / `GitPush` / `GitRebasePull` / `GitRebaseResolve` / `GitCommitDirty` | run-sync.ts | 无(未接线) | 🟡 **半成品 sync 推送** | **defer→用户拍** |
| `StableIdCollision` / `StableIdDuplicateGroup` / `LayerMismatchEntry` | doctor-stable-id-collision.ts | 模块被 doctor.ts 用(createStableIdCollisionCheck),类型本文件内自用 | 🟢 活,export 多余 | 保留 |
| `ScopeLintCode` / `StoreDiagnosticCode` / `RescopeChange` / `RescopeRefusal` | 各 | 各自本文件内 `X[]` 字段自用 | 🟢 活,export 多余 | 保留 |

### 细化结论:knip「unused export」≠ 死代码
绝大多数是**活代码但 export 多余**(只在本文件内用却导出)。摘 `export` 关键字是**独立的外观清理(可选)**,不属"清兜底"。真正的死代码 surface 很小,见下。

## B. Duplicate exports(6,named+default 双导出)
`installCommand`/`metricsCommand`/`onboardCoverageCommand`/`planContextHintCommand`/`syncCommand`/`uninstallCommand`
→ 命令全 live,只是双导出 lint nit。非 fallback,清理可选(收口顺手)。

## C. ⚠️ 关键:doctor.test.ts 的 co-location fixture(决策 ⑩ 逐条判)
`writeKnowledgeMeta(target, {source:"doctor_fix"})` 写生产已不读的 co-location agents.meta:
- **live 运行的**(非 skip):doctor.test.ts:121,271,283,309,334,365,386,418,435 + doctor-i18n.test.ts:62,72,81,84
- **已 it.skip 的**:doctor.test.ts:925(stable_id_collision),1025/1040(knowledge_dir_missing),1219(stable_id_collision),1271/1304/1338/1377(filesystem_edit_fallback)

逐个判:测 **retired check**(co-location 时代:inspectMeta/counter_desync/knowledge_dir_missing/stable_id_collision 等)→ 删测试 + 删 fixture 依赖;测 **live 行为**(用 writeKnowledgeMeta 只是搭环境)→ 改 fixture 不依赖 co-location。

## 修正后的 Wave 1 范围
不再是"删 knowledge-meta-builder.ts / legacy-serve-lock-probe.ts 两文件",而是:
1. 删 knowledge-meta-builder.ts 中的死 co-location 函数(保留 deriveRuleIdentity/extractRuleDescription)
2. 摘 legacy-serve-lock-probe.ts 的 LockState 死 type(文件保留)
3. 处理 isForbiddenCrossLayerEdge + 其测试
4. §C 的 doctor 测试 fixture 逐条判(与 105-skip triage 合并做)
5. 还有一批 ❓ 待验 export(resolveStoreByAliasOrUuid 等)

## 真正的死代码 surface(收敛后,极小)
1. **co-location 死函数簇** @ knowledge-meta-builder.ts:`buildKnowledgeMeta`/`computeKnowledgeBasedAgentsMeta`/`computeKnowledgeTestIndex`/`loadKbIdTypeMap`/`deriveKnowledgeMetaLayer`/`deriveKnowledgeMetaTopologyType`/`isSameKnowledgeTestIndex`/`stableStringify`/`isForbiddenCrossLayerEdge`/4 个 `__*Cache*` + `KnowledgeMetaBuildSource` type(**保留** deriveRuleIdentity/extractRuleDescription)
2. **recall.ts `extractBody`**(死重复,_shared.ts 已取代)
3. **死 type**:`LockState`(legacy-serve-lock-probe.ts)、`KnowledgeMetaBuildSource`
4. **`computeExposedAndMutated`**(疑死,待精验)
5. **doctor 测试 co-location fixture**(§C,与 105-skip 合并逐条判)— 最大体力活

## 不属本次的(单列)
- 🟡 半成品:sync 推送(run-sync.ts)→ 用户拍
- 🔵 可选外观:摘多余 `export`(一堆 🟢)、6 个 duplicate export → 收口顺手或不做
- ⚪ 决斗:doctor 内部 stable/endorsed rename → 用户拍

## 状态
Wave 0 候选定性 = **完成**。死代码 surface 已收敛到上述 5 簇,远小于 knip 原始 33 项。

## 🔄 REBASE 刷新(对齐 main 927b71d,scaffold-teardown 已停=无并发风险)
并行 goal scaffold-teardown 已落 4 commit 到 main,动的是**邻居**,未碰核心目标。逐项复验:
- ✅ cite-tag `LEGACY_CITE_TAG_REMAP` 仍在(`f643baf` 只删 `[recalled]` 强制提醒,没碰 parser remap)→ Wave 3 仍有效
- ✅ co-location `deriveRuleIdentity`/`extractRuleDescription` 仍 live(cross-store-recall 9+ 处)→ 保留
- ✅ co-location 死簇仍在,仅 `deriveKnowledgeMetaLayer` 已被并行删(从死清单移除)
- 🔧 **修正**:recall.ts `extractBody` 非死重复实现,是 **行 419 `export { extractBody }` 死 re-export**(内部 import+用 _shared 版,行 19/282 保留)→ 删一行即可
- ✅ i18n G1/G3(en/zh 各 3 处)+ self-archive 旧名(bootstrap 1 处) tendril 仍在

## ⚠️ 贯穿性事实:核心目标全与测试改动耦合(无"快速干净删")
- co-location 死簇:`writeKnowledgeMeta`(测试 fixture,被 doctor.test/doctor-i18n.test 用)内部链式调用 dead-export 函数 → 删死簇必须连带改 ~13 处 fixture + skip-triage
- vocab shim:删 remap 必须连带改 cite-line-parser.test / event-ledger.test 的 legacy 断言 + i18n 文案 + rebuild shared dist
→ 所以 Wave 1/3 都不是孤立删除,**与 skip-triage / fixture 改动是同一坨工作**,需在干净会话里逐测试做。

## 已执行
- [x] recall.ts:419 死 re-export 删除(零功能影响,验证流水线)

## 下一步(建议干净会话,以本文档为 spec)
Wave 0 余(seed regen+diff / 105-skip triage / census 不变式闸)+ Wave 1 co-location 死簇(耦合 fixture)→ Wave 2 迁移 → Wave 3 vocab shim(rebuild dist)。

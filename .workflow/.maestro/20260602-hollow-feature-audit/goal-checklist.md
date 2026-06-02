# goal-checklist — 20260602-hollow-feature-audit(模式②审计)

> status.json 是真源,本文件是投影视图 + 行动手册。

## 目标(一句话)
用「查电线」四 oracle 把 Fabric 声明面全扫一遍,产出全部 confirmed **空壳功能**(装好没接电)。**只发现不修复。**

## 终止判据(/goal 判什么停)
两条 ship_criteria 全绿:
- **G-CENSUS** — 声明面全集 census 完成(CLI 命令 + MCP tools + multi-store/sync 数据面 + schema 字段 全标 in/out 并跑过适配 oracle)
- **G-DRY** — 连续 2 轮扫不出新 distinct confirmed 空壳(loop-until-dry)

## 边界契约
- **in**:packages/{server,cli,shared}/src 的接线缝、命令树、store/sync 数据面、schema 声明 vs 实现、hook 注入面
- **out**:修复(归 global-refactor goal)、性能/重构/美学、test 自身 bug、node_modules/docs/assets
- **铁律**:候选先过 deterministic grep verify 才进 findings;census 先于 narrowing;Oracle1/2 纯 grep 先跑,Oracle4 dogfood 后跑

## 发现引擎
`~/.claude/skills/goal-mode/bug-oracle-catalog.md`(本 loop A0 已写实):
1. **producer-consumer 断裂** — producer 无 consumer import(server 零 loadGlobalConfig)★第一刀
2. **declared-vs-impl** — 命令/字段 trace 到实现是 stub/no-op
3. **doc-vs-code** — 文档声称的能力代码里没有
4. **round-trip 不变量** — write→read 0 命中(dogfood)

## 进度 — ✅ COMPLETED (3 round, loop-until-dry 收敛)
- [x] **A0** 反哺:写实 bug-oracle-catalog.md ✅
- [x] **Round 1** store/sync/recall 数据面 → 3 confirmed(F1/F2/F3,全 multi-store 簇)+ 3 refuted
- [x] **Round 2** hook 注入面/vector/剩余命令 → 0 新 confirmed(4 refuted)
- [x] **Round 3** 4 MCP tool/知识图谱边/广义零消费 → 0 新 confirmed(全 refuted)
- [x] **收口** G-CENSUS✅ + G-DRY✅(R2+R3 两轮 dry)→ status=completed

## 终态结论
**Fabric 当前唯一真空壳簇 = multi-store / sync 接线(已知 F-MULTISTORE-UNWIRED)**,符号级精确定位为:
- **F1** `readKnowledgeAcrossStores`/`listStoreKnowledge`/`aggregatePendingAcrossStores` 实现了零消费者;server 零 import store 层;recall 只读单 project → multi-store 读侧空壳
- **F2** `run-sync.ts` 仅 pull+rebase,全仓零 `git push` → sync 推送空壳
- **F3** store 写能力仅 CLI 消费,与 server 读面物理断 → 写读面断

**无 NEW distinct 空壳**。7 个疑似候选全 refuted(verify 拦住误判)。修复 defer→global-refactor goal。

## 已知锚点(round 1 起点,非空壳清单上限)
- server `packages/server/src` 对 `loadGlobalConfig`/`stores/` 引用 = **0**(已 grep 坐实)→ recall 不读 multi-store
- sync `packages/cli/src/sync` 无 `git push`(已 grep 坐实)→ sync 零推送
- (这两条是 F-MULTISTORE-UNWIRED 的 facet,本 loop 记录但不修;真值是找出**还有没有别的同类空壳**)

## Resume
续跑:`/goal-mode continue`(推进一步 + 重检 G-CENSUS/G-DRY)。
状态:`/goal-mode status`。

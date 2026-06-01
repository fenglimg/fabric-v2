# Goal Checklist — maestro-flow 基础设施层挖掘 → Fabric 吸收决策包

> **真源是 `status.json`,本文件是投影视图。** mode ② 审计驱动。
> 终止判据: `ship_criteria` 四门全绿 (G-INFRA-COVERAGE 6/6 + G-DECIDE 100% + G-PAIN-ALIGN 100% + G-GROUNDED 100%)。

## 目标

源码级(file:line)拆透 maestro-flow 支撑 spec/wiki/knowhow 的**基础设施层** —— 检索引擎 / 索引构建+持久化 / payload scale 控制 / CJK tokenization / 图遍历检索 / 向量语义层 —— 对照本轮 grep 核验的 Fabric 现状,产出 **infra 吸收决策包**,全程强制对齐两痛点:① hook 注入"选什么"的相关性质量 ② MCP payload 大体量 scale。

## 与上一轮的关系

上一轮 `20260529-maestro-flow-mining`(已 completed)挖的是**抽象层**(spec格式/scope/category/注入触发链/connect-digest-health 抽象)。本轮**下沉到支撑它们的 infra**,正交不重叠。

## 边界契约

**IN**: maestro infra 源码(search.ts BM25 / spec-keyword-index 倒排 / wiki-indexer 索引构建 / PersistedWikiIndex 持久化 / payload top_k+截断 / CJK n-gram / 图遍历检索);每条 → Fabric 吸收判定 + 强制映射两痛点之一。
**OUT**: 写 Fabric 代码;重挖上一轮抽象层;dashboard 可视化渲染(图遍历**检索算法** IN,渲染 OUT);v2.1 全局化落地;重挑战 B1-B8 / Part E。
**关键约束**:
- file:line 为准。
- **Fabric 现状(本轮 grep 核验)**: MCP `plan-context.ts:262→301` 返全候选**无 `.slice(0,k)`**;`recall.ts` 无 top_k;评分 `scoreDescriptionItem(plan-context.ts:619)` 仅 recency+locality(path)**无内容相关性**;无 BM25/tf-idf/倒排/embedding;hook 侧有 `hint_broad_top_k:8`/`hint_narrow_top_k:5`/`hint_summary_max_len:80`。
- **no-server-filter 已松绑**(用户 2026-05-29): 降级"非必须、可重评",**不再一票否决检索优化候选**。
- 护城河 Part D 其余(doctor lint/lifecycle/MCP-first/path-binding/cite contract)冲突仍必标。
- absorb 必带 `pain_target ∈ {injection-quality, mcp-payload-scale}`,诚实标"两边都没有"(如向量)不为吸收而吸收。

## 执行准则(行动手册)

1. 每个 B 任务 = 读 maestro infra 源码 → 抽实现机制(file:line) → 对照 Fabric 现状 → 落 1+ 吸收候选(带 pain_target)进 `candidate_pool`。
2. 候选 schema: `{id, source_subsystem, mechanism, feasibility, effect, moat_conflict, pain_target, verdict, priority}`。
3. 边挖边冒的新点 → candidate_pool(挂 source);新该读子系统 → task_decomposition carry-over。
4. B7 综合对 absorb 跑 G-GROUNDED 双冷评;**maestro 源端核验用 codex(能跨目录),gemini 锁 Fabric 侧**(上一轮 gemini --cd 锁 pcf 导致 maestro 源 sandbox 假阴性的教训)。
5. drift gate: 每 5 task close 自检 direct+indirect 对齐 <60% → 停报。

## Round 1 清单(round_task_ceiling=10, 已用 7)— ✅ converged

- [x] **B1** 检索引擎 — `search.ts:101-163` 真 BM25(idf/k1/b)+字段加权+倒排 vs Fabric `scoreDescriptionItem:619` 仅 recency+locality → A-INFRA-1
- [x] **B2** 索引构建+持久化 — `wiki-indexer.ts:64-127` single-flight 懒重建/`:527` persistIndex 剥 body → A-INFRA-4 reject(无 pain 对齐)
- [x] **B3** payload scale — 全链路 top_k(`search.ts:162` slice/`injector:142` cap5/walker:466) vs Fabric `:262/:458` 无 .slice 返全候选 → A-INFRA-3 P0
- [x] **B4** CJK tokenization — `search.ts:37-89` 2-3gram 查询/文档同 tokenizer vs Fabric 无 CJK → A-INFRA-2 P1
- [x] **B5** 图遍历 — `graph-walker` 是 workflow 编排(OUT);`graph-analysis` 是治理/健康度非检索;`query/search` 不做图扩展 → A-INFRA-5 reject
- [x] **B6** 向量层 — 两侧 grep 零行 → A-INFRA-6 reject(跟随成熟 maestro 的 lexical 选择)
- [x] **B7** 横向综合 — candidate_pool 6 条四字段齐全 + 双冷评 quorum=2/2 GROUNDED + 落地序列

## Ship Criteria 进度 — ✅ 四门全绿 (2026-05-29)

- [x] **G-INFRA-COVERAGE** 6/6 子系统 — actual: 6/6 done
- [x] **G-DECIDE** 候选三判定齐全 100% — actual: 6/6 feasibility/effect/moat_conflict 非空
- [x] **G-PAIN-ALIGN** absorb 映射两痛点 100% — actual: 3/3(injection-quality×2 + mcp-payload-scale×1)
- [x] **G-GROUNDED** absorb 效果 Fabric 代码实证 100% — actual: gemini(Fabric 侧)+codex(maestro 源)双冷评一致 GROUNDED

## Resume

推进下一步: `/goal-mode continue`(推进一个 B 任务 → 取证 → 原子更新 status.json → 重检 gate)。
查看进度: `/goal-mode status`。显式收尾: `/goal-mode close`。

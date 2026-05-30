---
name: fabric-connect
description: 知识图谱关联门面 — 发现 KB 条目间隐藏关联并回写 H2 `related` 图边。读 fab_recall/fab_plan_context 看候选, 按语义/共路径/共引提议 related 边, 经 fabric-review 写路径落盘。Triggers 连接知识/找关联条目/建知识图谱/link related entries/补 related 边/知识库连通性.
---

# fabric-connect — 知识图谱关联

把孤立的 KB 条目连成图:发现彼此**隐藏关联**(同一决策的正反面、pitfall↔规避它的 guideline、被取代↔取代),回写到 frontmatter 的 `related: [<stable_id>...]` 图边(v2.2 H2)。下游 `fab_recall include_related:true` 据此一跳拉回连通知识。

`related` 是**有向引用**(A.related=[B] 表示「读 A 时也该看 B」),按需补反向边(B.related=[A])。

## When to use

- 「把这些知识连起来」「找出相关条目」「补 related 边」
- 「知识库连通性怎样?」「有哪些孤岛条目?」
- 新增一批条目后想建立彼此引用。

## When NOT to use

- 写新条目 → `fabric-archive`。
- 审 pending / 退役陈旧 → `fabric-review` / `fabric-audit`。
- 检索时临时拉关联 → 直接 `fab_recall include_related:true`(无需建边)。

## 关联类型(提议 related 边的判据)

| 类型 | 例 |
|---|---|
| 互补 | decision「用 JWT」 ↔ pitfall「JWT 过期未刷新踩坑」 |
| 规避 | pitfall「sprite 黑边」 ↔ guideline「premultiplyAlpha 正确设置」 |
| 取代 | 旧 decision ↔ 取代它的新 decision(配合 deprecated/superseded-by) |
| 同域 | 同一子系统 / 共 relevance_paths 的条目 |
| 引用链 | A 的 rationale 依赖 B 的结论 |

## 流程

1. `fab_recall(paths=[...])` 或 `fab_plan_context` 拿候选 + 现有 `related`(读 description.related 看已连状态)。
2. 对候选两两/成簇判隐藏关联(用上表判据);只提议**高置信**边,不为「话题相邻」乱连(噪声边稀释图价值)。
3. 每条提议 = `(源 id, 目标 id, 类型, 一句理由)`;按需提议反向边。
4. 落盘经 `fabric-review` 写路径:在源条目 frontmatter 的 `related` inline 数组追加目标 stable_id;`fabric doctor --fix` reconcile 进 agents.meta。
5. 回报新增/反向边数 + 连通性变化(孤岛减少)。

## Constraints

- 本 skill **只提议 + 经 review 写路径落盘**;不自行改 `.fabric/knowledge/`,不手改 `agents.meta.json`(派生态)。
- `related` 只填**真实存在的 stable_id**(先 `fab_recall` 验证目标在库),不编造 / 不指向 pending。
- **稀疏优于稠密**:宁缺毋滥。只连高置信关联;低置信「相邻」不连(图的信噪比比覆盖率重要)。
- 反向边按需补,不强制双向(有向语义:A 该带出 B ≠ B 该带出 A)。
- 写 `related` 复用 H2 字段(`fabric-review` 的 modify 路径);schema 已支持,无需迁移。

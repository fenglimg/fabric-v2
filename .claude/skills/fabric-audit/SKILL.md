---
name: fabric-audit
description: 知识库语义淘汰门面 — 审计 KB 健康并以 deprecate-over-delete + rescue-before-delete 收口陈旧/孤儿/被取代条目。引擎是 `fabric doctor`；本 skill 按用户意图挑动作并守「不硬删、先抢救」红线。Triggers 审计知识库/清理陈旧知识/知识库体检/deprecate 条目/prune stale knowledge/知识库瘦身/淘汰旧决策.
---

# fabric-audit — 知识库语义淘汰

知识库 *维护期* 的对话入口:体检 KB,把陈旧 / 孤儿 / 被取代的条目按 **语义淘汰** 收口 —— 而不是一删了之。CLI (`fabric doctor`) 是引擎(跑 lint、算 health、给 orphan/stale 信号);本 skill 按用户意图挑动作,并守两条红线:**deprecate-over-delete** 与 **rescue-before-delete**。

写新条目用 `fabric-archive`;批量审 pending 用 `fabric-review`;本 skill 专管 *已归档条目的退役*。

## When to use

- 「审计 / 体检知识库」「知识库健康度怎样?」
- 「清理陈旧知识」「这些旧决策还要吗?」「知识库瘦身」
- 发布 / 大重构前想把过时知识收口。
- doctor 报了 orphan / stale / 低 health,想逐条处置。

## When NOT to use

- 写 / 提议新知识条目 → `fabric-archive`。
- 批量审 pending draft → `fabric-review`（内部走 `fab_review action="list"` / `pending_path`）。
- store 运维 / 同步 → `fabric-store` / `fabric-sync`。

## 两条红线

1. **deprecate-over-delete**:陈旧 ≠ 该删。一条「当时为什么这么决策」的 decision/pitfall 即使方案已换,其 **rationale 仍是知识**。退役 = 降 maturity / 标记 deprecated(保留正文 + 记录被什么取代),而非 `rm`。删除只用于「从未成立 / 纯噪声 / 重复」的条目。
2. **rescue-before-delete**:任何 *打算删* 的条目,删前必做抢救检查 —— 它是否携带别处没有的独特 rationale / 反例 / 边界?有则先 **merge 进取代它的条目**(或在新条目加 `related` 边指回),再删空壳。抢救检查没做过,不许删。

## 意图 → 动作映射

| 意图 | 动作 |
|---|---|
| 体检 / 健康度 | `fabric doctor`(读 lint + health rollup);零阻断,只报告 |
| 找孤儿 / 陈旧条目 | `fabric doctor`(消费 orphan / stale / orphan-demote 信号) |
| 退役一条陈旧条目 | **不删** → 降 maturity(proven→verified→draft)或在 frontmatter 标 deprecated + 记 superseded-by;经 `fabric-review` 落盘 |
| 删一条「从未成立 / 重复」条目 | 先跑 rescue 检查(独特 rationale?有则 merge/加 related);确认空壳后才删 |
| 被取代但有价值 | rescue:把独特 rationale merge 进取代条目,新条目加 `related` 边指回,再退役旧条目 |

## 流程(逐条处置)

1. `fabric doctor` 取 KB health + orphan/stale 候选清单(引擎给信号,本 skill 不自算)。
2. 对每个候选判 **三态**:still-valid(留) / superseded(退役,走 deprecate) / never-valid(删,走 rescue 检查)。
3. superseded → deprecate:降 maturity 或标 deprecated + `superseded-by`,保留正文 rationale。
4. never-valid → rescue-before-delete:独特知识?有则 merge + `related`,无则删空壳。
5. 处置经 `fabric-review` skill 落盘(本 skill 给决策,review 做写入),保持单一写路径。

## Scope re-assignment(迁移 / backfill 后纠偏)

`fabric store backfill-scope` 给老条目补 `semantic_scope`,**默认把所有 team-layer 条目标成 `semantic_scope: team`** —— over-broad 的保守默认,会让项目专属知识错误地暴露给所有项目。审计时按下面的测试纠偏:

- **team-scope 判定测试**:「换一个**没有本 app 代码**的不同 repo,这条知识还成立吗?」—— 成立才是 `team`。
  - app **内部**跨功能 / 跨玩法复用的共享组件(同一 app 多处用)**≠ team** —— 它仍绑这个项目,应是 `project:<id>`。**跨玩法复用 ≠ 跨项目复用**(如语音房 VoiceRoom 被多个玩法共用,仍是 `project:<id>`)。
- **纠偏动作**:把被默认成 team 的项目专属条目降级 ——
  `fabric store re-scope <store> --to project:<id> --id <id>`
- 完整判定树 / worked examples 见单一真源:`fabric-archive/ref/phase-3-7-semantic-scope.md`(本 skill 不重述,避免镜像漂移)。

## Constraints

- 本 skill **只读 + 给处置建议**;实际写入(降级 / 标记 / 删)经 `fabric-review` 的写路径,不自行改 store `knowledge/`。
- NEVER 绕过 rescue 检查直接删;删前 MUST 先跑抢救检查。删是最后手段,默认是 deprecate。
- store counters 派生态严禁手改;退役动作改的是 store `knowledge/<type>/` 下 markdown 的 frontmatter(maturity / deprecated / superseded-by),再 `fabric doctor --fix` reconcile。
- health / orphan / stale 一律取自 `fabric doctor` 的 JSON 输出,不在 skill 内重算(单一真源)。

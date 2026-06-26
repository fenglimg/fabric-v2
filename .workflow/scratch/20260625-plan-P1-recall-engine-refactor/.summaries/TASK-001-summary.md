# TASK-001: 暴露召回 score + 信号分解（score_breakdown）

Commit: `682359c2289fa33b77f5c98667287ffb9bcde009`

## Changes
- `packages/shared/src/types/agents.ts`: 新增 `RecallScoreBreakdown`（numbers-only：final/bm25?/bm25_rank?/vector?/vector_rank?/salience/recency/locality）与 `RecallScore`（score + score_breakdown）。**未**给 `RuleDescriptionIndexItem` 加 score 字段（见 Deviations — 防 plan-context payload 膨胀）。
- `packages/server/src/services/plan-context.ts`: ① 新增 `scoreBreakdownForItem()`——逐分量复刻 `scoreDescriptionItem`，`final === scoreDescriptionItem(...)`，纯观测、不喂排序。② 在原 `survivingScored.map(entry => entry.item)` 处旁建 `candidateScores: Map<stable_id, RecallScore>`（捕获 sort 已算出的 score）。③ `PlanContextResult` 加运行时 `candidate_scores?: Map`（序列化为 `{}`，不上 wire payload），仅 `candidateScores.size > 0` 时挂。
- `packages/server/src/services/recall.ts`: `RecallEntry` 加 `score?` / `score_breakdown?`；从 `planResult.candidate_scores` 读分并折进 entries（conditional-spread，scoreless 候选自动省略）；`candidate_scores` 从 `RecallResult` Omit 掉 + 解构剔除（不 re-surface 裸 Map）。
- `packages/shared/src/schemas/api-contracts.ts`: `_recallEntrySchema` 加 `score: z.number().optional()` 与 `score_breakdown: z.object({...}).optional()`；`recallOutputSchema.entries` 引用该 schema 自动携带（防 Zod strip，KT-PIT-0005）。
- `packages/server/src/services/recall.test.ts`: 新增 round-trip 用例 “exposes a numeric score + numbers-only score_breakdown per entry, surviving schema round-trip”——断言 entries[0].score 为 number、breakdown 全 number、`breakdown.final === score`，且 `recallOutputSchema.parse(result)` 后 score/score_breakdown 不被 strip。

## Verification (convergence.criteria)
- [x] C1 `grep score_breakdown recall.ts` 命中：L64/198（entries map 写出该字段）。证据：`...(scored ? { score: scored.score, score_breakdown: scored.score_breakdown } : {})`。
- [x] C2 `grep score_breakdown api-contracts.ts` 命中且在 `_recallEntrySchema` 内为 `.optional()`：L521-532（`score_breakdown: z.object({...}).optional()`，位于 L497 起的 `_recallEntrySchema`）。
- [x] C3 `grep 'score: z.number().optional()' api-contracts.ts` 命中：L516。
- [x] C4 recall.test.ts 断言 entries[0].score typeof number + round-trip 不 strip：新用例 L410。
- [x] C5 `pnpm test -- recall.test.ts` 全绿：`Test Files 68 passed (68) / Tests 794 passed (794)`，TEST_EXIT 0。
- [x] C6 `pnpm -r exec tsc --noEmit` 无 error：EXIT 0（全 workspace）。

## Tests
- [x] `pnpm --filter @fenglimg/fabric-server test -- recall.test.ts`: 794 passed / 68 files。
- [x] `pnpm -r exec tsc --noEmit`: exit 0。

## Deviations
- **改了 5 个文件，task 列了 4 处**：`packages/shared/src/types/agents.ts` 是 `RecallScore`/`RecallScoreBreakdown` 的类型归属处，属必要的 schema 支撑边（additive、optional）。
- **未按 task.action 字面把 score 透传到 candidate item**：初版照字面给 `RuleDescriptionIndexItem` 加 score + 把 breakdown 挂上 map 出的 item，结果 `plan-context.test.ts` 的 “single-path payload stays under 4000-token budget” 红（4123>4000）——score_breakdown 泄漏进 plan-context wire payload。改为「plan-context 用运行时 `candidate_scores` Map 承载（序列化为 {}，零 payload）→ recall 折进 entry」。这更贴合 LOCKED「只在 fab_recall 暴露 score、不改 plan-context wire」与 lean read_path 契约，且 plan-context payload 预算守住。最终目标态（fab_recall 每条 entry 带数值 score + 可选 breakdown、round-trip 不丢）完全达成。
- **`bm25_rank` / `vector_rank` 当前不填值**：仅在 schema 声明（防后续 RRF 波次被 strip）。理由：LOCKED「只 EXPOSE 已算出的 score」——这两个 rank 当前 scoring 没算，填它们等于引入新排名计算。schema 声明为 optional、未来波次填。

## Notes
- score 仅在「有 query / 进入 scored cut」的候选上出现；broad 无 query 探测 + related-appended 邻居为 scoreless，entry 自动省略 score/score_breakdown（steady-state wire 不变）。
- 后续融合波次（W2-W5 / RRF）：从 `candidate_scores` Map 读分即可，`bm25_rank`/`vector_rank` schema 已就位待填。
- 改 shared schema 后已执行 `pnpm --filter @fenglimg/fabric-shared build`（KT-PIT-0005 / 项目 gotcha）；本 worktree 首次需 `pnpm install` + `pnpm --filter @fenglimg/fabric-server build`（CLI tsc 依赖 server dist）。

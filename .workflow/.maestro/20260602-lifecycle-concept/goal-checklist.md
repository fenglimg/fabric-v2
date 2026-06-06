# goal-checklist — 20260602-lifecycle-concept（mode④ 探索/优化）

> status.json 真源，本文件投影视图。推进入口：`/goal-mode continue`。

## 目标
4-LLM panel（codex / gemini / claude-delegate / agy）+ claude 主裁判，收敛出最优的
**「完整生命周期概念分别去做什么」**设计 → 产 2 文档（评判 ledger + 最终版）。

## 边界契约
- **in**：设计 Fabric 知识层在每个生命周期阶段该做什么；覆盖 Hook 8 阶段 + Todo/Skill内容/会话模式；产 2 文档。
- **out**：实现 hook 代码 / 改 Fabric 源码 / 改现有 cite·archive 行为。
- **约束**：4 LLM 共享 `.scratchpad/lifecycle-baseline.md`（防术语 desync）；主裁不算独立票；冷评 ≥2 票含 ≥1 零上下文；收敛即停不过拟合。

## 终止判据（mode④）
`audit_rounds[-1].convergence_gate.terminate_reason != null`
→ `converged`（连续 2 轮无 distinct 改进）｜`budget_exhausted`（满 5 轮）｜`needs_human_pick`（冷评无共识胜者）。

## 进度
- [x] **S1** 锁定 Phase0 对齐 baseline（`.scratchpad/lifecycle-baseline.md`）✅
- [ ] **S2** 起第一轮 4-LLM panel → 回收 4 候选
- [ ] Round1 主裁 synthesize v1 → 4-LLM 零上下文冷评 → 收敛判定
- [ ] …（多轮 carry，直到 terminate_reason 落定）
- [ ] 产出 `lifecycle-concept-final.md` + 收尾 [[FINAL_NOTIFICATION]]

## 候选池（incumbent 指针见 status.json）
| id | 镜头 | status | score |
|---|---|---|---|
| C1-codex | backend | pending | — |
| C2-gemini | fullstack | pending | — |
| C3-claude-delegate | 独立冷评票 | pending | — |
| C4-agy | flash 第四票 | pending | — |

## Resume
中断后：`/goal-mode continue`（读本 checklist + status.json 取手册，推进下一步）。

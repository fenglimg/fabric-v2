# Goal Checklist — 20260530-impl-roadmap（mode ④ 探索/优化）

> status.json 是真源，本文件是投影。Resume → `/goal-mode continue`。

## 目标
汲取审计 66 surface 决策 → 起草实现 roadmap → cross-LLM 冷评迭代到收敛取最优。

## 终止判据（收敛 gate）
连续 **2 轮** cross-LLM 冷评（gemini+codex 含零上下文）无新增结构性改进 **OR** 5 轮预算耗尽 → 取最优 roadmap 版本。收敛即停（反过拟合）。

## 质量 rubric（5 维，冷评打分轴）
1. 完整性（覆盖 66 surface 零遗漏）
2. 排序/依赖（StoreResolver-first / 拓扑无环）
3. 颗粒度（可执行 / 有 done_when）
4. 风险前置（破坏性 / 迁移 / 测试基建）
5. 对齐回指（每 phase 指 surface）

## 边界
- 只 source 审计决策，不推翻已锁 66 surface
- 只产 roadmap 不写实现代码
- defer 项不展开（store 自带 skill / org / true-private overlay）

## 行动手册（每轮 /goal-mode continue）
1. 取 incumbent roadmap（当前 `roadmap-v{N}.md`）
2. cross-LLM 冷评打分 + 列结构性改进
3. 按改进产新版本 `roadmap-v{N+1}.md`（无改进则 streak+1）
4. 更新 incumbent / candidate_pool / convergence_gate
5. 重检收敛 gate；未达成自调下一轮

## 当前状态：✅ 已收敛（CONVERGED）
- 最优产物：`roadmap-v4.md`（terminate_reason=converged，连续 2 轮 round4/5 双路无新增结构改进）
- 质量轨迹：v1 75 → v2 89 → v3 94 → v4 ~99
- 收敛证据：gemini（零上下文）+ codex（接地验证锚）round4/5 均判 NO NEW STRUCTURAL IMPROVEMENTS；66 surface 零遗漏、严格拓扑无环、三依赖链（parity/bindings/pending）闭合、done_when 全可验

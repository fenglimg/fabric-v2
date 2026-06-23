# Goal Checklist — 20260622-fabric-ux-strategy(模式④ 探索/优化驱动)

> status.json 为唯一真源,本文件是投影视图。

## 🎯 目标
产出 fabric 在【交互 + 策略】两层的迭代最佳方案 + 后续功能集成路线(以 maestro-flow 为思路源),经多-LLM 零上下文冷评迭代收敛取最优。

## 🛑 终止判据(/goal 判停)
`audit_rounds[-1].convergence_gate.terminate_reason != null`:
- `converged` — 连续 2 轮无人打赢擂主(no_improvement_limit=2)
- `budget_exhausted` — 跑满 4 轮(max_rounds=4)
- `needs_human_pick` — top 候选冷评打平(≤5 分)且多-LLM 裁不动 → 浮你

## 🧱 边界契约
- **in**:交互层(4 时刻 HUD/archive/nudge/edit-time)/ 策略层(字段模型 + cite + self-archive)/ 后续功能集成
- **out**:写码 / 执行破坏性迁移 / 改 maestro-flow
- **约束**:只设计不动码 · 锚定三来源 · 零用户 clean-slate · 体感必须 > maestro-flow · 中文

## 🥊 擂主(incumbent)= C0-grilled
grilling 收敛方案,挑战者要打赢它:
1. **交互①** 单 HUD:每节奏一个人可读面(SessionStart 报盘点+1待办;PreToolUse edit-time 一行;Stop 闭嘴)
2. **交互②** archive 11→3 机器 stage,人工审核挪下游单次,3 stage 做成所有入口共享内核
3. **交互③** nudge 响应式渐强,从 Stop 搬到 SessionStart
4. **策略④** 字段 5→3:`layer`(硬边界)+ `scope`(团队内粒度,从属 layer)+ `when`(空=broad/glob=narrow)

## 🧭 探索轴
交互信息架构 · 字段模型简化 · cite/self-archive 内化 · 功能集成选型(maestro→fabric)

## 📊 进度
- **Round 1**(explore):发起 gemini(交互视角)/ codex(策略视角)/ agy(集成视角)三挑战者 → 各出提案 → 零上下文冷评 vs 擂主 → 综合 incumbent → 检收敛

## ▶️ Resume
续跑:`/goal-mode continue`(推进一步 + 重检收敛 gate)。状态:`/goal-mode status`。真源:`status.json`。

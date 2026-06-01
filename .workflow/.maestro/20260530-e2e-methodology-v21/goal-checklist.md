# Goal Checklist — v2.1 E2E/dogfood 旅程测试方法论迭代优化

> **status.json 是真源, 本文件是投影视图。** 模式④ 探索/优化驱动。

## 目标

v2.1 全局多 store 重构(`maestro-20260530-v21-impl` 已 completed)后, 旧 E2E/dogfood 用户旅程方法论(为单 .fabric co-location 设计)已 stale。多轮迭代出一份**贴合 v2.1 多 store 现状的 E2E dogfood 旅程方法论**, 经多-LLM 零上下文冷评迭代至**收敛(连续 2 轮无提升)或预算(5 轮)耗尽**, 取最优版本。

## 边界契约

- **In**: 锚定 baseline → 蒸馏 v2.1 journey 覆盖面 → execute/evaluate(冷评)/improve 循环 → 收敛取最优落地。
- **Out**: 不改 v21-impl 产品代码; 不碰其遗留 2 条 needs_adjudication; 不真跑全量 E2E(产出是方法论, 非测试运行); UX-19 类 GUI 手动 fire-test 仍 user-only。
- **Constraints**: 冷评必须 ≥1 零上下文(不信执行者自评); 行为型 rubric; 反膨胀(+20% 行无 justify 扣分); verbatim 采纳冷评 fix; 写路径防泄漏(共享库不含 personal)。

## 执行准则(记忆 doctrine)

1. **执行者自评不可信** — claude 自评天然乐观(项目先验 + 对不完备规则善意补全), gemini/codex 零上下文冷评的 gap 才是优化全部真信号。
2. **行为型 rubric** — 每条 journey 是否覆盖 v2.1 新面 + 可照字面跑通 + 判得对; 不要风格型(读着顺), 否则越改越长刷分。
3. **improve 只改 weakest** — verbatim 采纳冷评 suggested fix, 不自创变体。
4. **收敛即停** — 已收敛后续 loop = 负收益(过拟合 rubric + prompt churn)。真增益杠杆是扩 journey 集(content), 不是更多 loop。

## Exploration Axes(v2.1 新面, journey 必须覆盖)

- [ ] 多 store install/binding 旅程(receipt/回滚/恢复/bindings 快照)
- [ ] scope 阶梯 resolution 旅程(双轴 + store tie-break + personal layer 读集隔离)
- [ ] store-qualified cite 旅程(per-store stable_id + provenance 可见化)
- [ ] 跨库 pending 聚合 + review 旅程
- [ ] 写路径防泄漏旅程(共享库绝不含 personal scope, R5#3 negative case)
- [ ] 三端 CC/Codex/Cursor store parity 旅程(install→recall→cite→archive 端到端对齐)

## Setup 任务(Round 1)

- [ ] **T0** 锚定 baseline v0: 汇集旧 dogfood 方法论(ux-closure UX-N + ANL-2026-05-08 结论 + cold-eval harness)成单页 incumbent v0
- [ ] **T1** 蒸馏 v2.1 journey 覆盖清单(带验收点 + 可执行 fixture 方向)

## 终止判据(mode④)

`audit_rounds[*].convergence_gate.terminate_reason != null` ——
`converged`(连续 2 轮冷评无提升) | `budget_exhausted`(满 5 轮) | `needs_human_pick`(top 版本冷评打平, 差在未建模维度)。

## Resume

推进下一步: `/goal-mode continue` —— 推进一个 setup task 或跑一轮 execute→冷评→improve, 跑 verification, 原子更新 status.json, 重检收敛 gate + drift gate, 未达成自调下一步。

---

## ✅ CONVERGED (2026-05-30, 12 轮, 三轴)

`terminate_reason=converged` · `status=completed`。

- **三阶段**: round1-3 深度轴(grounded, 逐签名 over-fit→收口) → 用户 reframe pivot 广度轴(round4-8, GAP 11→0) → **用户 frame-challenge 重开交互轴**(round9-12, D 维 6→9 锚 HAX)。
- **交付**: `.scratchpad/e2e-methodology-FINAL.md` —— **三轴**(深度 anchor / 广度 J-META census 8源 / 交互 J-EXP-META D1-D9 锚 HAX 18) + 统一收口律 + 4层可观测(T1-ledger/T1-online/T2/T3) + J1-J40 + 9 个 NEW-N-3 埋点事件。
- **★最深洞察**: ① critic 在 frame 内审计, 只有 human 能挑战 frame(裁决阶梯 human 不可替代) ② 统一收口律: 长尾枚举(签名/surface/体验维度)→生成式 pattern(anchor/census/taxonomy 锚 HAX)吸收为 data ③ 可观测性是 (journey×埋点) 的函数, 加事件把 T3 下沉 T1/T2。
- **4 条真实产品发现(NEW-N, 待提单)**: ①无 git push 环未闭 ②parity 仅7cap ③9事件 instrumentation 债 ④强策略 over-compliance 风险。

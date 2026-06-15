# Goal Checklist — 2.2.0 发版前体检 + 常驻评测集 v1 (mode③ 混血)

> status.json 是真源,本文件是投影视图。终止判据 = 12 命名 ship gate 全绿(降级项显式记账)。
> 源:GOAL-BRIEF.md(2026-06-15 grill 收敛全集)。当前版本 2.2.0-rc.6 → 目标摘 -rc 发 2.2.0。

## 边界契约
- **IN**:Cursor 砍除 PREREQ · 5面×6维评测 · 6盲区 · 诚实性 a-e · G-OBSERV 补埋点 · G-PERF recall/hook size · G-SAFETY 红队 · cc+codex 中立剧本 · 报告①-⑤ + 基线固化
- **OUT**:完整混沌工程 · 追高好习惯% · Cursor 三端 · 池外候选(向量等)
- **constraints**:改 shared 必 rebuild dist · release-rc 全绿后才跑 · 临时仓先 fabric install · LLM-judge 零上下文冷评 · 降级显式记账 · 快照 -u 前肉眼 diff

## 命名 Ship Gate(全绿即自动 completed)
- [~] **PREREQ-0** Cursor 砍除 — DEFERRED 到外部分支(非本 goal scope)
- [x] **G-MACHINE** (硬) ✓ 全绿(test 2403/0)— 修 F1 store-only-e2e false-red @cdea9fb
- [ ] **G-CENSUS** (硬) registry 派生清单逐项映射无空壳 + 每面 usage 事件
- [ ] **G-OBSERV** (硬) 死电线显式记账 + 补埋点(解锁 G-HABIT 前置)
- [ ] **G-NOFAKE** (硬) cc+codex 剧本后 cite-coverage 编造ID=0
- [ ] **G-HABIT** (软) 漏斗指标非零过底线 baseline;codex 分诊记账
- [ ] **G-PERF** (硬) per-surface 延迟+payload/token 阈值;recall 27KB+hook size 测量定阈
- [ ] **G-DISPLAY** (软) 漂移快照+错渲染硬闸;主观经 B 冷评筛不卡
- [ ] **G-SAFETY** (硬) 隐私/预算 + KB投毒/注入红队 + loop压测 + path越权
- [ ] **G-UPGRADE** (硬) 2.0.1→2.2 install 刷新 stale hook
- [ ] **G-RESILIENCE** (硬) 并发多会话隔离 + MCP挂降级
- [ ] **G-SELFAUDIT** (硬) registry 有功能无成绩单行→亮红
- [ ] **G-HONEST** (硬) 诚实性 a-e 全过
- [ ] **G-SHIP** (硬) 全绿 → release-rc 摘 -rc 发 2.2.0 + 固化常驻 v1

## 执行顺序(round 1)
0. PREREQ-0 砍 Cursor
1. T1 维度1/4/6+盲区2 基线快跑
2. T2 G-OBSERV 死电线 + hook size/recall payload 测量
3. T3 维度3 行为(cc/codex 剧本)→ G-NOFAKE + G-HABIT baseline
4. T4 G-UPGRADE 升级旅程
5. T5 多store round-trip + 并发 + MCP降级
6. T6 维度5 画面采集 + B 冷评
7. T7 G-SAFETY 红队
8. T8 G-CENSUS + G-SELFAUDIT
9. T9 报告 ①-⑤ + G-HONEST + 固化

## 裁决三级阶梯
① AI 自决(test/grep/tsc/measure) → ② 多-LLM 冷评(maestro delegate gemini/codex,≥2票含≥1零上下文) → ③ human(needs_adjudication 队列,round 末批量浮)

## Resume
推进:`/goal-mode continue` · 状态:`/goal-mode status` · 收尾:命名 gate 全绿自动 completed(无需手动 close)
commit 节奏:每 gate 收口 `git add -A && git commit` → sha 回填 status.json git_commits[]

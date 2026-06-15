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
- [x] **G-OBSERV** (硬) ✓ 死电线红账(18 真死)+ F3 行为遥测→ADJ-1 降级 @5dc5349
- [ ] **G-NOFAKE** (硬) cc+codex 剧本后 cite-coverage 编造ID=0
- [ ] **G-HABIT** (软) 漏斗指标非零过底线 baseline;codex 分诊记账(F3 阻塞 skill/judge 维度)
- [x] **G-PERF** (硬) ✓ 延迟绿 + 注入3650B✓/recall24-29KB(over-warn 在65K hard内)PASS @5dc5349
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

## Resume(2026-06-15 跨 session 交接)
**已绿 3/12**:G-MACHINE(@cdea9fb)· G-OBSERV(@5dc5349)· G-PERF(@5dc5349)。PREREQ-0 deferred 外部分支。
**findings**:F1 修(store-only-e2e false-red)· F2 refute(recall payload 在 65K hard 内, description-first 工作中)· F3→ADJ-1(行为遥测死电线降级, 推荐 B 待用户拍)。
**进行中**:T8/G-CENSUS — 已采集注册表(CLI 16 cmd / MCP 6 tool / skill 8 / parity 12 cap),下一步读 docs/TESTING.md 的 J1–J24 派生全清单 → 逐项映射 wiring + usage 事件 → 无未接线空壳。

**剩余 gate 与对应 task**:
- G-CENSUS(T8 进行中)+ G-SELFAUDIT(T8): census 派生 + registry-vs-成绩单 self-audit 脚本
- G-NOFAKE + G-HABIT(T3): 造临时仓 fabric install + cc/codex 中立剧本(重活)
- G-UPGRADE(T4): 2.0.1→2.2 e2e 升级旅程脚本
- G-RESILIENCE(T5): 并发多会话隔离 + MCP 挂降级 + 多 store round-trip
- G-DISPLAY(T6): 画面采集 + B 零上下文冷评
- G-SAFETY(T7): KB 投毒/注入红队 + loop 压测 + path 越权
- G-HONEST(T9): 诚实性 a-e + 报告 ①-⑤ + 基线固化
- G-SHIP: 全绿后 release-rc 摘 -rc 发 2.2.0

推进:`/goal-mode continue` · 状态:`/goal-mode status` · 收尾:命名 gate 全绿自动 completed
commit 节奏:每 gate 收口 `git add -A && git commit` → sha 回填 status.json git_commits[]

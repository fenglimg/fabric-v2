# Goal Checklist — 2.2.0 发版前体检 + 常驻评测集 v1 (mode③ 混血)

> status.json 是真源,本文件是投影视图。终止判据 = 12 命名 ship gate 全绿(降级项显式记账)。
> 源:GOAL-BRIEF.md(2026-06-15 grill 收敛全集)。当前版本 2.2.0-rc.6 → 目标摘 -rc 发 2.2.0。

## 边界契约
- **IN**:Cursor 砍除 PREREQ · 5面×6维评测 · 6盲区 · 诚实性 a-e · G-OBSERV 补埋点 · G-PERF recall/hook size · G-SAFETY 红队 · cc+codex 中立剧本 · 报告①-⑤ + 基线固化
- **OUT**:完整混沌工程 · 追高好习惯% · Cursor 三端 · 池外候选(向量等)
- **constraints**:改 shared 必 rebuild dist · release-rc 全绿后才跑 · 临时仓先 fabric install · LLM-judge 零上下文冷评 · 降级显式记账 · 快照 -u 前肉眼 diff

## 命名 Ship Gate(12/13 实质全绿 · G-SHIP 待人裁授权)
- [~] **PREREQ-0** Cursor 砍除 — DEFERRED 到外部分支(非本 goal scope)
- [x] **G-MACHINE** (硬) ✓ 全绿(test 2403/0)— 修 F1 store-only-e2e false-red @cdea9fb
- [x] **G-CENSUS** (硬) ✓ 33 surface 零空壳派生 @6e780af(observability 7/33 降级 cross-ref ADJ-1)
- [x] **G-OBSERV** (硬) ✓ 死电线红账(18 真死)+ F3 行为遥测→ADJ-1 降级 @5dc5349
- [x] **G-NOFAKE** (硬) ✓ 真实 19 cite 事件 0 编造 ID + 检测器非盲 @71833f3(codex 侧降级)
- [x] **G-HABIT** (软) ✓ 激活漏斗 9/9 非零 翻库率2.71 baseline @71833f3
- [x] **G-PERF** (硬) ✓ 延迟绿 + 注入3650B✓/recall24-29KB(over-warn 在65K hard内)PASS @5dc5349
- [x] **G-DISPLAY** (软) ✓ 漂移闸绿+无错渲染;B 冷评 1-2/5→F4 dev-facing 不卡 @8d6421a
- [x] **G-SAFETY** (硬) ✓ 红队 18攻击/5类全容器 @7b43473
- [x] **G-UPGRADE** (硬) ✓ 黑盒升级 e2e stale 刷回当前版 P0-NEW1 @8619913
- [x] **G-RESILIENCE** (硬) ✓ 并发隔离5/5+backend-down降级3/3+多store round-trip @68e2ebc
- [x] **G-SELFAUDIT** (硬) ✓ registry vs scorecard diff 负向证伪 @6e780af
- [x] **G-HONEST** (硬) ✓ a-e 元自检全过 @8d6421a
- [ ] **G-SHIP** (硬) ⬜ **待人裁** — 12/13 实质绿, 用户选"先复核报告再定"(2026-06-15); release 不可逆需显式授权 @fbf38bf

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

## 状态(2026-06-15 终态)
**12/13 实质 gate 全绿**(8硬+2软+G-HONEST,无硬闸红)。报告 `REPORT.md` ①-⑤ 已出。
**唯一剩余**: G-SHIP = 发 2.2.0(npm publish+tag 不可逆)→ 用户选"先复核报告再定", 待复核 `REPORT.md`+`status.json` 后单独授权 `release-rc`。
**降级显式记账**: ADJ-1 裁 B(行为遥测死电线降级, 用户批准)· F4(画面 dev-facing UX, 2.3 候选不卡)· codex 行为侧降级 · cross-client-parity 含 cursor 待外部分支合 main 后复跑。
**常驻评测集 v1**: 8 scripts/*.mjs(census/self-audit/red-team/resilience/upgrade/nofake/habit/honest)+ baseline JSON + REPORT 口径, 已进 repo, 下次 rc 一键复跑。

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

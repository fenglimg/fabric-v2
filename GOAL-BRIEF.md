# GOAL-BRIEF — 2.2.0 发版前体检 + 常驻评测集 v1 (mode③ 混血:审计 + 修复)

> 派生自 2026-06-15 `/grill-me` 多轮收敛(本文件为最终全集)。
> 启动:新 worktree 把本文件复制为 `GOAL-BRIEF.md`,`/goal-mode` 读它 scaffold status.json + 命名 ship gate;gate 全绿即发 2.2.0。
> 事实:npm `latest`=2.0.1(用户实装),dev=2.2.0-rc.6。目标 = 跑清体检后摘 `-rc` 发 2.2.0 覆盖 latest。

## 目标(一句话)
对 `2.2.0-rc.6` 跑**一遍有界发版体检 → 出一份人可读报告 → 跑清就发正式 2.2.0**。这一遍的口径 + 报告 + 指标基线固化进 repo = **常驻评测集 v1**,以后每版重跑,**性能数字变时间序列,优化进度被它量住**。

## 已 grill 锁定的前提(不再 re-litigate)
- **行为没坏**:本仓 events.jsonl(rc.6,12 会话)实测 cite 自动记账 compliant×12 / hook_surface_emitted×7 / knowledge_consumed×28 / 漏斗健康。werewolf 旧红 = **旧 hook 未升级(P0-NEW1)测量假象**,非机制坏。
- **唯一行为盲区 = 跨 Agent**:本仓全 cc 无 codex → 行为数据点 = **cc + codex 各跑固定剧本**(`maestro delegate` 驱动,临时仓须先 `fabric install`)。
- **client scope 砍到 2 端**:Claude Code + Codex CLI,**Cursor 2026-06-15 砍除**(见下 PREREQ)。
- **尺子理念**:危险行为零容忍(硬);好习惯非零过底线(不追高百分比,LLM 概率性,100% 设硬闸=永不发)。
- **合理性不单开辩论**:效力红灯自动分诊——机制装对 codex 还做不到 = 策略对弱 AI 过分 → 降级(自动/可选)或推 2.3,不卡 2.2,显式记账。

## 完整评测矩阵:5 被测面 × 6 维度(✅有 / 🟡半 / ❌缺)
| 面＼维度 | 1正确 | 2完备·可观测 | 3行为效力 | 4性能·成本 | 5展示·符合预期 | 6安全·可控 |
|---|---|---|---|---|---|---|
| **Hook** | ✅unit | 🟡自身耗时半埋 | ✅本仓绿 | ✅冷启≤500ms · **❌注入payload大小零测量/无阈值** | 🟡注入文案无意图体检 | 🟡注入即攻击面(毒KB→注入→执行) |
| **CLI** | 🟡surface快照覆部分 | ❌CLI调用零埋点 | — | ✅冷启≤2000ms | 🟡doctor输出有快照 | 🟡path/drift abort |
| **MCP tool** | ✅契约快照 | ✅stdio_trace喷 | ✅recall→consumed健康 | 🟡dur/payload记了无闸 · **recall 27KB超** | 🟡recall正文格式无体检 | 🟡阈值标定存疑 |
| **Skill** | 🟡仅i18n漂移快照 | ❌skill_invocation死电线 | ❌用没用对skill隐形 | 🟡token量测过未设闸 | 🟡skill输出半 | 🟡viability gate兜底 |
| **产出·展示** | ✅bootstrap byte-lock | 🟡 | — | — | 🟡有漂移快照·**无"符合预期"体检** | 🟡personal泄漏team(已多测) |
| 全局安全 | | | | | | ✅隐私/✅预算机制 · **❌投毒红队 · 🟡loop失控** |

## 普查出的 6 个盲区(in/out 已拍)
1. **并发多会话**(多窗口同仓,per-session 信号张冠李戴)— **IN**
2. **离线/降级**(MCP挂/store冲突/缓存缺)— **半 IN**(至少验"MCP挂 hook 不崩、优雅降级";完整混沌推后)
3. **端到端升级旅程**(2.0.1→2.2 普通 install 会不会刷新旧 hook)— **IN(近硬闸,见 G-UPGRADE)**:werewolf 假红根因 P0-NEW1,测不到=把灾难原样发给老用户。`--force-hooks-only` 机制在,但默认路径 E2E + "普通升级能否自动捕获 stale hook"缺。
5. **多 store E2E round-trip**(真挂库→recall 真返跨库条目)— **IN**:历史最大空壳(team 61条→recall 0命中)只有真库 round-trip 暴露,unit 测不出。
6. **LLM-judge 必须零上下文冷评**— **IN(纪律,零成本)**:B 方案的 judge 不能是知道"该出啥"的同会话,否则盖章(执行者自评100%被冷评打到81%教训)。
7. **历史 confirmed/refuted 回测锚**— **IN**:已证实真 bug 设回归锚、已驳回误报禁复活(TESTING.md Phase 0)。
> (原 #4 Cursor 行为数据点已随 Cursor 砍除而删除)

## 元盲区 a–e:评测诚实性自检(报告/评测集本身会不会骗人)
- **a. telemetry 对地面真值**:hook 真注入 N 次 → `hook_surface_emitted` 真喷 N 条(整套建在"日志可信"上,但日志没验过;记忆里有 =0 记录)。
- **b. 画面真跑非 fixture**:③ 具体画面必须来自本次 run + 带时间戳,禁用旧 fixture 展示理想态。
- **c. 无静默采样**:抽样/top-N/单剧本必须 log 丢弃项,不得读起来像"全测了"。
- **d. baseline 非自我祝福**:首跑底线要有依据,不能把"当前行为"自动盖章为达标(否则测不出退步)。
- **e. cc 阳性对照不虚高**:剧本中立,不得 Fabric-coaching agent(否则测的是"被提示"而非真实习惯)。

## 报告形态(产出物,服务"我好评估")
跑完出一份报告(范本 = werewolf EVAL-REPORT,扩成全 5×6):
```
① 总览矩阵   — 5面×6维 ✅/🟡/❌ + 关键数字,一眼看全局
② 性能区     — 每面 延迟/payload/token,带 baseline→当前→趋势↑↓(=优化作为性能指标)
③ 具体画面区 — 每个渲染面真实输出【原样贴出】:SessionStart 实际注入啥(多大)/ recall 实际返回啥 / doctor·cite-coverage·pending 文件长啥样 → 肉眼看符不符合预期
④ 行为区     — cc vs codex 跑剧本结果,每习惯 fired/compliant + 证据
⑤ 结论区     — 哪些达标可发 / 哪些是债 / 哪些待用户拍
```
- **符合预期判定 = B**:LLM-judge **零上下文冷评**先筛,只把可疑画面标黄给用户定夺;画面全贴(想全看随时能看)。
- **优化追踪**:每版重跑,性能/行为指标 append 进历史,报告显示 vs 上版趋势。

## 命名 Ship Gate(全绿即发 2.2.0)
- [ ] **G-MACHINE** — 维度1:build/typecheck/lint/226 test/drift gate/store-only E2E 全绿。
- [ ] **G-CENSUS** — 维度2:从 CLI cmd registry + MCP tool registry + skill 注册 + J1–J24 自动派生清单,逐项映射,无未接线空壳;每面有 usage 事件(round-trip 可观测)。
- [ ] **G-OBSERV** — instrumentation 债显式记账:`skill_invocation_*`/`llm_judge_run` 死电线、CLI 无事件类型、`hook_surface_emitted` 无 size 字段 → 显式标红"不可评分+待补埋点",不得当不存在。补埋点 = 解锁 G-HABIT 全维度前置。
- [ ] **G-NOFAKE** — 维度3 硬闸:cc+codex 跑剧本后 `doctor --cite-coverage` 报编造 ID = 0。
- [ ] **G-HABIT** — 维度3 软闸:翻库率/archive触发/激活漏斗 非零且过底线(首跑标定 baseline);codex 做不到项走分诊规则,不阻断但显式记账。
- [ ] **G-PERF** — 维度4 硬闸:per-surface 延迟 + payload/token 预算成绩单 + 阈值;**recall 27KB + hook 注入大小**必须测量并定阈(超阈先瘦身或显式 waiver)。
- [ ] **G-DISPLAY** — 维度5 混合:漂移快照 + 明显错渲染硬闸;主观"好不好用"经 B 冷评筛后报告,不卡。
- [ ] **G-SAFETY** — 维度6:隐私/预算(已强)绿 + **对抗性 KB 投毒/注入红队** + loop 失控压测 + path 越权全堵。
- [ ] **G-UPGRADE** — 盲区3 近硬闸:2.0.1→2.2 端到端升级旅程,普通 `fabric install` 重跑后 hook/skill **确实是当前版**(防 P0-NEW1 复发)。
- [ ] **G-RESILIENCE** — 盲区1+2:并发多会话不张冠李戴 + MCP 挂优雅降级。
- [ ] **G-SELFAUDIT** — 自检:活注册表里有功能但成绩单无对应行 = 评测集自己亮红(保证常驻集顺应版本不腐烂)。
- [ ] **G-HONEST** — 评测诚实性自检(元盲区 a–e):telemetry 对地面真值校验过 / 画面来自本次 run 带时间戳 / 丢弃项已 log / baseline 有依据非自我祝福 / 剧本中立无 coaching。任一不满足 = 报告结论不可信,先修评测再信结果。
- [ ] **G-SHIP** — 前述闸绿(降级项已显式记账)→ `release-rc` 摘 `-rc`,发 2.2.0,固化剧本+报告口径+基线进 repo。

## PREREQ:Cursor 砍除(独立 clean-slate 任务,先于/并入 2.2)
零用户阶段,按 clean-slate 直接删,不留迁移。清:`.cursor/`(root + packages/cli/.cursor)、install client 列表、cross-client-parity 测试的 cursor 分支、client enum、docs cursor 引用。删净后 cross-client-parity 只剩 cc+codex。

## 副产 findings(待并入修复或 backlog)
1. **fabric-archive skill 缺 project-vs-team 轴**(Phase 3 只 team/personal,project 全靠绑定默认兜底;装的=最新源非 staleness,设计缺)→ 修法给 Phase 3 加一问;推 backlog 不卡发版。
2. **skill/cli 行为面无埋点 + hook 注入无 size**(并入 G-OBSERV)。
3. **recall payload ~27KB**(命中 KT-DEC-0019 description-first 决策,疑未收尾/回退)→ G-PERF 核实+瘦身。

## 执行顺序
0. **PREREQ**:砍 Cursor(clean-slate)。
1. 跑维度1/4/6 + 盲区2(基本现成,快速出"机器/性能/安全 ready 没")。
2. 补 G-OBSERV 死电线记账 + 接 hook size/recall payload 测量。
3. 跑维度3(造临时仓+写剧本+cc/codex)→ 标定 G-HABIT baseline;G-UPGRADE 端到端升级旅程。
4. 维度5 展示画面采集 + B 冷评筛。
5. 汇总成报告(①–⑤)→ 按分诊规则:能修的修,修不动降级/写 release notes。
6. G-SELFAUDIT 缝好 → 全闸绿 → G-SHIP 发版,固化常驻 v1。
7. *(可选)* rc.6 hook 装进 werewolf 仓看漏斗弹起,给"旧红=旧hook"补实证。

## 铁律
- 改 shared **必 rebuild dist**。
- `release-rc` 只在全闸绿后跑,别手动摘 tag。
- 临时仓必须先 `fabric install`(否则重蹈 werewolf 旧-hook 假阴性)。
- LLM-judge **零上下文冷评**,不可用知道答案的同会话。
- 降级项 ≠ 静默忽略:每个降级/waiver 在报告 + status.json 显式记账(诚实律,"无法评价"是一等 finding)。
- 快照 `-u` 前肉眼 diff。

## 操作 Runbook(新终端独立跑)

> **⚠️ 前置依赖**:必须等 `chore/remove-cursor-support`(Cursor 砍除 goal)**先合进 main**,本 worktree 再 rebase 到 2 端基线,否则 cross-client-parity / client 枚举对不上。

### ① 启动(先吃进 Cursor 砍除的 2 端 main)
```
cd /Users/wepie/Desktop/personal-projects/pcf-release-eval
git rebase main                    # cursor 砍除合 main 之后再做; 取 2 端基线
pnpm install
claude                             # 开会话
```
会话内输入(本 brief 作意图,goal-mode 判为 mode③ 混血):
```
/goal-mode 读 GOAL-BRIEF.md 跑 2.2.0 发版前体检(5面×6维+6盲区+诚实性a-e), 按命名 ship gate 跑到全绿出报告
```
→ goal-mode 搭好 `.workflow/.maestro/{session_id}/status.json` 后**吐一行 `/goal ...`**,**粘回**即自循环。

### ② 推进 & commit(过程中)
- 单步:`/goal-mode continue`;进度:`/goal-mode status`。
- **commit 节奏**:每道 gate 收口即提交本分支,sha 回填 status.json `git_commits[]`:
  ```
  git add -A && git commit -m "test(eval): <该 gate 做了啥>"
  ```
- 改 shared 后 `pnpm --filter @fenglimg/fabric-shared build` 再测。
- mode③:**命名 gate 全绿即自动 `completed`**,不需手动 close。

### ③ 收尾:发版 + 合并回 main
全部 ship gate 绿(含 G-SHIP)→ 报告产出 → 用户 review:
```
# 发版(全绿后,brief 铁律:别手动摘 tag,走 skill)
# 会话内: 调用 release-rc skill 摘 -rc 发 2.2.0
# 合并回 main:
cd /Users/wepie/Desktop/personal-projects/pcf
git checkout main && git pull --rebase origin main
git merge --no-ff feat/2.2-release-eval -m "Merge: 2.2.0 发版前体检 + 常驻评测集 v1"
git push origin main
git worktree remove ../pcf-release-eval
git branch -d feat/2.2-release-eval
```

### 常驻化(发版后)
评测剧本 + 报告口径 + 指标 baseline 固化进 repo(随 G-SELFAUDIT/G-HONEST),以后每版重跑即回归。

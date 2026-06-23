# NS-05 · Hook 体系的北极星重设计

> 角色:Fabric hook/注入体验设计师。问题:**如果从零重设计会话生命周期里的知识注入,该有几个 hook、各挂哪个事件、注入什么形态、用什么频率模型?**
> 基线:C1 已落地 + `02-hook.md`/`00-SYNTHESIS.md` 已诊断(narrow 教退役工具、fabric-hint 4/5 信号硬 block、broad ALWAYS summary 不截断、narrow 不接 nudge-policy、cite-contract-reminder 与 C1 矛盾)。本文不复述诊断,在其上做**目标态**。
> 北极星一句话:**hook = 单向只读的「提醒层」。AI sink 永远无条件给知识(flow);human sink 永远受单一 `nudge_mode` 调控的软提醒(observation);任何路径都不 `decision:block`。** flow ⊥ observation 是不可破的不变量。
> 对照系:maestro-flow `src/hooks/`。两条可移植的 production 先例 —— ① 所有 injector 一律 `additionalContext` advisory「safer and non-destructive」,无一 block;② `context-budget.ts` 用单一信号(remaining %)驱动 `full→reduced→minimal→skip` 四档**渐弱**注入。本文把后者的「单旋钮驱动渐变」搬成 Fabric 的统一频率模型。

---

## ① 6 个现有 hook 存在性裁决

逐个三连(该不该在 / 该不该合 / 该不该删),给确定性裁决。

| # | 现有 hook | 事件 | 裁决 | 理由(一句话) |
| --- | --- | --- | --- | --- |
| 1 | `knowledge-hint-broad` | SessionStart | **KEEP(重构)** | 开局 HUD 是唯一「会话级一次性全景」触点,职责正当;但 ALWAYS summary 不截断 + 33 行 REFERENCE 墙 = 信息架构破产,需渐进披露重写。 |
| 2 | `knowledge-hint-narrow` | PreToolUse | **KEEP(重构)** | 「改前浮现相关知识」是 just-in-time 注入的核心价值;但教退役工具(bug)、英文硬编码、不接 nudge-policy = 三处与体系脱节,需并入统一管线。 |
| 3 | `fabric-hint` | Stop | **KEEP(降级)** | turn 末「该归档/该审了」cadence nudge 有价值;但 5 信号里 4 个硬 `decision:block` 直接违反北极星,必须全降软。 |
| 4 | `cite-policy-evict` | PreToolUse | **MERGE → 并入 narrow** | 与 narrow 同事件(PreToolUse)、同对象(改前的人/AI)、同形态(软 nudge)。两个 PreToolUse hook 双弹是纯频率噪声。合成单一 PreToolUse「改前关怀」hook,内部分支「有相关知识就浮现 / 无 recall 就提醒 recall」。 |
| 5 | `post-tooluse-mutation` | PostToolUse | **KEEP(不动)** | 纯遥测、零交互、落 `events.jsonl`。是整个频率模型的「分母/真相源」,北极星依赖它。 |
| 6 | `session-end-marker` | SessionEnd | **KEEP(不动)** | 纯遥测、零交互。跨会话 debt 追踪的 anchor。 |

**lib 层裁决(影响 hook 数但不是顶层 hook):**

| lib | 裁决 | 理由 |
| --- | --- | --- |
| `cite-contract-reminder.cjs` | **KILL** | 它催 AI「补 `→ edit:<glob>` contract operator」,而 C1(`6b694ca`)已删首行 `KB:` contract 八股、改 recall 自动记账。一个 hook 说「无需手写首行」另一个催「补 contract」= grounded 自相矛盾。C1 之后 cite 唯一真相 = recall 自动记账,这条 L1 reminder 已无依附对象 → 删。(若 `doctor --cite-coverage` 还读它,改为只统计、不向 AI 发提醒。) |
| `nudge-policy.cjs` | **PROMOTE 为唯一频率内核** | 当前只有 fabric-hint 的 `archive` 信号经过它,设计意图(管整个人 sink)被调用方架空。北极星让**所有 human sink 出口无例外经过它**。 |
| `banner-i18n.cjs` | **KEEP(收敛)** | 人类文案唯一真源,正当。但 `zh-CN-hybrid` 与 `zh-CN` 逐字相同 → 折叠掉冗余变体;narrow banner 必须接进来(当前漏网)。 |
| `injection-log.cjs` / `bindings-snapshot-reader.cjs` / `config-cache.cjs` / 其余 | **KEEP** | 静默基础设施,无交互问题。 |

**裁决净结果:6 顶层 hook → 5 顶层 hook**(cite-policy-evict 并入 narrow),**lib 杀 1**(cite-contract-reminder)。
顶层 5 = SessionStart / PreToolUse / Stop / PostToolUse / SessionEnd —— **恰好一个 hook 对一个生命周期事件,零重叠**。这是「good taste」目标态:hook 拓扑 = 生命周期事件的一一映射,没有同一事件挂两个 hook 互相抢话。

---

## ② 目标 hook 集 + 生命周期挂载图

```
会话生命周期 ─────────────────────────────────────────────────────────────────►

  SessionStart        PreToolUse(Edit/Write)      Stop            SessionEnd
      │                      │                      │                  │
      ▼                      ▼                      ▼                  ▼
┌─────────────┐      ┌─────────────────┐    ┌─────────────┐    ┌────────────┐
│ H1 broad    │      │ H2 pre-edit     │    │ H3 cadence  │    │ H5 marker  │
│ 开局全景HUD │      │ (narrow+cite合) │    │ 归档/审提醒 │    │ 会话收尾   │
└──────┬──────┘      └────────┬────────┘    └──────┬──────┘    └─────┬──────┘
       │                      │                     │                 │
       │   ┌──────────────────┴─────────────────────┘                │
       │   │  每次 Edit/Write 后 ▼                                    │
       │   │              ┌──────────────────┐                        │
       │   │  PostToolUse │ H4 mutation log  │ (静默遥测,纯写)       │
       │   │              └────────┬─────────┘                        │
       ▼   ▼                       ▼                                  ▼
   ┌───────────────────────────────────────────────────────────────────┐
   │  AI sink  = hookSpecificOutput.additionalContext  (无条件 · flow)  │  ← H1/H2/H3
   │  human sink = systemMessage  (经 nudge-policy 闸 · observation)    │  ← H1/H2/H3
   │  telemetry = events.jsonl / injections.jsonl  (静默 · 真相源)      │  ← H4/H5 + 全员
   └───────────────────────────────────────────────────────────────────┘
        ▲                                          ▲
        │  所有 human sink 必经                     │  所有频率/cooldown/阈值收进
        └──── nudge-policy.resolveHumanSink() ──────┘  单一 nudge_mode 模型(见④)
```

**5 个 hook 的职责契约(单一职责):**

| Hook | 事件 | AI sink(flow,无条件) | human sink(observation,经 nudge-policy) | 频率 |
| --- | --- | --- | --- | --- |
| **H1 broad** | SessionStart | ALWAYS 规则(截断后)+ REFERENCE 分组计数(非平铺) | 开局 1 屏 HUD(scope-primary) | 每会话 1 次 |
| **H2 pre-edit**(narrow⊕cite 合并) | PreToolUse | 命中编辑目标的 narrow 条目摘要;无相关 recall 时 append 一行「先 recall」 | 命中才浮现 1 行 | 每编辑,session-dedup |
| **H3 cadence** | Stop | 5 信号统一软 `additionalContext`(**永不 block**) | 高价值才浮现,默认 quiet | 阈值+cooldown |
| **H4 mutation** | PostToolUse | — | — | 每编辑(静默) |
| **H5 marker** | SessionEnd | — | — | 每会话末(静默) |

设计要点:**只有 H1/H2/H3 有交互双 sink;H4/H5 纯遥测**。交互面从「6 hook 散落」收敛到「3 hook,共享同一套 sink 契约 + 同一个 nudge-policy 闸」。

---

## ③ 注入形态 before → after(3 样例)

设计原则(三条,贯穿所有交互 sink):
- **AI sink 渐进披露**:开局只给「索引 + 截断摘要」,正文按需 Read(KT-GLD-0005 lean);REFERENCE 不平铺 id 墙,按 type 分组计数,命中编辑路径再展开。
- **AI sink 不教架构、不留退役指针**:AI 不需要被告知「narrow 由 PreToolUse 浮现」「调 fab_plan_context」这类元信息/死工具。
- **human sink 大白话 + 自然语言旋钮**:非工程用户能懂;「想更安静」用一句话对 AI 说,不让人去编辑 config JSON。

### 样例 A · SessionStart 开局(H1 broad,AI sink)

**BEFORE**(实跑节选,`02-hook.md §1`):
```
[fabric:SessionStart] store                                          ← 裸词,无信息
ALWAYS-ACTIVE RULES (无条件适用 · 照此行遵循,正文按需取):              ← 病句
  [model] team:KT-MOD-0001 · scope 是三个互相独立的维度: store…
  [guideline] team:KT-GLD-0005 · 用户在 grill 中掀翻执行者 frame: 执行者
    原拟检索默认 eager 灌 body 到 16KB…(110+ 字整段,未截断)         ← 过载 bug
REFERENCE (情境触发 · 命中 must_read_if 时 Read / fab_recall):
  [decision] team:KT-DEC-0001 — Boundary B: data + lifecycle…
  …(共 25 decision + 8 pitfall,33 行平铺 id 墙)…                    ← 低密度噪声
取正文: fab_recall(paths), 或 Read <store>/knowledge/<type>/<id>--*.md
范围: 此处仅 broad…narrow…由 PreToolUse 浮现                          ← 教架构,冗余
```

**AFTER**(渐进披露 + 截断 + 分组计数):
```
[fabric · 写入 team · 只读 personal]                                 ← 复用人 sink 的 store 标签
ALWAYS(无条件遵循 · 7 条):
  · KT-MOD-0001 [model] scope 三维独立: store/maturity/semantic…(截至 80 字)
  · KT-GLD-0005 [guideline] 描述按需读、正文不每轮重灌…(截至 80 字)
  …(7 条,每条 summary 过 hint_summary_max_len 截断)
REFERENCE(情境触发 · 命中编辑路径时浮现):decision 25 · pitfall 8
  取正文: fab_recall(paths) 或 Read 对应 <id>--*.md
```
**变化**:① 头行复用人 sink 的 `写入X·只读Y`(消裸词 `store`);② ALWAYS summary 走 `truncateSummary(.., summaryMaxLen)`(1 行改,杀过载);③ REFERENCE 33 行 id 墙 → **2 行分组计数**,命中编辑路径时由 H2 按需浮现具体条目(向 narrow 的 lean 哲学靠拢);④ 删教架构尾行;⑤ 病句 `照此行遵循`→`无条件遵循`。

### 样例 B · PreToolUse 改前一行(H2 pre-edit,human sink)

**BEFORE**(narrow 实跑,`02-hook.md §2.2`)—— 中英混排 + 退役工具 + store 逐次重播:
```
[fabric] 2 narrow-scoped knowledge entries match your edit targets:     ← 英文硬编码
  [team:KT-PIT-0017] (pitfalls/draft) 用户跑 /fabric-review 说"全部审核…
  [team:KT-PIT-0020] (pitfalls/draft) 用户 grill 实际 fab_recall…
  (如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)  ← 退役工具!
[fabric] writes here land in store 'team'                               ← 会话级常量,逐次重播
```
（外加 cite-policy-evict 在同一次编辑**再弹一条**「改前先 recall」→ 双弹）

**AFTER**(合并 narrow+cite,i18n,删死指针,经 nudge-policy 闸):
```
[fabric] 命中 2 条和这次改动相关的知识:
  · KT-PIT-0017 [pitfall] /fabric-review「全部审核」误触全量…
  · KT-PIT-0020 [pitfall] grill 实际 fab_recall…
  取正文: fab_recall(paths)              ← 仅当本 session 对这些 path 还没 recall 时才 append
```
**变化**:① banner 走 `banner-i18n`(zh-CN 工程不再中英混排);② **删退役工具尾行**(P0 bug,现状每次编辑教 AI 调空工具);③ 删 `writes here land in store` 逐次重播(store 是会话级常量,归 H1 一次);④ **cite nudge 并入此 hook**:仅在「narrow 未覆盖 ∧ 本 session 对该 path 无 recall」时 append 一行,消双弹;⑤ 整条 human sink 经 `resolveHumanSink(cwd,"pre_tool_use",{hit})` —— `nudge_mode: silent` 时对 narrow 也生效(当前 narrow 绕过闸)。

### 样例 C · Stop nudge(H3 cadence,「提醒永不 block」统一模型)

**BEFORE**(实跑默认 config,`02-hook.md §2.3`)—— `archive_backlog` 直接 `decision:block` 打断 Stop:
```json
{"decision":"block","reason":"📋 Fabric: 28 个已结束的会话有未归档的高价值改动。\n
  是否调 /fabric-archive 跨会话补归档?\n
  (不想再看到此类提醒？在 .fabric/fabric-config.json 设 \"hint_dismiss_signals\":[\"archive_backlog\"]…)\n
[fabric] read-set stores: team (write), personal","signal":"archive_backlog"}
```
（`block` 会被 Claude Code 当硬中断:阻断 Stop + 重新 prompt AI。与 `nudge_mode` 无关 → 违反北极星。）

**AFTER**(5 信号统一软提示,永不 block,大白话 dismiss):
```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "[fabric] 28 个已结束会话有未归档的高价值改动。合适时机可调 fabric-archive 跨会话补归档。"
  },
  "systemMessage": "▸ [fabric] 28 个会话的改动还没存进知识库 · 想补存说「归档」即可\n  (不想再看到这类提醒?跟我说「关掉归档提醒」)",
  "signal": "archive_backlog"
}
```
**变化**:① **删 `decision:block`**,改 `additionalContext`(软提示,AI 自行决定该 turn 末是否自调 archive,不打断 Stop)—— 这一改对 `archive_backlog`/`review`/`import`/`maintenance` **4 个信号全做**,北极星「任何路径不 block」由此兑现;② human sink 经 `resolveHumanSink(cwd,"stop",{highValue})`,默认 quiet(step 4b 推广到全 5 信号);③ store 标签统一 `写入X·只读Y`(废 `read-set…(write)` jargon);④ dismiss 行口语化:`设 config 数组` → `跟我说「关掉归档提醒」`(人不碰 JSON,由 AI 翻译成 config 写入)。

---

## ④ 统一频率/时机北极星模型

**一个旋钮、一条渐弱曲线、永不 block。** 把散落的 cooldown/阈值/dedup 全收进 `nudge_mode` 主导的单一模型,语义对齐 maestro-flow `context-budget` 的「单信号驱动 full→skip 渐变」。

### 4.1 强度阶梯(human sink 的 4 档,永不到「block」)

```
   静默 ───────── 软提示 ───────── 标准 ───────── 渐强            [不存在] block
 silent           minimal          normal         verbose      ✗ 北极星禁止
   │                │                │               │
 全 human          仅最高价值       默认            每步可见      AI sink 不受
 sink 闭嘴         1 行            (当前态)        全展开        此轴影响(恒亮)
```

唯一旋钮 `nudge_mode ∈ {silent, minimal, normal, verbose}`,默认 `normal`。曲线只调 **human sink 的浮现与否/详略**;**AI sink 恒为 `additionalContext`,与档位无关**(flow ⊥ observation 不变量,`nudge-policy.cjs` 已有 invariant test 守这条)。**整条曲线没有第 5 档 block** —— 这就是「永不 block」的结构保证:nudge-policy 的返回类型里根本没有 `decision:block` 这个出口。

### 4.2 三层结构闸(在 nudge_mode 之前,mode-independent)

强度旋钮之上,先过 3 个「有没有东西值得说」的结构闸(已是 `resolveHumanSink` resolution order 1-2,北极星把三事件全纳入):

| 事件 | 结构闸(gate) | 闸不过 → human sink 静默 |
| --- | --- | --- |
| SessionStart | 无(开局总有全景) | — |
| PreToolUse | `{hit}` —— narrow 命中编辑目标? | miss → 不浮现 |
| Stop | `{highValue}` —— 有高价值归档/审信号? | 无 → 不浮现 |

结构闸过了,才轮到 `nudge_mode` 决定详略。结构闸 mode-independent:即使 `verbose` 也不会在「没东西可说」时硬造噪声。

### 4.3 把散落 cooldown/阈值收进模型

现状散落参数 → 北极星归并:

| 现状散落参数 | 现值 | 北极星归并去向 |
| --- | --- | --- |
| `hint_broad_cooldown_hours` | 0 | 保留 0(开局重弹可接受);但受 `nudge_mode` 总闸 |
| `hint_narrow_cooldown_hours` + `dedup_window_turns` | 0 / 5 turns | 收进 H2:**session-scoped dedup**(同 session 同条目不重浮,借鉴 maestro keyword-injector「Session dedup prevents re-injection」),删 cooldown 旋钮 |
| `archive_hint_cooldown_hours` | 12 | 保留(cadence 类合理),归 H3 |
| `review_hint_pending_count` ≥10 / `maintenance` 14d | — | 保留为「结构闸触发阈值」,但触发后走软提示**不再 block** |
| `hint_dismiss_signals: []`(per-signal 静音数组) | — | 仍存在(精确静音),但**入口改自然语言**:人说「关掉 X 提醒」→ AI 写该数组,人不碰 JSON |
| `hint_broad_budget_chars`(RETIRED 仍 materialize) | — | 删(死字段) |

**净结果**:用户面只剩 **1 个总旋钮 `nudge_mode` + 1 个精确静音 `hint_dismiss_signals`(自然语言入口)**。其余阈值降为引擎内部常量或结构闸,不再是「旋钮汤」里需要用户理解的项。对照 maestro-flow:预算/半衰期硬编码、只暴露 ~8 语义旋钮 —— 同方向。

---

## ⑤ 彻底兑现 KT-DEC-0007:任何路径都不 `decision:block`

北极星的硬约束 = **hook 进程的输出里,永远不出现 `decision:block`**。三道保证(结构性,非靠自觉):

1. **类型层封口**:nudge-policy 的 human-sink resolver 返回类型只有 `{emitHuman, verbosity}`,**没有 block 出口**;H1/H2/H3 的 AI sink 统一走 `emitAdditionalContext()` helper,该 helper 只能产 `hookSpecificOutput.additionalContext`。`decision:block` 这个字符串在 H1/H2/H3 三个 hook 的源码里应为 **0 处**(可由 doctor lint 守:`grep 'decision.*block' .claude/hooks/{broad,pre-edit,cadence}.cjs` 必须为空)。

2. **H3 是唯一历史 block 源 → 全降软**:当前 `fabric-hint` 的 `:2497`/`:2538`(`archive_backlog`/`review`/`import`/`maintenance`)是仅剩的 block 直写。北极星把这 4 个分支全改 `additionalContext`(样例 C)。`archive` 信号 C1 已软化 → 5 信号至此口径统一。**没有「折中保留 backlog block」的例外** —— 跨会话丢知识的焦虑应靠 H3 软提示 + H5/H4 遥测 ledger 兜底(事后用 `doctor --archive-history` 精确定位会话),而不是靠中断执行流逼迫。block 解决的是「怕 AI 不归档」,但 block 的代价是打断每一次正常 Stop —— 价值÷成本为负。

3. **invariant test 升级**:现有「no nudge_mode/observe combination changes the AI branch」测试,**扩成「no hook, no signal, no config 能产出 `decision:block`」**。这把北极星变成回归测试守护的不变量,而非文档约定。

> 一句话:**block 是 gate,gate 属于「闸层」;hook 是「提醒层」。北极星让两层物理分离 —— 提醒层的输出通道里没有「拦截」这根线。**

---

## 【Hook 收敛清单】(价值÷成本排序 + P0/P1/P2)

| # | 改动 | 价值 | 成本 | 优先级 | 归属 |
| --- | --- | --- | --- | --- | --- |
| 1 | **H2 删退役工具尾行** `fab_plan_context`(narrow:1245)—— 现状每编辑教 AI 调空工具 | 极高 | 极低(删1行) | **P0** | bug 必修 |
| 2 | **H3 五信号全降软** —— 删 4 处 `decision:block`,改 `additionalContext` + 经 nudge-policy。彻底兑现 KT-DEC-0007 | 极高 | 中(改4分支+测试) | **P0** | 北极星核心 |
| 3 | **invariant test 升级**为「任何路径不产 block」+ doctor grep lint | 高 | 低 | **P0** | 结构保证 |
| 4 | **H1 ALWAYS summary 套 `truncateSummary`**(broad:959)—— 杀开局过载 | 高 | 极低(1行) | **P1** | 渐进披露 |
| 5 | **MERGE cite-policy-evict → H2**,内部分支「narrow 浮现 / 无 recall 提醒」,消 PreToolUse 双弹 | 高 | 中 | **P1** | 6→5 收敛 |
| 6 | **H2 接 nudge-policy + banner-i18n** —— silent 对 narrow 生效、消中英混排 | 高 | 中 | **P1** | 体系一致性 |
| 7 | **KILL `cite-contract-reminder.cjs`** —— 与 C1 recall 自动记账矛盾 | 高 | 低(确认 cite-coverage 不依赖) | **P1** | 消 grounded 冲突 |
| 8 | **H1 REFERENCE 33 行 id 墙 → 分组计数**,命中编辑路径再浮现 | 高 | 中(碰 census/render) | **P1** | 渐进披露 |
| 9 | **频率模型归并**:删 narrow cooldown→session-dedup;删死字段 `hint_broad_budget_chars`;dismiss 入口改自然语言 | 中高 | 中 | **P2** | 旋钮瘦身 |
| 10 | **store 标签全 hook 统一** `写入X·只读Y`(H1/H3 共享 `renderScopeStoreLabel`) | 中 | 低 | **P2** | 措辞一致 |
| 11 | **大白话化**:HUD 末行 `fabric context`、`statusTier` 的 `nudge_mode`、dismiss 行 JSON 语法 → 自然语言 | 中 | 低 | **P2** | 非工程用户 |
| 12 | **折叠 `zh-CN-hybrid`** i18n 变体到 `zh-CN`(逐字相同) | 低 | 中(动 fixture) | **P2** | 减维护面 |

**落地波次**:P0(#1-3)立即 —— 一条 bug + 兑现北极星红线 + 测试守护;P1(#4-8)本轮 —— 渐进披露 + 6→5 合并 + 杀矛盾 lib + 一致性;P2(#9-12)结构/措辞收尾。

**镜像同步纪律**(贯穿全部):所有改动改**真源** `packages/cli/templates/` 后 `fabric install` 同步,**勿手改 4 套 dogfood 镜像**(narrow 副本已漂移 md5 `98278d9` vs `8f4e53e`,是 KT-PIT-0004 活体复现)。

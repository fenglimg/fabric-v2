# Fabric UX/DX 审计 · 触点类【Hook 交互】

审计员视角:双角度(交互体验 + 策略)· 激进授权 · 全 grounded(`file:line` + 真实文案)
基线:C1 已落地(SessionStart 单 HUD `05f0b22`、self-archive marker-free `7a2ae5c`、cite recall 自动记账 `6b694ca`、Stop archive nudge 默认安静 `fdbd9fe`)。本报告审 **C1 之后的当前状态**,不复述 C1 已做。

---

## 0. Census 全集表

| Hook 文件 | 生命周期事件 | 输出对象 | 输出什么 | 审了? |
| --- | --- | --- | --- | --- |
| `knowledge-hint-broad.cjs` | SessionStart | AI(`additionalContext`)+ 人(`systemMessage`) | AI:ALWAYS-ACTIVE RULES + REFERENCE 索引;人:scope-primary HUD 普查 | ✅ |
| `knowledge-hint-narrow.cjs` | PreToolUse(Edit/Write…) | AI(`additionalContext`)+ 人(`systemMessage`) | 命中编辑目标的 narrow 知识条目摘要 | ✅ |
| `fabric-hint.cjs` | Stop | AI(`decision:block` / dual-sink)+ 人(`systemMessage`) | 5 信号 nudge(archive / archive_backlog / review / import / maintenance)+ 无信号时 status 面包屑 | ✅ |
| `cite-policy-evict.cjs` | PreToolUse(Edit/Write…) | AI(`additionalContext`)/ Codex stderr | 「改前先 fab_recall」软提示 | ✅ |
| `post-tooluse-mutation.cjs` | PostToolUse | 无(纯落 `events.jsonl`) | `file_mutated` / `knowledge_body_read` 遥测 | ✅(静默,无交互) |
| `session-end-marker.cjs` | SessionEnd | 无(纯落 `events.jsonl`) | `session_ended` 标记 | ✅(静默,无交互) |
| `lib/banner-i18n.cjs` | — | 被 broad/fabric-hint 调用 | 11+ 面向人类 banner 字符串真源(zh/en/hybrid) | ✅ |
| `lib/nudge-policy.cjs` | — | 被 broad/fabric-hint 调用 | 人出口闸:nudge_mode + observe.* | ✅ |
| `lib/cite-contract-reminder.cjs` | (Stop 调) | AI/stderr | `⚠ KB: <id> cited as [applied] but missing contract` | ✅ |
| `lib/injection-log.cjs` | — | 落 `injections.jsonl` | 注入侧遥测(分母) | ✅(静默) |

**镜像漂移观感(留给综合)**:6 个 hook × 4 镜像(`.claude` `.codex` `packages/cli/.claude` `packages/cli/templates`)。5 个 hook 跨镜像 md5 完全一致;**唯独 `knowledge-hint-narrow.cjs`:`packages/cli/.claude` 副本(md5 `98278d9`)与其它三份(`8f4e53e`)漂移**。即 install source-of-truth 的一份 narrow 镜像已与本仓/template 不一致 —— 这正是 KB 里 `KT-PIT-0004`(三镜像手编无声漂移)的活体复现。

---

## 1. 会话开局注入文案逐行评(本会话 SessionStart 真实输出)

下面是**实跑** `knowledge-hint-broad.cjs` 得到的真实 AI sink 文本(节选),逐行评:

```
[fabric:SessionStart] store                                    ← ① 问题
ALWAYS-ACTIVE RULES (无条件适用 · 照此行遵循,正文按需取):        ← ② OK 但措辞拗
  [model] team:KT-MOD-0001 · scope 是三个互相独立的维度: store… ← ③ 信息过载
  [guideline] team:KT-GLD-0005 · 用户在 grill 中掀翻执行者 frame: 执行者原拟检索默认 eager 灌 body 到 16KB… ← ④ 严重过载
REFERENCE (情境触发 · 命中 must_read_if 时 Read / fab_recall):   ← ⑤ OK
  [decision] team:KT-DEC-0001 — Boundary B: data + lifecycle…   ← ⑥ 33 条 REFERENCE 墙
  …(共 25 decision + 8 pitfall)…
取正文: fab_recall(paths), 或 Read <store>/knowledge/<type>/<id>--*.md
范围: 此处仅 broad…narrow…由 PreToolUse 浮现                      ← ⑦ 冗余
```

- **① `[fabric:SessionStart] store`**(`broad.cjs:942`):`storeLabel` 解析失败时直接 fallback 字面量 `"store"`(`renderAiSink` opts 默认),AI 看到的就是裸词 `store`,毫无信息。本会话人出口正确显示了 `写入 team · 只读 personal`,但 AI sink 头行却退化成 `store` —— 两个 sink 的 store 标签不一致。
- **② ALWAYS-ACTIVE 标题**(`broad.cjs:947`)`无条件适用 · 照此行遵循,正文按需取` —— 「照此行遵循」是病句(应是「照此行事」或「逐条遵循」)。
- **③④ 摘要过载**:`KT-GLD-0005` 的 summary 整段 110+ 字把「grill 中掀翻执行者 frame…成本不对称论证…」全文灌进 SessionStart。这违反 broad 自己声称的「index line only(title + summary)」精神 —— summary 本身没有被 `hint_summary_max_len`(80)截断(那个 maxLen 只作用于 REFERENCE 的 `must_read_if`,不作用于 ALWAYS bodies 的 summary,见 `broad.cjs:959-960` 直接 `b.summary.trim()` 无截断)。**ALWAYS 区 summary 不截断是 bug 级过载**。
- **⑥ REFERENCE 墙**:本会话 33 条 REFERENCE 全量平铺(`KT-DEC-0001`…`KT-PIT-0004`),很多 `must_read_if` 退化成纯 summary。33 行 id 清单对 AI 是低密度噪声 —— `backstop` 默认 50 没触发,等于没有上限保护。
- **⑦ 冗余尾行**:`范围: 此处仅 broad…由 PreToolUse 浮现`(`broad.cjs:1011`)与人出口 HUD 的 `narrow 21 · 编辑对应文件时浮现` 语义重复,且 AI 不需要被教育注入架构。

**人出口 HUD**(本会话真实):
```
▸ [fabric] 共 61 条 · 团队 11 · 项目 49 · 个人 1
  broad 40 · 本会话注入
    ├ 常驻规则 7  guideline 6 · model 1
    └ 情境参考 33  decision 25 · pitfall 8
  narrow 21 · 编辑对应文件时浮现
  写入 team · 只读 personal
  看具体注入: fabric context (--explain 看每条来源)
```
HUD 本身 C1 已打磨得不错(scope-primary、自洽 broad+narrow=total)。**唯一交互问题**:末行 `看具体注入: fabric context` —— 非工程用户不知道 `fabric context` 要在哪敲(终端?对 AI 说?),且这条永远显示,稳态噪声。

---

## 2. 逐 Hook 审计

### 2.1 `knowledge-hint-broad.cjs`(SessionStart)

**现状**:见 §1。AI sink + 人 HUD 双出。

**问题 · 交互角度**:
- ALWAYS summary 不截断(`:959`)→ 长摘要灌爆开局上下文。
- 头行 `store` 裸词(`:942`)。
- 病句「照此行遵循」(`:947`)。
- 折叠提示文案极长(`:993`):`… 另 N 条 broad 条目折叠 (broad index > backstop ${backstop})。先跑 fabric-audit 瘦身;确需全展示再调 .fabric/fabric-config.json#broad_index_backstop (20..500)` —— 一行塞了诊断+两个修复路径+数字范围,AI 读到反而被带偏去调 config。

**问题 · 策略角度**:
- REFERENCE 33 条全量注入,`hint_broad_top_k`(config=8)被 `KT-DEC-0028`「不设 top-K 硬帽」推翻,只剩 backstop 50 兜底。结果:开局就给 AI 一面 33 行的 id 墙,**注入≠被消费**(`injection-log.cjs` 存的就是这个分母),真命中率会很低。
- broad summary 没走 `summaryMaxLen`,与 REFERENCE 的 `must_read_if` 截断策略不一致 —— 同一注入面两套截断口径。

**方案(激进)**:
1. ALWAYS summary 也过 `truncateSummary(.., summaryMaxLen)`(改 `:959-960`)。before:`b.summary.trim()` → after:`truncateSummary(b.summary, summaryMaxLen)`。1 行改,杀掉开局过载。
2. 头行 store fallback:`storeLabel || "store"` → 复用人出口的 `写入 X · 只读 Y`(把 `renderScopeStoreLabel` 结果传进 `renderAiSink`)。让两 sink 一致。
3. 把 REFERENCE 默认 backstop 从 50 降到 ~15,并把 33 行 id 墙改成**按 type 分组计数 + 仅展开 must_read_if 命中项**(开局不平铺全部 decision id,改为「decision 25 / pitfall 8,命中编辑路径再浮现」)。这是把 broad REFERENCE 向 narrow 的「按需」哲学靠拢,与 `KT-GLD-0005` lean 主张一致。
4. 删 `:1011` 冗余尾行(AI 不需要被教育架构)。
5. 病句:`照此行遵循` → `逐条遵循`。
6. HUD 末行 `看具体注入: fabric context` 加限定:`看每条来源: 终端跑 \`fabric context --explain\``,或对非工程用户直接删(他们不会去敲)。

**价值÷成本**:方案 1(summary 截断)+ 5(病句)价值高成本极低(各 1 行),立即做。方案 3(REFERENCE 重构)价值最高但要碰 census/render,中成本,值得。方案 2/4/6 低成本顺手。

---

### 2.2 `knowledge-hint-narrow.cjs`(PreToolUse)

**现状**(实跑,编辑 `.claude/hooks/knowledge-hint-broad.cjs` 触发):
```
[fabric] 2 narrow-scoped knowledge entries match your edit targets:
  [team:KT-PIT-0017] (pitfalls/draft) 用户跑 /fabric-review 说"全部审核…
  [team:KT-PIT-0020] (pitfalls/draft) 用户 grill 实际 fab_recall…
  (如需重读 broad 决策，调 fab_plan_context 或 fabric plan-context-hint --all)
[fabric] writes here land in store 'team'
```
真源:`narrow.cjs:1240`(banner)、`:1245`(尾行)、`formatEntryLine`。

**问题 · 交互角度(严重)**:
- **banner 英文硬编码**(`:1240`)`N narrow-scoped knowledge entries match your edit targets:` —— 在 `fabric_language: zh-CN` 工程下,broad/fabric-hint 全部 zh-CN,**唯独 narrow 这行是英文**。中英混排,且**完全没接 `banner-i18n.cjs`**(narrow 里 grep `banner-i18n`/`renderBanner` = 0 命中)。i18n 漏网。
- **尾行引退役工具**(`:1245`)`调 fab_plan_context 或 fabric plan-context-hint --all` —— `fab_plan_context` 已被 C1/W2-4 退役(broad 的 `:734` 注释明说「two-step fab_plan_context → fab_get_knowledge_sections 已 retire,改 fab_recall」)。**narrow 仍在教 AI 调一个不存在的工具**。这是会让 AI 调空工具的 grounded bug。
- 尾行括号 `(如需重读 broad…)`:每次编辑都提示「怎么重读 broad」,但 SessionStart 刚注入过 broad,频率上是噪声。

**问题 · 策略角度(严重)**:
- **narrow 完全不接 `nudge-policy.cjs`**(grep `nudge-policy`/`resolveHumanSink`/`observe` = 0)。意味着:用户设 `nudge_mode: silent` 时,broad HUD 静、fabric-hint Stop 静,**但每次编辑 narrow 仍弹 `systemMessage` 到人**。人出口闸的「全局静音」对 narrow 失效 —— 策略不一致。
- `[fabric] writes here land in store 'team'` 每次编辑都附在人出口尾部 —— store 归属是会话级常量,逐次编辑重复播报,纯噪声。

**方案(激进)**:
1. banner 走 `banner-i18n`:新增 `narrowMatchBanner` key(zh:`命中 N 条与本次编辑相关的 narrow 知识:` / en 现状),`narrow.cjs:1240` 改 `renderBanner`。
2. **删退役工具尾行**(`:1245`):要么整行删,要么改 `(重读 broad: fab_recall(paths) 或 fabric context)`。这是 bug 必修。
3. narrow 人出口接 `nudge-policy.resolveHumanSink(cwd, "pre_tool_use", {hit:true})` 闸 systemMessage(AI sink 不变,守 flow⊥observation 不变量),让 `silent`/`observe.pre_tool_use=false` 对 narrow 生效。
4. 删人出口 `writes here land in store 'team'` 逐次行(或并入 narrow 仅首次)。
5. 修镜像漂移:重跑 `fabric install` 让 `packages/cli/.claude` 副本与 SoT 对齐(`98278d9`→`8f4e53e`)。

**价值÷成本**:方案 2(退役工具)价值极高成本极低(删 1 行),**最该先做**——现状会误导 AI 调空工具。方案 1+3(i18n + nudge 闸)价值高中成本,补齐与其它 hook 的一致性。方案 4/5 低成本顺手。

---

### 2.3 `fabric-hint.cjs`(Stop)

**现状**(实跑,默认 config `nudge_mode` 未设 → "normal"):
```json
{"decision":"block","reason":"📋 Fabric: 28 个已结束的会话有未归档的高价值改动。\n   是否调 /fabric-archive 跨会话补归档这些遗漏?\n  (不想再看到此类提醒？在 .fabric/fabric-config.json 设 \"hint_dismiss_signals\": [\"archive_backlog\"]…)\n[fabric] read-set stores: team (write), personal","signal":"archive_backlog","recommended_skill":"fabric-archive"}
```

**问题 · 策略角度(本类最严重)**:
- **W5「Stop 默认安静」只覆盖 `signal==="archive"`,其余 4 信号仍硬 `decision:block`**。看 `main()`:只有 `result.signal === "archive"` 走 dual-sink + `resolveHumanSink` 闸(`:2528-2536`);`archive_backlog` / `review` / `import` 走 `out.write(JSON.stringify(result))`(`:2538`),`maintenance` 走 `:2497`。Claude Code 收到 `decision:block` 会**阻断 Stop 并重新 prompt AI**,与 nudge_mode 无关。
- 实证:本会话默认配置下,`archive_backlog`(28 个死会话)直接 `decision:block` —— 这正是 W5/`nudge-policy.cjs:4b` 注释承诺「Stop 人 nudge 默认 QUIET、遥测优先、不当观测 UI」**没兑现**的信号。`nudge-policy` 注释里写「SessionStart / pre_tool_use are unaffected」却没说「只有 archive 信号受 4b 管」,实际 backlog/review/import/maintenance 全部绕过了 4b。这是 KB `KT-DEC-0007`(hook=nudge 非 gate)的违反:4/5 信号仍是硬 gate。
- 28 个 backlog 死会话才触发一次,但触发即 block —— 频率低但**单次烈度过高**(打断执行流)。

**问题 · 交互角度**:
- `[fabric] read-set stores: team (write), personal`(`bindings-snapshot-reader.formatStoreLabels`,`:2478`)用的是 broad 早已弃用的 jargon 措辞「read-set stores … (write)」—— broad 的 `renderScopeStoreLabel`(`:880`)注释明说要替换这个「legacy read-set jargon line」成 `写入 X · 只读 Y`,但 fabric-hint 仍用旧的。**两 hook store 标签措辞不统一**。
- dismiss 提示行(`renderDismissOption`,`:1457`)`(不想再看到此类提醒？在 .fabric/fabric-config.json 设 "hint_dismiss_signals": ["archive_backlog"]…)` —— 对非工程用户,「设 config 数组」门槛过高,且这串 JSON 语法直接糊在 nudge 里很重。
- `📋 Fabric:` emoji 前缀(全局「no emoji」规则的显式例外),OK。

**方案(激进)**:
1. **把 W5 quiet 推广到全部 5 信号**:`archive_backlog` / `review` / `import` / `maintenance` 也走 dual-sink,人出口过 `resolveHumanSink(cwd,"stop",{highValue:true})`,AI 出口从 `decision:block` 降级为 `additionalContext`(软提示,不打断 Stop)。这是把 KT-DEC-0007「nudge 非 gate」真正贯彻到所有 Stop 信号。删 `:2497`/`:2538` 的 `decision:block` 直写。
   - 折中(若怕漏归档):仅 `archive_backlog` 保留 block(它是跨会话丢知识的最尖信号),review/import/maintenance 一律降软。
2. store 标签统一:fabric-hint 改用 broad 的 `写入 X · 只读 Y` 措辞(把 `renderScopeStoreLabel` 提到共享 lib 或复制其逻辑),废 `formatStoreLabels` 的 `read-set … (write)` jargon。
3. dismiss 行口语化(`renderDismissOption:1460`):before `(不想再看到此类提醒？在 .fabric/fabric-config.json 设 "hint_dismiss_signals": ["archive_backlog"]…)` → after `(不想再看到这类提醒?跟我说"关掉归档提醒"即可)` —— 把 config 语法收进 AI 可执行的自然语言,人不必碰 JSON。

**价值÷成本**:方案 1 价值最高(修「默认安静没兑现」的策略漏洞,直接影响每次 Stop 体验),中成本(改 4 个 emit 分支 + 测试)。方案 2/3 低成本高体验。

---

### 2.4 `cite-policy-evict.cjs`(PreToolUse)

**现状**(`renderNudge`,`:384-389`):
```
[fabric cite] 改 <file> 前未检测到相关 fab_recall —
建议先调 fab_recall(paths=[<被改文件>]) 让系统自动记账引用的 KB(无需手写首行 KB:)。
已 recall 过可忽略本提示。仍可手写首行 `KB: <id> [applied]` 显式 override。
(nudge only — 不阻塞本次编辑;cite 覆盖率见 fabric doctor --cite-coverage)
```

**问题 · 交互角度**:
- 4 行 nudge 偏长,且第 2、3 行讲了「自动记账」「手写首行 override」两套机制 —— C1 刚把首行 `KB:` contract 删成 recall 自动记账(`6b694ca`),这里却还在教「仍可手写首行 KB: override」,**给 AI 重新引入了已内化掉的八股选项**,与 C1 方向相左。
- 文档注释 `:14` 仍写 `fab_recall(paths) / fab_plan_context(paths)` —— 同样引退役 `fab_plan_context`(虽在注释,但 grep 噪声)。

**问题 · 策略角度**:
- 这是个 PreToolUse 软 nudge,与 narrow hook 同事件触发。两个 PreToolUse hook(narrow + cite)可能在同一次编辑都弹 —— 编辑一个文件可能同时收到「narrow 知识浮现」+「改前先 recall」两条。需确认顺序(KB `ISS-20260608-054` 提过 narrow vs cite-evict 顺序被模板装反)。频率叠加观感问题。

**方案**:
1. 砍到 2 行:`[fabric cite] 改 <file> 前没看到相关 fab_recall — 先调 fab_recall(paths=[...]) 系统会自动记账引用的 KB。(nudge,不阻塞)`。删「手写首行 KB: override」(C1 已内化)。
2. 注释 `:14` 去 `fab_plan_context`。
3. 与 narrow 合并考量:既然 narrow 已在 PreToolUse 浮现知识,cite nudge 可只在「narrow 未命中且本 session 无 recall」时才发,避免双弹。

**价值÷成本**:方案 1 价值中(去八股回潮 + 减长)成本极低。方案 3 价值高但要协调两 hook,中成本。

---

### 2.5 `post-tooluse-mutation.cjs` / `session-end-marker.cjs`

**现状**:两者 stdout/stderr **故意为空**(`post:34`、`session-end:24`),纯落 `events.jsonl`。零人/AI 交互。

**问题**:无交互层问题。唯一观感:`post-tooluse` 注释 `:7` 说「both …observation-only」,设计干净。

**方案**:不动。**价值÷成本**:N/A(无交互触点,审计通过)。

---

### 2.6 `lib/banner-i18n.cjs`

**现状**:面向人类文案真源,zh-CN / en / zh-CN-hybrid 三变体 11+ key。

**问题 · 交互角度**:
- `statusTier`(`banner-i18n` 内)`音量 ${mode}:verbose=每步可见 / silent=静音(.fabric/fabric-config.json nudge_mode)` —— 但**实跑 SessionStart 人出口显示的是 `看具体注入: fabric context (--explain 看每条来源)`,不是 statusTier**。说明 broad 的 HUD 末行另有渲染源(`renderHumanCensus` 后追加),`statusTier` 只在 fabric-hint Stop status 用。两处「音量/来源」提示措辞不统一,用户在 SessionStart 看不到「怎么调音量」。
- `statusTier` 里把 `.fabric/fabric-config.json nudge_mode` 直接塞进人出口 —— 非工程用户看不懂「nudge_mode」。

**问题 · 策略角度**:`zh-CN-hybrid` 变体与 `zh-CN` 逐字相同(文件头注释自承「In practice this matches zh-CN exactly」),三变体维护两份成本养一份冗余。

**方案**:
1. `statusTier` 口语化:before `音量 verbose:…silent=静音(.fabric/fabric-config.json nudge_mode)` → after `提醒音量当前=${mode}(想更安静跟我说"调低 Fabric 提醒",想每步可见说"调高")`。
2. 评估删 `zh-CN-hybrid`(折叠到 zh-CN),除非有 mixing 计划。

**价值÷成本**:方案 1 价值高(唯一面向人的「音量旋钮」措辞,现状没人看懂)成本低。方案 2 中价值(减维护面)中成本(动测试 fixture)。

---

### 2.7 `lib/nudge-policy.cjs`

**现状**:人出口闸,resolution order 清晰(`:resolveHumanSink`)。step 4b 是 W5 的「Stop 默认 quiet」。

**问题 · 策略角度**:
- step 4b 注释只说 quiet 作用于「the `stop` human nudge」,但实际 `fabric-hint` 只在 `archive` 信号调了这个 resolver,**其余 4 信号根本没经过 nudge-policy**(见 §2.3)。即 nudge-policy 设计上想管整个 stop 事件,调用方只接了 1/5。lib 设计与调用方不匹配。
- `resolveHumanSink` 只管人出口,AI 出口由调用方决定 —— 但 fabric-hint 的 4 信号 AI 出口是 `decision:block`(gate),不是软 context。lib 的「flow⊥observation」不变量在调用方被打破(block 既改 AI 又是硬中断)。

**方案**:配合 §2.3 方案 1 —— 让 fabric-hint 5 信号全部经 nudge-policy + 全降软 context,nudge-policy 的设计意图才真正生效。**价值÷成本**:已并入 §2.3。

---

### 2.8 `lib/cite-contract-reminder.cjs`

**现状**:`⚠ KB: <id> cited as [applied] but missing contract; add \`→ edit:<glob>\` or \`→ skip:<reason>\` next turn`(`:formatContractMissingReminders`)。

**问题 · 策略角度**:这条提醒是 rc.24 L1 cite-contract 执行层,要求 AI 在 cite decision/pitfall 时补 `→ edit:<glob>` operator。但 **C1(`6b694ca`)已删首行 `KB:` contract 八股,改 recall 自动记账**。这条 reminder 仍在催「补 contract operator」—— 与 cite-policy-evict 的「无需手写首行 KB:」**正面冲突**:一个 hook 说不用手写 contract,另一个 hook 催你补 contract。grounded 矛盾。

**方案**:重审 cite-contract-reminder 是否还该存在。若 C1 recall 自动记账已是唯一 cite 真相,这条 L1 reminder 应**删除或改为只在显式手写 `[applied]` 时才提醒**(与 C1 的「唯一开口时机=dismissed/override」对齐)。**价值÷成本**:价值高(消两 hook 矛盾)中成本(要确认 cite-coverage 稽核是否还依赖它)。

---

### 2.9 `lib/injection-log.cjs`

**现状**:落 `injections.jsonl` 分母遥测,静默 best-effort。无交互。
**问题**:无交互问题。设计干净(advisory lock 防多窗口 corruption)。
**方案**:不动。

---

## 3. 频率/时机专项

| Nudge | 触发 | 阈值/cooldown(config) | 会不会烦 | 评 |
| --- | --- | --- | --- | --- |
| broad HUD | 每 SessionStart | `hint_broad_cooldown_hours: 0` | 每次开会话弹,但单次 1 屏 | 时机对;ALWAYS summary 过载是真问题(§2.1) |
| narrow | 每次编辑命中 | `dedup_window_turns: 5`,`cooldown_hours: 0` | **会烦**:每编辑+不接 nudge silent 闸,且尾行逐次教「重读 broad」 | §2.2 修 |
| cite nudge | 每次编辑无 recall | window 30min | 与 narrow 同事件双弹 | §2.4 方案 3 |
| Stop archive | 高价值 + value-gate | `cooldown 12h` | C1 已软化(dual-sink),OK | 唯一兑现 quiet 的信号 |
| Stop backlog/review/import/maint | 阈值命中 | review≥10/7d,maint 14d | **会烦+烈**:仍硬 block 打断 Stop | §2.3 方案 1 必修 |

**cooldown 设计评**:`archive_hint_cooldown_hours: 12` 合理。`hint_broad_cooldown_hours: 0` / `hint_narrow_cooldown_hours: 0` —— broad 每次开局重弹可接受,但 **narrow cooldown=0 + 无 nudge 闸 = 每次编辑都可能弹人出口**,是频率最该收的点。`review_hint_pending_count: 10` 配 `decision:block`,意味着攒到 10 条 pending 就每个 Stop 都 block(直到 12h cooldown),烈度偏高。

---

## 4. 措辞专项:面向人类用户字符串 + 大白话改写

| 当前(file:line) | 非工程用户能懂? | 大白话改写 |
| --- | --- | --- |
| `看具体注入: fabric context (--explain 看每条来源)`(broad HUD 末行) | ✗ 不知在哪敲 | `想看每条知识从哪来:在终端跑 fabric context` 或直接删 |
| `音量 ${mode}:verbose=每步可见 / silent=静音(.fabric/fabric-config.json nudge_mode)`(`banner-i18n statusTier`) | ✗ nudge_mode 看不懂 | `提醒音量=${mode}(想更安静跟我说"调低 Fabric 提醒")` |
| `(不想再看到此类提醒？在 .fabric/fabric-config.json 设 "hint_dismiss_signals": ["archive_backlog"]…)`(`fabric-hint:1460`) | ✗ JSON 语法 | `(不想再看到这类提醒?跟我说"关掉归档提醒"即可)` |
| `[fabric] read-set stores: team (write), personal`(`fabric-hint:2478`) | ✗ jargon | `知识写到:team;只读参考:personal`(= broad 的 `写入/只读`) |
| `N narrow-scoped knowledge entries match your edit targets:`(`narrow:1240`) | ✗ 英文+jargon | `命中 N 条和这次改动相关的知识:` |
| `(如需重读 broad 决策，调 fab_plan_context…)`(`narrow:1245`) | ✗ 退役工具 | 删 |
| `知识库节点数 ${n}/${threshold}，距 init_scan_completed ${h}h`(`importLine1`) | ✗ `init_scan_completed` | `知识库还很空(${n}/${threshold} 条)` |
| `📋 Fabric: 28 个已结束的会话有未归档的高价值改动` | ✓ 基本能懂 | OK(「未归档」可换「还没存进知识库」) |

---

## 【本类 Top 5 高价值改动】

1. **`narrow.cjs:1245` 删退役工具尾行**(bug 必修)——`fab_plan_context` / `fabric plan-context-hint --all` 已退役,现状每次编辑都教 AI 调一个不存在的工具。删 1 行,价值极高成本极低。

2. **`fabric-hint.cjs` 把 W5「Stop 默认安静」推广到全部 5 信号**(策略漏洞)——当前只有 `archive` 走 dual-sink/软提示,`archive_backlog`/`review`/`import`/`maintenance` 仍 `decision:block` 硬打断 Stop,与 nudge_mode 无关、违反 KT-DEC-0007。实证:默认配置下 backlog 直接 block。改 `:2497`/`:2538` 4 个分支降软。价值最高。

3. **`broad.cjs:959` ALWAYS-ACTIVE summary 加 `summaryMaxLen` 截断**(开局过载)——当前 ALWAYS 区 summary 不截断,`KT-GLD-0005` 110+ 字整段灌进 SessionStart。1 行改,立即瘦开局上下文,与 lean 主张一致。

4. **`narrow.cjs` 接入 `nudge-policy` + `banner-i18n`**(一致性)——narrow 是唯一既不接人出口静音闸(silent 对它失效)、又英文硬编码(zh-CN 工程里中英混排)的 hook。补齐后与 broad/fabric-hint 行为统一。

5. **消 `cite-contract-reminder` ↔ `cite-policy-evict` 矛盾**(grounded 冲突)——一个催「补 `→ edit:<glob>` contract」,另一个说「无需手写首行 KB:」。C1 已内化 cite 为 recall 自动记账,L1 contract reminder 应删或仅在显式手写 `[applied]` 时触发。

**镜像漂移**(留给综合):`knowledge-hint-narrow.cjs` 的 `packages/cli/.claude` 副本已与 SoT 漂移(md5 `98278d9` vs `8f4e53e`),是 `KT-PIT-0004` 的活体复现,需 `fabric install` 重对齐。

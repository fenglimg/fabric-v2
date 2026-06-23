# NS-02 · CLI 技术栈 + 审美 + TUI 北极星

> 设计师视角:CLI 渲染栈裁决 + 目标视觉语言 + TUI 体验北极星。
> 北极星问题:**Fabric 的命令行观感要强过 maestro-flow —— 渲染栈与 TUI 要不要换、换成什么、目标审美是什么。**
> 基线 grounded:Fabric = `ink@4.4.1 + react@18 + @clack/prompts@1.2 + picocolors`;maestro-flow = `ink@6 + react@19 + @inkjs/ui@2 + ink-gradient@4 + ink-big-text@2 + ink-spinner@5`。
> 授权:零用户、clean-slate(`feedback_clean_slate`)。约束:CLI `context` 命令与 hook 注入 **byte-identical 共享渲染器**(`02-hook.md`),审美改动必须双端守恒。

---

## 0. 一句话主张

> **退掉 Ink。** Ink+React 在 Fabric 这种「99% 一次性命令输出 + 1 个 install wizard」的场景是错配——maestro-flow 走重 Ink 是因为它有**常驻 dashboard/TUI**,Fabric 没有。Fabric 的观感不靠「比 maestro 更重的 React 运行时」赢,靠**纯字符串渲染器的排版纪律 + 一套语义化视觉 token**赢:更快启动、更一致、更可被 hook 复用。目标审美 = **"安静的仪表盘"(Quiet Instrument Panel)**:单色强调 + 树形信息层级 + 对齐栅格 + 三态符号一致。Top1 改动 = **抽出 `theme.ts` 单一视觉 token 源,CLI 输出与 hook 注入共享同一套 symbol/paint/对齐原语**(治本 byte-identical 约束 + 杜绝割裂)。

---

## ① 栈裁决

### 1.1 现状诊断(grounded)

Fabric 当前是**两套渲染栈并存且职责错位**:

| 栈 | 用在哪 | 文件证据 | 问题 |
|---|---|---|---|
| **Ink + React** | `tui/*`(11 文件) + install summary 输出 | `InkOutputRenderer.ts` 每条消息一次 `render()`(`:34-37`,fresh Ink instance) | **把 Ink 当一次性字符串画笔用**:`renderSuccess`/`renderError`/`renderInfo` 全是 `render(<StatusMessage/>)` 然后立即丢——React 运行时全部开销、零交互收益 |
| **@clack/prompts** | 真正的交互层(9 文件,含 install wizard pipeline) | `install-wizard.ts` / `pipeline/store.stage.ts` / `doctor.ts` / `config.ts` 都 import clack | clack 才是 install/uninstall/config 的实际交互引擎 |
| **picocolors** | 字符串上色真源 | `colors.ts` 的 `paint.*` + `padEnd`/`displayWidth`(string-width) | 已是干净的纯函数渲染原语,**install-summary 已复用它做表格**(`install-summary.ts:178` padEnd 表) |

**核心反模式**:`InkOutputRenderer` 用 React 渲染**非交互、流式、一次性**的命令输出。Ink 的价值是「diff-based 重绘可变 UI」(进度条、可选列表、live spinner)。但 Fabric 的 doctor/install-summary/context 是**打印即终态**——根本不重绘。用 Ink 画它们 = 为了 `console.log` 一行字背一整个 React reconciler + yoga 布局引擎。

**与 maestro-flow 的关键差异**:maestro 走重 Ink(`ink@6` + gradient + big-text + `install-ui/InstallFlow` 持久 TUI app + `shared/tokens.ts` 设计 token)**是合理的**,因为它有 `dashboard/tui/`、多步 `CyberdeckBlueprint` 蓝图选择器、`ComponentGrid`/`BlueprintPreview` 这种**真·可变 UI**。Fabric 没有任何常驻 TUI——它只有一个 4 步 store wizard(`StoreWizardFlow.tsx`,而且这个 wizard 与 clack pipeline 还**重复**了)。

> **不要为了「观感超过 maestro」就抄它的重栈。** maestro 的重是被它的 dashboard 需求拉动的;Fabric 抄重栈只会得到:更慢的冷启动、与 hook(cjs 纯字符串)更割裂的两套渲染、更高维护税,而观感不会因为「我也用了 React」就变好。观感是排版纪律问题,不是运行时问题。

### 1.2 候选方案利弊表

| 候选 | bundle/启动 | 维护成本 | 与 hook(cjs)一致性 | 交互能力 | 观感天花板 | 裁决 |
|---|---|---|---|---|---|---|
| **A. 保留 Ink 仅限交互 wizard**(install/config/uninstall 用 Ink,所有一次性输出退纯字符串) | 中:Ink 仅交互路径加载,可 lazy import | 中:仍维护 React 组件 + tui 测试 | 半割裂:wizard 用 Ink、输出用字符串,hook 仍第三套 | ✅ 强 | 高 | △ 折中,但 wizard 已有 clack 版本,Ink wizard 是冗余 |
| **B. 全面退到 @clack + picocolors 纯函数渲染**(删 `tui/*` Ink,wizard 收敛到 clack,输出走 `theme.ts` 字符串渲染器) | **最低**:无 React/yoga/Ink,冷启动最快 | **最低**:一套字符串渲染原语,无 React 组件树/无 tui 测试矩阵 | **最佳**:CLI 输出与 hook 注入可共享同一 `theme.ts`(cjs 可 require) | ✅ 够(clack 覆盖 select/text/confirm/spinner) | **高**(排版纪律决定,非运行时) | ✅✅ **推荐** |
| C. 换 Ink→其他 React-TUI(opentui/blessed) | 高:换引擎重写 | 高 | 差 | ✅ | 高 | ✗ 纯换血,Fabric 无 dashboard 需求不值 |
| D. 抄 maestro 重 Ink(ink6+gradient+big-text) | 最高 | 最高 | 最差(两套运行时) | ✅ | 高(但 Fabric 用不上其 dashboard) | ✗ 错配,被 maestro 的 dashboard 需求误导 |

### 1.3 推荐栈 + 理由

> **推荐 B:全面退到 `@clack/prompts` + `picocolors` 纯函数渲染。删除 `tui/*` 的 Ink 层。**

**理由(四维)**:

1. **bundle / 启动延迟**:Ink 拉入 React 18 + yoga-layout + ink 自身。Fabric CLI dist 仅 448K,Ink/React 是其中相当占比的运行时依赖,且**每次** `fabric` 命令(即便只是 `fabric info` 打 5 行)都要解析这条依赖链。退栈后冷启动只剩 picocolors(~1 文件)+ clack(交互路径 lazy)。
2. **维护成本**:`tui/*` 11 个 `.tsx` + `types.ts` + 测试矩阵全可删。`InkOutputRenderer` 的 fresh-instance-per-message 黑魔法(`:34-37`)、cleanup unmount 循环(`:152-163`)全是为「把 React 当 console.log」付的税。
3. **与纯字符串渲染混用的割裂**:这是**最强理由**。`02-hook.md` 明确 CLI `context` 命令与 hook 注入 **byte-identical 共享渲染器**,而 hook 是 `.cjs` 运行时(`knowledge-hint-broad.cjs` 等)——**cjs hook 永远无法 require 一个 Ink/React 组件**。所以只要输出层有 Ink,CLI 与 hook 就**结构性地不可能共享渲染器**,只能各画一套靠测试锁 byte-identical(脆)。退到纯字符串 `theme.ts`(可被 ts 与 cjs 同时消费)是**唯一**能让这条 byte-identical 约束从「靠测试守」变成「靠共享代码守」的栈。
4. **观感天花板**:picocolors + padEnd + string-width 已经能做对齐表(`install-summary.ts` 实证)、树形层级、三态符号。observance 证明:HUD(`02-hook.md §1`)已被 C1 用纯字符串打磨得「scope-primary、自洽、不错」——**最好看的现状输出恰恰是纯字符串画的,不是 Ink 画的**。

**唯一保留 Ink 的反对意见**:install wizard 的多步状态机用 React 写更顺。**反驳**:Fabric 的 install wizard 已经有 clack pipeline 版本(`install-wizard.ts` + `pipeline/*.stage.ts`),`StoreWizardFlow.tsx` 的 Ink 版是**重复实现**。clack 的 `select`/`text`/`confirm`/`spinner`/`group` 足够覆盖 4 步 store wizard 与 install 流。删 Ink wizard、统一到 clack,反而消歧。

### 1.4 迁移面(代价)

| 迁移项 | 动作 | 代价 |
|---|---|---|
| `tui/InkOutputRenderer.ts` | 替换为 `lib/output-renderer.ts`(纯字符串,实现同 `OutputRenderer` interface) | Med |
| `tui/SummaryCard/StatusMessage/StepCounter/SectionHeader/Spinner/ErrorBox` | 删,逻辑迁进 `theme.ts` 渲染函数(spinner 用 clack 的或 `ora` 单依赖) | Med |
| `tui/StoreWizard*/InputField` | 删,store wizard 收敛到 clack(`install-wizard.ts` 已有骨架) | Med |
| `install-v2.ts:109-110` `createInkRenderer` | 改 `createStringRenderer`;顺带修 `shouldUseInstallRenderer` 反逻辑(`01-cli.md IN1`:`--yes` 反而触发 TUI) | Low-Med |
| `package.json` | 删 `ink`/`react`/`@types/react` 依赖 | Low |
| 测试 | 删 tui 组件测试,补 `theme.ts` 渲染快照测试 | Med |

> **净收益**:`react`/`ink`/`@types/react` 三依赖出局,11 个 `.tsx` 出局,渲染栈从 3 套(Ink/clack/picocolors)收敛到 2 套(clack 交互 + `theme.ts` 字符串),且 `theme.ts` 可被 hook cjs 复用 → byte-identical 约束从测试守变代码守。

---

## ② 审美北极星

### 2.1 视觉语言定义 ——「安静的仪表盘 / Quiet Instrument Panel」

设计基调:**仪表盘不是霓虹灯**。Fabric 是知识层,常驻在每个会话开局与每次编辑——它的输出**高频、稳态、不该抢注意力**。对照 maestro 的 `tokens.ts` 自称「Cyberdeck Console」(cyan/magenta/gradient/big-text,赛博朋克炫)。Fabric 的北极星走**反方向**:克制、单主色、靠**排版**而非**色彩饱和度**建立层级。这本身就是与 maestro 拉开体感的差异化——不是「比它更炫」,是「比它更冷静可信」。

#### 配色(picocolors 能力内,语义优先)

| token | picocolors | 语义 | 用途 |
|---|---|---|---|
| `primary` | `cyan` | 人类出口、标题、HUD 主轴 | `paint.human` 已是 cyan,沿用 |
| `ai` | `blue` | AI 出口、Next 指引 | `paint.ai` 沿用,与 human 区分两个 sink |
| `success` | `green` | 创建/通过/ok 态 | 三态符号绿 |
| `warn` | `yellow` | 注意非紧急、skipped、deprecated | |
| `error` | `red` | 失败/error | |
| `accent` | `magenta` | **仅** drift/镜像漂移等元警示(稀用) | `paint.drift` 沿用,克制 |
| `muted` | `dim` | 次级信息、index 号、尾注、提示路径 | 大量用于压低噪声 |

> **铁律:一屏只有一个主色块吸睛。** 主色(cyan)只给「这屏在讲什么」的轴(HUD 标题 / 命令主题);其余靠 `dim` 压、靠符号区分态。**禁止** maestro 式 gradient/big-text/多彩拼贴——那是 dashboard 审美,不是高频注入审美。

#### 排版栅格

- **标签列对齐**:统一 `labelWidth`(借 maestro `SP.labelWidth=14` 的纪律,Fabric 已有 `padEnd`/`displayWidth`)。所有 `label: value` 行 `padEnd(label, 14)` 左对齐冒号。
- **树形层级**:`├ / └ / │`(HUD 已用,`02-hook.md §1`)作为**唯一**的嵌套表达。深度 ≤2 层。一级 `▸` 主轴,二级 `├/└` 分支。
- **缩进 = 2 空格/层**,不用可变缩进。
- **表格**:多列数据(store list、capability table)走 `padEnd` 列对齐 + `-` 分隔线(install-summary 已实证),**禁止裸 `\t`**(`01-cli.md S1` 点名 store list 裸 `\t`)。

#### 图标 / 符号体系(单一真源,CLI 与 hook 共享)

| 用途 | 符号 | 说明 |
|---|---|---|
| 人类主轴 | `▸` | HUD/命令主题起始(prompt cursor 隐喻) |
| 树枝 / 树尾 | `├` `└` | 嵌套层级 |
| 通过 / 创建 | `✓` | green;no-color 退化 `[ok]` |
| 失败 | `✗` | red;退化 `[error]` |
| 注意 / skipped | `!` / `○` | yellow;退化 `[warn]` |
| 信息 | `·` | dim,低噪声列表项前缀(替代 maestro 的 `•`,更轻) |
| 下一步指引 | `→` | ASCII `-> ` 兼容 GBK(`error-render.ts` 已实证) |

> **no-color / no-unicode 双退化**:`isColorEnabled()` 已处理颜色(`colors.ts:7`);需补 `isUnicodeEnabled()`,在 GBK/CI 下把 `✓✗▸├└` 退化为 `[ok]/[x]/>/+/\``。**符号语义不变,只换字形**——这保证 hook 注入(可能落到非 UTF8 终端)与 CLI 一致。

#### 信息密度

- **一次性输出默认「terse」**:命令成功只回 1 行结论 + 0~3 行关键事实。详情藏 `--verbose`。
- **三态统一**(空/成功/错误)见下,跨命令同一视觉模板。
- **稳态高频输出(HUD/narrow)默认压到最低**:计数优先于平铺(`02-hook.md §2.1` 方案 3:REFERENCE 33 行 id 墙 → 按 type 分组计数)。

#### 三态统一视觉

```
[空状态]   ▸ <主题>
           · 还没有 <东西>。<一句下一步>
             → <可执行命令>

[成功态]   ✓ <动作完成>  ← green ✓ + 单行结论
           ├ <关键事实1>
           └ <关键事实2>            ← 仅成功才展开,失败不混

[错误态]   ✗ <出了什么>   ← red ✗ + 单行 message
           → <可执行下一步>          ← actionHint(error-render.ts 机制全覆盖)
                                       stack 仅 --debug
```

> 三态共享**同一栅格**(符号 + 主轴 + 树形分支 + `→` 指引),只换符号色与措辞。这是「统一视觉」的本体:用户看任何命令的任何态,版式同构 → 可预测 → 可信。

---

### 2.2 before → after 关键命令样例(4 个)

> 说明:before = 现状(grounded 自 `01-cli.md`/`02-hook.md` 真实输出);after = 北极星渲染。

---

#### 样例 1 · `fabric doctor`(只读健康)

**BEFORE**(`01-cli.md D1`:一命令做 8 事、状态行 + TL;DR + 逐 check + 3 section + payload-limits + store health,`--cite-coverage` 另喷 20+ 行指标墙):

```
Fabric Doctor
Status: degraded
TL;DR (top 3 issues):
  - 28 ended sessions have unarchived high-value edits
  - knowledge-hint-narrow.cjs mirror drift (packages/cli/.claude)
  - 12 pending knowledge entries awaiting review
[check] bootstrap ............... ok
[check] hooks ................... warn
[check] mcp ..................... ok
... (逐 check 全平铺) ...
Issues (derived-state):
  ...
Issues (knowledge):
  ...
payload-limits: ...
store health: team(write) personal(ro) ...
```

**AFTER**(北极星:5 秒看健康,terse + 三态栅格,审计面已拆去 `fabric audit`):

```
▸ fabric doctor                                    cc + codex · 2 stores

  ! degraded · 3 个待办 · 0 错误               ← yellow ! 单行健康结论

  ├ ! 28 个旧会话有未归档改动      → fabric-archive 补归档
  ├ ! narrow hook 镜像漂移         → fabric install 重同步
  └ ! 12 条待审知识               → fabric-review

  ✓ bootstrap · mcp · hooks · skills 就绪        ← 通过项折叠成一行,不平铺

  写入 team · 只读 personal
  详情 fabric doctor --verbose · 一键修 fabric doctor --fix
```

> 改动要点:① 通过的 check 折叠成 1 行(`✓ A · B · C 就绪`),只展开 actionable;② 每个待办行**自带 `→` 可执行下一步**;③ cite-coverage 20 行指标墙移出(`fabric audit cite`);④ store 标签统一「写入/只读」措辞(与 HUD 一致)。

---

#### 样例 2 · `fabric install`(summary 终态)

**BEFORE**(`install-summary.ts`:`console.log` 拼接,padEnd 表已有但散落、restart banner 裸文案):

```
Install plan
mode: project
target: /Users/.../pcf
Will write:
  - .../.fabric/events.jsonl
  - .../.fabric/forensic.json
  - .../.fabric/fabric-config.json
Capabilities:
client     bootstrap  mcp   hook   skill   follow-up
--------------------------------------------------------
cc         ✓          ✓     ✓      7       -
codex      ✓          ✓     ✓      7       restart codex
Restart your client to load Fabric.
```

**AFTER**(北极星:成功态栅格 + 对齐表 + 单一 restart 指引):

```
✓ Fabric 装好了 · project · 2 客户端                ← green ✓ 单行结论

  客户端    bootstrap  mcp  hook  skill  接下来
  ──────    ─────────  ───  ────  ─────  ──────
  cc         ✓          ✓    ✓     7      就绪
  codex      ✓          ✓    ✓     7      重启 codex 生效   ← yellow 仅此格

  ├ 写入 .fabric/{events,forensic,config}.json
  └ 知识 store:写入 team · 只读 personal

  → 重启客户端后,Fabric 会在每次会话开局浮现知识
```

> 改动要点:① 顶行 green ✓ 单结论;② 表格 `──` 用全角对齐线、列 padEnd(已有原语);③ 「Will write」三行折叠成 1 树枝;④ restart 从裸 banner 变成 `→` 指引,且只对需要重启的格(codex)标 yellow。

---

#### 样例 3 · `fabric context` / SessionStart 注入(**byte-identical 共享渲染器**)

> 这是审美一致性的**关键样例**:同一渲染器,人类在终端跑 `fabric context` 看到的,与 hook 在会话开局塞给「人 sink」的,**逐字节相同**。

**BEFORE**(`02-hook.md §1` 真实 HUD,已被 C1 打磨,但 AI sink 头行退化 `store`、末行噪声):

```
▸ [fabric] 共 61 条 · 团队 11 · 项目 49 · 个人 1
  broad 40 · 本会话注入
    ├ 常驻规则 7  guideline 6 · model 1
    └ 情境参考 33  decision 25 · pitfall 8
  narrow 21 · 编辑对应文件时浮现
  写入 team · 只读 personal
  看具体注入: fabric context (--explain 看每条来源)   ← 稳态噪声/非工程用户不知在哪敲
```

**AFTER**(北极星:同栅格,压尾注、统一主轴符号,人/AI sink store 标签一致):

```
▸ fabric · 61 条知识 · 团队 11 · 项目 49 · 个人 1     ← ▸ 主轴 + cyan,去 [fabric] 括号

  ├ 常驻规则 7      guideline 6 · model 1            ← 开局就生效
  ├ 情境参考 33     decision 25 · pitfall 8          ← 命中编辑路径时浮现(不平铺 id 墙)
  └ 编辑联想 21     改对应文件时自动带出

  写入 team · 只读 personal                          ← 人/AI sink 同一措辞(修 AI sink 裸 `store`)
```

> 改动要点:① `▸ fabric` 统一主轴符号(替 `[fabric]` 括号);② broad/narrow 三类压成 3 条树枝 + 计数(不平铺 33 行 id,与 `02-hook.md` 方案 3 一致);③ **删稳态尾注** `看具体注入: fabric context`(非工程用户不会去敲;真要看走 `--explain`);④ store 标签人/AI 双 sink 共享 `renderScopeStoreLabel` 结果(修 AI sink fallback 裸 `store`)。
>
> **一致性兑现**:此输出由 `theme.ts` 的 `renderKnowledgeHud(census)` 单函数产出。CLI `context` 命令 `console.log(renderKnowledgeHud(...))`;hook 把同函数结果塞 `systemMessage`。**同代码 → byte-identical 自动成立**,不再靠测试锁。

---

#### 样例 4 · 错误(`fabric <任意命令>` 失败)

**BEFORE**(`01-cli.md E1`:只有 FabricError 有 actionHint,其余 `console.error(err)` 喷裸 stack;各命令手写 `xxx failed:` 格式各异):

```
TypeError: Cannot read properties of undefined (reading 'mount_name')
    at resolveStore (/Users/.../store.js:142:18)
    at async Object.run (/Users/.../store.js:58:5)
    at async runMain (/Users/.../index.js:89:7)
    ... (整条 stack 喷给用户) ...
```

**AFTER**(北极星:统一 `renderCommandError`,错误态栅格,stack 仅 `--debug`):

```
✗ fabric store list 失败 · 找不到 store 绑定          ← red ✗ + 单行 message

  → 先跑 fabric store list 看已挂载的 store
  → 或 fabric store bind <alias> 绑定一个

  (诊断细节 fabric store list --debug)               ← dim,stack 藏 --debug
```

> 改动要点:① 非 FabricError 也走统一渲染(`index.ts:89` 兜底改 `renderCommandError`);② red ✗ + 单行人话 message,**不喷 stack**;③ 一个或多个 `→` actionHint(FabricError 机制覆盖率从「少数抛点」提到「全错误路径」);④ stack 仅 `--debug`,且提示词 dim 压低。

---

## ③ TUI 北极星(install wizard 等交互流)

### 3.1 现状体感短板(grounded)

1. **双实现割裂**:`StoreWizardFlow.tsx`(Ink)与 `install-wizard.ts`(clack)**并存**,store onboarding 有两套 wizard。维护者改流程不知改哪个。
2. **渲染器反逻辑**(`01-cli.md IN1`):`shouldUseInstallRenderer` 仅在 `--yes`/`--dry-run` 用 Ink 渲染器,而**默认交互安装反而没有 Ink**——关系反了。`--yes`(别问我)要的是干净 CI 日志,交互才需要可视化。
3. **Ink 一次性误用**:`InkOutputRenderer` 每条消息 fresh `render()`——install 的 step 进度没有真正的 live 重绘收益,只是把 console.log 包了 React。
4. **无统一步骤感**:StepCounter/Spinner/StatusMessage 各自 render,步骤之间无持续的「第 N/M 步」骨架,中断后无回显当前进度。

### 3.2 目标态:clack 单栈 wizard,「有骨架的对话」

> 北极星:install/store/config 交互流统一走 **clack**,呈现为**一条持续的、有步骤骨架的对话**——每步顶部有 `◇ 第 N/M 步 · <步骤名>`,已完成步骤回显选择,可 `Ctrl-C` 任意点中断且给出「已做到哪」的回执。

```
◆ Fabric 安装 · project · /Users/.../pcf

◇ 1/4 客户端          已选 ✓ Claude Code  ✓ Codex          ← 完成步回显选择(dim ✓)
◇ 2/4 知识 store      已选 创建新 store "team"
◆ 3/4 Git remote      ▸ git@github.com:org/knowledge.git_   ← 当前步高亮(cyan ◆)
○ 4/4 确认                                                  ← 未来步 dim ○

  ↑↓ 选择 · Enter 确认 · Ctrl-C 中断(进度会保存)
```

**目标体验四要素**:
- **步骤感**:持续的 `N/M` 骨架 + `◆ 当前 / ◇ 完成 / ○ 待办` 三态(clack `group` + 自渲染步骤头)。完成步**回显已选值**(用户随时看得到自己做了什么)。
- **进度**:长操作(写文件/git clone)用 clack `spinner`,完成转 `✓`。**不**用 Ink live 进度——install 步骤是离散的,spinner 足够。
- **可中断**:`Ctrl-C` 在任意步给出「已完成 1-2 步、第 3 步未做」的回执,而非裸退出。clack 的 `isCancel` 已支持优雅取消。
- **回显**:终态汇总 = 样例 2 的 install summary(✓ 栅格),与交互流首尾呼应(同视觉语言)。

> **为什么 clack 够、不需要 Ink**:Fabric 的交互流全是**线性问答**(选客户端 → 选 store → 填 remote → 确认),没有 maestro `ComponentGrid`/`BlueprintPreview` 那种**二维网格/实时预览**需求。clack 的 select/multiselect/text/confirm/spinner/group 完全覆盖,且与纯字符串输出层共享 picocolors 色板 → 交互与非交互**视觉同源**。

---

## ④ 一致性:CLI 输出 ↔ hook 注入

> 约束(`02-hook.md`):`fabric context` 命令与 SessionStart/Stop hook 的人类注入文案 **byte-identical**。hook 是 `.cjs` 运行时,无法 require Ink/React。

**北极星机制 ——「单一 `theme.ts` 真源,ts 与 cjs 双消费」**:

```
packages/shared/src/theme.ts   ← 视觉 token + 渲染原语单一真源
   ├─ paint.*         (picocolors 包装,no-color 退化)
   ├─ sym.*           (▸ ├ └ ✓ ✗ ! · →,no-unicode 退化)
   ├─ padLabel / table / tree   (对齐栅格原语)
   └─ renderKnowledgeHud(census)  ← HUD/context 单函数
        renderHealthSummary / renderInstallSummary / renderCommandError ...
              │                              │
   CLI ts ────┘                              └──── hook cjs
   console.log(renderKnowledgeHud(c))         systemMessage = renderKnowledgeHud(c)
```

落地三条:
1. **渲染逻辑全部下沉到纯函数 `theme.ts`**,CLI 命令与 hook 都只是「准备数据 → 调同一渲染函数 → 各自出口(console.log / systemMessage)」。byte-identical 从「测试守」变「同代码天然成立」。
2. **构建产物双格式**:`theme.ts` 走 `exports.development → src`(`00-SYNTHESIS.md #13` 已提议,根治 rebuild 复发),或编译出 cjs 副本供 hook require。**这正是退掉 Ink 的最大红利**——Ink 组件无法被 cjs require,纯字符串渲染函数可以。
3. **符号/退化口径单一**:`no-color`(已有 `isColorEnabled`)+ 新增 `no-unicode` 退化,CLI 与 hook 走同一开关 → GBK/CI 终端下两端同步退化,不会一端 `✓` 一端 `[ok]`。

---

## 排序【体验/栈收敛清单】(价值 ÷ 成本,P0/P1/P2)

| # | 改动 | 类别 | 价值 | 成本 | 优先级 |
|---|---|---|---|---|---|
| 1 | **抽 `theme.ts` 单一视觉 token + 渲染原语真源**(paint/sym/padLabel/tree/table),CLI 与 hook cjs 双消费 | 栈+一致性 | High | Med | **P0** |
| 2 | **`renderKnowledgeHud` 下沉 `theme.ts`,CLI `context` 与 hook 共享**(byte-identical 从测试守变代码守) | 一致性 | High | Med | **P0** |
| 3 | **三态视觉模板**(空/成功/错误同栅格)+ `renderCommandError` 兜底(`index.ts:89` 非 FabricError 也走统一渲染) | 审美 | High | Low | **P0** |
| 4 | 补 `isUnicodeEnabled()` no-unicode 退化(`✓✗▸├└→`),与 no-color 同开关 | 审美 | Med | Low | **P0** |
| 5 | **删 `tui/*` Ink 层**,`InkOutputRenderer`→纯字符串 `output-renderer.ts` | 栈 | High | Med | **P1** |
| 6 | store wizard 收敛到 clack(删 `StoreWizardFlow.tsx`),与 `install-wizard.ts` 合一 | TUI | High | Med | **P1** |
| 7 | 修 `shouldUseInstallRenderer` 反逻辑(交互才富渲染,`--yes` 走纯文本日志) | TUI | Med | Low | **P1** |
| 8 | install summary 套三态成功栅格(样例 2);store list 去裸 `\t` 改 padEnd 表 | 审美 | Med | Low | **P1** |
| 9 | clack wizard 加持续步骤骨架(`◆/◇/○ N/M` + 完成步回显 + 优雅中断回执) | TUI | Med | Med | **P1** |
| 10 | 删 `package.json` 的 `ink`/`react`/`@types/react` 依赖 + 删 tui 组件测试 | 栈 | Med | Low | **P2** |
| 11 | doctor 通过项折叠成单行 + 待办行自带 `→`(样例 1) | 审美 | Med | Med | **P2** |
| 12 | 评估 spinner 依赖(clack 内置 vs 单引入 `ora`),避免为一个 spinner 留 Ink | 栈 | Low | Low | **P2** |

**落地建议**:P0(#1-4)是**纯增量、无删除风险**——先建 `theme.ts` 真源 + 三态模板 + 双退化,立刻统一观感且兑现 byte-identical;此时 Ink 仍在但已被旁路。P1(#5-9)才动结构(删 Ink、收敛 wizard、修渲染器逻辑),建议单独 PR + grill。P2(#10-12)是收尾清理。**先立标准(P0)再退栈(P1)**,避免「边删边定审美」的混乱。

# Grill Report: W3-A+B 退 Ink + 鲜明多色审美北极星落地

**Session**: 20260623-grill-cli-stack-aesthetic
**Depth**: standard (5 branches)
**Date**: 2026-06-23
**Upstream**: NS-02-cli-stack-aesthetic.md(北极星)+ W2-5 已落 theme.ts

## Discovery Summary

### 项目上下文
Fabric CLI 渲染栈:`ink@4.4.1 + react@18 + @clack/prompts@1.2 + picocolors`。北极星已锁:**退 Ink 分两步**(W2-5 抽 theme 已做 / W3-A 拔 Ink)+ **鲜明多色审美**(影响 CLI 输出 + hook 注入,共享 theme)。

### 代码地基(post-W2-5 实测)
- `packages/shared/src/theme.ts`(W2-5,**渲染真源**):`ANSI`=手写 24-bit truecolor 前景码;`PALETTE`/`ThemeToken`;`isColorEnabled(env,isTTY)`=NO_COLOR+FORCE_COLOR(**仅开/关,无 256/16 降级**);`paint(token,text,colorOn)`;`symbol(kind)`=ASCII/glyph 三态 fallback。**无 Ink/picocolors 依赖,纯字符串**。无 gradient。
- Ink 残留:10 个 `packages/cli/src/tui/*.tsx`(StoreWizard/InputField/ProgressBar/SummaryCard/ErrorBox/StepCounter/SectionHeader/StatusMessage/index/types)+ `InkOutputRenderer.ts`。
- 颜色双系统:老 `packages/cli/src/colors.ts` + 新 `theme.ts`。
- byte-identical:`theme.ts` ↔ `commands/context.ts` ↔ `.claude/hooks/{fabric-hint,knowledge-hint-broad}.cjs` ↔ `banner-i18n.cjs`。
- 终端兼容处理散在:`colors.ts` / `theme.ts` / install pipeline `env.stage.ts` / 多个 command。

### Upstream
NS-02:主张退 Ink(Ink 是误用,每条消息 fresh React render)+ "安静仪表盘"(被用户否,改 **鲜明多色**)+ theme.ts 共享渲染。

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries | ✅ Complete | 退Ink彻底拔 / 拆退Ink+焕然一新 | — |
| 2 | Data Model & State (theme/color model) | ✅ Complete | 押结构非色彩 / 结构基元分层 | — |
| 3 | Edge Cases & Failure Modes (终端兼容) | ✅ Complete | 现代终端+ASCII兜底 / HUD结构极简 | — |
| 4 | Integration & Dependencies (clack/byte-identical) | ✅ Complete | colors.ts并入theme / @clack只包上下文 | — |
| 5 | Scale & Performance (启动延迟/退Ink本意) | ✅ Complete | 架构判据+perf存档 / 增量+snapshot | — |

---

## Branch 2: Data Model & State (theme/color/结构 model)

**Status**: 🔴 In Progress
**代码基线**: theme.ts PALETTE = 7 语义角色色(success/warn/error/drift/ai/human/accent,Flat-UI),纯前景、无 bg、无渐变,truecolor;`paint()`+`symbol()`;byte-locked `lib/theme.cjs` 镜像 + G-THEME parity test(theme-parity.test.ts)。**无任何 layout/结构基元**。

### Q2.1: 焕然一新差异化押哪

**Answer**: 押结构/排版(tree 层级 + 栅格对齐 + 图标/徽章 + 信息分组);色彩保持 7 语义角色,**不加渐变/背景色**。
**Evidence**: theme.ts 渐变需逐字符 ANSI,与 byte-locked cjs 镜像 + parity test 冲突;7 色已够鲜明。
**Decision**: locked
**Constraint**: W3-B 差异化 MUST 来自结构(tree/grid/badge/分组),NOT 色彩堆叠;色板冻结在 7 语义角色,禁渐变/bg(守 cjs 镜像可维护性)。

### Q2.2: 结构基元放哪

**Answer**: 分层 —— HUD(context 命令 + SessionStart hook)共享的结构基元进 theme.ts + cjs 镜像(parity 守);doctor/install/store 等 CLI-only 面用更丰富的 CLI-only 结构。
**Evidence**: byte-identical 只约束 HUD(context⊥hook 渲染同一知识 HUD);其余 CLI 面无 cjs 镜像需求。
**Decision**: locked
**Constraint**: 结构基元 MUST 分两层 —— shared(HUD 用,theme.ts+cjs+parity)/ CLI-only(其余面)。最小化 cjs 镜像扩张。

**Branch 2 完成** ✅ — 2 决策 locked。

---

## Branch 3: Edge Cases & Failure Modes (终端兼容)

**Status**: 🔴 In Progress
**代码基线**: theme.ts `isColorEnabled` 二档(NO_COLOR/FORCE_COLOR/isTTY),无 256/16 降级;`symbol()` 有 ASCII fallback,tree/box 字符暂无。

### Q3.1: 终端兼容做到哪一档

**Answer**: 假设现代终端 —— truecolor/none 二档(不建 256/16 阶梯);但所有结构字符(tree/box/badge)MUST 带 ASCII fallback,NO_COLOR/非TTY/窄终端降纯 ASCII 结构。
**Evidence**: 受众=Claude Code/Codex CLI 开发者(现代终端);降级阶梯对受众性价比低;管道重定向 isTTY=false→需兜底。
**Decision**: locked
**Constraint**: 色彩 MUST 二档(truecolor/none);结构字符 MUST 全部提供 ASCII fallback;不实现 256/16 中间档。

### Q3.2: cjs 镜像维护脆性怎么防

**Answer**: HUD 共享结构保极简(parity test 能轻松守的复杂度,如单层 list+badge);复杂 tree/栅格全 CLI-only。不依赖 W3-G。
**Evidence**: 与 Q2.2 分层一致;手写双份越复杂越易漂,极简共享层把漂移面压到最低。
**Decision**: locked
**Constraint**: HUD 共享结构基元 MUST 保持 parity-test-trivial 复杂度(单层结构);任何复杂 tree/grid 限 CLI-only;W3-B 不阻塞于 W3-G。

**Branch 3 完成** ✅ — 2 决策 locked。

---

## Branch 4: Integration & Dependencies

**Status**: 🔴 In Progress
**代码基线(三套并存)**: ① `theme.ts`(新,raw ANSI 7 色)② `colors.ts`(老,**picocolors** + string-width,**14 个消费者**)③ `@clack/prompts`(9 处裸用默认样式,未被 theme 包)。picocolors 仅 colors.ts 引。

### Q4.1: colors.ts 怎么处理

**Answer**: 并 colors.ts → theme.ts 单一真源 —— 迁 14 消费者,删 colors.ts + picocolors 依赖。
**Evidence**: colors.ts(picocolors)与 theme.ts(raw ANSI)双色系统;picocolors 仅 colors.ts 引,迁完即可删。
**Decision**: locked
**Constraint**: 色彩 MUST 单一真源 theme.ts;colors.ts 全 14 消费者迁移后删除;picocolors 依赖移除。这是 W3-B(焕然一新)的工作量主体。

### Q4.2: @clack 交互层统一到什么程度

**Answer**: 包上下文(intro/outro/消息/错误走 theme);prompt 控件本体接受 @clack 默认样式,不 fork。
**Evidence**: @clack 深度主题化需 fork,性价比低;上下文 theme 化已足够一致。
**Decision**: locked
**Constraint**: @clack 集成 MUST 仅包裹上下文(theme 化 intro/outro/log/error),不深度 restyle prompt 控件;不弃 @clack。

**Branch 4 完成** ✅ — 2 决策 locked。

---

## Branch 5: Scale & Performance

**Status**: 🔴 In Progress

### Q5.1: 退 Ink 验收判据

**Answer**: 架构判据为主(ink+react 依赖移除 + 单渲染栈 + wizard 功能等价 @clack + parity 绿)+ 量一次冷启动/bundle 前后对比存档(不设硬线)。
**Evidence**: NS-02 perf 声称未实测;Fabric CLI 启动非用户热路径;真收益是架构/维护。
**Decision**: locked
**Constraint**: W3-A 验收 MUST 以架构判据(依赖移除 + 单栈 + 功能等价 + parity);perf 量一次存档,NOT 硬验收线。

### Q5.2: 全面迁移防回归

**Answer**: 增量 per-surface + snapshot test 守 —— 每命令输出建 snapshot 基线,迁一面验一面,diff 拦回归。
**Evidence**: 与 W1-4 help snapshot 一脉相承;14 消费者迁移面大,增量降回归面。
**Decision**: locked
**Constraint**: W3-B MUST 增量按 surface 迁移,每 surface 配 output snapshot test;禁 big-bang。

**Branch 5 完成** ✅ — 2 决策 locked。

---

## Branch 1: Scope & Boundaries

**Status**: 🔴 In Progress
**Questions asked**: 1
**Decisions locked**: 1

### Q1.1: "退 Ink" 边界划在哪

**Answer**: 彻底拔 Ink —— 删 ink+react 依赖,10 个 tui/*.tsx 全用 @clack/prompts + theme.ts 重写。覆盖所有渲染面(install 阶段 / doctor / config 等)+ CLI 输出 + hook 注入,目标"焕然一新"。
**Evidence**: theme.ts(W2-5)已纯字符串接管输出;Ink 残留 10 tui/*.tsx + InkOutputRenderer.ts。
**Decision**: locked
**Constraint**: MUST 删除 ink + react 依赖;所有渲染面(交互 + 输出 + hook)收敛到 theme.ts(输出)+ @clack/prompts(交互)双底座。

**🔍 Insight(code 实测,Branch 4 也复用)**: 渲染面分类 —— **唯一真 Ink TUI = install wizard**(`install-v2.ts`→`tui/*.tsx`×10);`config.ts` 已是 @clack(13 prompt/0 Ink);`doctor.ts` 是 1649 行输出+几处 clack(非 Ink TUI);info/store/sync 纯输出。⇒ "退 Ink"(技术栈)与"焕然一新"(审美皮肤)是两件不同 scope 的事,应拆分。

### Q1.2: 退 Ink 与焕然一新是否拆分

**Answer**: 拆成两个独立子目标/PR —— ① 退 Ink = 只重写 install wizard(contained 高风险一处);② 焕然一新 = 所有面换 theme 皮肤(低危、广、可先行)。
**Evidence**: 渲染面分类(上 Insight),只有 install wizard 是真 Ink。
**Decision**: locked
**Constraint**: W3-A(退 Ink)SHOULD 限定为 install wizard 重写 + 删 ink/react 依赖;W3-B(焕然一新)独立推进全面 theme 皮肤,二者解耦可并行。

**Branch 1 完成** ✅ — 2 决策 locked。

---

## Synthesis

### Decision Summary
| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|
| D1 | 彻底拔 Ink(删 ink+react,10 tui→@clack+theme) | locked | 1 | MUST 删 ink+react |
| D2 | 拆「退 Ink(W3-A 仅 wizard)」与「焕然一新(W3-B 全面皮肤)」两子目标/PR | locked | 1 | SHOULD 解耦,可并行 |
| D3 | 差异化押结构(tree/grid/badge),色板冻结 7 语义角色,禁渐变/bg | locked | 2 | MUST 结构非色彩堆叠 |
| D4 | 结构基元分层:HUD-shared(theme+cjs+parity)/ 其余 CLI-only | locked | 2 | MUST 分两层 |
| D5 | 现代终端 truecolor/none 二档(不建 256/16);结构字符全 ASCII fallback | locked | 3 | MUST ASCII 兜底 |
| D6 | HUD 共享结构保 parity-trivial 复杂度;复杂结构限 CLI-only;不阻塞 W3-G | locked | 3 | MUST 极简共享层 |
| D7 | colors.ts → theme.ts 单一真源(迁 14 消费者,删 colors.ts + picocolors) | locked | 4 | MUST 单色彩真源 |
| D8 | @clack 仅包上下文(theme 化 intro/outro/log/error),不 restyle 控件、不弃 @clack | locked | 4 | MUST 仅包上下文 |
| D9 | 退 Ink 验收以架构判据为主(依赖移除+单栈+功能等价+parity)+ perf 量一次存档 | locked | 5 | MUST 架构判据,perf 非硬线 |
| D10 | W3-B 增量 per-surface 迁移 + 每面 output snapshot test,禁 big-bang | locked | 5 | MUST 增量+snapshot |

### Verified Constraints(供下游 plan/execute)
- **W3-A(退 Ink)= contained**:仅 `install-v2.ts` + 10 `tui/*.tsx` 重写为 @clack;删 ink/react;验收=依赖移除+功能等价+parity 绿。
- **W3-B(焕然一新)= 工作量主体**:colors.ts 14 消费者迁 theme.ts + 删 picocolors + 所有 surface 增量换皮 + snapshot 守;差异化靠结构(tree/grid/badge)。
- **色板冻结**:7 语义角色,禁渐变/bg,truecolor/none 二档。
- **HUD 共享层**:保 parity-trivial(单层 list+badge),复杂结构 CLI-only。

### Open Questions(→ brainstorm/实现细化)
| # | 区域 | 问题 |
|---|------|------|
| OQ1 | 视觉语言 | 具体 tree 字符集 / badge 样式 / 栅格列宽 / 4 命令(doctor/install/HUD/error)before→after —— 需 brainstorm 出 mockup |
| OQ2 | @clack 集成 | "包上下文"的具体 API(theme.intro/outro/log 包装层)签名 |
| OQ3 | 测试基建 | per-surface output snapshot 基建是否复用 W1-4 help snapshot 机制 |

### Risk Register
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | @clack prompt 控件本体与 theme 视觉不完全统一(D8 已接受) | 4 | low | 上下文 theme 化已足够;不 fork |
| R2 | 二档无 256 中间档,罕见"支持色彩但非 truecolor"终端体验欠佳 | 3 | low | 受众现代终端;NO_COLOR/非TTY 有兜底 |
| R3 | W3-B 迁移期双色系统(colors.ts/theme.ts)临时共存 | 4 | medium | 增量 per-surface,snapshot 守,迁完即删 colors.ts |
| R4 | "HUD 共享结构极简"边界主观,执行时易膨胀进 cjs 镜像 | 2/3 | medium | parity-trivial 硬约束 + review 把关;复杂物强制 CLI-only |
| R5 | 退 Ink 实测 perf 无收益甚至 @clack 也有开销 | 5 | low | 架构收益独立成立;perf 仅存档不背锅 |
| R6 | **Ink 翻案条件**:若未来 Fabric 需复杂实时全屏 dashboard(如 `fabric doctor --watch` 实时刷新)—— 该单一面 Ink/React 更合适,@clack/theme 不覆盖 | 1 | low | 当前无此面、不在 W3 规划;届时作**隔离 CLI-only 面**局部引 Ink,不影响 hook/wizard/output 退 Ink 主决策;且 Ink 仍服务不了 cjs hook 侧。D1(彻底拔 Ink)在此条件外**再确认成立** |

### Recommended Next Step
设计架构/scope 已 10 决策锁定,**剩开放项是具体视觉语言(OQ1)**——属设计细化,非 scope 不清。
- **W3-A(退 Ink)**:scope 完全清,可直接 `/maestro-plan` → execute(单 PR)。
- **W3-B(焕然一新)**:先 `/maestro-brainstorm --from grill:GRL-{id}` 出视觉语言 mockup(tree/badge/栅格 + 4 命令 before→after),再 plan/execute。


# W3-B 焕然一新 — 视觉语言规范 (Visual Language Spec)

> Source: grill GRL-20260623 (C-002/C-004/C-006/C-008) · brainstorm 20260623 · 差异化押**结构**非色彩
> Scope correction: colors.ts 已是 theme 适配层、picocolors 已死依赖(ux-w2-5),C-005 迁移~90%已完成;本规范聚焦**结构视觉语言**。

## §1 定位与目标
把 Fabric CLI 当前的**扁平彩色行**输出升级为**靠结构取胜**的鲜明界面:用 tree / grid / badge / 分组四类结构基元承载层级与关系,色彩只做 7 语义角色点缀。truecolor/none 二档,所有结构字符有 ASCII fallback。

## §2 术语 (locked)
| 术语 | 定义 |
|---|---|
| 结构基元 | tree(层级)/ grid(对齐表)/ badge(方括号语义标签)/ 分组(左竖条段落) |
| 7 语义角色 | success/warn/error/drift/ai/human/accent(+muted)— 取值冻结,见 theme.ts PALETTE |
| 二档色 | truecolor(isColorEnabled=true)/ none(NO_COLOR/非TTY)— 无 256/16 |
| ASCII fallback | 结构字符在 none 档降级:`├─`→`+-`、`│`→`|`、`└─`→`` `- ``、`▌`→`#`、`━`→`=` |

## §3 结构基元 (the W3-B vocabulary) — MUST

### 3.1 Section header(段落头)
- truecolor: `▌ ` (U+258C 左竖条, paint `accent`) + **bold** 标题
- none: `# ` + 标题
- 取代当前扁平的 `paint.ai("store health")`

### 3.2 Tree(层级)
- truecolor: `├─ ` `└─ ` `│  `(中间项/末项/竖延伸),paint `muted` 画线
- none: `+- ` `` `- `` `|  `
- 用于:doctor 检查分组、HUD 知识条目层级、install 阶段步骤

### 3.3 Badge(方括号语义标签)
- 状态: `[ok]`(success) `[warn]`(warn) `[err]`(error) — 复用 theme.ts SYMBOL_ASCII 内核,truecolor 附 ✓/!/×
- 作用域: `[team]`(drift) `[project]`(ai) `[personal]`(human) — HUD 知识层标注
- none: 纯 `[ok]` / `[team]` 文本(无色),log 抓取稳定

### 3.4 Grid(对齐表)
- 标签列 `padEnd` 对齐 + 值列;表头规则线 `─────`(none: `-----`),paint `muted`
- 复用 colors.ts 现有 `displayWidth`/`padEnd`(string-width 宽字符安全)
- 用于:doctor 检查清单、install summary 计数、store 列表

### 3.5 分组(段落)
- 连续相关行用 §3.1 段落头起、`│ ` 左竖条续(可选),段间空行
- 取代当前无分隔的连续 console.log

## §4 @clack 包上下文 wrap API (C-006) — MUST 仅包上下文,不 restyle 控件
新增 `packages/cli/src/install/theme-clack.ts`(或并入 theme 消费层):
```ts
themeIntro(title: string): void   // = ▌accent bold 标题 + 规则线,替 clack intro 纯文本
themeOutro(msg: string): void     // = success/accent 收尾行
themeLog.info|success|warn|error(msg): void  // = badge + paint,替 clack log.*
themeNote(body: string, title?): void        // = 左竖条分组块,替 clack note
```
prompt 控件(text/select/confirm/multiselect)**保持 @clack 默认**,不碰(C-006)。

## §5 Snapshot 机制 (C-008/OQ3) — MUST
**复用 W1-4 help snapshot 机制**:每个换皮 surface 抽出纯函数 `renderX(data): string`,vitest 对 **NO_COLOR 输出**做 snapshot(`toMatchSnapshot`)。
- 这是 producer-consumer round-trip oracle:渲染函数(producer)→ snapshot(consumer)。
- 每面一个 snapshot 文件;视觉回归 = snapshot diff。
- theme-parity.test.ts 不动(theme.ts 7 色取值冻结)。

## §6 colors.ts 去留(plan 阶段定)
两选项,plan 决策:
- **A 保留**:colors.ts 作 CLI 便利层(label/displayWidth/padEnd + 新结构基元),薄适配 theme。改动小。
- **B 折叠**:结构基元 + 便利函数并入 theme 消费层,删 colors.ts。更纯,但触及全 14 引用点。
- 推荐 **A**(改动小、不破现有引用);新结构基元加在 colors.ts 或新 `tui/structure.ts`。

## §7 Feature Decomposition (§10)
| ID | Feature | Priority | Surface |
|---|---|---|---|
| F-001 | 结构基元模块(tree/grid/badge/section + ASCII fallback) | MUST | theme 消费层/structure.ts |
| F-002 | @clack wrap API(themeIntro/outro/log/note) | MUST | install/theme-clack.ts |
| F-003 | doctor 换皮(段落头+tree 检查分组+grid 清单) | MUST | commands/doctor.ts |
| F-004 | install 换皮(ConsoleOutputRenderer 用结构基元) | MUST | tui/ConsoleOutputRenderer.ts |
| F-005 | HUD/SessionStart 换皮(badge 作用域+tree 条目) | SHOULD | hooks/knowledge-hint-broad.cjs(+parity) |
| F-006 | error 换皮(分组块+badge) | SHOULD | renderError + 错误路径 |
| F-007 | picocolors 死依赖删除 | MUST | package.json(一行) |
| F-008 | per-surface NO_COLOR snapshot 测试 | MUST | __tests__/snapshots |

## §8 Non-Goals
渐变/背景色 · 256/16 阶梯 · fork/restyle @clack 控件 · big-bang · 动 theme.ts 7 色取值或破 parity · 退 Ink(W3-A 已做)。

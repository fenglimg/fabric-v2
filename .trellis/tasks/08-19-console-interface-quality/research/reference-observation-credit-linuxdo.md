# 参考对象完整观测：credit.linux.do

观测时间：2026-08-19 · 观测者视口 1042px（另测 375px 移动）· 登录态为用户本人账号
方法：两轮。**第一轮只读**——导航 + 在页面上下文读取 computed style / CSS 自定义属性 / DOM 状态变体。**第二轮交互**（用户授权点击后）——展开菜单、打开对话框、切换设置开关、切换主题、切换标签页，逐个读回真实状态值。

**未做的事**：不点任何会产生交易或转账的控件（`新建` 创建流、`/trade` 提交入口）。观测期间改动过的两项状态——深色模式、`显示通知铃铛` 开关——**均已还原**（`notification-settings` localStorage 回到 `{"showBell":true}`，顶栏铃铛已回来；`<html>` 回到 `light`）。

> 为什么第一轮先"读样式"而不是直接"手点一遍"：手点只能覆盖我想得到的路径，会漏；直接枚举 DOM 里真实用到的状态变体（`hover:` / `focus-visible:` / `disabled:` / `data-[state=...]`）拿到的是**实现方写下的全集**。这是「先普查全集再挑代表」在 UI 上的用法。第二轮点击补的是另一类东西：**状态之间怎么切、切完给什么反馈**——这个读静态样式读不出来。
>
> **两处自我更正**（都是先看截图猜、后实测推翻）：① 侧栏选中项我曾描述为"有浅色底块"，实测背景是透明；② 按钮内图标我曾记为 24px，实测标准是 **16px**。原文已就地改正，列在这里是因为"我看着像"和"我量到"要分得清。

---

## 0. 技术栈判定（决定了"照抄"的成本）

`<html>` 上带 `light` class，353 个 CSS 自定义属性，其中包含
`--background/--foreground/--card/--popover/--primary/--secondary/--muted/--muted-foreground/--accent/--destructive/--border/--input/--ring/--chart-1..5/--sidebar-*`
——这是 **shadcn/ui 的标准令牌契约**，配 **Tailwind CSS v4**。另有 `--toast-*`/`--success-bg`/`--error-bg`（sonner toast）、`data-slot=*`（shadcn 组件标记）、`recharts-*`（图表）、Next.js 字体模块（Inter + Noto Sans SC + Geist Mono）。

**对我们的意义**：要抄的不是某个人的审美，是一份**公开、成文、被大量项目验证过的令牌表**。而且它全部是 CSS 自定义属性——**零构建即可采用**，不违反我们"零构建前端"的硬约束。我们不需要引入 Tailwind 或 React，只需把语义令牌层搬进 `shell.css`。

---

## 1. 语义令牌（浅色 / 深色，实测值）

| 令牌 | light | dark | 约等于 |
| --- | --- | --- | --- |
| `--background` | `lab(100% 0 0)` | `lab(2.51%…)` | `#fff` / `#09090b` |
| `--foreground` | `lab(2.51%…)` | `lab(98.26% 0 0)` | `#09090b` / `#fafafa` |
| `--card` | `#fff` | `lab(8.31%…)` ≈ `#18181b` | 深色下卡片**比背景亮** |
| `--popover` | `#fff` | ≈ `#18181b` | 同上 |
| `--primary` | `lab(49.0 30.3 -71.9)` ≈ `#2563eb` | `lab(90.69%…)` ≈ `#e4e4e7` | **深色下主色反相成近白** |
| `--primary-foreground` | ≈ `#fafafa` | ≈ `#18181b` | 随之反相 |
| `--secondary` / `--muted` / `--accent` | `lab(96.16%…)` ≈ `#f4f4f5` | `lab(15.73%…)` ≈ `#27272a` | 同一个值担三个角色 |
| `--muted-foreground` | `lab(47.89%…)` ≈ `#71717a` | `lab(65.65%…)` ≈ `#a1a1aa` | 次要文字 |
| `--destructive` | red-600 | red-400 | 深色下**变浅**保对比 |
| `--border` | `lab(90.69%…)` ≈ `#e4e4e7` | `lab(100% 0 0 / .1)` | **深色下边框是 10% 白，不是固定灰** |
| `--input` | 同 border | `lab(100% 0 0 / .15)` | 输入框边框比普通边框更明显 |
| `--ring` | zinc-400 | zinc-500 | 焦点环 |
| `--radius` | `.625rem` = **10px** | 同 | 派生 sm=6 / md=8 / lg=10 / xl=14 |
| `--sidebar` | `#fafafa` | `#18181b` | 侧栏底色与内容区**不同** |
| `--sidebar-foreground` | `#3f3f46` | `#f4f4f5` | |
| `--sidebar-accent` | `#f4f4f5` | `#27272a` | 侧栏 hover 底色 |
| `--sidebar-border` | `#e5e7eb` | `#27272a` | |
| `--chart-1..5` | orange-600 / teal / dark-blue / amber-400 / amber-500 | 另一组 | 图表专用调色 |

**关键取舍（三条，都和我们现状相反）**

1. **只有两级文字色**：`--foreground`（近黑）+ `--muted-foreground`（zinc-500）。我们有三级，且最浅那级用得最多。
2. **深色模式不是把灰值取反**：`--primary` 反相成近白、`--destructive` 变浅、`--border` 改用**半透明白**。我们现在是逐个手填深色灰值。
3. **侧栏有自己的一套令牌**，与内容区色不同（`#fafafa` vs `#fff`）——这是"两个区域"的最低成本表达，不靠边框和阴影。

## 2. 排版

Tailwind 标准阶梯，实际用到的：

| 角色 | 实测 | 备注 |
| --- | --- | --- |
| 页面标题 `h1` | **30px**，一行内混字重：名词 600 / 数值 400 | `积分`(600) `LDC`(400) `2168.72`(400) |
| 区块标题 `h2` | **16px / 600** | 小但半粗 |
| Tab | 14px / **700** | 选中与未选中**字重相同**，只变色 + 2px 下划线（避免宽度跳动） |
| 正文 / 侧栏项 | 14px / 400（未选中）· 14px / **700**（选中） | |
| 表头 `th` | 13px / 500 | |
| 表格单元 `td` | **11px / 500** | |
| Badge | **10px / 500** | |
| kbd 提示 | 12px / 500 | |

字重令牌 300–900 全定义；**实际分布 500 占 50%、400 占 39%、600 占 11%、700 占 1%**。

> **最重要的一条**：层级由 **size 管第一级、weight 管第二级** 分工承担，而不是"越重要越大越粗"。页面标题 30px/400，区块标题 16px/600——两者靠不同的轴拉开。
> **第二重要的一条**：正文默认字重是 **500（medium）**，不是 400。同样 11px，500 比 400 明显更"实"。我们全站 400 占 81%。

字体：Inter（拉丁）+ Noto Sans SC（中文）+ Geist Mono（等宽）。间距基数 `--spacing: .25rem`（4px 栅格）。

## 3. 分隔与层次（我们最过载的一处）

| 手段 | credit | 我们 `/config` |
| --- | --- | --- |
| 1px 发丝线 | 22 处 | **58 处** |
| 有阴影的元素 | **6**（且多为透明占位） | **17** |
| 圆角值 | 8px×38 / 6px×29 / 全圆×11 / 10px×7 / 4px / 2px | 6px×32 / 12px×16 / 999px×16 |
| 阴影令牌 | `xs: 0 1px 2px 0 #0000000d`、`sm: 0 1px 3px 0 #0000001a, 0 1px 2px -1px #0000001a` | 单个 `--shadow: 0 4px 20px -2px …, 0 2px 8px -1px …` |

**结论**：它主要靠 **1px 发丝线 + 背景色差**分区，阴影几乎不用；用到时也是 **1–3px 紧实阴影**。我们是 **发丝线 + 阴影 + 圆角卡片三套并用**，且阴影是 **20px 大模糊的柔光**——柔光正是"发虚、廉价"的观感来源。

## 4. 交互态全集（DOM 中真实使用的变体，按频次）

```
focus-visible ×127   hover ×65      aria-invalid ×64   disabled ×60
dark ×51             md: ×50        [&_svg] ×44        [&>svg] ×40
data-[active=true] ×32              data-[state=open] ×32
group-data-[collapsible=icon] ×26   active ×16         aria-disabled ×16
has-data-[slot=card-action] ×6      has-[>svg] ×5      min-[400px] ×4
```

读出来的事实：

- **`focus-visible` 是使用最多的状态变体（127 次），比 `hover` 多一倍。** 键盘可达性是一等公民，不是补丁。我们目前只有 `.seg` 和 `.scope-select` 写了 `:focus-visible`。
- **`aria-invalid` 64 次** → 表单错误态是组件内建的，不是页面各写各的。
- **`disabled` 60 次** → 禁用态同样内建。
- **`[&_svg]` / `[&>svg]` 共 84 次** → **图标在组件内是被规约的子元素**，尺寸/颜色/不收缩由父组件统一控制。规约原文：`[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`——**没写尺寸的图标一律 16px，写了的按写的来，且一律不响应鼠标、不被压扁**。实测分布：16px×13（导航/按钮，lucide，描边 2px）、12px×18（表格与徽标内联）、18px×4、24px×1。这解释了为什么它们的图标"到处都对"。
- **`group-data-[collapsible=icon]` 26 次** → 侧栏可折叠成纯图标条，是设计进组件的形态，不是事后加的。

无障碍属性：`aria-label ×13`、`aria-expanded/controls/haspopup`（菜单）、`aria-live`（toast 区）、`aria-valuemin/max`（进度条）。

## 5. 动效

令牌层（`:root` 实测）：`--default-transition-duration: .15s`、`--default-transition-timing-function: cubic-bezier(.4,0,.2,1)`、`--ease-out: cubic-bezier(0,0,.2,1)`。

**时长分四档，各管一类事**——这是第二轮点击才量到的，静态读样式看不出来：

| 档 | 用在哪 | 实测 |
| --- | --- | --- |
| **0.15s** | 一切交互态：hover / focus / 开关 / 弹出层入场 | `transition-colors`；`transition: all .15s`；下拉菜单 `enter .15s`；对话框遮罩 `enter .15s` |
| **0.2s** | 内容替换：切标签页后表体重绘、对话框本体 | `animate-in fade-in duration-200 [will-change:transform,opacity]`；对话框 `duration-200` + `zoom-in-95` |
| **0.3s** | 布局尺寸变化：切全宽、侧栏折叠、进度条 | `transition-all duration-300 ease-in-out` |
| **0.4s** | toast 进出 | `transition: transform .4s, opacity .4s, height .4s, box-shadow .2s` |

过渡属性清单（实测 `transitionProperty`）：`color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, --tw-gradient-*`——**一律是颜色类，没有一处对布局属性做 `all` 过渡**。位移/缩放只出现在**弹出层入场**（`zoom-in-95` + `slide-in-from-top-2`），即元素从无到有的那一帧，不用在常驻元素上。

关键帧全集（实测 `@keyframes`）：`spin`（loading）、`pulse`（骨架屏）、`enter`/`exit`（弹出层，`opacity` + `translate3d` + `scale3d` 三合一）、`accordion-down`/`up`（高度）、`caret-blink`、`bell-ring`（新通知时铃铛左右摆）、`aurora`（装饰渐变）、`swipe-out-left/right/up`（toast 滑动关闭）。

**取舍**：常驻元素只过渡颜色，成本极低、慢机器不抖；"贵"的动作（位移缩放）只在弹出层出现一帧。四档时长把"我按了" / "内容换了" / "布局变了" / "系统在跟我说话"分开——用户不用看内容就知道发生了哪一类事。

## 6. 组件规格（实测）

**侧栏项** `32px` 高 · `radius 8px` · `padding 8px` · `gap 8px` · 图标 16px

| 态 | 背景 | 文字色 | 字重 |
| --- | --- | --- | --- |
| 静止 | 透明 | `#3f3f46` | 400 |
| **hover** | **`#f4f4f5`**（`--sidebar-accent`） | **`#18181b`** | 400 |
| **选中** | **透明** | **indigo `#6366f1`** | **700** |
| 按下 | `active:bg-sidebar-accent` | 同 hover | |
| 键盘焦点 | — | — | `focus-visible:ring-2 ring-sidebar-ring` |

**hover 和选中用的是不同维度**（hover 改底色，选中改字重+文字色），所以**悬停在当前页上仍然有反馈**——这是一个很容易做错、做错了就"点哪儿都没反应"的细节。

**按钮**（class 原文即完整状态契约）
- 图标按钮：`size-9`(36×36) · 透明底 · `radius 8px` · 图标 16px · 色 `--muted-foreground` · `hover:bg-accent hover:text-foreground`（深色下 `hover:bg-accent/50`）
- 主按钮：`bg-primary text-primary-foreground hover:bg-primary/90` · `px-4 py-2`（含图标时 `px-3`）· 顶栏那枚是 `size-7 rounded-full` 变体
- 全部共有：`cursor-pointer` · `transition-all` .15s · `gap 8px` · `disabled:pointer-events-none disabled:opacity-50` · `focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]` · `aria-invalid:ring-destructive/20 aria-invalid:border-destructive`
- → **hover 是"降 10% 不透明度"或"加一层 accent 底"，不是换一个手调的颜色**。所以永远不会跑色。

**搜索框**（顶栏）：`h-8 rounded-md border-border/60 bg-muted/70 text-sm text-muted-foreground` · `hover:border-border hover:bg-muted`——hover 时**边框和底色同时加深一档**，是"这不是文字，是个可点的东西"的提示。

**表格**（`/balance` 实测）
- `th` 13px/**500**、色 `--foreground`（**满色，不是灰**）、`h-9 px-2`
- `td` 11px/**500** · `p-2 py-1` · **行高 33px**
- 行分隔线是 **`border-b border-dashed`（虚线发丝线）**，不是实线
- 行 hover：`hover:bg-muted/50`，`transition-colors` .15s；选中行 `data-[state=selected]:bg-muted`
- 容器内部滚动，外层不滚；空值写 `–`；类型列用 badge，状态列用语义色文字
- → **11px 正文能立住，靠的是 500 字重 + 表头满色**，不是靠放大字号。

**列表行**（`/leaderboard` 实测，与表格是两套）
- `h-[60px] px-3`，CSS grid **定宽列** `grid-cols-[72px_minmax(0,1fr)_112px]`（窄屏 `88px/1fr/128px`）
- **完全没有分隔线**，行之间只靠 60px 行高留白
- hover `bg-muted/30`（比表格的 /50 更淡，因为行更高、面积更大）
- "这一行是你"：外层套 `rounded-xl bg-primary/[0.04]`——**主色 4% 的底**，没有边框、没有阴影、没有标签

**Badge**：10px/500 · `rounded-full` · `px-1.5 py-0` · `border` · `[&>svg]:size-3` · `transition-[color,box-shadow]` · 主变体 `bg-primary text-primary-foreground border-transparent`，语义变体用浅色底 + 同色系深色字（purple-100/purple-800）

**Tabs**（`/balance` 实测，下划线式而非胶囊式）
- `TabsList`：`h-9 bg-transparent rounded-none border-b border-border gap-4 justify-start w-full overflow-x-auto`
- Trigger：14px/**700** · `px-0` · `border-b-2 border-transparent` · `-mb-[2px]`（压住列表底线）
- 未选中 `text-muted-foreground` → hover `hover:text-foreground` → 选中 `text-indigo-500` + `border-b-2 border-indigo-500`
- 选中不加底色、不加阴影（`data-[state=active]:bg-transparent data-[state=active]:shadow-none`）
- 焦点 `focus-visible:ring-[3px] focus-visible:outline-1`
- → 选中/未选中**字重相同（都 700）**，只变色 + 下划线，所以切换时**文字宽度不跳**

**下拉菜单**（点左上角用户块，实测）
- 面板：`bg-popover border rounded-md(8px) min-w-[8rem] p-1 shadow-md` · `fade-in-0 + zoom-in-95 + slide-in-from-top-2` · `enter .15s`
- 菜单项：32px 高 · 14px/400 · `px-2 py-1.5 rounded-sm(6px) gap-2 cursor-pointer`
- **高亮态写的是 `focus:bg-accent focus:text-accent-foreground`，不是 `hover:`**——鼠标悬停由 Radix 转成 focus，于是**键盘和鼠标共用同一个高亮态**，不会出现"键盘选中了但看不见"
- 危险项：`data-[variant=destructive]:text-destructive` + `focus:bg-destructive/10`
- 项内图标默认 `text-muted-foreground`（`[&_svg:not([class*='text-'])]`）
- 分隔线：`bg-border -mx-1 h-px my-2`

**对话框**（点表格行的操作图标，实测）
- 遮罩：`bg-black/50` · `fade-in-0` · **.15s**
- 面板：`bg-background border rounded-xl(14px) shadow-2xl p-0 overflow-hidden` · `sm:max-w-[500px]` · `fade-in-0 + zoom-in-95` · **duration-200** · `max-h-[90vh] overflow-y-auto`
- 无可见关闭按钮，靠 Esc / 点遮罩关
- → **阴影只出现在浮层上**（对话框 `shadow-2xl`、菜单 `shadow-md`、toast `0 4px 12px`）。**内容区的卡片一律 `shadow-none`。**

**开关 Switch**（通知设置页，实测）
- 行：72px 高 · 内边距 16px · 1px 边框 · `radius 10px` · **无阴影**
- 标签 14px/500 foreground；说明 12px/400 muted
- 轨道 **32×18** · 开时 `--primary` 底 · 全圆 · `transition: all .15s`
- 滑块 **16×16** 白 · `transition: transform, translate, scale, rotate .15s`
- **整页没有保存按钮**——见 §6.1

**Toast（sonner）**：`padding 16px` · `border 1px` · `radius var(--border-radius)` · `box-shadow 0 4px 12px rgba(0,0,0,.1)` · **13px** · 从屏幕边缘外 `translateY(±100%)` 滑入，`.4s`；可滑动关闭（`swipe-out-*` 关键帧）；容器带 `aria-live="polite"`

**⌘K 命令面板**（实测）
- 面板 `bg-background border rounded-xl shadow-2xl p-0` · 宽 540px
- 输入 `h-full text-sm bg-transparent outline-hidden`，**输入框自身无边框无底色**，边界由面板给
- 分组标题 11px/500 muted
- 每行 = 左图标 + 主标题(14px/500) + 副描述(12px muted) + 右侧类型 badge
- 底部工具条：`↵ 打开`、`ESC 关闭搜索界面`，键位用 kbd 小方块，右侧一句 muted 提示
- kbd：`h-5 min-w-5 rounded-sm(6px) bg-muted px-1.5 text-xs(12px)/500 text-muted-foreground font-mono`

### 6.1 一条交互层的结论：**确认不是弹条消息，是界面本身变了**

点掉 `显示通知铃铛` 开关的那一刻——**顶栏的铃铛图标当场消失**。没有 toast，没有"已保存"，整页也没有保存按钮（实测该页按钮清单为空）。

这条比任何配色都重要：它把"你改了什么"和"改完什么样"合并成了一个动作。对照我们 `/config` 现在的做法——每行一枚常驻保存按钮（16 枚），改完弹一条 toast 说"已保存"——用户要先信这条 toast，再自己去别的页面确认真的生效了。

**同时它也划出了适用边界**：这条只在"改动能立刻在当前视野里看见"时成立。改一个只在下次 session 才生效的阈值，界面没东西可变，那就仍然需要一条明确回执。所以规则不是"删掉所有保存按钮"，而是——**能当场看见结果的，让结果本身当回执；看不见的，才给回执。**

**空态**（`/merchant` 实测）：内容区居中 → 圆形浅底 + 线性图标（≈48px）→ 主文案（semibold, foreground）→ 副文案（小一号, muted-foreground）。**无插画、无边框、无大空盒**。
另一种更轻的空态（`/balance` 的「报告」区）：直接一行 `暂无报告`，14px/400/muted-foreground，别的什么都没有。

**加载态**：页面淡入 + 居中 spinner；`animate-pulse` 令牌在册（骨架屏）。

**命令面板**（点搜索框打开）：
- 遮罩轻暗；面板白底、大圆角、阴影、宽 ≈540px
- 顶部搜索输入 + 下方发丝线
- 分组标题（`页面`）小号灰
- 每行 = 左图标 + 主标题(14px semibold) + 副描述(12px muted) + 右侧类型 badge
- 选中行 = 浅灰底 + 左侧 2px 主色竖条
- 底部工具条：`↵ 打开`、`ESC 关闭搜索界面`、右侧 `tips: 按住 ⌘ + ↵ 在新标签页打开`，键位用 kbd 小方块

## 7. 页面骨架

- **左侧固定栏**（底色 `#fafafa`）：用户块（头像 + 名 + 角色 + 展开箭头）→ 主导航（图标 + 文字）→ 分组小标题（`文档库` / `服务`）→ 组内条目（外链带 ↗）→ 底部钉 `Version v1.3.21` / `Build At 2026/08/01 UTC`
- **内容区顶栏**：左搜索框（带 `⌘K`）· 右图标操作组（通知 / 设置 / 主操作 + / 全屏 / 主题）
- **内容**：页面标题行（标题 + 右侧主操作 + 通栏发丝线）→ 若干区块（16px/600 标题 + 内容）
- 侧栏右缘中部有 `‹` 折叠把手
- 内容区 `max-w-[1320px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12`，宽度变化 `transition-all duration-300 ease-in-out`

### 7.1 设置区的三层结构（这是我们 `/config` 最该抄的一段）

它没有把设置摊成一张长表，而是分了三层：

1. **设置总览页**（点顶栏 ⚙）：标题 `设置` → 分组小标题（`个人设置` / `账户设置`）→ **两列入口卡网格**。每张卡 = 图标 + 标题(14px/600) + 一行说明(12px/400 muted) + 1px 边框 + **无阴影**。
2. **子页**：顶部面包屑 `设置 › 外观设置`（父级 16px/600 主色可点，当前项 16px/600 foreground 不可点）→ 若干小节，每节 = 标题 14px/**500** + 说明 12px/400 muted + 控件。
3. **控件本身**按类型分化，不是一律下拉框：
   - 三选一 → **分段控件** 230×32 · 12px/500 · `radius 8px` · `padding 0 10px` · `gap 6px`；选中 `--primary` 底 + `--primary-foreground` 字，未选中 `#f4f4f5` 底 + `#18181b` 字
   - 主题选择 → **五列预览卡网格**，每张卡直接画出该主题的配色；选中卡加 indigo 边框 + 右上角圆形 ✓（约二十个 tweakcn 预设：Default / Amethyst Haze / Bold Tech / Caffeine / Catppuccin / Claude / Cosmic Night / Graphite …）
   - 布尔 → 开关行（见 §6）

**对比我们现状**：`/config` 是 9 组 40 余行铺在一页、2709px 高、16 枚常驻保存按钮。它是 **总览页 → 子页 → 控件** 三层，每层屏幕上同时只有一件事。

### 7.2 不打算抄的一处

点交易行会弹出一张**拟物收据**（等宽字体、虚线撕口、底部条形码、`RECEIPT` 大写标题）。这是它给核心业务概念做的一处专属"高光"，跟系统其余部分刻意不一致。

记在这里是为了说明它的分寸：**整套系统严格统一，只在一个地方破例**。我们的控制台没有对应的情感落点，不做这类破例——但要学会这个比例，别把每个页面都做成特例。

## 8. 响应式（375px 实测）

- 侧栏收进左上角汉堡；顶栏图标从 5 个减到 3 个（搜索/通知/设置）
- 内容单列铺满；**tabs 横向滚动**
- 表格**减列**（桌面的「积分动向」列在窄屏消失）而不是堆叠成卡片；其余列横向滚动

---

## 9. 覆盖清单与诚实边界

第二轮点击后，**已覆盖**：

导航（侧栏三态实测）· 顶栏图标按钮 · 搜索框 hover · 命令面板 · 下拉菜单（含键鼠共用高亮）· 对话框（遮罩 + 面板 + 入场）· 标签页（三态 + 切换后内容淡入）· 表格（表头/单元/虚线分隔/行 hover）· 列表行（无分隔线 + 4% 主色高亮）· 徽标 · 开关（含"改完界面当场变"的回执模型）· 设置三层结构 · 分段控件 · 主题预览网格 · 面包屑 · 空态两档 · 加载/骨架 · 四档动效时长 · 深浅模式 · 响应式 375px · toast 的 CSS 契约。

**仍未覆盖**（实施时若用到必须补测，不要凭 shadcn 默认值想当然）：

| 未覆盖项 | 为什么 | 影响 |
| --- | --- | --- |
| toast 的**实际渲染外观** | 观测期间没有任何操作触发它；CSS 契约（尺寸/阴影/动画）已从样式表读到，但没见过真身 | 低——我们已有 `.toast` 实现，只需按契约调尺寸与时长 |
| 表单输入框、`aria-invalid` **实时错误态** | 唯一的表单入口是创建交易流，属于我划的"不点"红线 | 中——`/config` 有输入框。契约（`aria-invalid:ring-destructive/20` + `aria-invalid:border-destructive`）已从组件 class 读到，但没看过它长什么样 |
| 按下态（`:active`）的具体颜色 | 变体在册（16 次），但按下只有一帧，读不到稳定值 | 低——可直接沿用 hover 值再深一档 |
| `/trade`、`/merchant` 的完整交互 | 交易页面，不点 | 低——形态与已覆盖页面同构 |

一条要记住的边界：以上所有数值都是**这一个产品在这一天的选择**，不是普适真理。抄的是它的**分工方式**（哪一轴管哪一级、哪种反馈配哪种操作），不是把 `#6366f1` 抄进我们的令牌表。

顺带一处对参考对象本身的观察：侧栏选中色与标签页选中色都是**硬编码 `#6366F1` / `indigo-500`，绕过了 `--primary` 令牌**。也就是说连它自己也没做到 100% 走令牌——这是"令牌表建了但没人守"的典型泄漏，正好提醒我们把"不许写字面色值"写成可检查的验收条款，而不只是写在文档里。

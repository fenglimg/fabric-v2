# 技术设计：控制台界面质感

## 边界

| 层 | 文件 | 本轮动作 |
| --- | --- | --- |
| 令牌 + 组件规约 | `packages/cli/templates/console/shell.css` | **重写**（唯一真源） |
| 共享行为 + 图标 | `packages/cli/templates/console/shell.js` | 扩展（图标表、顶栏渲染、字段控件改为"改动才出按钮"） |
| 页面 | `console/status.html` `console/config.html` `console/integrations.html` | 改写为 `fx-` 组件词汇 |
| 页面 | `preview/lumen.html` `console/graph.html` | **零改动**，靠令牌别名继承 |
| 服务端 | `packages/cli/src/commands/preview.ts` | 零改动（本轮不动路由与写通道） |

## 关键约束与它推导出的做法

### C1 `shell.css` 会打到 `lumen.html` 头上

`lumen.html:12` 引了 `shell.css`，且自带 2220 行样式。任何**裸标签选择器**（`h1 {}`、`table {}`）或与它重名的类（`.card` `.pill` `.status` `.brand` …）都会造成远端回归，而且 diff 里看不出来。

→ **两条硬规则**：
1. 新增组件类一律 `fx-` 前缀。已核对 `lumen.html` 的 91 个类名与 `graph.html`，`fx-` 前缀零碰撞。
2. 不新增裸标签选择器；`body` 基线保持现状（它已经在了）。

### C2 令牌换名不能变成一次大扫除

`lumen.html`（不可改）与 `graph.html` 用的是 `--text/--surface/--border/--accent/--text2/--surface-2/--surface-hover/--border-strong/--accent-light/--edge/--shadow/--radius*/--sans/--mono` 等旧名。

→ 新语义令牌是**新增**，旧名保留并**重定义为指向新令牌的别名**。旧名换了值（冷调 zinc 取代暖调 Apple 灰）但没换名，所以：
- lumen / graph 一行不改就跟着换肤；
- 三个新页面逐步改用新名，改到哪儿算哪儿，中途不会出现半黑半白。

别名表写在 `:root` 末尾并成组注释，说明"为什么留"。

### C3 深色模式的两个所有权

`shell.js` 已有 `data-theme-owner="page"` opt-out：lumen 自己管主题，shell 不抢。本轮不动这条。新令牌的深色值写在 `[data-theme="dark"]` 下，与现状同一个选择器，所以 lumen 的 `data-theme` 切换自动带上新令牌。

### C4 图标必须零构建、零外部依赖

→ `shell.js` 里一张 `FabricIcon` 表：`{name: "<path .../>"}`，`FabricIcon.svg(name, cls)` 返回内联 `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">…</svg>`。

尺寸/收缩/取色由 CSS 给（`.fx-ico{width:16px;height:16px;flex:none;pointer-events:none}`），JS 只吐路径。图标形状取自 lucide 的几何（MIT），逐个手写 path，不引包。

### C5 顶栏 markup 现在有两个生产者

现状：5 个模板各自硬写 6 行 navbar（shell.css 注释解释过：结构不变所以复制、样式会变所以共享）。本轮顶栏结构**要变**（加图标、加操作组），复制 5 份等于 5 处要改，其中一处（lumen）明确不许改。

→ **反转该决策**：顶栏结构改由 `shell.js` 在 `DOMContentLoaded` 时**就地升级**已有的 `.navbar`——读现存的 `a.seg[href]` 列表，给每条注入图标、补 `aria-current`，再把主题按钮与作用域切换器归位。既有 6 行 markup 一个字不改（lumen 满足），升级逻辑只有一份。

这是对 shell.css:90-94 注释里那条判断的显式更新，理由写进代码注释：**"结构不会变"这个前提本轮失效了**。

### C6 "改动才出按钮"不能靠重渲染整页

`FabricField.control` 现在把 save/reset 按钮直接拼进 HTML。改为：
- 控件容器带 `data-initial` 记录初始值；
- `input`/`change` 事件比对当前值与 `data-initial`，切换容器上的 `data-dirty`；
- 按钮常在 DOM 里但由 CSS `[data-dirty="false"] .fx-actions{display:none}` 控制可见。

好处：不重渲染就不丢焦点、不丢滚动位置，也不需要页面重新 `bind`。

## 数据流（不变）

页面 → `fetch('/api/…' + FabricScope.param())` → 渲染。写路径仍是 `POST /api/config/set`，经 `WRITE_ROUTES` 的 POST + loopback-Origin 门禁。本轮不新增、不修改任何路由。

## 兼容与回滚

- 回滚点：`shell.css`、`shell.js` 与三个页面模板各自独立，`git checkout` 单文件即可回退。
- 最危险的一步是 C2 的别名表——它一次性改变 lumen 与 graph 的实际配色。验证方式：改前后各截一次 `/` 与 `/graph` 的图对比（AC20）。
- 探针脚本落在 `__tests__/manual/`，手动执行，不进 CI（PRD Out of Scope）。

## 取舍记录

| 取舍 | 选了 | 为什么不选另一个 |
| --- | --- | --- |
| 全局左侧栏 vs 重建顶栏 | 顶栏 | lumen 已有自己的 header + 340px 树，三栏在 1024px 不可用（PRD F10） |
| 令牌改名 vs 加别名 | 别名 | 改名要动 lumen，而 lumen 是"零回归"保护对象 |
| 顶栏 markup 复制 vs JS 升级 | JS 升级 | 结构本轮要变，且其中一份在不可改的文件里 |
| 图标引包 vs 手写 path | 手写 | 零构建是硬约束；引包等于引 npm 依赖 + 构建步骤 |
| 删掉保存按钮 vs 改动才出现 | 改动才出现 | 参考对象的"界面自证"只在结果当场可见时成立；Fabric 的阈值改完看不见（PRD F8） |

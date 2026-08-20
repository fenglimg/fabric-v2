# 控制台项目清理与配置可撤销性

## 目标与用户价值

用户在真机使用控制台时提出四条。共同点不是"哪里不好看"，而是**页面提供的控件与它实际能做的事对不上**：

- 项目切换器列出 10 个项目，其中 7 个用户根本不想要，而页面没有任何移除动作；
- 悬停一个未选中的标签，它比真正选中的标签看起来更"选中"；
- 想撤掉一层配置、回到全局默认，那个按钮存在但永远不出现；
- 多选控件勾完之后没有保存入口，勾了等于没勾。

后三条都是**控件说了谎**，第一条是**能力缺失**。

## 已确认事实（真机实测，非推断）

环境前提：全局安装的 `fabric` 是 `2.5.0-rc.4`，其 `templates/` 下**没有 `console/` 目录** —— 多页控制台（`/graph` `/status` `/config` `/integrations` 与 `shell.css`）整个是未发布的本地工作。用户看到的必然是本仓构建，不存在"看的是旧版"这一解释。复现环境：`node packages/cli/dist/index.js preview --port 7792`。

### F1 — 项目列表由三个来源合并，没有任何写回路径

`packages/cli/src/console/project-list.ts:1-60` 记载：列表由 `~/.fabric/state/projects.json`（有路径、可能无 id）、`fabric-global.json` 的 `projects[<id>]` 段（有 id 与覆盖值、永远无路径）、`~/.fabric/state/bindings/`（有 id、无路径）三处合并而成。三处都只有读函数（`listRegisteredProjects` / `loadGlobalConfig` / `listBoundProjectIds`），**没有任何"移除一个项目"的写操作**，CLI 与控制台皆无。

用户当前可见 6 个（ccpm / pcf / werewolf-minigame / werewolf-minigame-5sp3 / werewolf-minigame-vest-7sp4 及本机项）+ 3 个只有 id 无目录 + 1 个未绑 store 无 id。期望只保留 **ccpm / pcf / werewolf-minigame**。

### F2 — `--accent` 一个变量名两种含义，导致知识页悬停被画成纯蓝

同一个 token 被声明两次且语义相反：

| 声明处 | 值 | 本意 |
|---|---|---|
| `shell.css` `:root` | `#f4f4f5` | 悬停用的淡背景 |
| `lumen.html` 内联 `:root` | `#2563eb` | 品牌强调色 |

`lumen.html:12` 先 `<link>` 了 `/assets/shell.css`，其内联 `<style>` 在后，故**在知识页 `/` 上 `--accent` 被覆盖成蓝色**。`shell.css:368` 的 `.seg:hover { background: var(--accent) }` 于是把悬停画成纯蓝实心。实测该页 `getComputedStyle(seg).backgroundColor === "rgb(37, 99, 235)"`；另外四页无此内联覆盖，悬停正常为浅灰。

**这也是它此前查不出来的原因**：五个页面的内联 `<style>` 里没有任何一条规则命中 `.seg`（CSSOM 全量枚举结果为空），冲突发生在 token 层不在选择器层。

### F3 — 「移除此处设置」按钮存在，但只在控件变脏后才显示

`shell.css:1224` `.fctl[data-dirty="false"] .fx-actions { display: none }` 同时藏起 `保存` 与 `移除此处设置` 两个按钮（二者同在 `.fx-actions` 内，`shell.js:408`）。而"撤掉本层设置、交回下层决定"恰恰是**不改动取值**的操作，控件因此永不变脏，按钮永不出现。

实测 `/integrations` 全部 14 个 `.fctl` 的 `actionsVisible` 均为 `false`，其中 `nudge_mode`（`本项目` 层真设过、`btns: ["移除此处设置[reset]", "保存[save]"]`）也一样藏着。

用户点击的那个 ⊖ 图标不是移除按钮，是 `<button class="fx-disclose" aria-label="说明">` 说明展开器 —— 它紧挨在层级徽标之后，位置上最像"取消这一层"，语义上完全无关。

### F4 — 多选控件的脏检查读错了元素，保存按钮永不出现

`shell.js:509-515` 的 `refresh()`：

```js
var el = ctl.querySelector("input, select");
var now = el.type === "checkbox" ? "" : String(el.value);
```

`.fctl.multi` 的 DOM 顺序是 `.chk`（一排 checkbox）在前、承载真实取值的 `input[type=hidden]` 在后，故 `querySelector("input, select")` 命中的是**第一个 checkbox**，`now` 被恒定判成 `""`。

- 当该层未设值时 `data-initial=""` → `"" === ""` → **永远 not dirty → 保存按钮永不出现**（用户实测到的现象）；
- 当该层已设值时（如 `"archive"`）→ `"" !== "archive"` → **永远 dirty**，是同一个 bug 的反向表现。

实测 `hint_dismiss_signals` 行：`firstElType: "checkbox"`、`hiddenVal: ""`、`initial: ""`、`dirty: "false"`、`actionsVisible: false`、`btns: ["保存[save]"]`。勾选任意复选框后 `hidden.value` 确实更新，但 `data-dirty` 不变，保存入口不出现 —— 勾了等于没勾。

### F5 — 纯蓝色块是当前视觉里最重的元素

用户点名"好丑"的三处都用满饱和度 `--primary: #2563eb` 实心：`.frow.mod::before` 的 3px 竖条（`shell.css:1113` 一带，08-20 上一轮刚从整条边框改成圆角短条）、`.fx-btn` 主按钮（重新安装 / 体检并修复 / 保存）、以及层级徽标。此外 `--ring` 在上一轮也被移到了 `--primary`，即蓝色同时承担"焦点""选中""已修改""主操作"四种含义。

## 需求

- **R1** 控制台提供移除项目的动作，使切换器只留用户要的项目。破坏性范围见「待定决策 D1」。
- **R2** 知识页的标签悬停底色与其他四页一致，且任何未选中标签的视觉重量都低于选中标签。
- **R3** 「移除此处设置」在该层真设过值时**始终可见**，不以控件变脏为前提；且不与「说明」展开器在位置上混淆。
- **R4** 多选控件的脏检查读承载取值的元素；勾选后保存入口出现，取消勾选回到初始集合后消失。
- **R5** 降低纯蓝色块的视觉重量。方向见「待定决策 D2」。
- **R6** 不新增可以携带路径的写端点（沿用 08-20 已立的规矩：请求体只收枚举与 scope）。

## 验收标准

- **AC1** 切换器中只出现用户保留的项目；被移除项在重新载入后不再出现。
- **AC2** 移除动作在执行前列出**将被改动的具体位置**（注册表条目 / 配置段 / store 绑定，按 D1 的选定范围）并要求一次显式确认；取消后磁盘零变化。
- **AC3** 移除动作不触碰未被选中的项目：以执行前后 `~/.fabric/state/projects.json`、`fabric-global.json`、`bindings/` 三处的逐项比对验证。
- **AC4** 五个页面上 `getComputedStyle(.seg:hover).backgroundColor` 取值一致；且知识页该值不等于 `--primary`。
- **AC5** 存在一条断言，使 `--accent` 被任一页面重新定义成与 `shell.css` 不同的值时变红（token 冲突的回归闸，不是把当前值抄一遍）。
- **AC6** `nudge_mode`（本项目层已设值）行上，未触碰控件时「移除此处设置」可见；点击后该行退回继承态、徽标由「本项目」变为下层来源。
- **AC7** `hint_dismiss_signals` 行勾选任一复选框后保存入口出现；改回初始集合后消失；保存后重新载入，勾选状态与保存内容一致。
- **AC8** 「说明」展开器与「移除此处设置」在视觉与位置上可区分（至少不共用同一处相邻位置）。
- **AC9** 全量测试与 `tsc --noEmit` 通过；任何新增断言须经变异测试证明会红。

## 范围外

- 不做项目重命名、不做把 id-only 项目反查回目录（状态页的「扫描本机」已覆盖，见 KT-GLD-0026）。
- 不改 lumen 的 `<title>`（另一件事，等用户单独拍板）。
- 不改动 `--primary` 本身的色值以外的配色体系重做；R5 限定在"哪些地方用它、用多重"。

## 关键决策（已定）

- **D1 —「移除项目」= 彻底注销。** 注册表条目 + 全局配置 `projects[<id>]` 段 + store 绑定文件三处全删。已向用户明示不可逆代价（该项目曾归档进 store 的知识会失去项目归属：知识文件仍在 store 里，但不再于任何仓库浮现），用户确认后选定此项。因此 UI 必须两步确认并逐条列出将被改动的具体位置，且合入前须在一次性副本上演练。
- **D2 — 蓝色只留给焦点与选中。** 主按钮改中性近黑实心，「已修改」竖条改更细更低饱和，层级徽标改中性灰。理由：`--primary` 当前同时承担焦点 / 选中 / 已修改 / 主操作四种语义，挤在一个颜色上导致哪个都不突出；收敛后蓝色重新具备指示性。选定的是"哪些地方允许用蓝"这条规则，具体色值在实现时于真机比对确定。

补充守则（沿用 08-20 上一轮已立、本轮不重新论证）：新增写端点请求体永不携带路径；删除集与展示集必须是同一个对象；结果计数由重新读取得出而非算术相减；新增断言须经变异测试证明会红。

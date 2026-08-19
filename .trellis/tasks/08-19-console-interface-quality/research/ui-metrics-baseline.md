# UI 指标基线（改动前）

采集时间：2026-08-19
采集方式：`fabric preview --port 7797`（真实服务、真实本机数据），浏览器视口宽 1440px，逐页在页面上下文执行下方探针。

> 这是**改前**快照。同一段探针在实现完成后重跑一次，两份数字并列即是 AC1–AC12 的判据。
> 之所以要落盘而不是"改完看一眼"：上一轮（W4）的教训是只在被测进程里量过的性质不迁移到真实进程；同理，只在记忆里存过的基线在下一轮就会变成"我记得好像好一些了"。

## 探针

```js
(() => {
  const els = [...document.querySelectorAll('body *')].filter(e => e.offsetParent !== null);
  const carries = e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  const fs = new Map(), col = new Map();
  for (const e of els) if (carries(e)) {
    const c = getComputedStyle(e);
    fs.set(c.fontSize, (fs.get(c.fontSize) || 0) + 1);
    col.set(c.color, (col.get(c.color) || 0) + 1);
  }
  const toks = new Set();
  for (const e of els) for (const n of e.childNodes) if (n.nodeType === 3)
    for (const t of n.textContent.trim().split(/\s+/)) if (t.length >= 24) toks.add(t);
  return {
    textEls: els.filter(carries).length,
    fontSizes: [...fs].sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])),
    colors: [...col].sort((a, b) => b[1] - a[1]),
    headings: [...document.querySelectorAll('h2,h3')].map(h => h.textContent.trim()),
    longTokens: [...toks],
    buttons: document.querySelectorAll('button').length,
    inputs: document.querySelectorAll('input,select').length,
    docH: document.body.scrollHeight,
  };
})()
```

实现时把它落成 `packages/cli/__tests__/manual/ui-metrics-probe.mjs`（手动执行，不进 CI —— 理由见 prd.md Out of Scope）。

## 原始结果

### `/status`

```
textEls    30
fontSizes  22px×2, 15px×1, 13px×18, 12px×6, 11px×3
weights    600×9, 400×21
paddings   5px 10px ×6 | 7px 0 ×6 | 16px 18px ×5 | 1px 7px ×3 | 0 18px | 4px 8px | 22px 18px 60px
radii      6px×7, 12px×5, 999px×3
docH       700
longTokens /Users/wepie/Desktop/personal-projects/pcf
           a64bccdc-b91e-4947-90f1-432280965050
           sha256:6901459bbedadc44d2ed5dda9181f58aa3e086e9a1f6f77cdea6c2ce078d20d0
```

11–13px 占比 **27/30 = 90%**。sha256 那一行在 1440px 下换行后被下方元素裁切（截图证据）。
卡片网格：3 张统计卡在 2 列网格里 → 第二行只有 1 张，右侧留空洞。

### `/config`

```
textEls    124
fontSizes  15px×1, 14px×3, 13px×29, 12px×50, 11px×41
colors     #86868b (--text-tertiary) ×59
           #48484a (--text-secondary) ×28
           #1d1d1f (--text)          ×27
           #ffffff                   ×9
           #2563eb (--accent)        ×1
frowCount  9
rowHeights 99, 120, 140, 99, 99, 98, 119, 139, 139
buttons    16
inputs     11
docH       2709
headings   全机器默认 / 提醒频率 / 按项目单独设置 / 按知识库 /
           personal 个人库 / fabric-team / wespy-team-cocos-knowledge-base / 远程嵌入
```

- 11–13px 占比 **120/124 = 97%**；全页最大字号 15px，就是导航栏标题。
- 最浅灰占 **48%**，是出现最多的文字色；三级色使用比例 22% / 23% / 48%（倒挂）。
- 9 行设置 → 2709px；平均行高 ~110px。
- 16 个按钮全部常驻，无改动状态下 0 个是需要点的。

**同名行**（AC8 的靶子）：

| # | flabel | fkey | fdesc 长度 | 所属小节 |
| --- | --- | --- | --- | --- |
| 8 | 知识库未成型阈值 `团队 store` | `underseed_node_threshold` | 67 | fabric-team |
| 9 | 知识库未成型阈值 `团队 store` | `underseed_node_threshold` | 67 | wespy-team-cocos-knowledge-base |

标签、key、说明三者完全相同；行内那枚 `团队 store` 标签对两行都成立，因此它在此处不区分反而误导。

**提醒频率预设**：三档卡片各自逐条列出 8 个阈值 → 选一个档位要读 24 个数字。

### `/integrations`

```
textEls    160
fontSizes  18px×1, 15px×1, 14px×4, 13px×28, 12px×83, 11px×43
colors     #86868b ×60, #48484a ×47, #1d1d1f ×28, #ffffff ×12
cards      14
monoEls    35
docH       3693
headings   运行时行为 / 调节项 ×7 / 物理文件 / MCP 接入 / 规则引用 /
           hook 脚本 / skill / 共享库 / 修复 / 安装记录
```

- 11–13px 占比 **154/160 = 96%**；全页仅 1 个元素 > 15px。
- 最浅灰 **38%**，仍是第一多。
- `调节项` 作为 `<h3>` 连续出现 **7 次**——既不描述内容也不能用于定位。

## 汇总

| 指标 | /status | /config | /integrations | AC 目标 |
| --- | --- | --- | --- | --- |
| 11–12px 占比 | 30% | 73% | 79% | ≤ 25%（AC2） |
| 11–13px 占比 | 90% | 97% | 96% | — |
| 最大字号 | 22px | 15px | 18px | — |
| 三级灰占比 | — | 48% | 38% | ≤ 20% 且非第一（AC4） |
| 文档高度 | 700 | 2709 | 3693 | ≤ 1400 / ≤ 2000（AC5） |
| 常驻按钮 | — | 16 | — | 无改动时 0（AC6） |
| 重复标题 | — | 2 行同名 | 调节项 ×7 | 0（AC7/AC8） |
| ≥24 字符裸标识符 | 3 | — | — | 0（AC10） |

## 改后结果（2026-08-19，同一台服务、同一份本机数据）

探针已落盘为 `packages/cli/__tests__/manual/ui-metrics-probe.mjs`。它分两半：静态半段由 node 直接跑并断言（字面色值、裸标签选择器、`fx-` 前缀、硬编码字号），运行时半段由脚本打印出来贴进各页 console —— 本仓库没有 headless 浏览器，与其假装有，不如把口径固定在一个文件里。

> 视口：改前基线取自 1440px，改后同样取 1440px。三页 `main` 的 `max-width` 都 ≤1080px，1280 与 1440 实测同值，所以这个宽度对文档高度不敏感 —— 但仍然按同宽度取，因为"上一版量的是别的宽度"正是让前后对照悄悄失效的那类问题。

| 指标 | /status | /config | /integrations | AC |
| --- | --- | --- | --- | --- |
| 文档高度 | 900\* | **1925**（原 2709，−29%） | **2408**（原 3693，−35%） | AC7（数值未达，见 prd AC7 注） |
| >14px 字号档数 | 3（30/20/16） | 2（30/16） | 2（30/16） | AC3 ✅ |
| 最大字号 | 30px（页头，非 chrome） | 30px | 30px | AC2 ✅ |
| 文字色种类 | 3 | 3 | 5 | AC4 ✅（见下注） |
| 内容区带阴影元素 | 0（原 17） | 0 | 0 | AC5 ✅ |
| SVG 图标 | 11 | 28 | 23 | AC6 ✅ |
| 设置行最大高度 | — | 43px（原 98–140） | 74px（多选行，见下注） | AC8 ✅/注 |
| 无改动时可见保存按钮 | — | 0（原 16） | 0 | AC9 ✅ |
| 同页重复标题 | 0 | 0 | 0（原「调节项」×7） | AC10 ✅ |
| 横向滚动（700/768/1024/1440） | 无 | 无 | 无 | AC18 ✅ |
| 字重分布 | 500×15 > 400×9 | 500×39 > 400×35 | 400×61 > 500×26 | AC1 |

\* `/status` 内容不足一屏，`scrollHeight` 被视口高度钳到 900；实际内容约 640px。

三条需要写清楚而不是打勾了事的：

- **AC4 的"5 种色"（/integrations）**：`--foreground` 30 / `--muted-foreground` 58 / `--primary` 8 / `--warning` 6 / 主色按钮上的前景色 2。后三种都是**状态色**，不是又一级灰。基线要打掉的是"三级灰倒挂、最浅一级占 48%"，那个问题在三页都不复存在。
- **AC8 的 74px（/integrations）**：`hint_dismiss_signals` 是 8 个复选框的多选行。原本一行一个选项 → 229px；`.chk` 改成换行排列后 2 行 → 74px。48px 是单值行的口径，一个 8 选项的集合控件不可能不折叠地压进一行 —— 而折叠会让"我到底静音了哪几类提醒"变成看不见的状态。除它之外 12 行里 11 行 ≤53px。
- **AC11 的同名行**：三行 `underseed_node_threshold` 的 `flabel` 仍然相同，区分靠行内那枚 store 标签（`personal` / `fabric-team` / `wespy-team-cocos-knowledge-base`）。基线里那枚标签写的是「团队 store」，对两行都成立所以不区分；现在写的是别名本身。

### 静态断言（node 直接跑，会失败退出）

```
node packages/cli/__tests__/manual/ui-metrics-probe.mjs
── static checks ──
all clear
```

这一半做过变异测试：往 `shell.css` 注入 `.sidebar{color:#ff0000}` 与 `h4{margin:0}` 后，三条断言（字面色值 / 未锚定类名 / 裸标签选择器）全部报出，恢复后回到 all clear。写这一步是因为"绿了"本身不是证据 —— 一个什么都抓不到的检查也会绿。

## 一条方法学备注

「质感不好」是无法直接验收的。上面这些数字是它的**可观测代理**——代理不等于本体，所以：

1. 数字达标不代表用户满意，最终判据仍是用户看一眼；
2. 但数字不达标一定不满意，所以它们能挡住"改了一版还是那个味"的返工；
3. AC5 特意配了一条反向核对（说明文字总字数不下降），因为「压缩文档高度」这个指标最容易靠删内容作弊。

这三条对应 KT-GLD-0025：拿代理指标当工作量前，先验证代理指标本身。

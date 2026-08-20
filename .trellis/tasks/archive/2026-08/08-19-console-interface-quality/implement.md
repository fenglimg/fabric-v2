# 执行计划：控制台界面质感

## 顺序（每步独立可回滚）

1. **S1 令牌层** —— 重写 `shell.css` 的 `:root` / `[data-theme="dark"]`：语义令牌 + 字号 / 字重 / 圆角 / 阴影 / 动效四档，并在末尾补旧名别名组（design C2）。
   - 验证：`/` 与 `/graph` 打开无样式塌陷（AC20 的第一道）。
2. **S2 组件词汇** —— 在 `shell.css` 追加 `fx-` 组件层：按钮 / 图标按钮 / 徽标 / 卡片 / 统计 / 键值行 / 表格 / 标签页 / 空态 / kbd / 开关 / 页头，四态齐备（R5 / R7）。
   - 验证：`grep` 确认无裸标签选择器、无非 `fx-` 新类（design C1）。
3. **S3 图标表 + 顶栏升级** —— `shell.js` 增 `FabricIcon`；`DOMContentLoaded` 就地升级 `.navbar`（design C4 / C5）。
   - 验证：五个页面顶栏一致，lumen / graph 模板文件未改（`git status`）。
4. **S4 字段控件改造** —— `FabricField` 改为 `data-initial` + `data-dirty`，按钮改动后才显示（design C6，AC9）。
5. **S5 `/status`** —— 页头 `h1` + 统计卡网格修孤儿 + 键值行 + 长标识符截断复制 + 空态组件（AC2/AC13/AC18）。
6. **S6 `/config`** —— 说明收进展开、行高 ≤48px、同名行补 store 名、提醒频率预设收数字（AC7/AC8/AC11/AC12）。
7. **S7 `/integrations`** —— 7 个「调节项」改名、卡片去阴影、行密度收紧（AC7/AC10）。
8. **S8 探针与基线** —— 落 `packages/cli/__tests__/manual/ui-metrics-probe.mjs`，跑改后数字，写回 `research/ui-metrics-baseline.md`。
9. **S9 校验与提交** —— 见下。

## 验证命令

```bash
pnpm -r exec tsc --noEmit
```

```bash
pnpm --filter @fenglimg/fabric-cli test
```

```bash
pnpm --filter @fenglimg/fabric-shared test
```

浏览器侧（`fabric preview --port 7797` + Browser pane）：五页各跑一次探针，逐条对 AC1–AC21。

## 风险文件与回滚点

| 文件 | 风险 | 回滚 |
| --- | --- | --- |
| `shell.css` | 打到 lumen / graph 头上（design C1/C2） | `git checkout --` 单文件 |
| `shell.js` | 顶栏升级逻辑在所有页面跑，含 lumen | 同上；升级函数写成 early-return 保护 |
| `config.html` | 父任务 AC6（提醒频率逐键反推）易回归 | 改前先跑一次现有 config 相关测试 |

## `task.py start` 前的检查

- [x] `prd.md` 已过收敛（无重复事实、无未决问题、AC 可测）
- [x] `design.md` 有边界、约束推导、取舍表、回滚
- [x] `implement.md` 有顺序、验证命令、风险点
- [x] 用户已授权实施（"走 trellis 流程一键完成所有任务"）

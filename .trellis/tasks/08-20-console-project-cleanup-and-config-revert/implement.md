# 执行计划 — 控制台项目清理与配置可撤销性

四批。每批收口即 `git commit`（分支 `feat/fabric-console`）。排序理由见 `design.md` §六。

## W1 — 两个说谎的控件（纯前端）

- [x] `shell.js` 渲染三种控件时，给承载取值的元素打 `data-value-el`（text 输入 / select / multi 的 hidden）
- [x] `refresh()` 改为只认 `data-value-el`，删掉 `el.type === "checkbox" ? "" : ...` 这条靠 DOM 顺序的分支
- [x] `FabricField.control()` 把 `.fx-actions` 拆成 `.fx-actions`（保存，脏门控）与 `.fx-revert`（移除此处设置，`f.modified` 时常显）
- [x] `shell.css` 新增 `.fx-revert` 定位与样式；`.fctl[data-dirty="false"] .fx-actions { display:none }` 保持不变、不再波及移除按钮
- [x] 「说明」`ⓘ` 与「移除此处设置」拉开位置（前者贴层级徽标，后者贴控件）
- [x] 用例（多选正向）：未设值时勾一个 → `data-dirty="true"`、保存入口可见
- [x] 用例（多选反向）：已设值时不动控件 → `data-dirty="false"`
- [x] 用例（移除按钮）：`f.modified=true` 且控件未脏 → 移除按钮可见；`f.modified=false` → 不渲染
- [x] 变异：`refresh()` 改回 `querySelector("input, select")`，上面两条多选用例必须各自变红
- [x] 变异：把 `.fx-revert` 挪回 `.fx-actions`，移除按钮用例必须变红
- [x] 真机 `/integrations`：勾 `hint_dismiss_signals` → 保存出现 → 保存 → 重载后勾选状态与保存内容一致（AC7）
- [x] 真机：`nudge_mode` 行不触碰控件即可见移除按钮 → 点击 → 该行退回继承态、徽标由「本项目」变下层来源（AC6）

**验证**：`pnpm --filter @fenglimg/fabric-cli test` + 真机双向走一遍

**W1 实测（2026-08-20，真机 7792）**

- **新增 devDependency `jsdom`**（`packages/cli`，`pnpm-lock.yaml` 已同步，CI `--frozen-lockfile` 不会红）。理由：这两个 bug 都是 **DOM 语义**的 bug —— `querySelector` 对多元素子树返回谁、可见性规则波及哪棵子树。手写 DOM 桩会用写出这个 bug 时的同一套假设去实现这些语义，于是**与 bug 一致地通过**（KT 记过的 oracle 同源问题）。jsdom 是独立实现，这份独立性就是这条依赖的全部价值。
- **变异 1**（`refresh()` 改回 `querySelector("input, select")` + checkbox 特判）：精确杀掉 3 条多选用例，text/select 那条保持绿 —— 后者本来就靠文档顺序碰巧能工作，这个结果正确。
- **变异 2**（`.fx-revert` 挪回 `.fx-actions`）：第一次只杀掉 1 条，**最该红的「未触碰时移除按钮可达」活了下来**。根因是 `getComputedStyle` 只报元素自身的 `display`，祖先 `display:none` 不会传下来，所以"问它自己可不可见"这个判据太弱。改成向上走祖先链的 `reachable()` 后，变异 2 杀掉 2 条含那一条。**存活变异体暴露的是判据缺陷，不是代码缺陷** —— 这次没跑变异就会留下一条永远绿的假断言。
- **真机 AC6**：`/integrations` 14 行里，未触碰状态下可达的移除按钮从 **0 个变成 2 个**（`nudge_mode` / `archive_hint_hours`，即两个「本项目」行）。
- **真机 AC7 完整往返**：勾 `archive_backlog` → 保存出现 → 保存 → 落盘 `{"hint_dismiss_signals":["archive_backlog"]}` → 重载后勾选状态与落盘一致、徽标由「内置默认」转「本项目」、且移除按钮**不需要弄脏就可达**（修复前多选行从来没有过这个按钮）→ 点移除 → 徽标转回「内置默认」、勾选清空。`~/.fabric/fabric-global.json` 与操作前 sha256 一致（`a18bbdccfb52`），用户真实配置零残留。

## W2 — token 冲突（单点改动 + 机制级回归闸）

- [ ] 查出交集：既被共享外壳（`.navbar` / `.seg` / `.frow` / `.fx-*` / `.fctl`）消费、又被任一页面内联 `<style>` 重定义的 token 名
- [ ] 该交集内的 token 在 `shell.css` 改用 `--fx-` 前缀，`:root` 与 `[data-theme="dark"]` 两处同步；不做全量重命名
- [ ] 新增断言：解析 `shell.css` 取 `CHROME_TOKENS`，解析五个页面模板取各自重定义的 token 名，断言**交集为空**
- [ ] 变异：让 `.seg:hover` 重新消费一个被页面重定义的名字，该断言必须变红
- [ ] 真机五页实测 `getComputedStyle(.seg:hover).backgroundColor` 取值一致，且知识页该值 ≠ `--primary`（AC4）

**验证**：五页悬停数值比对 + 变异

## W3 — 注销项目（唯一新写面，唯一不可逆）

- [ ] `project-registry-io.ts` 补 `deregisterProjectById`（内部按 `project_id` 反查路径后复用既有 `deregisterProjectByPath`，不另写一份删除逻辑）
- [ ] 全局配置补"删除 `projects[<id>]` 整段"的写函数（`applyGlobalConfigEdit` 只改单键，不覆盖此场景）
- [ ] bindings 补"删除 `project_id` 匹配的 `*_resolved.json`"的写函数
- [ ] 新建 handler `applyProjectDeregister(body, launchDir)`：body 只收 `{ projectId, scope }`，**不收路径**；三处归属从 `collectKnownProjects(launchDir)` 的返回对象里取
- [ ] `preview.ts` 的 `WRITE_ROUTES` 加入 `/api/projects/deregister`
- [ ] 拒绝分支：未知 id → 404；缺 id / 非字符串 → 400；`scope.kind==="machine"` → 400；**当前项目 → 409 并说明理由**
- [ ] `remainingCount` 由重新跑 `collectKnownProjects` 得出，不用 `before - 1`
- [ ] 切换器两步确认 UI：首点展开面板，逐条列出将被改动的具体位置（注册表行 / 配置段 / binding 文件名）→「确认注销」才 POST →取消则磁盘零变化
- [ ] 用例：正向注销（三处都命中）/ 只有 id 无路径的项目（注册表跳过、另两处命中）/ 只在注册表的项目（另两处跳过）
- [ ] 用例：四条拒绝分支各一条
- [ ] 守卫用例：`GET /api/projects/deregister === 405` **且**同用例断言 `GET /api/integrations === 200`（机制级）
- [ ] 变异：把"未被选中的项目零触碰"的过滤放宽，断言变红
- [ ] **回滚点**：真机执行前先把 `~/.fabric/state/` 与 `fabric-global.json` 整体复制到一次性目录，在副本上跑一遍，逐项比对只动了该动的（AC3）
- [ ] 真机：注销 werewolf-minigame-5sp3 / werewolf-minigame-vest-7sp4 / 3 个 id-only / 1 个未绑 store，切换器只剩 ccpm / pcf / werewolf-minigame（AC1）

**回滚点**：本批唯一不可逆。副本演练通过之前不碰真实 `~/.fabric`。

## W4 — 配色收敛（改动面最广，全部可逆）

- [ ] 新增 `--fx-btn-solid-bg` / `--fx-btn-solid-fg` 一对 token，`.fx-btn` 主态改中性近黑实心
- [ ] `.frow.mod::before` 改 2px、低饱和强调色
- [ ] `.tag` 层级徽标改中性灰
- [ ] 复核 `--primary` 的剩余消费方只剩 `--ring`（焦点）与 `.seg.active`（选中）两类
- [ ] 新增样式一律带类/id 锚点、无裸标签选择器、无字面色号
- [ ] 跑 `ui-metrics-probe.mjs` 静态半
- [ ] 五页 × 700/768/1024/1440 截图比对，无横向滚动

**验证**：真机比对 + probe 静态半

## 收口

- [ ] `pnpm -r exec tsc --noEmit`（本地必跑，不靠 build —— 三次复发史）
- [ ] 全量 `pnpm -r test`
- [ ] AC1–AC9 逐条对照勾验，未达成的写明原因而不是删判据
- [ ] 归档判断：走一遍并把结论说出来，允许结论是"本段无可归档"

## 风险文件

| 文件 | 风险 | 处置 |
|---|---|---|
| `~/.fabric/state/` `fabric-global.json` | W3 不可逆，动的是用户真实机器状态 | 先在一次性副本上演练；执行前后三处逐项比对 |
| `preview.ts` | 新增写面，安全边界 | 请求体不含路径；机制级守卫用例 |
| `shell.js` `refresh()` | 三种控件共用，改错全线失效 | 正反两向用例 + 变异 |
| `shell.css` token 重命名 | 五页共用，漏改一处即静默失效 | 改完跑五页悬停数值比对；交集断言兜底 |
| `project-registry-io.ts` | 已有写函数，按 id 的新入口须复用而非另写 | 新函数内部转调既有 `deregisterProjectByPath` |

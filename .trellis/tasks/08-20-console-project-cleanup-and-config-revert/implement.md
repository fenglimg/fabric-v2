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

- [x] 查出交集：既被共享外壳（`.navbar` / `.seg` / `.frow` / `.fx-*` / `.fctl`）消费、又被任一页面内联 `<style>` 重定义的 token 名
- [x] 该交集内的 token 在 `shell.css` 改用 `--fx-` 前缀，`:root` 与 `[data-theme="dark"]` 两处同步；不做全量重命名
- [x] 新增断言：解析 `shell.css` 取 `CHROME_TOKENS`，解析五个页面模板取各自重定义的 token 名，断言**交集为空**
- [x] 变异：让 `.seg:hover` 重新消费一个被页面重定义的名字，该断言必须变红
- [x] 真机五页实测 `getComputedStyle(.seg:hover).backgroundColor` 取值一致，且知识页该值 ≠ `--primary`（AC4）

**验证**：五页悬停数值比对 + 变异

**W2 实测（2026-08-20，真机 7792）**

- **交集实测为 6 个**：`--accent` / `--border` / `--radius` / `--radius-sm` / `--sans` / `--mono` —— 只有 `lumen.html` 重定义 token（其余四页的内联 `<style>` 一个 token 都不声明），所以交集完全由 lumen 的调色板与 `shell.css` 的消费面相交产生。
- **改法**：`shell.css` 内 30 处 `var()` 消费点改读 `--fx-*`；旧名的**声明保留**（四个控制台页的内联样式仍在读 `--accent` / `--border` / `--radius` / `--mono`，而它们不重定义这些名字，因此不构成冲突）。`--fx-*` 必须是**字面值不是别名** —— 写成 `--fx-accent: var(--accent)` 会在下一跳重新继承页面的覆盖、把 bug 原样装回来，测试里有一条专门钉这点。
- **回归闸**（`console-chrome-tokens.test.ts`，3 条）：解析 `shell.css` 的 `var()` 读取集 × 五个模板内联 `<style>` 的声明集，断言交集为空；另加一条**非空性守卫**（lumen 声明数 > 20 且含 `--accent`），否则 lumen 哪天不再声明调色板，交集断言会因为错误的原因变绿。解析前先剥 CSS 注释 —— 两个文件都在注释里引用了正在讨论的 token 名。
- **变异**：把 `.seg:hover` 的 `background` 改回 `var(--accent)`，断言变红且直接点名 `lumen.html: --accent`。
- **真机五页**：`--fx-accent` 五页一致均为 `#f4f4f5`；知识页上 `--accent` = `--primary` = `#2563eb` 而 `--fx-accent` ≠ 二者（AC4 / AC5）。悬停「关联图」实拍为淡灰药丸，视觉重量低于选中态。

## W3 — 注销项目（唯一新写面，唯一不可逆）

- [x] `project-registry-io.ts` 补 `deregisterProjectById`（内部按 `project_id` 反查路径后复用既有 `deregisterProjectByPath`，不另写一份删除逻辑）
- [x] 全局配置补"删除 `projects[<id>]` 整段"的写函数（`applyGlobalConfigEdit` 只改单键，不覆盖此场景）
- [x] bindings 补"删除 `project_id` 匹配的 `*_resolved.json`"的写函数
- [x] 新建 handler `applyProjectDeregister(body, launchDir)`：body 只收 `{ projectId, scope }`，**不收路径**；三处归属从 `collectKnownProjects(launchDir)` 的返回对象里取
- [x] `preview.ts` 的 `WRITE_ROUTES` 加入 `/api/projects/deregister`
- [x] 拒绝分支：未知 id → 404；缺 id / 非字符串 → 400；`scope.kind==="machine"` → 400；**当前项目 → 409 并说明理由**
- [x] `remainingCount` 由重新跑 `collectKnownProjects` 得出，不用 `before - 1`
- [x] 切换器两步确认 UI：首点展开面板，逐条列出将被改动的具体位置（注册表行 / 配置段 / binding 文件名）→「确认注销」才 POST →取消则磁盘零变化
- [x] 用例：正向注销（三处都命中）/ 只有 id 无路径的项目（注册表跳过、另两处命中）/ 只在注册表的项目（另两处跳过）
- [x] 用例：四条拒绝分支各一条
- [x] 守卫用例：`GET /api/projects/deregister === 405` **且**同用例断言 `GET /api/integrations === 200`（机制级）
- [x] 变异：把"未被选中的项目零触碰"的过滤放宽，断言变红
- [x] **回滚点**：真机执行前先把 `~/.fabric/state/` 与 `fabric-global.json` 整体复制到一次性目录，在副本上跑一遍，逐项比对只动了该动的（AC3）
- [x] 真机：注销 werewolf-minigame-5sp3 / werewolf-minigame-vest-7sp4 / 3 个 id-only / 1 个未绑 store，切换器只剩 ccpm / pcf / werewolf-minigame（AC1）

**回滚点**：本批唯一不可逆。副本演练通过之前不碰真实 `~/.fabric`。

**W3 实测（2026-08-20，副本 7793 → 真机 7792）**

- **偏离计划一处：请求体带的是 row key 而不是 `projectId`。** 计划假设每个项目都有 id，真机上不成立 —— `werewolf-minigame-8sp2` 是 `registry-only`（装了 Fabric 但从没绑过 store，于是 `.fabric/fabric-config.json` 里根本没有 `project_id`，KT-PIT-0102）。按 id 命名行会让**恰好最该被清掉的那个项目永久不可移除**。改为 `MergedProject.key`（有 id 用 id，无 id 用 `path:<path>`），服务端把 key 匹配回重新合并出的列表，然后只用**匹配到的那一行自己的字段**去删 —— 请求依然不能指向页面没显示过的东西（KT-PIT-0106）。计划里的 `scope.kind==="machine"` → 400 这条随之取消：body 不再收 scope。
- **两步确认是服务端保证的，不是前端自觉**：不带 `confirm` 的同一个端点在服务端是纯读，返回计划。「点开看看再取消」磁盘零变化因此是构造性的 —— 副本上比对 9 个文件 + 全局配置的 sha，取消后逐行一致。
- **变异 5 条全部杀掉**：① `deregisterProjectById` 去掉按 id 过滤 → 2 红（含「邻居项目逐字节不变」）；② bindings 改按文件名匹配而非文件内 `project_id` → 4 红；③ 去掉 `confirm` 门 → 1 红（正是「未确认写不了」那条）；④ 未知 key 兜底取第一行 → 404 那条红；⑤ 从 `WRITE_ROUTES` 里删掉这条路由 → 守卫 2 条红。
- **副本演练（`/tmp/fabric-rehearsal`，整份 state + fabric-global.json 拷贝，stores 软链）**：9 → 3，逐项 diff 只少了 5 个 binding 文件、`projects.json` 变了一次，其余 sha 一致。
- **真机（AC1 / AC3）**：同一套 UI 操作走完，`/api/scopes` 现在只剩 machine / ccpm / pcf / werewolf-minigame 且 `blockedByReason` 为空（那三行「另有 N 个…」的提示也一并消失）。逐项 diff 与副本形状完全一致；**`fabric-global.json` 逐字节未变** —— 被注销的 6 个项目没有一个在 `projects` 段里有条目，所以 config 那条臂在真机上没被触发（它由单测覆盖）。备份留在 `/tmp/fabric-real-backup-state` 与 `/tmp/fabric-real-backup-global.json`。

## W4 — 配色收敛（改动面最广，全部可逆）

- [x] 新增 `--fx-btn-solid-bg` / `--fx-btn-solid-fg` 一对 token，`.fx-btn` 主态改中性近黑实心
- [x] `.frow.mod::before` 改 2px、低饱和强调色
- [x] `.tag` 层级徽标改中性灰
- [x] 复核 `--primary` 的剩余消费方只剩 `--ring`（焦点）与 `.seg.active`（选中）两类
- [x] 新增样式一律带类/id 锚点、无裸标签选择器、无字面色号
- [x] 跑 `ui-metrics-probe.mjs` 静态半
- [x] 五页 × 700/768/1024/1440 截图比对，无横向滚动

**验证**：真机比对 + probe 静态半

**W4 实测（2026-08-20，真机 7792）**

- **改动四处**：`.fx-btn` 主态 → `--fx-btn-solid-bg/-fg`（浅色 `#18181b` 深色反相 `#fafafa`，靠**重量**而不是色相当主操作）；`.fx-badge.primary` 由蓝实心块改描边中性（它标的是「这一行是当前那个」这件事实，不是一个动作，而一张表里十几个实心块会跟被它标注的数据抢注意力）；`.frow.mod::before` 3px → 2px 且改半透明 `--fx-mod-mark`（45%，随行背景走而不是挑一个死灰蓝）；`integrations` 的 `.tag.on` 由蓝改 `--success`（「已启用」是状态不是选中，而它跟顶栏那条选中标签会同屏出现）。
- **层级徽标复核后未改**：`.tag` 本就是 `--muted-foreground`、`.tag.set` 本就是 `--foreground`，两者已经是中性。计划里写「改中性灰」是照 F5 的推断写的，实测不成立 —— 记下来而不是为了勾掉这一条去动一个已经对的地方。
- **`--primary` 剩余消费方实测四处**，全部是选中态：`.seg.active` / `.seg.active::after` / `.fx-tab[aria-selected="true"]` / `.chk input[type="checkbox"]` 的 `accent-color`；焦点走 `--ring`（同值不同名）。页面层保留三处：`.cbtn.on`、`.preset.on`（都是选中）与 `.goto`（超链接 —— 蓝色链接是第五种通用约定，把它改成灰比留着更怪）。
- **新增断言（`blue is spent only on selection`）是 pin 不是 mechanism** —— 「蓝＝选中」没有解析器判得了，它的作用是让「再往别处花一次蓝」变成一次要写理由的显式编辑，而不是一条一条悄悄侵蚀回去。变异：把主按钮背景改回 `var(--primary)` → 当场变红。
- **五页 × 700/768/1024/1440 共 20 组**：`scrollWidth ≤ innerWidth` 全部成立，无横向滚动。明暗两套实测：浅色主按钮 `rgb(24,24,27)`／深色 `rgb(250,250,250)`，竖条 `rgba(37,99,235,.45)`／`rgba(96,165,250,.5)` 且均为 2px，选中标签两套仍是各自的蓝。
- `ui-metrics-probe.mjs` 静态半 all clear（无字面色号、无裸标签选择器、`fx-` 前缀规则）。

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

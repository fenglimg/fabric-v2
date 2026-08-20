# 技术设计 — 控制台项目清理与配置可撤销性

## 一、边界与既有资产

三处项目身份来源都已有读函数，写函数只有一个：

| 位置 | 读 | 写 | 键 |
|---|---|---|---|
| `~/.fabric/state/projects.json` | `listRegisteredProjects` | **`deregisterProjectByPath`（已存在，`project-registry-io.ts:232`）** | 路径 |
| `fabric-global.json` `projects[<id>]` | `loadGlobalConfig` | 无（`applyGlobalConfigEdit` 只改单键，不删整段） | project_id |
| `~/.fabric/state/bindings/*_resolved.json` | `listBoundProjectIds` | 无 | 文件内 `project_id` 字段 |

三者由 `collectKnownProjects(launchDir)` 合并成 `MergedProject[]`。**注销要做的三件事各自对应一处**，因此实现是"给后两处补写函数 + 复用第一处已有的"，不是新造一套注册表。

注意第一处按**路径**键控，而用户要清掉的 10 个里有 3 个只有 id 没有路径 —— 按 id 注销时路径必须由服务端从注册表自己反查，不能由请求携带（R6）。

## 二、新写端点 `/api/projects/deregister`

沿用 08-20 上一轮为 `/api/cleanup` 立的两条规矩，一字不改：

1. **请求体只收 `{ projectId, scope }`，永不收路径。** 要删哪个文件、哪一段配置，全部由服务端从它自己刚才渲染给页面的那份数据算出。
2. **删除集与展示集是同一个对象。** handler 先调 `collectKnownProjects(launchDir)`，从返回的 `MergedProject` 里取该 id 的三处归属，而不是另写一遍查找逻辑（KT-PIT-0106：读端与写端共用构造函数时必须传同一组参数）。

`WRITE_ROUTES` 加入该路径 → 自动继承 POST-only + loopback-Origin 守卫。守卫用例沿用机制级写法：同一个用例里断言 `GET /api/projects/deregister === 405` **且** `GET /api/integrations === 200`（KT-PIT-0100：`WRITE_ROUTES` 是路径级的，读写不能共用路径）。

### 返回形状

```ts
type DeregisterResult =
  | { ok: true; projectId: string;
      removed: { registryPath: string | null; configSegment: boolean; bindingFiles: string[] };
      skipped: { location: "registry" | "config" | "bindings"; reason: string }[];
      remainingCount: number }
  | { ok: false; status: number; error: string };
```

`remainingCount` 由**重新跑一次** `collectKnownProjects` 得出，不是 `before - 1`（KT-PIT-0107：静默失败的删除必须表现为"数字没动"，而不是被算术掩盖）。

### 拒绝条件

- 未知 `projectId` → 404。
- 缺 `projectId` 或非字符串 → 400。
- `scope.kind === "machine"` → 400（注销是针对某个项目的动作，机器视角下没有"哪一个"）。
- **`projectId` 等于当前所在项目 → 409**。你正在看着它的配置页把它的配置段删掉，页面此后所有取值来源都会失去意义。这条是硬拒绝并说明理由，不是静默跳过。用户本轮要保留的 pcf 恰是当前项目，不影响本次目标。

### 不可逆性与二次确认

D1 选定**彻底注销**：三处全删。已向用户明示且用户确认的代价 —— 该项目曾归档进 store 的知识（frontmatter 里 `semantic_scope: project:<id>`）会失去归属，知识文件本身仍在 store 里，但不再于任何仓库浮现。

因此 UI 必须两步：首点展开面板，逐条列出**将被改动的具体位置**（注册表的哪一行路径、配置里的哪一段、哪几个 binding 文件名），「确认注销」才 POST；取消则磁盘零变化（AC2）。这与孤儿文件清理的交互形状一致，用户已经熟悉。

**回滚点**：本批唯一不可逆动作。合入前先把 `~/.fabric/state/` 与 `fabric-global.json` 整体复制到一次性目录，在副本上跑一遍，逐项比对只动了该动的（AC3）。

## 三、`--accent` token 冲突（F2）

### 为什么不是"把 lumen 的 `--accent` 改掉"

lumen 定义自己的调色板是正当的 —— 它本来就是一个有独立视觉语言的页面，它也确实重定义了 `--border` 等其他 token。真正的错误是**共享导航条的样式去消费了一个页面可以自由重定义的名字**。改 lumen 只修好这一个 token，下一个撞名的照旧。

### 做法：给共享外壳的 token 加保留前缀

`shell.css` 中被**共享外壳组件**（`.navbar` / `.seg` / `.frow` / `.fx-*` / `.fctl`）消费的 token，改用 `--fx-` 前缀（如 `--fx-hover-surface`），并在 `:root` 与 `[data-theme="dark"]` 两处定义。页面调色板与外壳调色板从此不共享命名空间。

改动面限定在"**既被共享外壳消费、又被任一页面重定义**"的那个交集 —— 逐个查出来再改，不做全量重命名（全量重命名改动面大、收益只在这个交集上）。

### AC5 的回归闸怎么写才不是抄一遍当前值

断言的是**不变量**，不是色值：

1. 解析 `shell.css`，收集所有出现在共享外壳选择器规则体里的 `var(--X)`，得到集合 `CHROME_TOKENS`；
2. 解析五个页面模板的内联 `<style>`，收集各自重定义的 token 名；
3. 断言两个集合**交集为空**。

这条断言在今天为真，且在任何人日后给某个页面加一个撞名 token 时会红 —— 而把 `--accent: #f4f4f5` 抄进测试则只能证明"今天这个值是这个值"。变异验证：把 `.seg:hover` 改回消费一个被页面重定义的名字，该断言必须变红。

## 四、两个说谎的控件

### F3 —「移除此处设置」不再以变脏为前提

`.fx-actions` 现在同时装着「保存」与「移除此处设置」，整体被 `.fctl[data-dirty="false"]` 隐藏。但两个按钮的出现条件本就不同：

| 按钮 | 该出现的条件 | 现状 |
|---|---|---|
| 保存 | 控件变脏 | 正确 |
| 移除此处设置 | **本层真设过值**（`f.modified`），与脏无关 | 被错误地一起藏了 |

拆成两个容器：`.fx-actions`（保存，保持脏门控）与 `.fx-revert`（移除，`f.modified` 时常显）。这同时满足 AC8 —— 移除按钮固定在控件一侧、「说明」`ⓘ` 固定在层级徽标一侧，两者不再相邻。

### F4 — 脏检查读承载取值的元素

`refresh()` 现在靠 DOM 顺序碰运气（`querySelector("input, select")` 在多选控件上命中第一个 checkbox）。改为渲染时给真正承载取值的元素打 `data-value-el`，`refresh()` 只认这个标记 —— 显式标记优于顺序巧合，且三种控件（text / select / multi）走同一条路径。

两个方向的用例都要有：未设值时勾选 → 变脏（现状为假）；已设值时不动 → 不脏（现状为真脏，是同一 bug 的反向表现）。变异：把取值元素的选择改回 `querySelector("input, select")`，两条用例都必须红。

## 五、配色收敛（D2：蓝只留给焦点与选中）

当前 `--primary: #2563eb` 同时被四类语义消费。收敛后的分配：

| 语义 | 现在 | 之后 |
|---|---|---|
| 键盘焦点 (`--ring`) | `--primary` 蓝 | **保持蓝** |
| 当前选中标签 (`.seg.active`) | `--primary` 蓝 | **保持蓝** |
| 主按钮 (`.fx-btn`) | `--primary` 实心蓝 | 中性近黑实心（亮 `#18181b` / 暗 `#fafafa` 配反色文字），新增 `--fx-btn-solid-bg` / `--fx-btn-solid-fg` 一对 token |
| 「已修改」竖条 (`.frow.mod::before`) | 3px 满饱和蓝 | 更细（2px）、更低饱和的强调色 |
| 层级徽标 (`.tag`) | 蓝描边 | 中性灰 |

约束沿用上一轮：新增样式一律带类/id 锚点、无裸标签选择器、无字面色号（一律走 token）、`ui-metrics-probe.mjs` 静态半必须过。具体色值在实现时于真机上比对确定，不在设计里钉死 —— 钉死的是"哪些地方允许用蓝"这条规则。

## 六、批次与排序

| 批 | 内容 | 为什么在这个位置 |
|---|---|---|
| W1 | F3 + F4 两个说谎的控件 | 最便宜、纯前端、风险最低，且直接消掉"点了没用"这类最伤信任的体验 |
| W2 | F2 token 冲突 + AC5 回归闸 | 单点改动 + 一条机制级断言，与 W1 无冲突 |
| W3 | 注销项目（唯一新写面、唯一不可逆） | 放在视觉之前，避免与 W4 的大面积样式改动交叉验证 |
| W4 | 配色收敛 | 改动面最广但全部可逆，放最后避免与前三批反复冲突 |

每批收口即 `git commit`（分支 `feat/fabric-console` 已在用）。

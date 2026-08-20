# 设计 — 控制台交互可操作性与视觉收口

## 设计立场

九条问题只有两条需要新增服务端能力（清理孤儿文件、清理提醒缓存）。其余七条要么是模板没渲染已有数据，要么是措辞，要么是 CSS。

因此本设计的主轴是**先用已有数据把话说对，再为两处真缺口加最小写面**——而不是重构。

## 一、边界与既有约束

| 约束 | 影响 |
|---|---|
| 零构建前端 | 所有页面逻辑仍是单文件 HTML + `shell.js`；不引入模块/框架 |
| `WRITE_ROUTES` 是路径级方法门表 | 新写端点必须独占路径，不与读端点共用（KT-PIT-0100） |
| 写端点请求体不携带路径 | 现有 `/api/repair` 只收 action 枚举，服务端自己拼 argv。删除端点沿用此形（否则等于开了一个"任意文件删除"的本地端点） |
| 读写共用集合构造函数须同参 | 删除端必须复用读端算孤儿的同一函数（KT-PIT-0106） |
| 回滚/结果声明须 off 磁盘状态 | 删除响应报告的是**实际删掉的**，不是打算删的（KT-PIT-0107） |
| `shell.css` 单一令牌源 + legacy 别名块承重 | 视觉改动只动令牌与类，不硬编码色号 |
| 共享表禁裸标签选择器 | 新增样式一律带类/id 锚点（KT-PIT-0109） |

## 二、数据流：三处已有但没用上的数据

这是本任务最便宜的一段。以下字段服务端**已经算好并发给页面**：

| 字段 | 出处 | 现状 | 本任务用它做什么 |
|---|---|---|---|
| `source` | `config-resolve.ts:81`，取值 `env｜project｜defaults｜store｜global｜default` | 已下发，模板不渲染 | R5：判定"是否设在当前查看层"；R4：每行标出真实来源层 |
| `sourceLabel` | `global-config-view.ts:306`，已本地化 | 已下发，模板不渲染 | 直接作为来源层的显示文案，无需新增 i18n 键 |
| 孤儿文件路径 + 状态 | `integrations-view.ts` 的 `collectIntegrations(scope)` | 已渲染为只读清单 | R1：删除端复用同一函数重算，作为删除白名单 |

### R5 的具体改法（`modified` 的语义修正）

现状 `global-config-view.ts:308`：

```ts
modified: source !== "default",
```

这句把"不是内置默认值"读成了"设在这一层"。从本机层继承来的值同样满足它，于是页面对 7 行说了假话。

改为按当前查看层判定：

```ts
// `modified` 的唯一含义是「这一层自己写了这个值」——它驱动的是
// 「已在此处设置」标记与「移除」按钮，两者都只在本层有值时才成立。
// 判据不能是「和内置默认不同」：从上层继承下来的值同样满足那个条件，
// 于是继承行会被标成本层设置，而它的「移除」按钮无事可移。
modified: source === layerOf(target),
```

`layerOf(target)` 把写目标（`{scope:"machine"}` / `{scope:"project",projectId}`）映射到对应的 `ValueSource`。同时新增下发 `inherited: source !== layerOf(target) && source !== "default"`，供 R4 渲染"继承自 X"。

> 这是**展示面**的修正，不动 loader 的级联规则（KT-PIT-0104：展示面的层集必须等于或超过 loader 的层集；这里是把已读到的层如实说出来）。

## 三、新增写面：一个路由，两个动作

沿用 `/api/repair` 的形状——单路由 + action 枚举，而不是两个新路由。

```
POST /api/cleanup
  body: { action: "orphan-artifacts" | "hint-cache", scope: <scopeId> }
  resp: { removed: string[], skipped: {path,reason}[], remainingCount: number }
```

- 自动继承 `WRITE_ROUTES` 的 POST-only + loopback-Origin 守卫（加进集合即可）。
- **请求体不含路径**。服务端按 `action` 自己算要删的集合。

### action = `orphan-artifacts`

1. 调 `collectIntegrations(scope)`——与读端渲染清单的**同一个函数、同一个参数**。
2. 过滤 `state === "orphan"` 的路径，得到删除白名单。
3. 逐个删除；每个删除前再校验该路径仍在白名单内且位于 scope 的安装根之下（双保险：即便白名单计算有 bug，也删不出安装目录）。
4. 返回实际删掉的列表。

**为什么不加 CLI 命令**：`install never prunes` 是 CLI 侧的既有缺口（`integrations-view.ts:264`），补它是另一件事，射程更大。控制台这一侧的孤儿集合已经算好了，直接用；把 CLI 的 prune 作为后续任务，不阻塞本轮。

### action = `hint-cache`

删 `.fabric/.cache/` 下的提醒累积文件族：`archive-hint-shown-*`、`session-hints-*`、`hint-dismiss-*`、`hint-silence-counter`、`narrow-dedup-window-*`、`knowledge-hint-broad-last-emit`。

**文件名不手抄**（KT-PIT-0095：手抄清单只验证它自己）：从写这些文件的 writer helper 派生前缀，或至少让清单与 doctor 的清扫器共用同一份常量，并加 round-trip 用例（调 writer 生成一个文件名 → 断言清理器认得它）。

不删：`vectors/`、`bm25/`、`session-digests/`、`active-session-*`（这些是索引与在跑的会话状态，不是提醒记录）。

### 两步确认（AC2）

前端两步，服务端无状态：

1. 第一次点「清理」→ 不发请求，就地展开一个确认面板，列出**页面已经渲染的那份路径清单**全文 + 条数。
2. 面板内「确认删除」→ POST。
3. 响应回来后重新 `load()`，并把 `removed` 与确认时展示的清单做比对；**不一致就明说**（如"确认时 15 个，实际删除 14 个，1 个已不在"）。

> 服务端重算 → 与确认时展示的清单存在 TOCTOU 窗口。不用锁去消除它（成本不匹配），改为**把差异如实报出来**。声明 off 实际磁盘状态而不是 off 意图。

## 四、九条的落点

| # | 落点 | 性质 |
|---|---|---|
| V1 品牌 | `preview/lumen.html:1237-1242` 退掉旧 `.brand` 页头；导航条 `nav-title` 五页已是「Fabric 控制台」，不动 | 删 |
| V2 选中态 | `shell.css` `.seg.active`：加形状差异（底色胶囊 or 更实的指示条）；lumen 的三层渐变条与导航条下缘的关系重排 | 改 CSS |
| V3 hover 连片 | `.seg:hover` 收缩填充盒 / 加间距 / 改用更轻的 hover 表达；`.navbar` gap 从 2px 放大 | 改 CSS |
| V4 行选中质感 | `.frow.mod` 与 `:focus-visible` 重做 | 改 CSS |
| T1 删除措辞 | `shell.js:347-353` reset 按钮文案 → 「移除」语义；i18n 键随之 | 文案 |
| T2 切项目无反馈 | 各页主体区渲染当前范围名；配置行显示 `sourceLabel` | 模板 |
| T3 标记说谎 | `global-config-view.ts:308` 按上文修正 + 下发 `inherited` | 服务端小改 |
| T4 开关找不到 | 行为卡的"在别处调整"改为可点击锚点，跳到具体控件并高亮；卡内补一句"想关掉它 → 点这里" | 模板 |
| T5 多选像单向 | 多选控件在 `mod:false` 时也给出「移除」的禁用态或说明，而不是只有「保存」 | 模板 |
| F1 清理孤儿 | 新 `/api/cleanup` action=`orphan-artifacts` + 集成页两步确认 UI | 新功能 |
| F2 清理缓存 | 新 `/api/cleanup` action=`hint-cache` + 集成页可见计数 | 新功能 |

## 五、兼容与回滚

- **lumen 的保护约束改判**：`lumen.html` 原为零回归保护文件。V1 要求删除它 body 里的旧 `.brand` 页头，这是一次**用户批准的、有界的**改动。约束改为：除该页头及其相邻布局外，lumen 其余渲染零回归。
- 新增端点是**纯增量**：不加进 `WRITE_ROUTES` 就不存在；加进去后旧路由行为不变。
- CSS 改动集中在 `shell.css` 与四个页面模板，`git checkout` 即回滚。
- 服务端唯一改动是 `modified` 的判据 + 新增 `inherited` 字段（增量，旧消费方不受影响）。
- 删除动作**不可回滚**——这是它需要两步确认的原因。孤儿文件的性质（本版不再分发、重装也不会重新生成）意味着删错的代价是"下次装回来"，不是数据丢失。

## 六、测试策略

- **删除端**：正向（孤儿被删）、负向（`ok`/`modified` 状态文件零触碰，以执行前后计数验证）、越界（构造一个安装根之外的路径进白名单，断言被拒）。
- **守卫**：`/api/cleanup` GET=405 且同用例断言一个读端点 GET=200（机制级断言，KT-PIT-0100）。
- **`modified` 修正**：两个项目（ccpm / werewolf-minigame）的 fixture，其中一个在项目层真设过、一个纯继承，断言前者标记、后者不标记。**fixture 必须在被断言的那一维上有区分力**（KT-PIT-0097）。
- **缓存清理清单**：round-trip——调 writer 生成文件名，断言清理器认得（KT-PIT-0095）。
- **变异测试**：以上每条新断言都要证明它会红（把修正改回原样 / 把排除条件改成 no-op）。
- **真机 dogfood**：fixture 只覆盖已知形状，页面类改动以真机双项目比对为准（KT-PIT-0104）。

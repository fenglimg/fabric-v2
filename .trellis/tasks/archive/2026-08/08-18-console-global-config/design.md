# design — 全局配置管理页

## §0 出发点：改的是入口维度，不是读写机制

`console-config-view` 已经把「一个键住在哪个唯一归属、当前生效值是多少」解决了，并且 CLI 面板与网页共用同一个 `resolveEffective`。那部分**不动**。

本任务改的是**用什么维度进入这些数据**：

| | 现在 | 改造后 |
| --- | --- | --- |
| 入口 | cwd 仓库（`loadPanelContext(projectRoot)`） | 机器（全局配置文件 + 注册表 + 挂载库） |
| 项目 | 隐含且唯一（cwd 那个） | 显式且多个，cwd 只是被高亮的一项 |
| 写入目标 | 从 cwd 推断 | 请求显式指定，且必须命中枚举集合 |
| store | cwd 仓库的 write-target | 机器上挂载的全部 3 个，显式选 |

关键观察：`writeFieldValue(field, value, ctx, preferProjectScope)` 是按 `field.home` 分派的，**它需要的全部上下文就是 `ctx.projectId` 和 `ctx.storeRoot` 两个字段**。所以「写到哪个项目 / 哪个库」这件事不需要新的写逻辑，只需要**换一个 ctx**。写通道零改动是本设计最重要的成本控制点。

## §1 `PanelContext` 从「工作区派生」拆成「显式构造 + 派生包装」

现状 `loadPanelContext(workspaceRoot)` 一口气做了三件事：读 repo 配置拿 `project_id`、按 repo 的 write-target 算 `storeRoot`、读全局配置。全局页需要的是「给我一个指向项目 A / 库 X 的 ctx」，与工作区无关。

```ts
// 新增：纯构造，不碰文件系统之外的推断
export function buildPanelContext(input: {
  projectId: string | null;
  storeRoot: string | null;
  applyEnv: boolean;          // 见 §3
}): PanelContext

// 保留：现在是 buildPanelContext 的一个派生调用者（CLI 面板与 fabric config 继续用它）
export function loadPanelContext(workspaceRoot: string): PanelContext
```

`resolveEffective` / `writeFieldValue` 签名与实现**不变**（C2）。`PanelContext` 加一个 `applyEnv: boolean` 字段，`resolveEffective` 的 env 分支加一道 `ctx.applyEnv &&` 前置。这是本次对既有代码唯一的语义改动，配一条负向用例（`applyEnv:false` 时 env 不参与）。

## §2 项目清单：两个残缺来源的合并

两个来源各缺一半，谁都不能单用：

| 来源 | 有 | 缺 | 何时只有它 |
| --- | --- | --- | --- |
| `~/.fabric/state/projects.json` | 路径、fabric 版本、登记时间 | `project_id`（未绑 store 的项目没有） | 装了但从没配过项目级覆盖 |
| `~/.fabric/fabric-global.json` 的 `projects` 段 | `project_id`、已有的覆盖值 | 路径、名字（永远拿不到） | 注册表功能之前装的（**目前 100% 是这种**，见 PRD P1） |

合并键是 `project_id`。产出每项带一个 `origin` 标注：

- `both` — 正常态。可展示路径、可写覆盖。
- `registry-only` — 已登记但无 id。**可见但不可写覆盖**，因为配置段以 id 为键，没有 id 就没有可写的位置。界面必须说明原因（"未绑定知识库，故没有项目标识"）并给出下一步（`fabric store bind`），而不是静默不列（PRD 里用户已定：列出来）。
- `config-only` — 有覆盖但查不到装在哪。可写（id 在手），路径显示为「未登记（可能是旧版安装或仓库已移动）」。

`stale`（注册表里路径已不存在）按读时 `existsSync` 派生，沿用 `RegisteredProjectView` 既有语义，不落盘。

## §3 env 层：全局页里它会撒谎，必须降级（C3）

这是本设计最容易做错的一处，值得单开一节。

现在这版页面敢说「此值正被 `FABRIC_FUSION` 决定」，隐含前提是：**控制台进程的环境 ≈ 真正读这个变量的进程的环境**。在项目页里这个前提勉强成立（你在那个仓库的 shell 里启的服务）。全局页里它不成立——真正读 `FABRIC_NUDGE_MODE` 的是**各项目自己的** hook 进程、读 `FABRIC_FUSION` 的是 MCP server 进程，控制台的 `process.env` 不代表任何一个。

对非当前项目断言「正被 env 决定」，就是拿一个进程的环境去描述另一个进程——正是 KT-MOD-0004 说的「看得见的值不是生效的值」，只不过这次是界面自己制造的。

分级：

| 行 | env 是否参与 resolve | 文案 | 可编辑 |
| --- | --- | --- | --- |
| 当前所在项目 | 是（`applyEnv:true`） | 「**本控制台进程**观察到 `FABRIC_X=v`；带着同一变量的客户端会读到它，改文件不生效」 | 否 |
| 其他项目 / 全机器 / 知识库 | 否 | 「此键可被 `FABRIC_X` 覆盖」 | 是 |

强断言的措辞里必须出现「本控制台进程」——那是我们唯一真正观察到的事实，不是推断。

## §4 版面：按真实数据量分配权重，不按概念对称分配

真机实测（PRD P2 / P3）：`projects` 段 0 条、corpus 字段只有 1 个、17/19 是 preference。所以三个区**不是**三个等大的板块：

```
┌ 全机器默认 ────────────────────────────┐  ← 主体。18 个键（17 preference + language）
│  分 4 组，与现在的卡片布局一致          │     常态下你的全部设置都在这
└────────────────────────────────────────┘
┌ 按项目单独设置 ────────────────────────┐  ← 常态为空。列表 + 每项可展开
│  [项目 A · 当前]  2 项覆盖   ▾          │     展开后只列「该项目已覆盖的键」
│  [项目 B]         无覆盖     ▾          │     + 一个「为此项目添加覆盖」选择器
└────────────────────────────────────────┘
┌ 按知识库 ──────────────────────────────┐  ← 1 个键 × 3 个库,做成一张小表
│  underseed_node_threshold  personal / fabric-team / wespy-…
└────────────────────────────────────────┘
┌ 远程嵌入（只报形状）───────────────────┐  ← 原样搬运
└────────────────────────────────────────┘
```

「按项目」默认只展示**已有覆盖**而非 18 个键全铺开：18 × N 个项目是一堵墙，而真实需求是「我要给这个项目破一个例」。添加覆盖走「选键 → 填值 → 保存」，选完即出现在该项目的覆盖列表里。

注册表空态（当前真机状态）是这个区的默认渲染：一句「这台机器还没有登记任何项目」+ 一句可执行指引（去各仓库重跑 `fabric install`），而不是空白。

## §5 API

```
GET  /api/config          →  { machine, projects[], stores[], remoteEmbedding, strings }
POST /api/config/set      →  { key, value, target }
```

`target` 是判别联合，**请求体不接受任何路径**（R4）：

```ts
type Target =
  | { scope: "machine" }
  | { scope: "project"; projectId: string }   // 必须在 §2 合并清单内且 origin ≠ registry-only
  | { scope: "store"; storeUuid: string };    // 必须在 global.stores 内
```

服务端按 target 构造 ctx：`machine` → `{projectId:null, storeRoot:null}`；`project` → `{projectId, storeRoot:null}`；`store` → `{projectId:null, storeRoot: 由 uuid 经 storeRelativePathForMount 推出}`。然后交给未改动的 `writeFieldValue`。

拒绝路径全部走 400/404 且**在写任何文件之前**：未知 key、非 panel key、target 校验失败、`field.home` 与 target scope 不匹配（例如把 corpus 键往 `machine` 写）、值 validate 失败。

`WRITE_ROUTES` 与路由不变（`/api/config` 读、`/api/config/set` 写），POST-only + loopback Origin 校验原样继承（C1）。

## §6 模块与去留

| 文件 | 动作 |
| --- | --- |
| `console/config-resolve.ts` | 加 `buildPanelContext` + `applyEnv`；`resolveEffective`/`writeFieldValue` 不动 |
| `console/config-view.ts` | **删**，由 `console/global-config-view.ts` 取代（C5：不留第二个入口） |
| `console/config-write.ts` | **删**，由 `console/global-config-write.ts` 取代 |
| `console/project-list.ts` | 新增，§2 的合并逻辑（独立成模块因为它是本任务唯一有真实分支的纯函数，值得单独测） |
| `templates/console/config.html` | 按 §4 重写 |
| `commands/preview.ts` | 只换 handler 实现，路由与守卫不动 |
| `docs/configuration.md` | 补一段「控制台配置页是机器视角」 |

删而不是留——零用户阶段，保留一个没人进的项目页只会变成第二个会漂移的真值源。

## §7 风险

| 风险 | 处理 |
| --- | --- |
| AC1（两目录返回一致）写成同源自证 | 断言必须**真跑两次 `collectGlobalConfigView`**，cwd 分别为已装/未装仓库，deep-equal 后仅允许 `isCurrent` 不同；且先确认它在改造前**是红的**（红→绿才证明测的是这次改动） |
| `applyEnv` 前置漏加，全局页仍吃控制台 env | 负向用例：设 `FABRIC_FUSION`，断言非当前项目行 `source !== "env"` 且 `editable === true` |
| target 校验只挡状态码不挡副作用 | AC4 断言**磁盘未变**（写前后哈希全局配置文件），不只断言 4xx |
| 删 `config-view.ts` 带走仍被引用的东西 | 删除后跑 `tsc --noEmit` + knip；两者都干净才算 |
| 注册表空 → 页面看着像坏了 | 空态是一等渲染分支并有用例覆盖（AC2 后半） |

## §8 不做

- 注册表回填/自动发现（PRD Out of Scope；解法是重跑 `fabric install`）。
- 跨项目批量改。
- 删除覆盖 / 清理孤儿段。
- 导航条 i18n（父任务 design §9 的 shell 收尾批次，不在本任务混入）。

## §9 实现后校准：AC1 有且只有一条例外

R1/AC1 原文写的是「两目录返回**完全一致**」。实现后的事实是「一致，除了一行补行」——把差异写清楚比把验收改松更有用：

**例外**：当前所在项目若**两个来源都不认识**（既不在 `~/.fabric/state/projects.json`，其 id 也不在 `projects` 段），会被合成一行加进清单。这不是漏网，是刻意的：注册表晚于大多数安装，`projects` 段又只在改过配置后才有键——真机今天恰好就是这个状态（注册表空 + `projects: {}`），没有这一行，你**站着的那个项目在自己机器上是看不见的**。该行只带 id：无路径（不知道就不能猜）、无覆盖项（本来就没有）。

**边界**：cwd 能决定的仅此三样——`currentProjectId`、每行的 `isCurrent` 徽章、以及上面这一行的有无。其余一切（默认值、其他项目、store 清单、远程嵌入形状、**排序**）都不随 cwd 变。排序单列出来，是因为它就是这次真机比对唯一抓到的漏网：曾让当前项目排第一，于是同一台机器上两个控制台会对同一份清单给出不同顺序。

用例 `console-global-config-view.test.ts` 把例外本身钉住：去掉那一行之后，两个 cwd 的 payload 完全相等——例外恰是那一行，没有别的东西搭车。

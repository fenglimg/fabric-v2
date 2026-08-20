# Fabric 控制台 — 跨子任务技术设计

本文件只定**跨子任务的公共契约与边界**。每个子任务内部的实现细节写在各自的 `design.md`。

## 1. 分层边界：控制台不得成为第二套内核

```
┌─────────────────────────────────────────────┐
│  templates/console/*.html   零构建、无依赖   │  展示层
├─────────────────────────────────────────────┤
│  commands/preview.ts  路由 + JSON 端点       │  适配层（薄）
├─────────────────────────────────────────────┤
│  @fenglimg/fabric-server / shared 现有能力    │  内核（唯一真值）
│  install pipeline · config resolve · doctor  │
└─────────────────────────────────────────────┘
```

**硬约束**：适配层禁止实现业务判断。任何「怎么算落后」「哪层生效」的逻辑必须落在内核并被 CLI 与控制台共用。

理由：一旦 UI 自己算一遍，就会出现「界面说落后、CLI 说没落后」这类无法排查的分叉。这与 KT-MOD-0004 拒绝配置双写是同一条原理——**同一个问题只能有一个答案的产地**。

## 2. 页面组织：server-owned 页，不做模板注入

新增功能页 = 新增一条服务端路由 + 一个独立模板文件。

**禁止**把新数据改写成既有模板认识的形状再灌进 `lumen.html`。KT-DEC-0080 记录了这条路的实测代价：跨库数据被改写成 compound scope 键注入后，撞出 undefined 拼串、统计卡归零、长库名截断三处破绽，最终 revert 成专用页。

> 注（2026-08-17 核实）：KT-DEC-0080 描述的「7 个 style variant + 专用 `/all` 页」在当前代码中已不存在——`templates/preview/` 只有 `lumen.html`，跨库改由 `?all=1` 查询参数驱动，路由为 `/` `/graph` `/api/knowledge` `/api/revision`。**机制描述已过期，但「结构性功能走 server-owned 页」的原则仍然适用**，本设计遵循后者。该条目应在收口时提 review 修订。

规划路由（最终以子任务为准）：

| 路由 | 归属子任务 | 读/写 |
| --- | --- | --- |
| `/` `/graph` `/api/knowledge` `/api/revision` | 既有，不动 | 读 |
| `/projects` `/api/projects` | version-upgrade | 读 |
| `/config` `/api/config` | config-view | 读 |
| `/api/config/set` | config-view | **写** |
| `/api/install/run` | version-upgrade | **写** |

## 3. 写通道契约

用户决策：**只监听 127.0.0.1，不做鉴权**。理由是能连上 loopback 的进程本来就能直接改配置文件，加鉴权防不住真实威胁只增加摩擦。

因此安全性由这三条保证，缺一不可：

- **W1** 绑定地址硬编码 `127.0.0.1`，禁止任何 flag/配置能改成 `0.0.0.0`。需有测试锁死。
- **W2** 写端点一律 `POST`，且校验 `Origin`/`Host` 为 loopback——挡住外部网页跨站打本机端口（DNS rebinding 类）。这不是「鉴权」，是防止**非用户发起**的请求，与上面的决策不冲突。
- **W3** 写操作走内核既有的写入路径（如 config 的 `atomicWriteJson`），不新增写文件方式。

## 4. 数据来源：优先复用已有 `--json`

`doctor` / `audit` / `info` / `metrics` / `sync` / `config` 均已有 `--json`。控制台后端**优先直接 import 内核函数**（同进程、无子进程开销）；仅当某能力只在 CLI 层拼装、内核无导出时，才退而 spawn CLI + 解析 `--json`。

选择理由：同进程调用没有序列化损耗和进程管理复杂度；但 `--json` 的存在意味着即使 import 路径不通，也永远有一条不必重写逻辑的退路。

## 5. 注册表：机器级新状态

新增 `~/.fabric/state/projects.json`（落 `~/.fabric` 对齐 KT-DEC-0003 双根：本机状态永不入 repo git）。

写入时机：`fabric install` 成功后的一个 pipeline stage。

**幂等性要求（C4）**：注册表是「当前事实的快照」语义，不是「首次发生」语义——每次 install 覆盖该项目条目即可，重复执行结果相同。KT-PIT-0076 记录的坑是在幂等命令里放 once-ever 时间戳会被每次重跑重置、导致下游 gate 永不触发；本设计通过选择「快照语义」从根上避开，而非依赖调用方克制。dry-run 不写。

详细 schema 见 `console-project-registry/design.md`。

## 6. 三层配置的真值来源待核

`docs/configuration.md` 与 KT-MOD-0002 对层级的表述不一致：

- 文档：`env > repo > store > 库默认值`
- KT-MOD-0002：`env > project > global > code default`

两者的中间层不同（store vs global）。可能是两套正交的层（store 管知识库属性、global 管人的偏好），也可能是其中一份已漂移。

**R3 落地前必须读实现确认**，禁止照抄任一份文档。KT-PIT-0081 已有先例：`STORE_OVERRIDABLE_KNOBS` 声明 15 组、实际只有 12 组生效，把声明当活契约读会押错排查方向。配置页展示的必须是**实现的真实行为**。

## 7. 实施顺序与依赖

```
console-project-registry  ──┬──> console-version-upgrade
                            │
console-shell ──────────────┴──> console-config-view
```

- `console-project-registry` 必须最先：没有它，「跨项目」这个核心诉求无数据源。
- `console-shell` 可与 registry 并行（互不依赖）。
- 另两个各自依赖上面两者。

这不是人为分期——registry 是物理前置。

## 8. 明确的非目标

- 不做远程访问、不做多用户、不做权限模型。
- 不做通用任务编排面板（KT-DEC-0072：Fabric 是知识层，编排是 maestro-flow 的地盘）。
- 不迁移/不兼容任何历史 web 产物（`serve` 已删除，不复活）。
- 不引入前端构建链。

## 9. shell 收尾待办（子任务收口时累积）

四个模板（`console/config.html` `console/graph.html` `console/status.html` `preview/lumen.html`）共享同一段**硬编码中文导航条**。`config-view` 的正文已服务端按 `language` 渲染并在 `en` 机器实测通过，导航条没有——`en` 机器上是中文导航配英文正文。修法是把导航抽成一处、字符串随数据下发，正好和下面两项动同一批文件，一起做一次比分三次动更省 review：

- 导航条 i18n（抽共享导航 + 服务端下发字符串）。
- `lumen.html` 迁到 `shell.css` 令牌。
- `fabric preview` → `fabric console` 改名。

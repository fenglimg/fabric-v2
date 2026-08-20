# 项目注册表：让 Fabric 知道装在哪些仓库

父任务：`.trellis/tasks/08-17-fabric-console`

## Goal

让 Fabric 在机器层面知道「我被安装在哪些仓库里、各自是什么版本」，从而使跨项目的版本总览与批量升级成为可能。

## 为什么这是内核缺口，不是展示问题

当前 `~/.fabric/state/bindings/` 下有 8 个 `<project_id>_resolved.json`，内容是该项目的 store read-set。**没有任何一个字段记录仓库在磁盘上的位置**。

因此「列出本机所有装了 Fabric 的项目」今天无法实现——不是没做界面，是没有数据源。这是父任务里唯一必须改内核的部分，也是另外两个子任务的物理前置。

实测漂移（2026-08-17）：npm `2.6.0` / 全局 CLI `2.5.0-rc.4` / 本 repo manifest `2.5.0-rc.4`。用户当前无从发现。

## Requirements

- **R1** 新增机器级注册表 `~/.fabric/state/projects.json`，记录每个已安装项目的：仓库绝对路径（主键）、上次 install 的 fabric 版本、上次登记时间，以及 project_id（**可选**——不绑 store 的 install 不产生 project_id，详见 design §2.1）。
- **R2** `fabric install` 成功后自动登记/更新当前仓库条目。
- **R3** 记录的路径必须与本次 install 实际写入的根**完全一致**，不得另起一套路径解析。
  > S1 核实更正：原写「以 `.git` 为锚点、复用 `resolveProjectRoot`」。该函数会无条件短路返回 `CLAUDE_PROJECT_DIR`（在 Claude Code 会话中恒被设置），跨仓执行时会登记错误的仓库；且它是标注待迁移的遗留适配器。改为直接用 `InstallContext.target`——零解析，且自动尊重 `--target`。详见 design §3.1。
- **R4** 提供只读查询能力（供 CLI 与后续控制台共用），返回条目列表并标注每条的 `stale`（路径已不存在）与版本状态。
- **R5** 提供 CLI 可见入口，让用户不开控制台也能看到这份列表——否则这份数据只有 UI 能用，违背「CLI 是内核」的定位。
- **R6** 存量项目补登记：至少支持「跑一次 `fabric install` 即登记」；不要求实现磁盘扫描（用户已选「install 时登记」方案）。
- **R7** `fabric uninstall` 必须注销该项目的注册表条目。
  > 依据 KT-PIT-0074：新增一个「登记/清扫」类机制时必须同时实现它**反方向的孪生**，否则会留下自相矛盾的半套机制。这里的具体后果是：卸载过的项目永远赖在控制台列表里，显示为「已安装但版本落后」，用户点升级又会把 Fabric 装回去——一个用户无法理解也无法摆脱的幽灵条目。
  > 注销按**路径**匹配，不按 project_id：uninstall 会删掉 `.fabric/fabric-config.json`（project_id 的来源），按 id 注销就依赖「必须在删除前读取」的时序，脆弱且易在后续重构中被打破。

## Constraints

- **C1 幂等**：`fabric install` 可被无限次重跑。注册表条目是**当前事实的快照**（每次覆盖），不是「首次发生」记录。
  > 依据 KT-PIT-0076：在幂等命令里放 once-ever 语义的时间戳，会被每次重跑重置，使依赖它的 gate 永不触发（`init_scan_completed` 实证）。本设计用快照语义从根上规避。
- **C2 dry-run 不写**：`--dry-run` / `planOnly` 路径下不得落盘。同一条 KT-PIT-0076 记录了 dry-run 盖戳会让下游误判已初始化。
- **C3 落 `~/.fabric`**：本机状态，永不入 repo git（KT-DEC-0003 双根布局）。
- **C4 路径不分叉**：注册表记录的路径 = 本次 install 实际写入 `.fabric/` 的根（`context.target`）。禁止在注册表侧做任何独立的路径推断——一旦二者用不同规则算，就会出现「注册表说装在 A、实际装在 B」这类无法排查的分叉。
- **C5 stage 输出纪律**：不新增独立 `console.log` 旁白行；如需展示走 `StageResult.detail`（KT-DEC-0044）。
- **C6 never-throw**：注册表读写失败不得中断 `fabric install`。装知识层的附带记账失败，不该让主流程挂掉。
- **C7 并发安全**：用户会多窗口并发操作同一台机器（多 client session 并发是已知使用模式），写入必须是原子的，不得出现半截 JSON。

## Acceptance Criteria

- [x] AC1 在一个干净仓库跑 `fabric install`，`~/.fabric/state/projects.json` 出现该仓库条目，含正确的绝对路径与当前 CLI 版本。
- [x] AC2 连续跑三次 `fabric install`，注册表中该项目仍只有一条条目，内容为最后一次的快照（幂等性验证）。
- [x] AC3 跑 `fabric install --dry-run`，注册表**不发生任何变化**（含文件 mtime）。
- [x] AC4 把已登记项目的目录改名后查询，该条目被标记为 `stale`，且不影响其余条目返回。
- [x] AC5 注册表记录的路径与本次 install 实际写入 `.fabric/` 的根一致，二者永不分叉。
  > 验证方式：wiring 测试里 install 的目标是临时夹具目录，与进程 `cwd`（仓库根）不同，因此「登记的是 target 而非 cwd」被直接证明。未额外写 `--target` flag 的 CLI 级用例——`--target` 正是经由同一个 `context.target` 生效，再测一遍是同一条路径。
  > 更正自原 AC5「从子目录执行应登记仓库根」。核实发现 install 的 target 是 `--target` > `EXTERNAL_FIXTURE_PATH` > `cwd`，不回溯 git root——从子目录跑就是装在子目录。要求注册表回溯到仓库根，反而制造了与磁盘现实的分叉。
- [x] AC9 两个 install 并发收尾时，两条登记都在，无一丢失（`withFileLock` 生效验证）。
- [x] AC10 对一个已登记项目跑 `fabric uninstall`，其注册表条目消失，其余条目不受影响；注销不存在的条目是无声的 no-op（不报错）。
- [x] AC6 注册表文件被手动写成非法 JSON 时，`fabric install` 仍能成功完成（C6 never-throw），并能自愈或明确报出该状况。
- [x] AC7 CLI 有可见入口能列出注册表内容。
- [x] AC8 既有 install 相关测试全绿，install 的终端输出没有新增旁白行。

## Out of Scope

- 磁盘扫描发现存量项目（用户已明确选择 install-time 登记方案）。
- 任何 UI（属于 `console-version-upgrade`）。
- 注册表跨机器同步。

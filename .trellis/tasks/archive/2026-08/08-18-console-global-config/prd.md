# 全局配置管理页：以机器视角看与改配置

父任务：`.trellis/tasks/08-17-fabric-console`
前置：`console-config-view`（已完成，读写机制整块复用）、`console-project-registry`（已完成，提供项目清单）

## Goal

配置本来就住在机器级的 `~/.fabric/fabric-global.json` 里。现在的 `/config` 却要求你先 `cd` 到某个仓库才能看——拿「你从哪个目录启的服务」这个与配置无关的事实当入口。

本任务把 `/config` 改造成**机器视角**：一进来看到的是「这台机器整体怎么配的」，项目只是其中一个可展开的维度，当前目录只是列表里被高亮的一项。

## 用户原话与其含义

> 「更倾向于一个全局的管理页面，不用管具体在哪个目录下开启的，以全局的视角去看具体配置，然后允许设置整体或者单独设置项目」

拆成两条可验收的诉求：

- **入口去目录化**：页面内容不随启动目录变化（当前目录只影响"高亮哪一项"，不影响能看到什么、能改什么）。
- **两级写入**：一个键既能设成「全机器」，也能只对某个项目设。这个能力**已经存在**（`defaults` 段 vs `projects[id]` 段），缺的是让你在一个页面里对**任意**项目做，而不只是对当前目录这个项目。

## 落地前已核实的三处前提（决定了页面该长什么样）

> 与 `console-config-view` 同样的纪律：前提没量准就动手，做出来的界面会自信地显示错误信息。以下均为 2026-08-18 真机实测。

- **P1 项目注册表现在是空的。** `fabric info projects --json` 返回 `{"projects": []}`。登记只发生在 `fabric install` 时，而现有仓库都是该功能之前装的；也**无法回填**——老数据只有 `project_id`，不含路径。**空态是本页的默认首屏，不是异常分支**，必须一等公民对待并给出可执行的下一步（去各仓库重跑 `fabric install`）。
- **P2 项目级覆盖现在一条都没有。** 真机 `~/.fabric/fabric-global.json` 的 `projects` 段是 `{}`，全部 5 项设置都在 `defaults`。所以「全机器」区是常态主体，「按项目」区常态为空——版面权重要按这个来，不能设计成一屏项目卡。
- **P3 只有 1 个 corpus 字段。** 19 个 panel 字段里 17 个是 preference、1 个 global_root（`fabric_language`）、corpus 只有 `underseed_node_threshold` 一个。知识库维度不值得做成与项目并列的大区块。机器上挂了 3 个 store，所以该区的真实形状是「1 个键 × 3 个库」。

## Requirements

- **R1 页面内容与启动目录无关**：三个数据区（全机器 / 按项目 / 按知识库）都从机器级数据源读，不经过 cwd。cwd 的唯一作用是在项目列表里标注「当前所在」。
- **R2 项目清单 = 注册表 ∪ 全局配置的 `projects` 段键**。两个来源各有各的残缺（注册表有路径可能无 id，配置段有 id 必无路径），必须合并且标明每一项的状态，不能只取其一。
- **R3 写入目标由请求显式指定**，不再从 cwd 推断：`全机器` / `某个项目` / `某个知识库`。
- **R4 写入目标必须来自枚举集合**：projectId 必须在 R2 的清单内，store 必须在已挂载的库内。**请求体不接受任何路径**——由服务端从 uuid 推路径。
- **R5 展示的必须是实现的真实行为**（沿用 config-view 的 R5）。尤其见 C3。

## Constraints

- **C1** 沿用既有写通道：POST + loopback Origin 校验 + `WRITE_ROUTES`，不新开写入机制。
- **C2** 复用 `resolveEffective` / `writeFieldValue`，不新写第二套 resolve。一个问题只能有一个答案源。
- **C3 env 层在全局页会撒谎，必须降级表述。** 现在这版页面里「env 正在顶着」是可信的——控制台跑在你那个 shell 里，与被描述的项目同一个进程环境。全局页不成立：真正读这些变量的是**各项目自己的** hook / MCP 进程，控制台的 `process.env` 不代表它们。因此全局页只能说「此键可被 `FABRIC_X` 覆盖」，**不得**对非当前项目断言「正被 env 决定」。当前所在项目可保留强断言。
- **C4** 不显示任何 secret（沿用 config-view：远程嵌入只报 host / 有没有 key / model）。
- **C5** 单页，不新增第二个配置页。两页并存必然出现「同一个键两个入口、显示还可能不一致」——正是 KT-MOD-0004 一直在防的。

## Acceptance Criteria

- [x] AC1 从两个不同目录启动控制台（一个已装 Fabric、一个未装），`/api/config` 返回的项目清单、全机器默认、知识库清单一致——**有且只有一条例外**：两个来源都不认识的当前项目会被补一行（否则你站着的那个项目在自己机器上看不见），该行只带 id、无覆盖项、无路径。证据：沙箱双服务器 7795(repo-alpha)/7796(repo-unbound) 比对 `identical: true`（含排序）；真机 pcf/ vs /tmp 比对，差异经核对**恰是且仅是**那一行补行（其余部分 `non-project part identical: true`）。单测 `console-global-config-view.test.ts` 4 例，含把例外本身钉住的一例（去掉那一行后两份 payload 完全相等）。
      **这条真的红过**：先按 R1 写的断言在单测里绿、真机比对红——差在**排序**（当前项目被排到第一，于是列表顺序随 cwd 变），fixture 里当前项目恰好按名字也排第一，靠命名巧合过关。改用排最后的名字后单测转红，去掉 current-first 排序后转绿。
- [x] AC2 项目清单包含「仅在注册表」「仅在配置段」「两者都有」三种来源的条目，各自状态标注正确；注册表为空时页面渲染空态与可执行指引，而非空白或报错。证据：沙箱页面同时渲染 `proj-orphan`(config-only) / `repo-alpha`(both) / `repo-gone`(both+stale) / `repo-unbound`(registry-only，展开后给出「未绑定知识库…先跑 fabric store bind」且无可编辑控件)；空态由 `console-project-list.test.ts` 「empty machine yields an empty list」+ 真机 /tmp 启动（`projects: []`）双向覆盖。
- [x] AC3 对项目 A 写入某键，只落到 `projects[A]`；项目 B 与 `defaults` 均不受影响（正向 + 两条负向断言）。证据：`console-global-config-write.test.ts`；浏览器实操——从 repo-alpha 启动的控制台给**非当前项目** `proj-gone` 新增 `nudge_mode` 并改成 `verbose`，磁盘 `projects` 变为 `{proj-alpha:{nudge_mode:silent}, proj-orphan:{audit_mode:strict}, proj-gone:{nudge_mode:verbose}}`，`defaults.nudge_mode` 仍为 `normal`。
- [x] AC4 写入目标校验：伪造的 projectId / 未挂载的 store uuid / 请求体里塞路径，三者均被拒或被忽略，且没有任何文件被写。证据：`console-global-config-write.test.ts` 磁盘指纹断言；真实 HTTP 复核——`unknown project: nope`、`store is not mounted: ../../../etc`、`underseed_node_threshold cannot be set at scope "machine"`、`fabric_language cannot be set at scope "project"`、`not a configurable key: embed_api_key`、跨源 POST 403。请求体里塞 `path` 不报错也不生效：路径一律由服务端按 id/uuid 推出，请求体的 path 从未被读。
- [x] AC5 C3 的降级：当前所在项目那行强断言（正被 env 决定、不可编辑），其他项目那行只是弱提示（可被覆盖）且仍可编辑。证据：`config-env-layer.test.ts` 9 例 + `console-global-config-view.test.ts` 中 `applyEnv` 只对当前项目为 true 的用例；文案改为「本控制台进程观察到环境变量 X」。
- [x] AC6 `underseed_node_threshold` 按 store 分别显示与写入；改 store X 不影响 store Y。证据：单测 + 沙箱真实写入落到 `stores/team/team-kb/store-config.json`（`{"underseed_node_threshold": 9}`），`stores/personal/personal-kb/` 下未生成任何文件。
- [x] AC7 canary：响应体与页面 HTML 全文均不含真实/伪造 API key。证据：沙箱全局配置里种 `sk-SANDBOX-CANARY-DO-NOT-LEAK`，两个服务器的 `/api/config` 全文 grep 命中 0；真机响应 `secret leaked: false`，只报 `{configured, endpointHost, hasApiKey, model}`。

## Out of Scope

- 项目注册表的回填/自动发现（P1 的解法是重跑 `fabric install`，不在本任务造第二套发现机制）。
- 跨项目批量改同一个键（"把这 5 个项目都设成 silent"）——先把单项目路径跑通再谈。
- 删除某个项目的覆盖段 / 清理孤儿段（读写之外的生命周期操作）。
- 配置版本历史与回滚（沿用父任务 Out of Scope）。

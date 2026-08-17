# 配置视图：三层配置生效值与来源可见可改

父任务：`.trellis/tasks/08-17-fabric-console`
依赖：`console-shell`（需要页面骨架与写通道）

## Goal

让用户在一个页面上看清「这个项目现在实际按什么配置在跑、每个值是从哪一层来的」，并能直接改。

## 真实痛点（对用户原话的修正）

用户表述为「CLI 配置效率低下」。但 `fabric config` 已经是交互式面板，且字段可自省（`getPanelFields()`）——**录入效率不是主要瓶颈**。

真正的瓶颈是**不可见**：配置分布在环境变量、`~/.fabric/fabric-global.json`、`<repo>/.fabric/fabric-config.json`、store 的 `store-config.json` 四处，用户改完不知道最终生效的是哪一个值、来自哪一层。这正是 KT-MOD-0004 警告的那类问题——「看得见的值不是生效的值」是最难排查的一类。

## Requirements

- **R1** 展示每个配置项的**最终生效值**及其**来源层**。
- **R2** 字段清单从 `getPanelFields()` 自省派生。**禁止手写静态字段列表**——加字段要自动出现、删字段要自动消失（KT-DEC-0035 的活注册表原则）。
- **R3** 可编辑：写入该 key 的唯一归属层。一个 key 只能有一个可写位置（KT-MOD-0004），界面不得提供「往另一层也写一份」的入口。
  > 校准：单一归属**已由架构保证**（`PanelFieldMeta.home` 是一等字段，没有第二个写入口可提供），界面不再需要主动规避。R3 剩下的实义是：`preference` 类有 `projects[id]` / `defaults` 两个段可写，界面必须让用户**显式选**落哪个段，不得替他决定。
- **R4** 改完的值与 CLI 侧读到的一致（同一真值来源，无第二套状态）。
- **R5** 展示的必须是**实现的真实行为**，不是文档声明的行为。

## 落地前必须先核实的两处已知漂移

- **D1 层级顺序**：`docs/configuration.md` 写 `env > repo > store > 库默认值`；KT-MOD-0002 写 `env > project > global > code default`。中间层不同（store vs global）。可能是两套正交的层，也可能其中一份已漂移。**必须读实现确认，禁止照抄任一份文档。**
- **D2 可下沉白名单**：KT-PIT-0081 记录 `STORE_OVERRIDABLE_KNOBS` 声明 15 组可下沉、实际只有 12 组生效。界面必须反映实际生效的 12 组语义（或以实现为准重新核实数量），否则会让用户以为存在并不存在的跨层竞争。

> 这两条是本子任务的**第一步工作**，不是背景说明。前提没量准就动手，做出来的界面会自信地显示错误信息——比没有界面更糟。

### 核实结论（2026-08-17，完整推导见 `design.md` §0）

两条漂移记录**本身都已过期**，过期方向不是数字变了，是机制被整个删掉了。

- **D1 已结**：不存在统一 cascade，真实模型是 per-CLASS——`preference` 走 `env(仅 4 键) > global.projects[id] > global.defaults > 默认`，`corpus` 走 `env > store-config.json > 默认`，`global_root` 只有 `language`。**`<repo>/.fabric/fabric-config.json` 已是 identity-only，不承载任何策略旋钮。** `docs/configuration.md` 与 KT-MOD-0002 两份声明都错，且错在不同地方。
- **D2 已结**：`STORE_OVERRIDABLE_KNOBS` 白名单已删（`schemas/fabric-config.ts:64`），`storeConfigSchema` 成为 store 可配项的唯一定义。"15 声明 / 12 生效"不再有指代对象，界面**不应**呈现任何跨层竞争语义。
- **新发现**：19 个 panel 字段里**没有任何 secret 字段**——`embed_api_key` 住在 global config 的 `embed_remote.api_key`，不在 `getPanelFields()` 内。

据此校准下方 R3 / AC3 / AC5（原措辞基于已不成立的前提）。

## Constraints

- **C1** 写入走内核既有路径（`atomicWriteJson` 等），不新增写文件方式。
- **C2** secret / credential 类字段（`embed_api_key` 等）不得在界面明文回显。
  > `~/.fabric/fabric-global.json` 当前确实存有明文 API key。展示面把它渲染到网页上会扩大暴露面（浏览器历史、截图、录屏）。展示为掩码，编辑走「只写不读回」。
- **C3** 语言渲染遵循机器级 `~/.fabric/fabric-global.json` 的 `language`。
  > 已知缺口（2026-08-17 实测）：本页**正文**（字段标签 / 描述 / 来源标签 / 按钮 / 提示）全部服务端按 `language` 渲染，`en` 机器上验证通过；但**顶部导航条**（"Fabric 控制台 / 知识 / 关联图 / 状态 / 配置"）在四个模板里都是硬编码中文，`en` 机器会看到中文导航 + 英文正文。这不是本页引入的（`graph.html` / `status.html` / `lumen.html` 先有），修它要一次性动包括 out-of-scope 的 `lumen.html` 在内的四个模板 + 共享导航抽取。**留给父任务的 "shell 导航 i18n" 一并做**，这里不静默声称 C3 全绿。

## Acceptance Criteria

- [x] AC1 配置页列出的字段与 `getPanelFields()` 返回一致；临时增删一个字段，页面自动跟随（验证 R2 不是手写清单）。
  > 两道：清单相等 + **结构性**断言（读 `config-view.ts` 源码，断言它一个 panel key 都没提到）。只做前者会被"今天手抄一份"骗过去——手抄的清单今天也相等。
- [x] AC2 每行显示生效值 + 来源层，且与实际 resolve 结果一致。同一个 `resolveEffective`，CLI 面板与页面共用，无第二套 resolve。
- [x] AC3 含一个 env 覆盖下层的用例，断言值**明显不等于代码默认值**（KT-PIT-0062：断言值撞默认值会让用例永远绿但从未验证过目标行为）。
  > 校准：只有 4 个 panel 键有实际 env 读点（`default_layer_filter` / `fusion` / `nudge_mode` / `underseed_node_threshold`），用例必须落在这 4 个之内；env 值、`defaults` 值、代码默认值三者互不相等。
  > 落地：4 键全覆盖（3 个 preference + `underseed_node_threshold` 走 corpus 段），三值两两不等；另有普查用例双向锁 `PANEL_ENV_OVERRIDES` 与代码读点集合相等，加不加都会红。
- [x] AC4 在界面改一个值后，`fabric config --get <key>` 读到同样的值。
  > 单测（写入 → `configCmd --get`）+ 沙箱浏览器实测（`archive_hint_hours` 24→48，落盘为**数字**、repo config 仍 identity-only、`--get` 返回 48）。
- [x] AC5 secret 类字段在页面与 `/api/config` 响应里均为掩码，原文不出现在任何响应体中。
  > 校准：panel 字段集不含 secret，逐字段掩码会是**空断言**（断言对象是空集，用例永远绿——KT-PIT-0062 的同形变体）。改为 canary 负向断言：fixture 写入可识别假 key，断言响应体与页面 HTML 全文均不含该串。这条不依赖字段清单，能挡住"把 global config 整个 dump 进响应"这类逐字段掩码防不住的泄漏。
- [x] AC6 D1 / D2 两处漂移已核实并有结论记录；若发现文档或知识条目有误，提交修订。
  > 结论见上「核实结论」+ `design.md` §0。文档侧已改：`docs/configuration.md` 全文重写（三归属表 / per-class cascade / 4 条 env 表 / store-config 唯一定义）。
  > **知识条目侧待用户同意**：`KT-MOD-0002`（层级模型已过期、与 KT-MOD-0004 冲突）与 `KT-PIT-0081`（白名单已删、无指代对象）需要改/退役，写的是**共享 team store**，按 KT-GLD-0020 必须先取得用户明示同意，未擅自写入。

## Out of Scope

- 配置的版本历史 / 回滚。
- 跨项目批量改配置。

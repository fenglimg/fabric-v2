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
- **R4** 改完的值与 CLI 侧读到的一致（同一真值来源，无第二套状态）。
- **R5** 展示的必须是**实现的真实行为**，不是文档声明的行为。

## 落地前必须先核实的两处已知漂移

- **D1 层级顺序**：`docs/configuration.md` 写 `env > repo > store > 库默认值`；KT-MOD-0002 写 `env > project > global > code default`。中间层不同（store vs global）。可能是两套正交的层，也可能其中一份已漂移。**必须读实现确认，禁止照抄任一份文档。**
- **D2 可下沉白名单**：KT-PIT-0081 记录 `STORE_OVERRIDABLE_KNOBS` 声明 15 组可下沉、实际只有 12 组生效。界面必须反映实际生效的 12 组语义（或以实现为准重新核实数量），否则会让用户以为存在并不存在的跨层竞争。

> 这两条是本子任务的**第一步工作**，不是背景说明。前提没量准就动手，做出来的界面会自信地显示错误信息——比没有界面更糟。

## Constraints

- **C1** 写入走内核既有路径（`atomicWriteJson` 等），不新增写文件方式。
- **C2** secret / credential 类字段（`embed_api_key` 等）不得在界面明文回显。
  > `~/.fabric/fabric-global.json` 当前确实存有明文 API key。展示面把它渲染到网页上会扩大暴露面（浏览器历史、截图、录屏）。展示为掩码，编辑走「只写不读回」。
- **C3** 语言渲染遵循机器级 `~/.fabric/fabric-global.json` 的 `language`。

## Acceptance Criteria

- [ ] AC1 配置页列出的字段与 `getPanelFields()` 返回一致；临时增删一个字段，页面自动跟随（验证 R2 不是手写清单）。
- [ ] AC2 每行显示生效值 + 来源层，且与实际 resolve 结果一致。
- [ ] AC3 含一个 env 覆盖下层的用例，断言值**明显不等于代码默认值**（KT-PIT-0062：断言值撞默认值会让用例永远绿但从未验证过目标行为）。
- [ ] AC4 在界面改一个值后，`fabric config --get <key>` 读到同样的值。
- [ ] AC5 secret 类字段在页面与 `/api/config` 响应里均为掩码，原文不出现在任何响应体中。
- [ ] AC6 D1 / D2 两处漂移已核实并有结论记录；若发现文档或知识条目有误，提交修订。

## Out of Scope

- 配置的版本历史 / 回滚。
- 跨项目批量改配置。

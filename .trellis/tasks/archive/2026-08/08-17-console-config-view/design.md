# 设计：配置视图

父任务：`.trellis/tasks/08-17-fabric-console`
前置：`console-shell`（已完成，`ef7c933f`）——页面骨架、`shell.css`、写通道门禁均已就位。

---

## §0 先量前提：D1 / D2 的核实结论

PRD 把「核实 D1/D2」列为第一步工作而不是背景说明。核实完的结论是：**两条漂移记录本身都已经过期**，而且过期方向不是"数字变了"，是"那个机制被整个删掉了"。

### 0.1 D1 —— 不存在统一的四层 cascade，真实模型是 per-CLASS

代码里有一轮叫 `config-single-home` 的重构（W1–W8）已经落地。真实模型：

| class | 生效顺序 | 物理位置 |
| --- | --- | --- |
| `preference` | `env(仅部分键) > projects[project_id] > defaults > 代码默认` | `~/.fabric/fabric-global.json` 的两个段 |
| `corpus` | `env(仅部分键) > store-config.json > 代码默认` | 绑定的 team store 根 |
| `global_root` | `~/.fabric/fabric-global.json` 顶层 > 代码默认 | 同上（只有 `language`） |

关键事实：**`<repo>/.fabric/fabric-config.json` 已经是 identity-only**（`project_id` / `required_stores` / `write_routes` / `active_project` / `active_write_store` / `default_write_store`），不再承载任何策略旋钮。权威依据 `packages/server/src/config-loader.ts:185-196` 的 `projectLayer()` 注释与 `resolvePreference` / `resolveCorpus`（同文件 270-296），以及 hook 侧孪生 `.claude/hooks/lib/config-cache.cjs:133 readPolicy`。

每个键归哪一类由 `PanelFieldMeta.home` 声明（`packages/shared/src/schemas/fabric-config-introspect.ts:64`），这是**一等字段**，不是注释。

**所以三份声明各错在哪：**

- `docs/configuration.md:15` 的 `environment > repo > store > library default` —— 中间两层全错。repo 层不承载策略；store 层只对 corpus 类成立。文件里还有三处独立事实错误：把全局配置文件名写成 `~/.fabric/fabric-config.json`（真名 `fabric-global.json`）、宣称 "Repo overrides are allowed"（已不允许）、引用 `store_knob_repo_override` 诊断（已被 `config_key_relocated` 取代，见 `packages/cli/__tests__/doctor-config-key-relocated.test.ts:14`）。
- `KT-MOD-0002` 的 `env > project > global > code default` —— 其正文明确把 `project` 定义为 `.fabric/fabric-config.json`，即已死的那一层。它与同库的 `KT-MOD-0004`（one key one home，仍然正确且已 body_in_context）直接冲突。
- **PRD 自身的 R1/R3 措辞**假设了"多层竞争"。实际上 R3（一个 key 只有一个可写位置）**已经由架构保证**，不需要界面去避免——界面根本没有第二个写入口可提供。

### 0.2 env 层只对 19 个 panel 键中的 4 个成立

对全仓 `FABRIC_*` 做了一次普查（node 遍历 `packages/*/src` + `.claude/hooks`，避开 Bash grep 的已知假阴性）。与 panel 键集合求交，得到**恰好 4 个**：

| panel 键 | env 变量 | 唯一读点 |
| --- | --- | --- |
| `default_layer_filter` | `FABRIC_DEFAULT_LAYER_FILTER` | `config-loader.ts:518` |
| `fusion` | `FABRIC_FUSION` | `config-loader.ts:708` |
| `nudge_mode` | `FABRIC_NUDGE_MODE` | `.claude/hooks/lib/nudge-policy.cjs:65` |
| `underseed_node_threshold` | `FABRIC_UNDERSEED_NODE_THRESHOLD` | `hooks/lib/hint-config.cjs:114` + `knowledge-hint-broad.cjs:342` |

其余 15 个 panel 键**没有任何 env 读点**。hook 侧的 `readPolicy` 更是完全没有 env 层。

这解释了 `config.ts:166-172` 那段注释——CLI 面板故意不显示 env 层，理由写的是"不是每个旋钮都有 env reader，宣称有就是在撒谎的展示"。这个判断是对的，但它选了保守的一半：**对那 4 个键，面板现在会把 env 生效的情况显示成 `machine-wide`，也就是显示了一个不生效的值**。这正是 R5 要消灭的东西。

### 0.3 D2 —— `STORE_OVERRIDABLE_KNOBS` 已被删除，KT-PIT-0081 结构性失效

`packages/shared/src/schemas/fabric-config.ts:64-72` 明确记录：白名单已删，因为它回答的那个问题（"这个键能不能同时写在 repo 和 store 两处"）不再存在。`storeConfigSchema` 现在是 store 能配什么的**唯一**定义，一份 shape 不可能和自己漂移。

所以 KT-PIT-0081 记录的"声明 15 / 实际 12"不再是活契约，界面**不应该**呈现任何跨层竞争语义。PRD 里"界面必须反映实际生效的 12 组"这句要作废——12 这个数字本身已经没有指代对象了。

### 0.4 AC5 的前提也不成立（新发现，PRD 未预见）

`embed_api_key` **不是 panel 字段**。它住在 global config 的 `embed_remote.api_key`（`schemas/store.ts:369`），而 `getPanelFields()` 返回的 19 个键里没有任何 secret 类字段。

若配置页只渲染 panel 字段，AC5「secret 在页面与响应体里均为掩码」就是**空断言**——断言的对象根本不会出现，用例永远绿但从未验证过目标行为。这是 KT-PIT-0062 的形状，只不过换了个位置：那次是断言值撞上默认值，这次是断言对象撞上空集。

处理见 §4。

---

## §1 数据契约

新增 `GET /api/config`，返回：

```ts
interface ConfigView {
  projectRoot: string;
  projectId: string | null;      // null ⇒ 无法写 projects[] 段
  storeAlias: string | null;     // null ⇒ 无法写 corpus 类
  fields: ConfigFieldView[];
  remoteEmbedding: RemoteEmbeddingView;  // §4
}

interface ConfigFieldView {
  key: string;
  group: "A_locale" | "B_hint_threshold" | "C_audit" | "D_behavior";
  home: "global_root" | "preference" | "corpus";
  label: string;                 // 已 t() 渲染，前端不做 i18n
  description: string;
  type: "boolean" | "number" | "string";
  widget: "select" | "text";
  enumValues?: string[];
  effective: string;             // 经 format_for_display
  source: "env" | "project" | "defaults" | "store" | "global" | "default";
  sourceLabel: string;           // 已 t() 渲染
  envVar: string | null;         // 有 env 读点的键才非 null
  editable: boolean;             // source==="env" ⇒ false，见 §5
}
```

`fields` 直接由 `getPanelFields()` 映射（R2/AC1）——一次 `.map()`，没有第二张表。

## §2 env 注册表：新增，且带防漂移闸门

新建 `packages/shared/src/schemas/config-env-registry.ts`：

```ts
/** panel 键 → 实际存在读点的 env 变量名。只登记真读的，不登记"看起来该有的"。 */
export const PANEL_ENV_OVERRIDES: Readonly<Record<string, string>> = {
  default_layer_filter: "FABRIC_DEFAULT_LAYER_FILTER",
  fusion: "FABRIC_FUSION",
  nudge_mode: "FABRIC_NUDGE_MODE",
  underseed_node_threshold: "FABRIC_UNDERSEED_NODE_THRESHOLD",
};
```

配一条**普查测试**：扫 `packages/*/src` + `.claude/hooks`，抽出所有被实际读取的 `FABRIC_*` 名，与 panel 键集合求交，断言结果恰等于注册表。

这条测试是本设计里唯一的防漂移机制，也是对 D2 教训的直接回应：**15-vs-12 那次漂移之所以能潜伏，正是因为"声明"和"实现"是两张互不校验的表。** 一张新表如果没有闸门，就是在重造同一个坑。闸门的方向要双向——注册表多登记（宣称有 env 但没人读）和少登记（新加了读点没登记）都要红。

命名约定不做隐式推导（`key.toUpperCase()` 前缀 `FABRIC_`）：4 个里已有 `default_layer_filter → FABRIC_DEFAULT_LAYER_FILTER` 恰好符合、而将来任何一个不符合的都会静默错配。显式表 + 普查闸门比约定更便宜。

## §3 真值来源：扩 `resolveEffective`，不新建

`resolveEffective` / `loadPanelContext` / `writeFieldValue` 现在是 `commands/config.ts` 的模块私有函数。控制台与 CLI 同在 `packages/cli`，所以：

1. 把三者移到新文件 `packages/cli/src/console/config-resolve.ts` 并导出；`commands/config.ts` 改为 import。
2. 在 `resolveEffective` 的最前面插入 env 层：查注册表 → `process.env[name]` → 过 `field.validate()` → 命中则 `source: "env"`。
3. `ValueSource` 联合类型加 `"env"`；i18n 加 `cli.config.source.env`（两语种，与既有 5 个 source 键同块）。

**CLI 面板因此同时变准**——这是刻意的。若只让控制台懂 env，就会出现"网页说 env，CLI 说 machine-wide"，正是 R4 要防的第二套状态。R4 的实现方式是共享函数，不是两处各自实现同一份逻辑。

搬迁必须是**逐字节搬迁**：函数体不改一行（除 env 层是新增的），先搬后改，两步分开提交内的两次编辑，这样 diff 可读。

## §4 secret：从"掩码"改为"结构上不可能出现"

§0.4 说明了直接实现 AC5 会得到空断言。采用的方案是两件事：

**(a) 远程嵌入只显示存在性，不显示任何值。**

```ts
interface RemoteEmbeddingView {
  configured: boolean;      // embed_remote 存在
  endpointHost: string | null;  // 仅 hostname，无路径无 query
  hasApiKey: boolean;       // 只报有无
  model: string | null;     // 模型名不是 secret
}
```

用户真正关心的是"我的召回现在走本地还是远程、key 配没配"——这个信息量给足了，而 key 原文一个字节都不进响应体。endpoint 只取 hostname 是因为完整 URL 的 query 段有携带 token 的先例。

**(b) 一条 canary 负向测试。** fixture 里写入可识别的假 key（`sk-CANARY-DO-NOT-LEAK-0001`），断言 `/api/config` 响应体全文与配置页 HTML 全文均不含该字符串。

canary 的价值在于它**不依赖字段清单**：将来谁把 global config 整个对象 dump 进响应（最可能的泄漏方式，而且是逐字段掩码防不住的），这条会红。逐字段掩码只能防住你已经想到的字段。

本任务**不提供 secret 的编辑入口**。写入 API key 需要"只写不读回"的完整语义（确认改没改成、误触不清空），值不抵成本；`fabric config` 与直接编辑 global config 都是现成路径。

## §5 写：POST /api/config

复用 shell 已建立的 `WRITE_ROUTES` 路由表门禁（POST-only + loopback Origin），加一条路由即可——新端点自动继承，不需要在 handler 里写任何校验。

请求 `{ key, value, scope? }`：

- `key` 必须命中 `getPanelFieldByKey`，否则 400。**不接受任意配置键**——与 `/api/open` 收 id 不收路径同一个理由：可写集合由构造封闭，而不是靠校验写对。
- `value` 过 `field.validate(String(value))`，用它的返回值落盘（不是用请求里的原值）。
- `scope`: `"project" | "defaults"`，仅 `home === "preference"` 时有意义。**UI 必须让用户显式选**，不替他决定——"改这一个项目"和"改这台机器所有项目"后果差一个数量级。`corpus` / `global_root` 无选择项。
- `source === "env"` 的字段：**禁止编辑，返回 409**，并说明当前值由环境变量顶着、写进配置文件不会生效。这是本页面存在的意义的一次具体兑现——静默写一个不生效的值，正是 KT-MOD-0004 说的最难排查的那类故障。

写入走 `writeFieldValue`，它内部已用 `mutateGlobalConfig` / `atomicWriteJson`（C1 满足，不新增写文件方式）。

## §6 页面

`templates/console/config.html`，沿用 shell.css 令牌与导航。按 `group` 分四段，每行：标签 / 生效值 / 来源徽章 / 编辑控件（`select` 或 `text`，由 `widget` 决定）。

- 来源徽章用不同底色区分 `env`（警示色，因为它意味着不可编辑）与其余。
- `envVar !== null` 的行，即使当前未生效也标注"可被 `FABRIC_X` 覆盖"——用户排查"我改了怎么没用"时，这一行是答案。
- 无 `projectId` 时，scope 选择器禁用并说明原因（未绑定 store，还没有 project_id）；无 store 时，corpus 类字段只读并说明。

**i18n（C3）**：字段标签/描述/来源标签由服务端 `t()` 渲染后进 `ConfigFieldView`（前端零 i18n 逻辑）。页面 chrome 文案（分组标题、按钮、错误提示，约 10 条）同样由 `/api/config` 的 `strings` 字段带下来，而不是像 `status.html` 那样硬编码中文——`status.html` 那种写法在 `language: en` 的机器上会渲染成中英混排。这是本任务内顺手补齐的一致性，不回头改 `status.html`（那属于父任务的 i18n 收口）。

## §7 不做

- 配置版本历史 / 回滚（PRD Out of Scope）。
- 跨项目批量改（同上；`console-version-upgrade` 会碰到跨项目，但那是版本不是配置）。
- cadence profile 档位切换（CLI 有 `__profile__` 入口）。四键联动的 UI 语义比单键复杂，等单键路径验证过再说。
- secret 编辑（§4）。
- 把 `resolveEffective` 提到 `@fenglimg/fabric-shared`：server 侧有自己的 `resolvePreference` / `resolveCorpus`，三方合一是独立的重构，不在本任务背。

## §8 文档与知识条目修订（AC6）

**本任务内做**（代码仓内，无需额外授权）：

- 重写 `docs/configuration.md`：per-class 模型、正确的全局配置文件名、删掉 "Repo overrides are allowed" 与 `store_knob_repo_override`、补 4 个 env 键的实际覆盖面。

**需用户同意后才做**（写共享 team store，KT-GLD-0020）：

- `KT-MOD-0002` —— 层级模型已过期且与 KT-MOD-0004 冲突，应 modify 或 retire。
- `KT-PIT-0081` —— 白名单已删，陷阱结构性失效，应 retire。

这两条挂起、不阻塞实现。设计文档里记下结论，用户点头再走 `fabric-review`。

## §8.5 已知缺口：导航条 i18n（C3 未全绿）

页面**正文**服务端按 `language` 渲染，`en` 机器实测通过（字段标签 / 描述 / 来源标签 / 按钮 / env 提示全英文）。**导航条不是**——`config.html` / `graph.html` / `status.html` / `lumen.html` 四个模板各自硬编码中文 `Fabric 控制台 / 知识 / 关联图 / 状态 / 配置`，`en` 机器上是中文导航配英文正文。

不在本任务修的理由：这是 shell 层先有的缺口（本页只是复制了既有导航），修法是把导航抽成一处并随数据下发字符串，会动到 `lumen.html`——父任务显式列为 out of scope（"迁 lumen.html 到 shell.css tokens" 同批）。跨 4 个模板改导航结构，混在配置页的 diff 里既难 review 也难回滚。

处理：记为父任务待办（与"`fabric preview` → `fabric console` 改名"、"lumen.html 迁 tokens"同一批 shell 收尾），**不在验收里声称 C3 全绿**。

## §9 风险

| 风险 | 处理 |
| --- | --- |
| 搬 `resolveEffective` 出 `config.ts` 时改动行为 | 逐字节搬迁；CLI 既有 config 测试即回归网 |
| env 普查测试自身有假阴性（正则漏读法） | 带对照组：注册表里故意抽掉一个跑一次，必须红 |
| 页面显示的值与 hook 实际读的不一致（hook 无 env 层，server 有） | 注册表按**读点**登记而非按变量名存在登记；`nudge_mode` 的读点在 hook，`fusion` 在 server，两者语义都成立 |
| 写入后页面不刷新，用户以为没生效 | 写成功后重新拉 `/api/config` 重渲染，不做乐观更新 |

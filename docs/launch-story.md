# Fabric v1.0 首发叙事

> 人机协作的语义共识平面
>
> The Consensus Plane for AI-Human Collaboration（AI–Human 协作的共识平面）

这份文档把 `.workflow/.analysis/ANL-fabric-product-2026-04-19/v1.0-launch-story.md`
中的 1279 行首发脚本，压缩成一个可公开阅读的三幕版本。
它保留维护者视角、关键技术演示和版本边界，
同时移除重复铺陈，方便团队直接分发给评审、设计和文档读者。

## 参考用户画像

我是一个 6 人 Cocos Creator 游戏团队的仓库维护者。
我们在做一个狼人杀小项目。
团队会交替使用 Claude Code、Cursor、Codex、Windsurf、Roo 和 Gemini。

我的真实问题不是 AI 不会写代码。
我的问题是，不同 AI 很容易把同一个仓库理解成不同的东西。

我需要的是一套能被织进仓库、分发给多个客户端、并持续可见的规则面：

- `fab init` 负责先落规。
- MCP 负责按路径分发规则。
- Dashboard 在后续版本负责把规则生态展开给维护者看。

这就是 Fabric 的产品起点。

## 第一幕：Day 1 上午，`fab init` 把规则先织进去

周一上午，我把狼人杀仓库切到一个干净分支。
项目里还没有 `AGENTS.md`，也没有 `.fabric/`。
我没有先开文档，也没有先找 AI 聊需求，
而是直接在仓库根目录执行：

```bash
fab init
```

我期待它一次完成三件事：

1. 识别项目是什么。
2. 把最小协议骨架写进仓库。
3. 明确告诉我下一步如何把语义初始化交给 AI 客户端。

下面这段中文化 stdout，就是第一幕的核心体验：

```text
$ fab init

Fabric v1.0 · control plane

正在扫描项目根目录...
检测到项目类型: Cocos Creator 3.8 TypeScript Component project
检测依据:
  - project.config.json
  - creator.version = 3.8.0
  - assets/scripts/*.ts
  - @ccclass + extends Component

正在生成证据包...
证据包摘要 / `.fabric/forensic.json`
  - `framework.kind`: `cocos-creator`
  - `framework.version`: `3.8.0`
  - `framework.subkind`: `typescript-component`
  - `entry_points[0].path`: `assets/scripts/Game.ts`
  - `topology.by_ext[".ts"]`: 3
  - `recommendations_for_skill`: 6 items

Created `AGENTS.md`
Created `.fabric/agents.meta.json`
Created `.fabric/human-lock.json`
Created `.fabric/forensic.json`

正在安装 Claude Code 初始化接力...
Installed `.claude/skills/agents-md-init/SKILL.md`
Installed `.claude/hooks/agents-md-init-reminder.cjs`
Created `.claude/settings.json` with Claude Stop hook

Reason: `.fabric/forensic.json` is ready; use the `agents-md-init` skill to finish `AGENTS.md` initialization.
```

这一屏真正重要的地方，不只是它创建了几个文件。
真正关键的是，Fabric 把“项目识别结果”和“下一步 AI 接力”放进了同一条链路。

它先快、先准、先非破坏性落盘：

- `.fabric/forensic.json` 作为证据包。
- fallback `AGENTS.md` 作为最低契约。
- `.claude/skills/agents-md-init/SKILL.md` 作为语义初始化入口。
- `Reason:` 行保留英文 protected token，方便 AI 客户端稳定复用。

随后我在 Claude Code 里只需要输入一句普通的话：

```text
我刚执行了 fab init，请使用 agents-md-init 完成当前项目初始化。
```

后面的访谈并不是泛泛而谈，而是围绕三个步骤展开：

- Framework Confirm
  明确项目是 Cocos Creator 3.8、TypeScript、`@ccclass + extends Component`。
- Invariants Extraction
  明确 `.meta` 不可改、`assets/prefabs/**` 与 `assets/scenes/**` 受保护、`update()` 不可 `async`。
- Domain Construction
  把 `Game.ts` / `Player.ts` / `Network.ts` 组织成可落盘的仓库语义结构。

第一幕证明的事情很简单：
Fabric v1.0 不是“再来一个 AI 插件”，
而是第一次用一个明确的 CLI 动作，
把规则、依据和后续接力动作写进仓库。

## 第二幕：狼人杀样例把规则写成真实 `AGENTS.md`

第一幕解决的是“怎么开始”。
第二幕解决的是“开始之后，规则长什么样”。

这里的样例不是说明书，也不是一个抽象模板。
它是一个可以放进 `examples/werewolf-minigame-stub/AGENTS.md`
的真实仓库契约。

这个样例保留了 Fabric v1.0 的几条关键原则：

- 维护者看得懂。
- AI 执行得了。
- MCP 分发时不会因为语言混杂而丢掉 hard rules。

它的骨架包含四层：

1. Repository Identity
   说明项目类型、语言策略、`@fenglimg/fabric-*` 命名约定和三面分工。
2. Hard Rules
   用英文明确 `MUST` / `NEVER`，例如必须保留 `@ccclass` 身份、不得编辑 `**/*.meta`。
3. Working Contract
   明确中文解释层服务维护者，英文硬约束服务 AI。
4. Explanation Layer
   用中文解释狼人杀项目里最容易被 AI 误判的语义边界。

对狼人杀仓库来说，真正需要保护的不是文件行数，
而是玩法语义：

- `Game.ts` 承担昼夜回合推进与胜负判定。
- `Player.ts` 代表身份、公开信息、私有信息和行动能力。
- `Network.ts` 是传输边界，不是玩法真相源。

在公开样例里，我们进一步把这套约束展开成 5 个角色 agent：

- Villager
- Werewolf
- Seer
- Witch
- Hunter

这样做有两个目的。

第一，它让维护者可以直接看懂“多人语义协作”在 Fabric 里的落地形状。
第二，它把样例从“文件保护规则”推进到“角色职责与通信协议”，
更适合作为 Day 7 E2E 夹具和产品演示材料。

第二幕成立，意味着 Fabric 已经不是只会生成骨架文件。
它已经能给出一个带有真实项目语义的仓库契约，
并且这个契约既能被人读，也能被 AI 客户端执行。

## 第三幕：Dashboard 把规则生态展开给维护者看

第三幕属于 v1.1，不属于 v1.0 的硬发布承诺。
但它是 v1.0 首发叙事必须明确展示的下一步。

如果第一幕是“把规则织进去”，
第三幕就是“把规则展开给维护者看”。

我运行：

```bash
fab serve
```

当前实现会在本地打印类似输出：

```text
Fabric Dashboard: http://127.0.0.1:7373
```

Dashboard 的角色不是第二个编辑器，
也不是另一个配置中心。
它是 observability plane。

在首发叙事里，它至少要把三种状态清楚展开：

### 1. Ledger View

维护者需要先看到最近的协作轨迹，而不是只看原始 commit。
Dashboard 应该把 AI 与 Human 的意图按时间线交错展示，
让我知道：

- 是谁先动的。
- 改动大概落在哪个语义边界。
- 是否已经发生过人类确认。

### 2. Rules View

维护者第一次打开页面时，最想确认的是
“当前仓库规则到底长什么样”。

Rules View 应该把 `AGENTS.md` 层级、版本哈希、最近 `sync-meta`
时间以及每个 scope 的状态显式展示出来，
让静态规则第一次具备结构树视角。

### 3. Agents View

维护者需要知道，不同 agent 在当前仓库里各自负责什么。
对于狼人杀样例来说，这意味着可以看到 villager、werewolf、seer、
witch、hunter 的职责边界，以及它们共享的通信协议与冲突处理方式。

这三个视角合在一起，才构成“规则生态”的第一眼。

第三幕真正要传达的，不是界面有多漂亮，
而是维护者第一次能在一个屏幕里同时看到：

- 规则树是否同步。
- 人类锁是否漂移。
- ledger 是否持续追加。
- 多客户端是否真的工作在同一套语义契约上。

更完整的页面结构、截图占位和功能说明，
已经拆分到 [Dashboard Tour](./dashboard-tour.md)。

## 从 v1.0 到 v1.2 的演进线

这三幕合起来，正好对应 Fabric 的产品演进线：

- v1.0 = Control Plane MVP
  先让维护者完成安装、识别、落规和 AI 接力。
- v1.1 = Observable Maintenance
  让维护者持续看见规则、锁和意图的状态。
- v1.2 = Portability & Trust
  让规则可以被迁移、被审计、被验证、被信任。

这条路线不是从一串功能点里拼出来的。
它是从维护者每天真实面对的问题推出来的：

1. 先把规则织进去。
2. 再把规则看见。
3. 最后让规则可迁移、可验证、可持续发布。

## 相关文档

- [快速开始](./getting-started.md)
- [初始化说明](./initialization.md)
- [Dashboard Tour](./dashboard-tour.md)
- [Roadmap](./roadmap.md)

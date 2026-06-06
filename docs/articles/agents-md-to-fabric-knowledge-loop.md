# 从 AGENTS.md 到 Fabric：给 AI Coding Agent 补上工程知识闭环

AI Coding Agent 越来越强，但在真实工程里，我逐渐感受到一个反复出现的问题：Agent 能写代码，能读文档，能执行任务，但它很难稳定地“记住”一个项目长期积累下来的工程经验。

每次新会话开始，它都像重新加入项目一样，需要重新理解目录结构、技术栈、架构约定、历史决策和踩坑经验。于是很多团队开始使用 `AGENTS.md`、`CLAUDE.md`、`.cursor/rules` 这类规则文件，把项目约定写下来，让 AI 在每次对话中先读取这些规则。

这确实是一个重要起点。但我在实践中逐渐意识到：`AGENTS.md` 解决了“AI 应该读什么”的问题，却没有完整解决“知识如何持续沉淀、审核、治理和复用”的问题。

Fabric 就是沿着这个问题继续往下走的一次工程实践。

它不是要替代 `AGENTS.md`，而是想补上 `AGENTS.md` 缺失的那部分闭环：让项目知识能在 Claude Code、Codex CLI、Cursor 等 AI Coding Agent 之间持续流动，并在日常开发中被提取、审核、复用和治理。

## 一、从 AGENTS.md 开始：静态规则还不够

`AGENTS.md` 的价值很清晰。

它可以作为 AI Coding Agent 的项目级入口，告诉 Agent：

- 当前项目的硬性约束是什么；
- 技术栈、目录结构、命名规范是什么；
- 哪些文档需要按需读取；
- 哪些模块有额外的局部规则；
- 修改代码后需要同步更新哪些说明。

一个合理的 `AGENTS.md` 结构通常不会把所有内容都塞进去，而是采用两层设计：

```text
project-root/
├── AGENTS.md
├── docs/
│   ├── guides/
│   ├── api/
│   ├── components/
│   ├── conventions/
│   └── troubleshooting/
└── src/
    └── components/
        ├── ui-dialog/
        │   ├── AGENTS.md
        │   └── docs/
        └── data-table/
            └── AGENTS.md
```

根目录的 `AGENTS.md` 始终加载，负责放硬规则、关键约定和文档索引。更详细的说明放在 `docs/` 中，由 Agent 根据任务按需读取。复杂模块也可以有自己的 `AGENTS.md`，形成一棵轻量的项目知识树。

这套设计比把所有内容塞进一个超长规则文件要好得多。它减少上下文浪费，也让文档更容易维护。

但它仍然有几个问题。

第一，`AGENTS.md` 主要是静态入口。它能告诉 Agent“现在有哪些规则”，但不会自动判断一次开发过程里出现了什么新经验。

第二，它依赖人工维护。代码改了、架构变了、踩坑了，如果没有人主动更新，文档很快就会过时。

第三，不同 AI 工具之间容易分叉。Claude Code 有 `CLAUDE.md`，Cursor 有 `.cursor/rules`，Codex 有自己的配置和 skill 目录。规则一旦分散，就会出现“这个工具知道，那个工具不知道”的问题。

第四，它缺少知识生命周期。一条经验是临时判断、单次踩坑，还是已经被多次验证的稳定规则？它过期了吗？被引用过吗？应该提升、降级，还是归档？这些都不是 `AGENTS.md` 自己能解决的。

所以我开始把问题从“如何写好 `AGENTS.md`”推进到另一个层面：

> 能不能让 `AGENTS.md` 继续作为入口，同时为它补上一套工程知识闭环？

这就是 Fabric 的起点。

### 图 1：AGENTS.md 两层项目知识架构

```text
生成一张中文技术架构图，主题是“AGENTS.md 两层项目知识架构”。

画面展示一个项目目录树：
根目录有 AGENTS.md，旁边标注“始终加载：硬性约束、关键约定、文档索引”。
AGENTS.md 向下连接 docs/，docs/ 下有 guides、api、components、conventions、troubleshooting。
src/components/ 下展示 ui-dialog/AGENTS.md 和 data-table/AGENTS.md，表示模块级 AGENTS.md。
右侧放一个 AI Coding Agent，标注 Claude Code、Cursor、Codex、Copilot 等工具都可以读取这套结构。
底部用一行强调：“硬性约束始终加载，详细知识按需读取”。

风格：白底，工程文档风，清晰目录树，细线连接，中文标签，专业简洁，不要卡通，不要复杂背景。
画幅：16:9 横版，适合技术博客正文大图。
```

## 二、从腾讯文章得到的启发：Harness 不是目的，知识才是核心

后来我看到腾讯技术工程的一篇文章，核心观点是：Harness Engineering 的重点不应该只是工作流编排，而应该是知识沉淀。

这点对我触动很大。

现在讨论 AI 工程化时，很多注意力会放在这些问题上：

- 要不要多 Agent 协同；
- 要不要做 16 阶段工作流；
- 要不要给 Agent 加状态机；
- 要不要做自动测试、自动 review、自动发布；
- 要不要搭一个更复杂的 harness。

这些都重要，但它们更像是“管道”。真正能长期产生复利的，是管道里流动的知识。

一次架构决策、一次线上事故、一次调试踩坑、一个团队约定、一个业务流程，如果没有沉淀下来，下次 Agent 还是会重新推导，甚至重新犯错。反过来，如果这些知识能被持续积累、审核和复用，后面的每一次 AI 开发都会站在前一次的基础上。

腾讯文章里有几个概念，我认为非常值得吸收。

第一是知识类型化。工程知识不是一团模糊的文档，它可以拆成不同类型：

- `decision`：为什么选择这个方案，而不是另一个方案；
- `pitfall`：哪里容易踩坑，为什么这个坑不明显；
- `guideline`：未来类似场景应该怎么做；
- `model`：系统、领域、模块的心智模型；
- `process`：有顺序要求的流程和操作步骤。

Fabric 当前也采用类似的五类知识，只是目录名使用复数形式：

```text
.fabric/knowledge/
├── decisions/
├── pitfalls/
├── guidelines/
├── models/
└── processes/
```

第二是成熟度。知识不是写下来就天然可信。Fabric 当前 schema 使用三种成熟度：

- `draft`：刚提取出来，仍然需要验证；
- `verified`：已经被验证，可以被正常参考；
- `proven`：经过更充分验证，具有较高可信度。

第三是生命周期。知识需要进入、审核、提升、降级和归档。否则知识库只会越来越大，最后变成另一个没人敢信的文档堆。

第四是按需消费。Agent 不应该在每次会话里一次性读取全部知识，而应该根据当前任务、当前文件路径、当前意图，先拿索引，再读取相关条目。

这些概念成为 Fabric 的基础。

但 Fabric 没有照搬腾讯文章里的所有设计。它做了很多简化和取舍。

比如，腾讯文章里有更重的多层知识存储模型，而 Fabric 当前只保留了双根结构：

```text
<repo>/.fabric/      # team knowledge，随项目走
~/.fabric/           # personal knowledge，跨项目个人偏好和经验
```

项目内的 `.fabric/` 存团队知识，个人目录下的 `~/.fabric/` 存个人知识。这个结构比五层模型轻很多，也更适合先把闭环跑起来。

再比如，腾讯文章强调工作流阶段里的知识注入，而 Fabric 当前选择了 harness-agnostic 的路线。它不要求你必须使用某个 16 阶段工作流，也不绑定某个 IDE 或 Agent 框架，而是通过现代 AI 工具普遍支持的能力接入：

- MCP tools；
- Stop hook；
- SessionStart / PreToolUse 类 hook；
- Skill 模板；
- CLI 命令。

也就是说，Fabric 吸收的是“知识闭环”的内核，剔除的是“重型工作流编排”的外壳。

还有一些腾讯文章中的设计，在 Fabric 中暂时没有实现，而是放到了后续规划中。例如独立的 `team-knowledge.git`、三角色权限模型、跨 repo 团队知识分发等，目前属于 v2.1 方向。Fabric v2.0 更聚焦于单 repo、跨客户端、本地优先的知识闭环。

所以，Fabric 对腾讯文章的理解可以概括成一句话：

> 工作流不是目的，知识 sustainment 才是目的。Fabric 先把知识从“被写下”推进到“能被持续消费、审核和治理”。

### 图 2：腾讯方法论与 Fabric 取舍对比

```text
生成一张中文对比架构图，主题是“从腾讯 AI Team 知识方法论到 Fabric 的轻量化取舍”。

左侧标题：腾讯文章方法论。
左侧展示：五层知识存储、五种知识类型、三级成熟度、16 阶段工作流、团队知识库、远程接管。

右侧标题：Fabric 当前实现。
右侧展示：双根知识库 .fabric/ 和 ~/.fabric/、五种知识类型 decisions/pitfalls/guidelines/models/processes、三级成熟度 draft/verified/proven、MCP + CLI + Hooks + Skills、archive → review → promote → doctor lint 闭环。

中间用箭头分三类：
“吸收”：知识类型、成熟度、生命周期治理、按需消费。
“简化”：五层存储 → 双根 team/personal，16 阶段 → harness-agnostic hooks。
“暂缓”：team-knowledge.git、角色权限、远程接管。

风格：技术白皮书插图，左右对比，少量颜色区分，中文清晰，专业克制。
画幅：16:9 横版，白底，避免卡通人物，避免复杂背景。
```

## 三、Fabric 当前的产品形态：CLI、MCP、Hooks、Skills

Fabric 当前的定位是：

> 一个面向 AI Coding Agent 的跨客户端知识 sustainment 层。

它不替代 Claude Code、Codex CLI、Cursor，也不强制你使用某个固定工作流。它提供的是一套围绕知识的基础设施，让不同 AI 客户端可以通过同一套协议读写项目知识。

Fabric 的核心由四个入口组成：CLI、MCP、Hooks、Skills。

### 1. CLI：给人和脚本使用

CLI 是确定性的命令行入口，不依赖 LLM 判断。

当前项目公开的主命令包括：

```bash
fabric install
fabric serve
fabric doctor
fabric uninstall
fabric config
fabric plan-context-hint
fabric onboard-coverage
```

`fabric install` 是标准入口。它会扫描项目，安装 Fabric 需要的目录、hooks、skills 和客户端配置，并生成初始知识结构。

常用参数包括：

```bash
fabric install --yes
fabric install --dry-run
fabric install --force-skills-only
```

其中 `--dry-run` 用于只看计划不写文件；`--force-skills-only` 用于在已有 Fabric 项目里只刷新三个 Skill 模板，不重跑完整安装流程。

`fabric serve` 用来启动本地服务，默认端口是 `7373`。当前实现默认监听 `127.0.0.1`；如果要绑定非 loopback host，需要设置 `FABRIC_AUTH_TOKEN`，否则会回退到本地地址。

`fabric doctor` 是治理入口，用来检查知识库、事件、索引、hook、schema 等状态。它支持只读检查，也支持确定性修复：

```bash
fabric doctor
fabric doctor --json
fabric doctor --strict
fabric doctor --fix
fabric doctor --fix-knowledge
fabric doctor --cite-coverage
fabric doctor --archive-history
fabric doctor --enrich-descriptions --auto
```

CLI 适合做安装、检查、升级、CI 和本地维护。

### 2. MCP：给 Agent 使用

MCP 是 Fabric 的运行时协议层。Agent 不应该靠硬编码读 `.fabric/`，而应该通过 MCP 获取和写入知识。

当前核心工具是四个：

```text
fab_plan_context
fab_get_knowledge_sections
fab_extract_knowledge
fab_review
```

其中：

- `fab_plan_context`：根据当前任务和路径，返回相关知识候选、`selection_token` 和描述索引；
- `fab_get_knowledge_sections`：根据 `selection_token` 和选中的 `stable_id` 拉取具体知识正文；
- `fab_extract_knowledge`：把一次会话中值得保留的经验写入 `.fabric/knowledge/pending/<type>/`；
- `fab_review`：对 pending 知识执行 `list` / `approve` / `reject` / `modify` / `search` / `defer`。

MCP 不是给用户日常手动调用的入口，而是 Agent、Skill 和 hook 背后的底层能力。

### 3. Hooks：在关键时机提醒

Fabric 不希望完全依赖用户记得“该沉淀知识了”。所以它通过 hook 在关键节点提醒 Agent。

当前安装模板覆盖 Claude Code、Codex CLI 和 Cursor 三端。核心 hook 包括：

- `fabric-hint.cjs`：Stop 阶段触发，用于 archive / review / import 三类提醒；
- `knowledge-hint-broad.cjs`：SessionStart 阶段触发，用于会话开始时提供 broad knowledge hint；
- `knowledge-hint-narrow.cjs`：PreToolUse 阶段触发，在 `Edit|Write|MultiEdit` 前提供路径相关的 narrow knowledge hint；
- `cite-policy-evict.cjs`：Claude Code 的 UserPromptSubmit 阶段触发，用于长会话 cite policy 的提示治理。

Stop hook 的重点是判断：

- 是否距离上次 `knowledge_proposed` 已超过配置阈值，推荐 `fabric-archive`；
- pending 队列是否过多或过旧，推荐 `fabric-review`；
- 项目知识节点过少且初始化后已过一段时间，推荐 `fabric-import`。

这个设计很重要：hook 只负责提醒，真正的判断交给刚经历过上下文的 AI。

### 4. Skills：给 AI 做复杂判断

Skill 是 Fabric 中最贴近用户日常使用的一层。它不是底层 API，而是一套让 AI 在会话中执行复杂判断的工作流模板。

当前核心 Skill 有三个：

```text
fabric-archive
fabric-review
fabric-import
```

`fabric-archive` 用于从一次或多次会话中提取值得保留的知识。它会判断哪些内容真的值得归档，并分类为 decisions、pitfalls、guidelines、models 或 processes，然后通过 `fab_extract_knowledge` 写入 pending。

`fabric-review` 用于审核 pending 或 canonical knowledge。它会根据上下文推断 review mode，并通过 `fab_review` 执行 approve、reject、modify、search、defer 等动作。真正涉及单条知识取舍时，它会把选择交给用户判断。

`fabric-import` 用于历史项目冷启动。它会从已有项目资料中提取候选知识，带 checkpoint 支持，帮助老项目从 0 到 1 建立知识库。

### 5. 知识存储：双根结构

Fabric 的知识文件仍然是 Markdown，不是黑盒数据库。

项目级知识放在：

```text
.fabric/knowledge/
```

个人级知识放在：

```text
~/.fabric/knowledge/
```

这意味着你可以直接用 Git 管理、审查、比较和迁移这些知识。MCP、CLI 和 Skill 是更方便的入口，但底层仍然是可读、可版本化的文件。

Fabric 当前的整体分工可以概括为：

> CLI 负责安装和治理，MCP 负责运行时知识读写，Hook 负责触发提醒，Skill 负责让 AI 做需要判断的知识提取与审核。

### 图 3：Fabric 产品架构总览

```text
生成一张中文产品架构图，主题是“Fabric 的四个产品入口”。

中心是 Fabric Knowledge Layer。
下方是知识存储：.fabric/knowledge 作为 team knowledge，~/.fabric/knowledge 作为 personal knowledge，包含 decisions、pitfalls、guidelines、models、processes、pending、events.jsonl。

左侧是 CLI，列出 fabric install、fabric serve、fabric doctor、fabric config、fabric plan-context-hint、fabric uninstall。
上方是 AI Clients，包含 Claude Code、Codex CLI、Cursor。
右侧是 MCP，列出 fab_plan_context、fab_get_knowledge_sections、fab_extract_knowledge、fab_review。
右下是 Skills，列出 fabric-archive、fabric-review、fabric-import。
左下是 Hooks，标注 SessionStart、PreToolUse、Stop、UserPromptSubmit，并列出 knowledge-hint-broad、knowledge-hint-narrow、fabric-hint、cite-policy-evict。

用环形箭头展示：读取相关知识 → 执行任务 → hook 发现沉淀机会 → archive 写入 pending → review 审核 → doctor 治理 → 下次任务复用。

风格：现代工程架构图，白底，分区明确，中文标签，不要营销海报风。
画幅：16:9 横版，适合技术博客正文大图。
```

## 四、日常怎么用：从安装到知识闭环

Fabric 的使用可以分成两类：首次接入和日常循环。

### 1. 首次接入

安装 CLI：

```bash
npm install -g @fenglimg/fabric-cli
```

进入目标项目：

```bash
cd <your-project>
fabric install
```

如果希望非交互执行：

```bash
fabric install --yes
```

如果只想看安装计划，不写文件：

```bash
fabric install --dry-run
```

安装后，Fabric 会完成几件事：

- 创建或刷新 `.fabric/` 目录；
- 安装 `fabric-archive`、`fabric-review`、`fabric-import` 三个 Skills；
- 安装三端 hook 脚本和对应配置；
- 写入或合并 AI client 所需配置；
- 扫描项目生成 baseline knowledge；
- 建立 `.fabric/events.jsonl` 事件账本；
- 同步 `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` 中的 Fabric 指针。

然后启动服务：

```bash
fabric serve
```

默认本地地址是：

```text
http://127.0.0.1:7373
```

再检查状态：

```bash
fabric doctor
```

### 2. 日常开发循环

一次典型的 Fabric 使用闭环是这样的：

```text
安装 Fabric
  ↓
AI 正常开发
  ↓
SessionStart / PreToolUse hook 提供知识提示
  ↓
Agent 通过 MCP 查询相关知识
  ↓
会话结束时 Stop hook 检测 archive / review / import 信号
  ↓
调用 fabric-archive 提取候选知识
  ↓
候选知识进入 .fabric/knowledge/pending/
  ↓
调用 fabric-review 审核
  ↓
正式进入 .fabric/knowledge/
  ↓
fabric doctor 持续治理
  ↓
下次任务自动复用
```

比如一次真实业务场景：

你在项目里修了一个认证模块的 bug。Agent 在修改 `src/auth/**` 前，PreToolUse hook 先给出路径相关的知识提示。Agent 再通过 `fab_plan_context` 查询和认证相关的历史 decision、pitfall、guideline，并用 `fab_get_knowledge_sections` 拉取真正相关的正文。它发现之前有一条关于 token refresh 的坑，于是避免重复犯错。

这次修复过程中，你又发现一个新的非显然问题：某个边界条件在测试环境不会触发，但生产配置下会导致 refresh token 被提前失效。

会话结束时，Stop hook 发现这次会话可能有沉淀价值，于是提醒调用 `fabric-archive`。

`fabric-archive` 把这条经验整理成一个 pending pitfall：

```yaml
knowledge_type: pitfalls
maturity: draft
summary: refresh token 在生产配置下会被提前失效
relevance_paths:
  - src/auth/**
```

随后你运行或触发 `fabric-review`，确认这条经验确实有价值，于是 approve。它进入正式知识库。

下次任何 Agent 再修改 `src/auth/**` 时，这条 pitfall 就可以被提前注入上下文。

这就是 Fabric 想形成的闭环：不是把知识写进文档就结束，而是让知识在后续任务中继续发挥作用。

### 3. 历史项目冷启动

对于已经存在很久、但没有 Fabric 知识库的项目，可以使用 `fabric-import`。

它不是简单扫描文件名，而是让 AI 基于已有代码、文档、提交历史和项目结构提取候选知识。所有候选知识先进入 pending，之后仍然需要 review。

这避免了一个常见问题：冷启动时一次性导入大量未经确认的“伪知识”，最后污染知识库。

### 4. 知识治理

知识库必须能增长，也必须能清理。

Fabric 使用 `fabric doctor` 做治理：

```bash
fabric doctor
fabric doctor --json
fabric doctor --strict
fabric doctor --fix
fabric doctor --fix-knowledge
```

它会检查：

- pending 是否积压；
- stable id 是否重复；
- index 是否漂移；
- layer 是否不一致；
- stale knowledge 是否需要降级或归档；
- hook 和 skill 是否正确安装；
- events ledger 是否完整。

这一步决定了 Fabric 不是一个“只进不出”的知识收集器，而是一个持续维护知识健康度的系统。

### 图 4：Fabric 日常使用闭环

```text
生成一张中文流程图，主题是“Fabric 日常使用闭环”。

从左到右展示 6 个步骤：
1. 安装接入：npm install -g @fenglimg/fabric-cli，fabric install。
2. 启动服务：fabric serve，连接 Claude Code / Codex CLI / Cursor。
3. 日常开发：SessionStart 和 PreToolUse hook 给出知识提示，Agent 通过 MCP 查询相关知识。
4. 会话结束：Stop hook 检测 archive / review / import 信号。
5. 知识沉淀：fabric-archive 写入 .fabric/knowledge/pending。
6. 人工审核与治理：fabric-review 审核进入正式 knowledge，fabric doctor 检查 stale、duplicate、drift、layer mismatch。

底部画一个循环箭头回到“日常开发”，标注“下次任务自动复用已沉淀知识”。

风格：清晰流程图，适合技术博客正文大图，中文标签，白底，蓝绿点缀，避免复杂插画。
画幅：16:9 横版。
```

## 五、一些取舍和后续规划

Fabric 当前还只是一个初步完成的里程碑，它刻意控制了边界。

它没有做完整的重型工作流平台，也没有试图替代 Claude Code、Cursor 或 Codex。它只做一件事：让 AI Coding Agent 的工程知识能够跨会话、跨客户端、跨时间持续存在。

当前已经比较清晰的能力包括：

- 跨客户端 MCP-first 知识层；
- `.fabric/` 和 `~/.fabric/` 双根知识库；
- 五类知识类型；
- 三阶段成熟度；
- archive → review → promote → doctor lint 闭环；
- CLI、MCP、Hooks、Skills 四个入口；
- 本地优先、文件可读、Git 可管理。

后续还可以继续往几个方向推进。

第一是团队知识分发。当前 team knowledge 主要随项目 `.fabric/` 走，未来可以引入独立的 `team-knowledge.git`，让多个 repo 共享团队知识。

第二是权限边界。当前 review 模型比较轻，未来可以引入 admin、contributor、reader 这类角色，把团队知识库的写入和审核边界做清楚。

第三是更强的语义检索。当前 Fabric 更强调结构化、路径相关和 typed knowledge，后续可以结合向量检索，让 Agent 在复杂任务里更自然地找到相关知识。

第四是更好的 dashboard。`fabric doctor` 已经能做治理，但可视化的知识健康度、pending 队列、引用趋势、过期风险，会让维护体验更直观。

第五是更多客户端适配。Fabric 的目标不是绑定某一个 AI 工具，而是成为 AI Coding Agent 之间共享知识的薄层协议。

## 六、基于当前项目校准的实现边界

这篇文章里的 Fabric 描述按当前项目实现校准，有几个边界需要明确：

- 当前 CLI 公开命令包括 `install`、`serve`、`doctor`、`uninstall`、`config`、`plan-context-hint`、`onboard-coverage`；没有独立公开的 `fabric hooks install` 命令，hook 安装由 `fabric install` 编排完成。
- `fabric install` 的预览参数是 `--dry-run`，不是 `--plan`。
- 当前 MCP tool 名称是 `fab_plan_context`、`fab_get_knowledge_sections`、`fab_extract_knowledge`、`fab_review`。
- 当前 hook 模板覆盖 Claude Code、Codex CLI、Cursor 三端；历史文档里关于 Cursor Stop hook 仍待 v2.1 的说法已经与当前源码不完全一致。
- 独立 `team-knowledge.git`、三角色权限模型仍属于后续规划，不属于当前 v2.0 的已落地能力。

## 结语

`AGENTS.md` 是一个很好的起点。它让 AI Coding Agent 能够读取项目规则，不再完全从零开始。

但真实工程里，仅有规则入口还不够。我们还需要知道：

- 新经验如何被提取；
- 候选知识如何被审核；
- 稳定知识如何被复用；
- 过时知识如何被降级；
- 不同 AI 客户端如何共享同一套项目记忆。

Fabric 想补上的正是这一段。

它把 `AGENTS.md` 从一个静态入口，连接到一个持续运转的知识闭环中：CLI 负责安装和治理，MCP 负责 Agent 运行时访问，Hook 负责提醒，Skill 负责判断，`.fabric/` 负责沉淀。

从这个角度看，Fabric 并不是“又一个文档工具”，而是一次关于 AI 工程知识如何持续存在的实践。

或者说：

> `AGENTS.md` 让 AI 读懂项目规则，Fabric 让项目经验在每一次 AI 开发之后继续留下来。

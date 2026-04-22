# Brainstorm Session

**Session ID**: BS-2026-04-22-cli安装流程优化
**Topic**: CLI 安装流程具体应该怎么优化，能否像当前的 ccw install 一样执行安装；调研当前 CLI 安装 UI 框架是什么、怎么实现
**Started**: 2026-04-22T22:20:43+0800
**Dimensions**: technical, ux, feasibility
**Mode**: Balanced

## Table of Contents
- [Session Context](#session-context)
- [Current Ideas](#current-ideas)
- [Thought Evolution Timeline](#thought-evolution-timeline)
- [Synthesis & Conclusions](#synthesis--conclusions)
- [Decision Trail](#decision-trail)

## Current Ideas
1. **两层安装模型**
   保留 `fabric init` 的非交互脚本模式，同时新增一个向导式安装入口，例如 `fabric install` 或 `fabric init --wizard`，用来承接 `ccw install` 风格的分步选择。

2. **把 Stage 选择显式化**
   当前 `init` 把 scaffold、bootstrap、MCP、hooks、follow-up assets 串成单路执行；可以改成“预检 -> 选项确认 -> 执行 -> 总结”的安装状态机。

3. **沿用轻量命令行交互栈**
   不需要上完整 TUI。若要接近 `ccw install`，更适合引入 `inquirer` 或 `@clack/prompts` 这类 prompt 层，而不是改成 `ink`/React 终端应用。

## Session Context
- Focus areas: Install UX, current UI framework, execution model
- Perspectives: creative, pragmatic, systematic
- Constraints: existing stack unknown, prefer minimal-risk upgrade path, keep non-interactive usage intact
- Mode: Balanced

## Exploration Vectors
1. Fabric 当前 CLI 安装链路实际上是怎样执行的，哪些步骤已经自动化。
2. `ccw install` 的交互模型是什么，是完整 TUI 还是 prompt-driven wizard。
3. Fabric 若要“像 ccw install 一样”，最小变更方案是什么。
4. 哪些能力属于 UI 表层，哪些需要重构安装状态机和安装清单。
5. 保留 CI/脚本可用性的前提下，交互式安装入口该如何设计。
6. Codex/Claude 双生态下，安装体验是否应该统一在一个向导里。

## Initial Decisions
> **Decision**: 以“Install UX 优先，UI 框架识别为配套”作为本轮主线。
> - **Context**: 用户先问“能否像 ccw install 一样执行安装”，UI 框架只是实现手段。
> - **Options considered**: 只看 UI 库；只看安装命令；同时看安装状态机和 UI 层。
> - **Chosen**: 同时看安装状态机和 UI 层。 — **Reason**: 仅知道框架名，不能回答“能不能像 ccw install 一样做”。
> - **Rejected**: 只看视觉/UI 依赖。原因是 Fabric 目前核心问题更像流程编排，而不是缺少彩色输出。
> - **Impact**: 本轮调研聚焦 `fabric init/bootstrap/config/hooks` 与 `ccw install` 的结构差异。

---

## Thought Evolution Timeline

### Round 1 - Exploration (2026-04-22T22:20:43+0800)

#### User Input
用户希望调研两个问题：
- CLI 安装步骤是否可以像当前 `ccw install` 一样执行
- 当前 CLI 安装的 UI 框架是什么、怎么实现

#### Decision Log
> **Decision**: 先做“现状对照”而不是直接提方案。
> - **Context**: 需要先确认 Fabric 当前是否已有交互式安装骨架。
> - **Options considered**: 直接方案化；先对比 Fabric 与 ccw。
> - **Chosen**: 先对比 Fabric 与 ccw。 — **Reason**: 否则容易把“缺少 prompt”误判成唯一问题。
> - **Rejected**: 直接给方案。原因是可能忽略现有非交互约束。
> - **Impact**: 本轮先梳理命令入口、依赖、状态机和安装摘要模式。

#### Ideas Generated
- **Idea A: Wizard 外挂层**
  在现有 `initFabric()` 和 `installBootstrap/installMcpClients/installHooks` 外包一层安装向导，不改底层安装函数语义。
  novelty: 3/5, feasibility: 5/5

- **Idea B: 新命令拆分**
  保留 `fabric init` 为脚本友好命令，新增 `fabric install` 专做交互式引导和安装选择。
  novelty: 4/5, feasibility: 4/5

- **Idea C: 单命令双模式**
  让 `fabric init` 在 TTY 下默认进入 wizard，在非 TTY 下保持现状。
  novelty: 3/5, feasibility: 3/5

#### Analysis Results
- Fabric CLI 当前基于 `citty` 组织命令树，没有安装 `inquirer`、`ora`、`boxen` 这类交互/引导依赖；依赖更偏轻量参数解析和文本输出，证据见 `packages/cli/package.json` 与 `packages/cli/src/index.ts:1-17`。
- `fabric init` 的执行模型是“参数解析 -> 可选 TTY 摘要 -> 直接写文件 -> 顺序执行 bootstrap/mcp/hooks -> 输出 capability summary”，没有交互式选择或回退分支，证据见 `packages/cli/src/commands/init.ts:106-240`。
- `fabric bootstrap install`、`fabric config install`、`fabric hooks install` 都是单次调用 + stderr 文本回显，不具备 wizard 状态机，证据见 `packages/cli/src/commands/bootstrap.ts:63-107`、`packages/cli/src/commands/config.ts:104-155`、`packages/cli/src/commands/hooks.ts:34-67`。
- `ccw` CLI 基于 `commander` 组织命令，`install` 命令单独路由到 `commands/install.js`，证据见 `/home/fenglimg/.nvm/versions/node/v22.21.1/lib/node_modules/claude-code-workflow/ccw/dist/cli.js:54-108`。
- `ccw install` 不是 React/Ink/TUI 框架，而是 **prompt-driven wizard**：
  - 交互层：`inquirer`
  - 视觉层：`chalk`, `boxen`, `figlet`, `gradient-string`
  - 过程反馈：`ora`
  证据见 `/home/fenglimg/.nvm/versions/node/v22.21.1/lib/node_modules/claude-code-workflow/ccw/dist/commands/install.js:1-11` 与 `.../utils/ui.js:1-128`。
- `ccw install` 的核心优势不是“UI 更花”，而是它显式实现了安装状态机：已有安装检测、mode 选择、target 选择、Codex 子组件勾选、备份确认、hook 安装策略、清理旧 manifest、安装、摘要、后续提醒，证据见 `.../commands/install.js:258-420` 与 `.../commands/install.js:520-805`。

#### Challenged Assumptions
- ~~像 ccw install 一样做，意味着要引入完整 TUI 框架~~ → 不成立
  - Reason: `ccw install` 本身不是 Ink/Blessed 这类完整终端 UI，只是 `commander + inquirer + ora + chalk/boxen` 的向导式 CLI。

- ~~Fabric 当前已经有半套安装向导，只差 UI 美化~~ → 不成立
  - Reason: Fabric 现在只有线性执行和表格摘要，没有交互式状态选择、确认、回退、备份、组件勾选等流程节点。

#### Open Items
- 是否应新增独立 `fabric install`，而不是继续扩展 `fabric init`。
- 是否值得引入 `inquirer`，还是使用更轻的 `@clack/prompts`。
- 交互式安装是否应该统一管理 `bootstrap/config/hooks/follow-up assets` 的目标生态选择。

#### Narrative Synthesis
**Starting point**: 从“能否像 ccw install 一样”出发，本轮先对比 Fabric 与 ccw 的真实安装结构。  
**Key progress**: 已确认 Fabric 现状是脚本友好型 one-shot 命令，而 ccw install 是基于 prompt 的多阶段安装向导。  
**Decision impact**: 这意味着优化重点应先放在“安装状态机设计”，UI 库只是在第二层。  
**Current state**: 最强方向是“两层安装模型”或“新增 install 向导命令”，而不是直接把 `init` 染色。  
**Open directions**: 下一轮若继续，可以深挖 `fabric install` 的命令形态、交互节点、以及 `inquirer` vs `@clack/prompts` 的取舍。

### Round 2 - Reframe (2026-04-22T22:24:00+0800)

#### User Input
用户允许破坏性重做，明确表示可以直接替换 `init` 流程，不必优先考虑兼容性，并希望一起考虑新的更好设计。

#### Decision Log
> **Decision**: 将目标从“给现有 init 加向导层”升级为“重新定义 init 作为主安装入口”。
> - **Context**: 用户明确放开兼容性约束。
> - **Options considered**: 保守双层模型；彻底重定义 `fabric init`；新增 install 并弱化 init。
> - **Chosen**: 彻底重定义 `fabric init`。 — **Reason**: 在破坏性改造许可下，这能得到最一致的产品心智。
> - **Rejected**: 继续维护 one-shot 与 wizard 双入口。原因是会长期保留概念重复和文档负担。
> - **Impact**: 后续推荐将以“`init` 变成正式向导和安装状态机入口”为核心。

#### Ideas Generated
- **Idea D: `init` 作为正式安装向导**
  `fabric init` 默认进入 wizard，用户先选择安装模式/目标客户端/组件，再执行。
  novelty: 4/5, feasibility: 4/5

- **Idea E: `init --yes` 作为自动化等价物**
  保留无交互自动安装，但把它降级为 wizard 的自动确认模式，而不是另一套语义。
  novelty: 4/5, feasibility: 5/5

- **Idea F: `scan` 并入 `init` preflight**
  初始化前自动做目标项目检测、风险提示、现有安装发现和建议安装计划。
  novelty: 5/5, feasibility: 4/5

#### Analysis Results
- 现在的 `fabric init` 已经具备足够多的 stage 和总结输出，天然适合升级为状态机入口，而不是继续被视为单纯的“文件写入命令”，证据见 `packages/cli/src/commands/init.ts:152-240`。
- 现有文档已经把 `fabric init` 作为唯一标准 onboarding 入口，这反而支持破坏性重构后继续保留命名不变，只重写体验，证据见 `README.md:30-42` 与 `packages/cli/README.md:5-13`。
- 如果直接重写 `init`，最合理的自动化保留方式不是“旧 init 不动”，而是引入统一的非交互开关，例如 `--yes` / `--default` / `--non-interactive`，让脚本环境复用同一个 install plan 生成器。
- 在这个新设计下，`bootstrap install`、`config install`、`hooks install` 更适合作为“高级重跑/修复子命令”，不再承担主 onboarding 角色，这与当前 README 的“advanced commands”定位是一致的。

#### Challenged Assumptions
- ~~若改造 init，最好新增 install 而不是破坏旧入口~~ → 在当前前提下不再成立
  - Reason: 用户已经允许破坏性替换，而保留两个入口会延续产品心智分裂。

- ~~scan 应继续独立，init 只做执行~~ → 可被打破
  - Reason: 更好的安装体验恰恰需要把扫描、预检、风险提示和计划生成前置到 init 内。

#### Open Items
- wizard 默认是“完整自动安装 + 可回退修改”，还是“先生成安装计划再确认执行”。
- 新的参数模型是否应该围绕 `plan -> confirm -> execute` 组织，而不是继续围绕 `--no-bootstrap/--no-mcp/--no-hooks`。

#### Narrative Synthesis
**Starting point**: 上一轮仍以兼容性为主要约束。  
**Key progress**: 本轮在用户放开兼容性后，把最优方向切换为“直接重写 `fabric init` 体验”。  
**Decision impact**: 这使得推荐从“双层模型”转向“单一主入口 + 自动化 flag”的产品结构。  
**Current state**: 当前最强方案是让 `fabric init` 成为真正的安装向导，并把非交互模式视为 wizard 的自动执行变体。  
**Open directions**: 需要最终明确新 `init` 的阶段设计和参数表面。

---

## Synthesis & Conclusions

### Executive Summary
Fabric 当前的安装体验已经具备“一条命令完成 setup”的能力，但本质上仍是 **线性执行器**，不是 **安装向导**。  
如果目标是“像 `ccw install` 一样执行安装”，真正需要补的是 **状态化交互流程**，而不是仅仅添加彩色输出。

### Top Ideas
1. **新增 `fabric install` 向导命令**
   - strongest: 不破坏 `fabric init` 的脚本/CI 语义
   - challenges: 需要维护一套新的 prompt 状态机

2. **给 `fabric init` 增加 `--wizard`**
   - strongest: 命令心智统一
   - challenges: 容易把“初始化”与“向导安装”耦死，后续参数语义变复杂

3. **只增强现有 TTY preflight**
   - strongest: 改动最小
   - challenges: 很难达到 `ccw install` 那种选择式安装体验

### Primary Recommendation
在当前“允许破坏性重构”的前提下，直接把 **`fabric init` 重定义为主安装向导**。

推荐新模型：
- `fabric init`
  默认进入 wizard
- `fabric init --yes`
  自动接受推荐安装计划并直接执行
- `fabric init --plan`
  只输出安装计划，不落盘
- `fabric init --reapply`
  对已有 Fabric 项目重新跑安装/修复

推荐理由：
- 最统一的产品心智
- 文档和 onboarding 入口仍保持 `init`
- 不再长期维护重复命令
- 可以把 scan/preflight/capability summary 合并成一个完整状态机

### Alternative Approaches
- **双入口路线**: 保留旧 `init`，新增 `install`
  tradeoff: 更稳，但产品长期会有重复入口和文档分裂

- **轻改路线**: 继续沿用当前 `init`，只加 prompts
  tradeoff: 能力表面改善，但结构仍不干净

- **重型 TUI 路线**: 上 Ink/Blessed
  tradeoff: 与问题本质不匹配，工程代价偏高

### Key Insights
- `ccw install` 的本质是 **wizard CLI**，不是 TUI app。
- Fabric 当前缺的是 **安装状态机**，不是“漂亮的 terminal UI”。
- 当兼容性不再是首约束时，最佳方案变成“直接把 `init` 变成安装状态机入口”。

## Decision Trail
- Round 1: 优先比较安装状态机，而非只比较 UI 依赖。
- Round 1: 结论转向“双层安装模型”，而不是直接改造 `fabric init` 的文本输出。

## Session Statistics
- Total rounds: 1
- Perspectives used: creative, pragmatic, systematic
- Ideas generated: 3
- Code artifacts reviewed: 8
- External research: no

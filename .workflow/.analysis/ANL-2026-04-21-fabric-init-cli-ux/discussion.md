# Analysis Discussion

**Session ID**: ANL-2026-04-21-fabric-init-cli-ux
**Topic**: 优化 fabric 当前 init 流程的交互/UI 体验，并收敛 AGENTS.md/CLAUDE.md/GEMINI.md 与 skill 安装策略
**Started**: 2026-04-21T00:00:00+08:00
**Dimensions**: architecture, implementation, comparison, decision
**Depth**: standard

## Table of Contents
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
- [Decision Trail](#decision-trail)
- [Synthesis & Conclusions](#synthesis--conclusions)

## Current Understanding

### What We Established
- 当前 `fab init` 已经包含 3 个后续阶段：`bootstrap`、`mcp`、`hooks`，并且在前置阶段会先落地 `.fabric/*` 和一个 fallback `AGENTS.md`，所以它并非没有流程，而是流程缺少“预览、分支选择、安装意图、验证反馈”这类向导体验。
- 当前 init 对 Claude 有专门的后置安装链路：写入 `.claude/skills/agents-md-init/SKILL.md`、`.claude/hooks/agents-md-init-reminder.cjs` 并 merge `.claude/settings.json`，但对 Codex/Gemini 只停留在 bootstrap 文档层，没有对“skill 是否存在 / 如何安装”给出显式校验或恢复动作。
- 当前 bootstrap 的设计天然会把 Fabric 指南写散到多个客户端外部文件：`CLAUDE.md`、`GEMINI.md`、`AGENTS.md`、`.cursor/rules/*` 等。这导致规则源头不单一，用户也会感知为“init 生成很多看似重复的说明文件”。

### What Was Clarified
- ~~问题是 init 完全没有 UI~~ → 实际上已有阶段性输出和 stage summary，但 UI 只是在执行后打印结果，没有“执行前预览”和“交互式选择”。
- ~~Codex 没有接入 init~~ → 实际上 Codex 已接入 MCP config 与 bootstrap header，但没有接入与 Claude 等价的 skill/后置引导链路，因此体验上是不完整接入。

### Key Insights
- 现在的核心短板不是“缺命令”，而是“状态机不完整”：Fabric 只知道如何写文件，却不知道如何表达 `detected -> selectable -> partially installed -> ready -> needs follow-up` 这些状态。
- 现在的外部多文件不是纯粹 bug，而是“缺少单一事实源”的架构结果。只要继续把不同客户端的引导文本当成主文档，就很难避免 `AGENTS.md/CLAUDE.md/GEMINI.md` 分裂。
- `.codex` 下 skill 缺失本质上是一个产品完整性问题：既然 `resolveClients()` 已经能检测到 `~/.codex`，`fab init` 就应该能在 init 阶段要么安装 Codex 所需 skill，要么明确告诉用户 Codex 只完成到 MCP/config 层，技能层尚未装备。

## Analysis Context
- Focus areas: init CLI UX, bootstrap artifact consolidation, Codex skill parity
- Perspectives: Technical, Architectural
- Depth: standard

## Initial Questions
- 当前 init 的真实阶段是什么，哪些点已经具备，哪些点只是缺呈现？
- bootstrap 为何会把同类说明写到多个外部文件？
- Claude 的 skill 安装链和 Codex/Gemini 的当前能力差在哪里？
- 如果要改成更像 `ccw install` 的体验，最合理的交互状态机是什么？

## Initial Decisions
> **Decision**: 以现有 `init.ts` / `bootstrap.ts` / `config resolver` / 测试为主证据，辅以公开 README 类对比参考。
> - **Context**: 用户关注的是“当前 fabric init 的交互与产物策略是否需要优化”。
> - **Options considered**: 仅基于主观体验分析；基于仓库实现与已有会话分析；额外参考外部 CLI 安装流。
> - **Chosen**: 基于代码与既有分析会话为主，外部参考为辅。 — **Reason**: 这个问题已经在本仓库有前序讨论，且当前行为必须以真实代码为准。
> - **Rejected**: 纯感受式分析，因为容易忽略现有阶段和兼容约束。
> - **Impact**: 结论将更偏重“怎么在当前架构上演进”，而不是完全重做一个新 init。

---

## Discussion Timeline

### Round 1 - Exploration (2026-04-21T00:00:00+08:00)

#### User Input
用户提出两个主要方向：
1. `fabric cli init` 当前控制台初始化流程太简略，希望参考 `npm install -g claude-code-workflow` / `ccw install` 的流程感与 UI 感。
2. 初始化时生成 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md` 在外部，希望收敛到 `.fabric` 内部，尽量只保留一份，或者不生成，具体流程写到 skill 中；同时指出 `.codex` 没有安装相应 skill 的缺陷。

#### Decision Log
> **Decision**: 把问题拆成三条链路分析：`init UX 状态机`、`bootstrap 文档事实源`、`Codex skill parity`。
> - **Context**: 用户的问题表面上是两个点，实际上都指向 init 的产品完整性。
> - **Options considered**: 只分析 UI；只分析文档产物；做整体初始化协议分析。
> - **Chosen**: 整体初始化协议分析。 — **Reason**: 交互设计和文档收敛是同一个状态机问题的两个表现。
> - **Rejected**: 单点修补，因为会得到碎片化建议。
> - **Impact**: 后续建议会以“一次性把 init 设计成多阶段安装向导”为主，而不是只加几行彩色输出。

#### Key Findings
> **Finding**: `fab init` 已经有显式阶段，但它是线性执行型输出，不是面向用户决策的向导。
> - **Confidence**: High — **Why**: `initCommand.run` 先调用 `initFabric()`，再依次执行 `bootstrap`、`mcp`、`hooks`，并打印 stage result 与 summary。证据：`packages/cli/src/commands/init.ts:155-255`。
> - **Hypothesis Impact**: Modifies hypothesis "init 没有 UI"。
> - **Scope**: init CLI 交互层。

> **Finding**: `initFabric()` 仍然把 `AGENTS.md` 作为根级主产物写入 workspace，并把 Claude skill/hook 装到 `.claude/*`；这意味着现在的“真正事实源”同时分布在 workspace 根、`.fabric`、`.claude` 三处。
> - **Confidence**: High — **Why**: 代码直接写 `AGENTS.md`、`.fabric/agents.meta.json`、`.fabric/human-lock.json`、`.fabric/forensic.json`，以及 `.claude/skills/...` 和 `.claude/hooks/...`。证据：`packages/cli/src/commands/init.ts:279-315`。
> - **Hypothesis Impact**: Confirms hypothesis "当前初始化产物太分散"。
> - **Scope**: init 产物布局与信息架构。

> **Finding**: bootstrap 当前是“按客户端复制薄文档”的模式，因此天然会生成 `CLAUDE.md`、`GEMINI.md`、`AGENTS.md` 等多个外部文件。
> - **Confidence**: High — **Why**: `CLIENT_TEMPLATE_MAP` 和 `CLIENT_TARGET_MAP` 把不同模板写到各自客户端原生位置，其中 Claude/Gemini/Codex 都有单独目标。证据：`packages/cli/src/commands/bootstrap.ts:64-80`。
> - **Hypothesis Impact**: Confirms hypothesis "外部多份文档是架构导致"。
> - **Scope**: bootstrap 子系统。

> **Finding**: Codex 目前只完成了 MCP config 和 bootstrap header 适配，没有像 Claude 一样的 skill 安装闭环。
> - **Confidence**: High — **Why**: `resolveClients()` 能检测 `~/.codex` 并写 `config.toml`；`bootstrap` 只会往 `AGENTS.md` prepend Fabric Bootstrap header；仓库里没有对应 Codex init skill 安装测试，只有 Codex config 测试。证据：`packages/cli/src/config/resolver.ts:75-80`、`packages/cli/__tests__/config-install.test.ts:28-113`、`packages/cli/__tests__/init-claude-install.test.ts:20-79`。
> - **Hypothesis Impact**: Confirms hypothesis "Codex 侧存在能力缺口"。
> - **Scope**: 客户端适配完整性。

#### Technical Solutions
> **Solution**: 把 `fab init` 改造成“检测 -> 方案预览 -> 交互选择 -> 执行 -> 验证/下一步”的控制台向导，而不是执行完再总结。
> - **Status**: Proposed
> - **Problem**: 当前输出能看见阶段，但用户在执行前无法选择安装范围、理解会写哪些文件、或发现 skill 缺口。
> - **Rationale**: 这能在不破坏现有核心逻辑的前提下补齐 UI 感和产品感。
> - **Alternatives**: 仅增加彩色日志；保持纯 flags 风格。前者改善有限，后者仍然把认知负担交给用户。
> - **Evidence**: `packages/cli/src/commands/init.ts:155-255`, `packages/shared/src/i18n/locales/zh-CN.ts:100-112`
> - **Next Action**: 设计向导状态机与交互阶段。

> **Solution**: 把 `.fabric` 设为单一事实源，外部客户端文件降级为“薄适配/指针层”。
> - **Status**: Proposed
> - **Problem**: 现在多个客户端说明文件各自携带同类规则，内容重复且容易漂移。
> - **Rationale**: 只保留 `.fabric/guide.md` 或 `.fabric/bootstrap/*` 作为主文档，客户端文件只写最小引用说明，可以大幅降低分裂。
> - **Alternatives**: 完全不生成客户端文件；继续维持多份完整文档。前者可能破坏客户端原生发现机制，后者继续制造重复。
> - **Evidence**: `packages/cli/src/commands/bootstrap.ts:64-80`, `packages/cli/templates/bootstrap/CLAUDE.md:1-7`, `packages/cli/templates/bootstrap/GEMINI.md:1-7`
> - **Next Action**: 设计“单一源 + 薄适配”的目录布局。

> **Solution**: 为 Codex 增加和 Claude 对齐的 post-init capability check，至少提供 `installed / missing / manual step required` 的显式状态。
> - **Status**: Proposed
> - **Problem**: 当前 init 对 Codex 只做配置，不暴露 skill 缺失，用户会误认为 Fabric 已完整接入。
> - **Rationale**: 即使短期不真正安装 Codex skill，也必须在 init 中把缺口可视化。
> - **Alternatives**: 暂不处理；直接复用 Claude skill。前者继续埋坑，后者在不同客户端协议未对齐时风险较高。
> - **Evidence**: `packages/cli/src/config/resolver.ts:75-80`, `packages/cli/__tests__/init-claude-install.test.ts:20-79`
> - **Next Action**: 设计 capability matrix 与失败提示。

#### Analysis Results
- `fab init` 的核心流程现在是：写 Fabric 核心文件 -> 运行 `bootstrap` -> 运行 `mcp` -> 运行 `hooks` -> 打印“next step/reason message”。它是完整的执行链，但缺少开始前的“安装计划”和执行后的“能力校验面板”。
- `cli.init.reason-message.body` 当前仍要求用户“使用 agents-md-init skill 完成 AGENTS.md 初始化”，这说明产品叙事里 `fab init` 仍被设计为“装备阶段”，而不是“完成初始化”。证据：`packages/shared/src/i18n/locales/zh-CN.ts:109-112`。
- Claude 专有安装链路已经存在，并且有测试覆盖 skill、hook、settings merge 和 sentinel 行为，这表明“基于客户端差异做后置安装”在架构上是被接受的。证据：`packages/cli/__tests__/init-claude-install.test.ts:20-79`。
- bootstrap 目前对 Codex 的处理最特殊：不是写独立文件，而是把 Fabric Bootstrap prepend 到 `AGENTS.md`。这进一步暴露出 `AGENTS.md` 同时承担了“项目规则”和“Codex 启动提示”两种职责。

#### Corrected Assumptions
- ~~init 只是简单地生成几个文件~~ → 实际上它已经承担了 evidence collection、MCP config、hooks、Claude skill 安装等多重职责。
  - Reason: 之前对 `init` 的感知主要来自用户体验，而不是实际代码路径。
- ~~多份外部文档纯粹是疏忽~~ → 实际上这是 bootstrap 的设计结果：按客户端原生入口分发模板。
  - Reason: `bootstrap.ts` 已经明确把不同客户端映射到不同文件位置。

#### Open Items
- 如果把 AGENTS/CLAUDE/GEMINI 收敛到 `.fabric` 内，哪些客户端仍然需要保留原生入口文件作为 discovery shim？
- Codex 是否应该拥有真正的 init skill，还是只需要把流程写进 `.fabric` 并由 `AGENTS.md` 薄引用？
- 控制台向导是默认交互模式，还是通过 `--interactive` 开启？

#### Narrative Synthesis
**起点**: 基于用户对“init 太简略”和“文档太分散”的直觉，本轮先核实现有实现。  
**关键进展**: 新发现表明 init 并不缺阶段，而是缺向导状态机；多文档问题也不是单点 bug，而是 bootstrap 的既有设计。  
**决策影响**: 这使得后续建议从“加 UI 修饰”转为“重做 init 的信息架构与状态表达”。  
**当前理解**: Fabric 需要的是一个有预览、有选择、有能力检查的安装向导，以及 `.fabric` 为核心的单一事实源。  
**遗留问题**: 还需要明确单一事实源下客户端薄适配的边界，以及 Codex skill 的最低可行方案。

### Round 2 - Synthesis (2026-04-21T00:20:00+08:00)

#### User Input
用户希望分析能落到具体的 init 交互流程、UI 感、以及文档/skill 收敛方案，而不是停留在抽象层。

#### Decision Log
> **Decision**: 推荐采用“两层式重构”，先补状态机和单一源，再考虑真正的多客户端 skill 安装统一。
> - **Context**: 一次性重写所有客户端协议成本高，且当前 Claude 链路已可用。
> - **Options considered**: 一步到位统一所有客户端；只做输出美化；分阶段收敛。
> - **Chosen**: 分阶段收敛。 — **Reason**: 能在保持当前架构可用的同时，先解决最痛的 UX 与事实源问题。
> - **Rejected**: 只做 UI 美化，因为不能解决重复文档与 Codex 缺口。
> - **Impact**: 推荐会分成 P0/P1/P2 阶段。

#### Key Findings
> **Finding**: 当前仓库此前的分析已经把 `fab init` 定义为“装备，不是完成初始化”，这与用户对“为什么还要外部 skill”感到割裂是同一个体验问题。
> - **Confidence**: High — **Why**: 既有结论明确写到 `fab init` 是 “CLI 装备 + AI skill 接力”。证据：`.workflow/.analysis/ANL-fab-doc-init-werewolf-2026-04-19/conclusions.json`。
> - **Hypothesis Impact**: Confirms hypothesis "需要把 init 的阶段语义讲清楚"。
> - **Scope**: 产品叙事与命令设计。

> **Finding**: 仓库里另一份分析已指出根 `AGENTS.md` 与跨切面规则分发存在进一步收敛空间，说明“收敛到单一源”与既有方向一致，不是逆向设计。
> - **Confidence**: High — **Why**: 既有分析建议以 `@import`、rules-frontmatter、结构化断言减少双重维护。证据：`.workflow/.analysis/ANL-fab-init-heuristic-discovery-2026-04-19/conclusions.json`。
> - **Hypothesis Impact**: Confirms hypothesis "收敛文档源是合理主线"。
> - **Scope**: 规则文档架构。

#### Technical Solutions
> **Solution**: P0 先把 `fab init` 改成交互式 summary/install 向导，但仍复用现有 `initFabric()`、`installBootstrap()`、`installMcpClients()`、`installHooks()`。
> - **Status**: Validated
> - **Problem**: 当前命令入口没有“UI 感”和“可选流程”。
> - **Rationale**: 现有核心执行函数已经足够模块化，适合在外层加 orchestrator，而不是推倒重写。
> - **Alternatives**: 重写所有内部逻辑；只加日志。前者成本大，后者收益小。
> - **Evidence**: `packages/cli/src/commands/init.ts:155-255`
> - **Next Action**: 设计交互问题、预览面板和 capability summary。

> **Solution**: P1 把主说明文档迁移到 `.fabric/bootstrap/` 或 `.fabric/guide.md`，外部文件只保留 3-8 行的薄入口。
> - **Status**: Validated
> - **Problem**: 多客户端外部文件重复且分散。
> - **Rationale**: 这样既保留客户端入口，又把真正内容收回 `.fabric`。
> - **Alternatives**: 完全删除外部文件；继续多份完整文件。前者可能损伤发现链路，后者继续分裂。
> - **Evidence**: `packages/cli/src/commands/bootstrap.ts:64-80`, `packages/cli/templates/bootstrap/CLAUDE.md:1-7`
> - **Next Action**: 明确要保留哪些 shim 文件，哪些可以不生成。

> **Solution**: P2 引入 client capability registry，把 `mcp/config/bootstrap/skill/hook` 视为可独立能力，并在 init 结束时显示矩阵。
> - **Status**: Proposed
> - **Problem**: 现在用户无法知道“Fabric 对某客户端到底装到哪一步了”。
> - **Rationale**: 一旦 capability 被结构化，Codex 缺 skill 的问题就能被准确表达，也便于后续增量补齐。
> - **Alternatives**: 继续靠 README 说明；把所有客户端强行做成一样。前者不可见，后者忽略不同客户端协议差异。
> - **Evidence**: `packages/cli/src/config/resolver.ts:29-82`, `packages/cli/__tests__/init-claude-install.test.ts:20-79`, `packages/cli/__tests__/config-install.test.ts:28-113`
> - **Next Action**: 定义 capability schema。

#### Analysis Results
建议中的控制台 init 向导可以是 5 步：
1. `Detect`：扫描当前工程、已检测到的客户端、已有文件冲突、可安装能力。
2. `Plan`：用 box/表格预览会写入哪些内容，哪些是 Fabric 核心文件，哪些是客户端薄入口，哪些客户端缺少 skill 支持。
3. `Choose`：允许选择 preset，如 `minimal`、`standard`、`full`，以及逐项开关：`bootstrap`、`mcp`、`hooks`、`skills`、`local/global server`。
4. `Apply`：实时进度条或 stage stepper，失败时保持 partial summary，而不是只抛异常。
5. `Verify`：打印 capability matrix，例如 `Claude: mcp yes / bootstrap yes / hook yes / skill yes`，`Codex: mcp yes / bootstrap yes / skill no (manual)`。

建议中的文档布局可以是：
- `.fabric/guide.md` 或 `.fabric/bootstrap/clients/{client}.md` 为真正文档源。
- 根 `AGENTS.md` 可保留，但只保留项目级规则入口和 Fabric 索引，避免再塞客户端 bootstrap 文本。
- `CLAUDE.md` / `GEMINI.md` / `AGENTS.md` 中的 bootstrap 部分改为短 shim，例如“Fabric bootstrap lives in `.fabric/bootstrap/claude.md`”或最小规则 + `@AGENTS.md` / `@.fabric/guide.md`。

#### Corrected Assumptions
- ~~要收敛文档就必须完全取消外部文件~~ → 更合理的是保留原生入口，但让这些文件变薄。
  - Reason: 不同客户端仍依赖自己的入口约定。
- ~~Codex 缺 skill 只能通过真正安装 skill 解决~~ → 短期也可以先通过 capability matrix + manual step 提示把问题产品化显性化。
  - Reason: 客户端协议统一可能需要分阶段推进。

#### Open Items
- 根 `AGENTS.md` 是否仍作为项目总规则入口保留，还是也迁到 `.fabric` 后由 shim 指向？
- Codex 的“skill”最终是独立文件、AGENTS 子节，还是 `.codex/skills/fabric-init` 之类的目录？
- 交互式 init 是否默认开启，还是无 TTY 时自动退化到现有非交互流程？

#### Narrative Synthesis
**起点**: 在确认现状后，本轮需要把问题转成可执行重构。  
**关键进展**: 得出一套两层式方案：先做向导和单一源，再做 capability registry 与多客户端 skill 对齐。  
**决策影响**: 这让建议既能快速改善用户体验，也不会强迫一次性推倒现有初始化协议。  
**当前理解**: 最优路线不是删功能，而是把现有步骤显性化、把分散文档降为薄适配。  
**遗留问题**: 还需决定根 `AGENTS.md` 的最终角色，以及 Codex skill 的目标形式。

---

## Decision Trail
- 以 `init UX 状态机`、`bootstrap 文档事实源`、`Codex skill parity` 三条主线组织分析，而不是把问题拆成孤立 UI/文件名讨论。
- 优先推荐分阶段重构：先解决状态机和单一事实源，再解决跨客户端 skill 对齐。
- 结论偏向“`.fabric` 做单一源，客户端文件做薄入口”，而不是简单删除所有外部文件。

## Synthesis & Conclusions

### Executive Summary
当前 Fabric 的 `init` 真正缺的不是功能数量，而是产品化表达。代码层面它已经做了不少事，但用户只能在执行后看到线性日志，无法在执行前看到安装计划、无法选择初始化模式、也无法在执行后明确知道各客户端的 Fabric 能力装到了哪一步。与此同时，bootstrap 仍把规则文档散落在多个客户端入口文件里，导致 `AGENTS.md`、`CLAUDE.md`、`GEMINI.md` 的角色重叠。Codex 则处于“已接 MCP/config，但没有 skill 闭环”的半完成状态。

### Recommendations
1. **把 `fab init` 升级为真正的控制台向导**
   - Priority: high
   - Rationale: 解决“太简略、没有 UI 感、没有可选流程”的第一痛点。
   - Steps:
     - 在执行前增加 detect/plan summary，列出检测到的客户端、将写入的路径、冲突项、可用能力。
     - 增加 `preset` 或 step-by-step 选择，例如 `minimal` / `standard` / `full`，并允许切换 `bootstrap`、`mcp`、`hooks`、`skills`。
     - 执行阶段使用 stepper/progress 呈现，失败时打印 partial result，不要只有异常。
     - 执行后输出 capability matrix，而不是只输出 stage summary。
   - Evidence refs: `packages/cli/src/commands/init.ts:155-255`, `packages/shared/src/i18n/locales/zh-CN.ts:100-112`

2. **把 `.fabric` 变成初始化文档和协议的单一事实源**
   - Priority: high
   - Rationale: 解决 `AGENTS.md/CLAUDE.md/GEMINI.md` 多份重复的问题。
   - Steps:
     - 新增 `.fabric/guide.md` 或 `.fabric/bootstrap/` 作为主文档源。
     - `bootstrap` 模板只保留薄适配文本，指向 `.fabric` 内部文档，而不复制整套规则。
     - 根 `AGENTS.md` 保留为项目总入口，但减少客户端特定引导，避免继续承担多角色。
     - 在 `sync-meta` 或相关工具里把 `.fabric` 主文档纳入可追踪对象。
   - Evidence refs: `packages/cli/src/commands/bootstrap.ts:64-80`, `packages/cli/src/commands/init.ts:279-315`

3. **引入 client capability registry，并在 init 结束时显式报告能力缺口**
   - Priority: high
   - Rationale: 解决 “Codex 没装 skill 但用户不知道” 的问题。
   - Steps:
     - 为每个客户端定义能力项：`bootstrap`、`mcp-config`、`hook`、`skill`、`manual-followup`。
     - `resolveClients()` 只负责检测存在性；`init` 负责汇总“能装什么、装到了什么、还差什么”。
     - 对 Codex/Gemini 等未完全支持 skill 的客户端，输出明确的 `manual step required` 或 `not supported yet`。
     - 后续再决定是否补真正的 Codex skill 安装。
   - Evidence refs: `packages/cli/src/config/resolver.ts:29-82`, `packages/cli/__tests__/config-install.test.ts:28-113`, `packages/cli/__tests__/init-claude-install.test.ts:20-79`

4. **把 Claude-only 的 init follow-up 叙事改成多客户端可理解的初始化完成度叙事**
   - Priority: medium
   - Rationale: 当前 `reason-message` 只提 `agents-md-init skill`，默认叙事偏 Claude。
   - Steps:
     - 将 `reason-message` 改成按客户端能力动态生成。
     - 如果只有 Claude 支持完整 skill，则说明 “Claude 已可继续完成初始化；Codex/Gemini 当前仅完成 Fabric bootstrap 和 MCP 配置”。
     - 无 TTY 或非交互时，仍打印明确 next steps。
   - Evidence refs: `packages/shared/src/i18n/locales/zh-CN.ts:109-112`

5. **分阶段推进，不要一上来追求统一所有客户端 skill**
   - Priority: medium
   - Rationale: 这是风险最小的路线。
   - Steps:
     - P0: 加向导、加 capability matrix、保留现有执行逻辑。
     - P1: 收敛文档源到 `.fabric`，外部文件降为 shim。
     - P2: 评估并补齐 Codex/Gemini 的 skill 安装或替代机制。
   - Evidence refs: `packages/cli/src/commands/init.ts:155-315`, `.workflow/.analysis/ANL-fab-doc-init-werewolf-2026-04-19/conclusions.json`

### Intent Coverage Matrix
| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| 1 | init 流程太简略，控制台初始化缺少 UI 感和可选交互流程 | ✅ Addressed | Round 1, Round 2, Rec #1 | 已给出向导状态机与交互步骤 |
| 2 | 初始化时生成 AGENTS.md/CLAUDE.md/GEMINI.md 在外部，是否能集成在 `.fabric` 内部 | ✅ Addressed | Round 1, Round 2, Rec #2 | 推荐改为 `.fabric` 单一源 + 外部薄适配 |
| 3 | 能否只保留一份文件而不是多份或者不生成 | ✅ Addressed | Round 2, Rec #2 | 推荐保留必要 shim，不再保留多份完整文档 |
| 4 | 具体流程写在 skill 里面（当前 `.codex` 下没有安装相应 skill） | ✅ Addressed | Round 1, Round 2, Rec #3/#4 | 结论是短期先显式暴露能力缺口，长期再补 Codex skill parity |

### Findings Coverage Matrix
| # | Finding (Round) | Disposition | Target |
|---|----------------|-------------|--------|
| 1 | init 已有阶段但缺向导感 (R1) | recommendation | Rec #1 |
| 2 | 事实源分布在 workspace/.fabric/.claude (R1) | recommendation | Rec #2 |
| 3 | bootstrap 天然导致外部多文档 (R1) | recommendation | Rec #2 |
| 4 | Codex 只有 config/bootstrap 没有 skill 闭环 (R1) | recommendation | Rec #3 |
| 5 | `fab init` 是装备而非完成初始化 (R2) | recommendation | Rec #4 |
| 6 | 既有分析已支持继续收敛规则源 (R2) | absorbed | → Rec #2 |

### Session Statistics
- Total rounds: 2
- Key findings: 6
- Dimensions covered: architecture, implementation, comparison, decision
- Artifacts generated: discussion.md, exploration-codebase.json, research.json, explorations.json, conclusions.json
- Decision count: 3

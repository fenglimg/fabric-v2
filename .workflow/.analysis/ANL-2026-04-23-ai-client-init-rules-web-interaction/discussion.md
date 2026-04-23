# Analysis: AI 客户端初始化规则与 Web 交互流程

## Table of Contents
- [Session Metadata](#session-metadata)
- [User Intent](#user-intent)
- [Analysis Configuration](#analysis-configuration)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
  - [Round 1: Multi-Perspective Exploration](#round-1-multi-perspective-exploration)
  - [Round 2: External Research — Industry Landscape](#round-2-external-research--industry-landscape)
  - [Round 3: Feasibility Evaluation](#round-3-feasibility-evaluation)
  - [Round 4: Web Dashboard 交互模式深度分析](#round-4-web-dashboard-交互模式深度分析)
  - [Round 5: Dashboard 功能愿景 — "观察与记录平台"](#round-5-dashboard-功能愿景--观察与记录平台)
  - [Round 6: Dashboard 定位升级 — 纯观察平台](#round-6-dashboard-定位升级--纯观察平台)
- [Initial Intent Coverage Check](#initial-intent-coverage-check)
- [Conclusions](#conclusions)

---

## Session Metadata
- **Session ID**: ANL-2026-04-23-ai-client-init-rules-web-interaction
- **Date**: 2026-04-23
- **Topic**: AI 客户端的初始化规则和 Web 交互流程 — 全景扫描与深度发散
- **Dimensions**: architecture, implementation, concept
- **Depth**: Deep Dive
- **Mode**: Multi-perspective (4 perspectives)

## User Intent
原始分析请求包含 5 个核心意图：

1. **初始认知构建**: AI 客户端是如何从 0 到 1 构建起对项目的最初认知的？
2. **规则处理痛点**: 现有的规则处理逻辑中，哪些地方让人感到"困惑"或"束手束脚"？
3. **本地-Web 协作效率**: 本地环境与 Web 界面之间的协作，是否存在某种"沟通效率极低"的模式？
4. **关键缺失环节**: 如果要让这个过程变得"无感且精准"，目前缺失的最关键的一环是什么？
5. **规则配置优化**: 具体规则配置是否存在优化的部分？

## Analysis Configuration

### Focus Directions
| Direction | Coverage |
|-----------|----------|
| 初始化认知流程 | Intent 1 — AI 客户端如何从 0 到 1 构建项目认知 |
| 规则处理机制 | Intent 2, 5 — 规则加载/解析/应用逻辑及其局限性与优化空间 |
| 本地-Web 协作 | Intent 3 — 本地环境与 Web 界面的交互模式与效率 |
| 规则配置优化 | Intent 4, 5 — 现有规则配置结构和可优化空间 |

### Perspectives
| Perspective | Tool | Focus |
|------------|------|-------|
| Technical | Gemini | 代码实现、处理流程、模式分析 |
| Architectural | Claude | 系统设计、组件交互、可扩展性 |
| Domain Expert | Gemini | AI 客户端领域最佳实践与标准 |
| Business | Codex | 用户体验价值、效率 ROI |

### Dimension Selection Rationale
> **Decision**: 选择全部 4 个方向 + 4 个视角 + Deep Dive
> - **Context**: 用户明确要求"全景扫描模式"和"深度发散"，并提出"可以最大程度的去探索"
> - **Chosen**: 最大覆盖面 — 所有方向和视角均启用
> - **Reason**: 与用户的全景探索意图完全对齐

## Current Understanding

经 6 轮分析产出两层结论 — 协议层升级方案 + Dashboard 产品愿景：

**协议层（2 个已验证方案）**：
- **[P0, S] 三层级激活模型** — `agents-meta.ts` activation.tier + `get-rules.ts` 分支过滤（~50 LOC, 零 breaking changes）
- **[P1, M] tree-sitter AST 扫描** — `forensic.ts` AST 替换 + `detector.ts` tech profile（~100 LOC, web-tree-sitter WASM）

**Dashboard 产品愿景（纯观察平台，零写操作）**：
- **模块 A：规则拓扑** — 动态激活高亮、命中理由可视化、覆盖率热力图、规则冲突报警
- **模块 B：认知探针** — 技术栈指纹图（基于 REC-2）、信心指数度量、认知覆盖地图
- **模块 C：语义时间线** — AI 推理链路追踪、漂移可视化（只看不审批）、注解展示（只读）
- **模块 D：时间胶囊** — 认知 Diff（不只代码 Diff）、交互回放（幻灯片模式）、状态快照对比
- **进阶：规则沙盒** — 模拟"如果增加这条规则，AI 认知会怎样变化"（dry-run 模式）

**设计原则**：零写入 / 第二屏幕 / 架构腐烂照镜子 / SSoT 纯净度 / AI 透明化

## Discussion Timeline

### Round 1: Multi-Perspective Exploration

**Sources**: 4 perspective agents (Technical/Architectural/Domain Expert/Business) + external research agent
**Files analyzed**: 40+ files across cli/server/dashboard/shared packages

#### Key Findings

**跨视角共识（5 大发现）**：

1. **跨客户端能力鸿沟** [HIGH] — 仅 Claude Code CLI 获得 hook+skill 完整支持。6/7 客户端无初始化强制和访谈引导。`resolver.ts:L113-L127` 中 capabilities 矩阵以硬编码布尔值定义，无配置扩展路径。

2. **Forensic 扫描质量天花板** [HIGH] — 纯文本模式匹配（非 AST），5 文件×30 行的固定预算。`determineConfidence()` 在 `forensic.ts:L903-L926` 中仅对 `@ccclass` 装饰器给予 HIGH confidence（astLevel=true），React/Next/Vite 封顶 MEDIUM。

3. **规则激活模型单一** [HIGH] — `get-rules.ts:L136-L161` 中 `loadRulesForPath()` 对所有节点执行 minimatch 全扫描。无 Windsurf 式 model_decision 或操作类型感知。O(N) 复杂度，无索引。

4. **Bootstrap 模板内容碎片化** [MEDIUM] — CLAUDE.md/GEMINI.md 仅 3 条规则（缺 fab_update_registry 和 @HUMAN），cursor/roo/windsurf 有 5 条，codex 仅 3 条。规则覆盖不一致。

5. **Dashboard SSE 可靠性缺口** [MEDIUM] — `openSseConnection()` 在 `client.ts:L217-L219` 中 catch 块完全静默异常，注释称"caller handles reconnect"——但 5 个 dashboard 视图均未实现重连逻辑。

**视角独特发现**：

- **Technical**: initFabric() 7 步写入无回滚（`init.ts:L274-L343`）；JsonlEventStore 全量读取 O(n)（`http.ts:L57-L127`）；并发首次请求无 singleflight
- **Architectural**: Content-addressed revision chain 设计精巧（sha256 of sorted node hashes）；单进程单项目约束（FABRIC_PROJECT_ROOT 进程级）
- **Domain Expert**: recommendations_for_skill 标记 @deprecated 但 SKILL.md 仍在读取；AGENTS.md 标准合规但缺少 tools/env 段
- **Business**: 入门需 3 轮 AI 交互才获得价值（Zero TODO 约束阻止部分保存）；Stop Hook 和 forensic 推荐纯中文硬编码（国际化缺口）

#### Decision Log

> **Decision**: 采用 4 视角并行深度探索而非单视角+CLI 分析
> - **Context**: 用户选择所有 4 个视角 + Deep Dive
> - **Chosen**: Multi-perspective Phase B（4 个 cli-explore-agent 并行）
> - **Reason**: 最大化覆盖面，每个视角关注不同维度
> - **Impact**: 产出 34 个 key findings，28 个 code anchors，15 条调用链

#### Discussion Points

1. **规则一致性优先还是客户端特化优先？** — cursor.mdc 的 5 条规则集是最完整的，是否应以此为基准统一所有模板？
2. **Forensic 扫描是否应引入轻量 AST 分析？** — 当前 text-level 对 Web 框架封顶 MEDIUM，import graph 分析可能以低成本提升到 HIGH
3. **fab_get_rules 是否应增加操作类型参数？** — 区分 read/write/create/delete 操作以实现更精准的规则注入
4. **非 Claude 客户端的初始化强制方案** — 在 fab_get_rules MCP 响应中嵌入初始化守卫？
5. **Dashboard 是必需还是可选？** — human-lock 审批目前无 CLI 等价物

### Round 2: External Research — Industry Landscape

**Sources**: 4 parallel research agents covering rules evolution, semantic activation, MCP patterns, cold start approaches

#### Key Findings

**1. 规则系统演进 — 行业趋同于四模式激活**

所有主流 AI 客户端已趋同于相似的激活分类：
- **Claude Code**: `paths:` frontmatter → 文件读取时按需加载；无 paths = 会话启动时加载
- **Cursor**: Always Apply / Apply Intelligently / Apply to Specific Files / Apply Manually
- **Windsurf**: always_on / model_decision / glob / manual
- **GitHub Copilot**: `.github/instructions/*.instructions.md` + `applyTo` glob

> **Finding**: AGENTS.md 并非正式跨工具标准 — 它是 OpenAI Codex 项目自身的开发规范，Windsurf/Copilot 作为目录级约定读取。
> - **Confidence**: HIGH — **Why**: 多源交叉验证
> - **Hypothesis Impact**: 修正了之前对 AGENTS.md 作为"行业标准"的认知
> - **Scope**: 影响 Fabric Protocol 的标准合规定位

**2. 语义激活 — model_decision 是 lazy-load 模式**

> **Finding**: Windsurf 的 model_decision 并非独立推理调用 — 仅将规则 description 注入系统提示词，模型自行判断相关性后按需读取完整规则。零额外推理开销。
> - **Confidence**: HIGH — **Why**: 官方文档明确说明
> - **Scope**: 为 Fabric 提供了无推理成本的语义激活实现路径

> **Finding**: 没有任何生产工具实现了操作类型感知的激活（read/write/create/delete 区分）。所有激活基于文件路径或模型自路由。
> - **Confidence**: HIGH
> - **Scope**: 操作感知激活是 Fabric 的差异化机会，但需自行设计

**3. MCP 协作 — StreamableHTTP 取代 HTTP+SSE**

> **Finding**: 2025-03-26 MCP 规范废弃了旧 HTTP+SSE 传输，新 StreamableHTTP 使用单一端点同时支持 POST 和 GET(SSE)。
> - **Confidence**: HIGH
> - **Scope**: Fabric Server 的 HTTP 传输层需评估是否需要迁移

> **Finding**: MCP 规范严格点对点 — 服务器禁止跨流广播同一消息。Fan-out 需应用层代理。Dashboard SSE 应独立于 MCP SSE。
> - **Confidence**: HIGH
> - **Scope**: Fabric 当前的 Dashboard SSE 独立通道设计是正确的

**4. 冷启动 — tree-sitter AST + git churn 是前沿方案**

> **Finding**: Aider 的 repo map 使用 tree-sitter AST 解析 + PageRank 式图排序，按 token 预算自动选择最重要的文件。比 Fabric 的文本扫描在结构理解上强一个量级。
> - **Confidence**: HIGH
> - **Scope**: forensic 扫描的核心改进方向

> **Finding**: Claude Code `/init` 交互模式（`CLAUDE_CODE_NEW_INIT=1`）使用子代理探索代码库 → 追问 → 生成可审查的提案 — 与 Fabric 3 阶段访谈最为接近。
> - **Confidence**: HIGH
> - **Scope**: 验证了 Fabric 的结构化访谈是正确方向

#### Technical Solutions

> **Solution**: 三层级渐进式激活模型
> - **Status**: Proposed
> - **Problem**: 当前仅 glob 路径匹配，无语义感知
> - **Rationale**: 对齐 Windsurf/Cursor/Claude Code 已趋同的四模式分类
> - **Alternatives**: 纯 glob (current)、独立小模型路由（无产品实现）、全量 always-on（token 浪费）
> - **Evidence**: Windsurf model_decision, Cursor Apply Intelligently, Claude Code path-scoped rules
> - **Next Action**: 设计 agents.meta.json 节点的 activation 字段扩展

| Tier | Mechanism | Use For |
|------|-----------|---------|
| Tier 1: Always | 无条件 | 核心协议不变式（≤50 行）|
| Tier 2: Path-scoped | Glob frontmatter | 子系统规则（语言、框架、目录）|
| Tier 3: Description-stub | Description + 按需加载 | 跨切关注点（安全、性能、重构）|

> **Solution**: Forensic 扫描升级 — fast fingerprint + tree-sitter structural scan
> - **Status**: Proposed
> - **Problem**: 当前 5 文件×30 行文本扫描，Web 框架封顶 MEDIUM confidence
> - **Rationale**: Aider 验证了 tree-sitter + graph ranking 的可行性和效果
> - **Alternatives**: 全文本扫描（current）、embedding 向量索引（过度）、full repo bundling（token 成本高）
> - **Next Action**: 评估 tree-sitter npm 包集成和 git churn 加权采样

> **Solution**: Bootstrap 模板规范化 — 单一 source of truth + 客户端包装
> - **Status**: Proposed
> - **Problem**: 6 个模板内容碎片化，3-5 条规则不等
> - **Rationale**: 所有工具已趋同于类似规则结构，差异仅在格式（YAML frontmatter、.mdc 等）
> - **Next Action**: 设计共享规则模板 + 客户端格式适配器

#### Decision Log

> **Decision**: 用户选择 4 个方向全部做外部研究
> - **Context**: Round 1 发现多处行业对标空白
> - **Chosen**: 并行执行规则演进、语义激活、MCP 协作、冷启动研究
> - **Reason**: 最大化外部知识输入，对齐行业前沿
> - **Impact**: 纠正了 AGENTS.md 标准认知，发现 model_decision lazy-load 模式，确认 tree-sitter 升级路径

### Round 2: Narrative Synthesis

**起点**: 基于 Round 1 的 5 大跨视角共识和 Intent 3/4 的部分覆盖，本轮从行业对标切入。
**关键进展**: 外部研究确认了 Fabric Protocol 的设计方向正确（分层规则、强制Hook、结构化访谈），但在激活精度（glob-only vs 三层级）、扫描深度（文本 vs AST）、模板一致性方面落后于行业前沿。最关键的发现是 Windsurf model_decision 的实现方式——不是独立推理调用而是 description stub + 按需加载——为 Fabric 提供了零成本的语义激活路径。
**决策影响**: 研究结果产出了 3 个具体的 Technical Solution proposals。
**当前理解**: Fabric 的架构框架（Shadow Mirroring + L0/L1/L2 + MCP 双传输）是正确的，需要在激活层、扫描层和模板层做精细化升级。
**遗留问题**: 3 个 proposed solutions 需要优先级排序和可行性评估。

#### Intent Coverage Check

| # | Original Intent | Status | Coverage |
|---|----------------|--------|----------|
| 1 | 从 0 到 1 构建项目认知 | ✅ 已覆盖 | R1: 管道追踪 + R2: Aider tree-sitter 对标，Claude Code /init 对比 |
| 2 | 规则处理逻辑的困惑/束手束脚 | ✅ 已覆盖 | R1: glob-only 限制 + R2: 行业四模式激活对标，model_decision 路径 |
| 3 | 本地-Web 协作效率低 | ✅ 已覆盖 | R1: 3 通道架构 + R2: MCP StreamableHTTP 规范，Dashboard 独立通道验证 |
| 4 | 无感且精准的关键缺失环节 | ✅ 已覆盖 | R2: 三层级激活 + tree-sitter 扫描 + 模板规范化 = 关键升级三件套 |
| 5 | 规则配置优化 | ✅ 已覆盖 | R1: 碎片化诊断 + R2: 单源 + 格式适配器方案 |

### Round 3: Feasibility Evaluation

**Sources**: 3 parallel feasibility analysis agents (code-level verification per solution)

#### Solution 1: 三层级渐进式激活模型 — ✅ VALIDATED

> **Solution**: 三层级激活 (Always / Path-scoped / Description-stub)
> - **Status**: Validated — HIGH feasibility, S effort
> - **Problem**: `get-rules.ts:L136-L161` 对所有节点做 minimatch 全扫描，无语义感知
> - **Rationale**: Windsurf model_decision 验证了 description-stub + 按需加载的零推理开销模式
> - **Implementation**:
>   - `agents-meta.ts` schema: 添加 `activation?: { tier: 'always' | 'path' | 'description', description?: string }` 可选字段（默认 `path`，完全向后兼容）
>   - `get-rules.ts` filter: 在 minimatch 前增加 tier 分支 — `always` 直接返回，`description` 仅返回 stub，`path` 走现有逻辑
>   - 变更量: ~50-60 LOC，2 个文件，零 breaking changes
> - **Alternatives**: 独立小模型路由（无产品实现）、全量 always-on（token 浪费）
> - **Next Action**: 设计 activation 字段 schema + get-rules filter 分支

#### Solution 2: Forensic 扫描升级 — tree-sitter + git churn — ✅ VALIDATED

> **Solution**: tree-sitter AST 结构扫描 + git churn 加权
> - **Status**: Validated — HIGH feasibility, M effort
> - **Problem**: `forensic.ts` 纯文本扫描，5 文件×30 行固定预算，Web 框架封顶 MEDIUM
> - **Rationale**: Aider 验证了 tree-sitter + PageRank 的可行性；`detector.ts` 已做 package.json fingerprinting（`detectPackageManager`、`detectFramework`），是天然的 fast-fingerprint 入口
> - **Implementation**:
>   - 阶段 1（fast fingerprint）: `detector.ts` 已有基础设施，扩展为结构化 tech profile
>   - 阶段 2（tree-sitter）: `inferPatternHint()` 是精确替换点 — 当前返回文本匹配结果，替换为 AST 解析
>   - 依赖: `web-tree-sitter` + language grammars (~3.5MB)，纯 WASM 无原生编译
>   - 变更量: +80-120 LOC，主要在 forensic.ts
> - **Alternatives**: embedding 向量索引（过度）、full repo bundling（token 成本高）
> - **Next Action**: 评估 web-tree-sitter WASM 集成 + 设计 AST confidence 评分算法

#### Solution 3: Bootstrap 模板规范化 — ⏸ DEFERRED

> **Solution**: 单一规则源 + 客户端格式适配器
> - **Status**: Deferred — LOW VALUE at current scale
> - **Problem**: 6 个模板内容碎片化（3-5 条规则不等）
> - **Rationale**: 代码验证发现实际规模极小 — 6 个模板合计 ~35 LOC 有效内容，`installBootstrap()` 写入路径已 stubbed（所有目标标记 skipped）。当前碎片化的实际影响有限
> - **Defer Reason**: 模板写入路径尚未实现，统一模板的价值在写入路径完成后才能兑现。当前优化 ROI 过低
> - **Trigger**: 当 `installBootstrap()` 实现真实写入时重新评估
> - **Next Action**: 无（等待写入路径实现）

#### Decision Log

> **Decision**: Solution 1 & 2 验证通过，Solution 3 推迟
> - **Context**: 用户选择全部方案评估，3 个并行 agent 完成代码级可行性验证
> - **Chosen**: S1 (激活模型) 优先级 P0，S2 (tree-sitter) 优先级 P1，S3 (模板) 推迟
> - **Reason**: S1 变更最小（~50 LOC）且立即可用；S2 需要依赖引入但价值高；S3 当前 ROI 不足
> - **Impact**: 将 3 个 proposed solutions 收敛为 2 个 validated + 1 个 deferred

### Round 3: Narrative Synthesis

**起点**: Round 2 产出 3 个 Technical Solution proposals，用户要求全部做可行性评估。
**关键进展**: 代码级验证确认 S1（三层级激活）和 S2（tree-sitter 扫描）均可行且不破坏现有接口。S3（模板规范化）经验证实际规模极小（~35 LOC），且写入路径未实现，ROI 不足以当前投入。
**决策影响**: 3 proposals → 2 validated (P0/P1) + 1 deferred。分析的核心产出明确为两个可执行的升级方案。
**当前理解**: Fabric Protocol 需要两个精确升级 — 激活层增加 description-stub 语义激活（S effort），扫描层引入 tree-sitter AST 分析（M effort）。两者独立、无依赖、可并行实施。模板层当前无需动作。

## Conclusions

### Recommendations Summary

| # | Recommendation | Priority | Effort | Status |
|---|---------------|----------|--------|--------|
| REC-1 | 三层级渐进式激活模型 (activation.tier) | P0 | S (~50-60 LOC) | ✅ Validated |
| REC-2 | tree-sitter AST 扫描 + git churn | P1 | M (~80-120 LOC) | ✅ Validated |
| REC-3 | Bootstrap 模板规范化 | P2 | Deferred | ⏸ Deferred |
| REC-4 | HumanLockView 批量审批 | P1 | S (~40-60 LOC) | Proposed |
| REC-5 | SSE 断线进度可视化 | P2 | XS (~15-25 LOC) | Proposed |

### Execution Path

1. **REC-1** (可立即启动): `agents-meta.ts` 添加 `activation.tier` 字段 → `get-rules.ts` 增加 tier 分支 → 零依赖、零 breaking changes
2. **评估 web-tree-sitter** (REC-2 前置): 确认 WASM 集成方案和包体积影响
3. **REC-2** (评估通过后): `forensic.ts` AST 替换 + `detector.ts` tech profile 扩展
4. **REC-4** (独立): HumanLockView 批量选择 + approve 端点数组支持
5. **REC-5** (独立): useEvents() 重试状态暴露到 header badge

### Validated Architecture

以下设计经分析确认正确，无需修改：Shadow Mirroring、Content-addressed revision chain、3 阶段结构化访谈、Dashboard 独立 SSE 通道、Stop Hook 强制初始化、L0/L1/L2 分层规则体系。

### Full Details

See `conclusions.json` for complete structured data including known issues, dependencies, and finding traceability.

### Round 4: Web Dashboard 交互模式深度分析

**Sources**: cli-explore-agent (9 Dashboard files analyzed)
**触发**: 用户指出 "Web 客户端的功能更偏向于查看，而不是主动操作和编辑"

#### Key Findings

**1. Dashboard 功能全景 — 观察+分诊工具**

| 视图 | 类型 | 写操作 | 核心能力 |
|------|------|--------|----------|
| RulesTreeView | 只读浏览 | 无 | 规则树展示、节点详情（file/scope/priority/hash/deps）、文本过滤 |
| HumanLockView | 读写 | POST /api/human-lock/approve | 漂移状态展示、单条审批 |
| IntentTimelineView | 读写 | POST /api/intent/annotate | AI/Human 双栏时间线、为 AI 条目添加人工注解 |
| HistoryReplayView | 只读 | 无 | 滑块式 ledger 历史回放、时间点快照查看 |
| DoctorView | 只读 | 无 | 系统健康状态、诊断检查列表（ok/warn/error） |

**核心数据**: 5 个视图中 3 个纯只读，2 个有写操作但仅限 2 个 POST 端点。Dashboard 本质是**观察与人工审查分诊工具**。

**2. SSE 数据流 — Pull-on-Push 模式**

`useEvents()` hook 维护单一 SSE 连接（`/events`），接收 5 种事件类型。每个视图通过 `useEffect` 监听 `lastEvent.type`，收到相关事件后发起独立的 GET 请求刷新数据 — **不是直接状态注入，而是 SSE 触发 → HTTP 拉取**。唯一例外：`IntentTimelineView` 的 `ledger:appended` 直接注入 payload 到本地状态。

断线重连: 指数退避（1s → 2x → cap 30s），但 UI 仅显示 "connecting" badge，无重试次数或下次重试倒计时。

**3. 交互缺口 — 6 个"看得到、做不了"**

| 缺口 | 描述 | 影响 |
|------|------|------|
| 无规则编辑/创建 | RulesTreeView 纯展示，不能修改任何规则 | 规则管理必须切换到 CLI 或直接编辑文件 |
| 无批量审批 | HumanLockView 逐条审批，无"全部批准" | 大规模重构后审批摩擦极高 |
| 注解仅追加 | IntentTimeline 注解不可编辑/删除 | 错误注解永久存在 |
| 历史回放无回滚 | 看到规则退化但无法从 Dashboard 恢复 | 回滚需切换到 CLI |
| Doctor 无修复动作 | 诊断发现问题但无一键修复 | 纯观察，所有修复在 Dashboard 外 |
| 断线无进度感知 | 用户无法区分瞬态闪断与持续故障 | 需打开 DevTools 才能判断 |

#### Analysis: "查看为主"定位的合理性

Dashboard 的"查看为主"定位与 Fabric Protocol 的**架构约束高度一致**：

1. **规则的 Source of Truth 在文件系统** — `.fabric/agents/` 目录是规则的唯一源。Dashboard 如果提供规则编辑，会引入双写问题（Dashboard 写 vs CLI 写 vs AI 写），与 Shadow Mirroring 的单源模型冲突。

2. **写操作精确限制在人工审查域** — 仅有的 2 个写端点（approve lock、annotate intent）恰好是**只有人类才能做的判断**：确认文件变更合规（lock approve）、为 AI 行为添加人类上下文（intent annotate）。这是正确的职责分离。

3. **Pull-on-Push 是防御性设计** — SSE 仅作通知，实际数据通过 HTTP GET 拉取，保证视图数据与 REST API 一致。这避免了状态分裂（SSE payload vs API response 不同步），但代价是每次事件触发一次额外网络往返。

#### Recommendation

> **Finding**: Dashboard 的"查看为主"定位是正确的架构选择，而非功能缺失。但有两个精确改进点值得实施：
> - **Confidence**: HIGH
> - **Scope**: Intent 3（本地-Web 协作效率）

> **Solution**: HumanLockView 批量审批
> - **Status**: Proposed
> - **Problem**: 大规模重构后逐条审批摩擦极高
> - **Rationale**: 这是 Dashboard 仅有的 2 个写域之一，且批量审批不引入新的数据源问题
> - **Effort**: S — 前端增加全选+批量 POST，后端在现有 approve 端点基础上支持数组
> - **Next Action**: 评估 approve 端点是否支持批量 body

> **Solution**: SSE 断线进度可视化
> - **Status**: Proposed
> - **Problem**: 用户无法区分瞬态断连与持续故障
> - **Rationale**: useEvents() 已有 retryCount 和 backoff 状态，只需暴露到 UI
> - **Effort**: XS — 将 retryCount + nextRetryMs 渲染到 header badge
> - **Next Action**: 直接实施

#### Decision Log

> **Decision**: Dashboard "查看为主"是正确定位，不建议增加规则编辑功能
> - **Context**: 用户观察到 Dashboard 偏查看，要求分析其交互模式
> - **Chosen**: 确认当前定位正确，仅提出 2 个增量改进（批量审批 + 断线感知）
> - **Reason**: 规则的 Source of Truth 在文件系统，Dashboard 引入规则编辑会与 Shadow Mirroring 单源模型冲突。Dashboard 的价值在于提供 AI 无法替代的人工审查通道
> - **Impact**: 新增 REC-4（批量审批）和 REC-5（断线可视化）


### Round 5: Dashboard 功能愿景 — "观察与记录平台"

**Sources**: Gemini CLI 深度分析（gem-171104-enc6）
**触发**: 用户明确定位 Dashboard 为"更好的看见、更好的规则可视化、更好的记录"工具

#### 设计哲学

Dashboard 定位为类似 Grafana/Datadog/Sentry 的**可观测性平台** — 高密度信息监控舱，而非 CMS 编辑工具。核心原则：

- 规则 SoT 在文件系统，Dashboard **零编辑入口**
- 写操作严格限于人工审查域（lock approve + intent annotate）
- 现有 schema（`deriveAgentsMetaLayer`、`topology_type`、`deps`）是视图推导的天然数据源

#### 功能建议矩阵

**维度一：可视化增强**

| # | 功能 | 价值 | 复杂度 | 描述 | 参考 |
|---|------|------|--------|------|------|
| V1 | 规则拓扑知识图谱 | HIGH | M | 基于 deps/layer/topology_type 构建 DAG，不同颜色区分 L0/L1/L2 | Datadog Service Map |
| V2 | 作用域覆盖矩阵 | HIGH | S | 文件树 × scope_glob 热图，暴露"规则真空区"和"过度冲突区" | SonarQube Treemap |
| V3 | 漂移差异检视器 | MEDIUM | M | hash 变化时双栏 diff + 下游 deps 波及高亮 | GitHub PR Diff |

**维度二：观察增强**

| # | 功能 | 价值 | 复杂度 | 描述 | 参考 |
|---|------|------|--------|------|------|
| O1 | 规则命中率热力图 | HIGH | M | 统计 Intent 中引用的规则频次，标记僵尸规则和热点规则 | Grafana Heatmap |
| O2 | AI 推理链路追踪 | HIGH | L | 将 AI 行为展开为瀑布图：L0 → L1 cross-cutting → L2 镜像 | Jaeger Tracing |
| O3 | 健康趋势折线图 | MEDIUM | S | 基于错误和阻拦记录绘制日趋势，观察 AI 适应性 | Datadog Alert Dashboard |

**维度三：记录增强**

| # | 功能 | 价值 | 复杂度 | 描述 | 参考 |
|---|------|------|--------|------|------|
| R1 | 带快照的意图时间机器 | HIGH | L | 回放时同步复原当时的规则树和文件状态摘要 | Vercel Deploy Preview |
| R2 | 多维审计过滤器 | MEDIUM | S | 结构化过滤（action + layer + time range） | Sentry Discover |
| R3 | 结构化决策日志展示 | HIGH | XS | JSON Tree 折叠面板 + 代码文件直链 | AWS CloudTrail |

**维度四：明确边界（坚决不做）**

| # | 边界 | 描述 | 参考 |
|---|------|------|------|
| B1 | 零规则编辑入口 | 无 textarea 修改 .fabric/agents/，仅展示只读警告 + CLI 命令指引 | ArgoCD GitOps 锁定 |
| B2 | 禁止元数据手动重写 | layer/priority 严格由 deriveAgentsMetaLayer 路径推导，不可 UI 拖拽修改 | K8s Dashboard |
| B3 | 写域物理隔离 | approve/annotate 在专属模态弹窗中，与消费视图形式割裂 | GitHub Actions 审批确认 |

#### 推荐实施优先级

1. **第一批（HIGH 价值 + ≤S 复杂度）**: V2（作用域覆盖矩阵）、R3（结构化日志展示）、O3（健康趋势）
2. **第二批（HIGH 价值 + M 复杂度）**: V1（规则 DAG）、O1（命中率热图）、V3（漂移 Diff）
3. **第三批（HIGH 价值 + L 复杂度）**: O2（AI 链路追踪）、R1（快照时间机器）
4. **边界守卫（持续）**: B1/B2/B3 作为 Design Principle 固化到代码审查清单

#### Decision Log

> **Decision**: Dashboard 演进方向确定为"高密度信息监控舱"
> - **Context**: 用户定位 Dashboard 为"更好的看见、可视化、记录"，Gemini CLI 完成行业对标分析
> - **Chosen**: 12 项功能建议（3 可视化 + 3 观察 + 3 记录 + 3 边界），分 3 批实施
> - **Reason**: 对齐 Grafana/Datadog/Sentry 设计范式；复用 agents-meta.ts 已有的 layer/topology_type/deps 数据结构；不引入规则编辑能力
> - **Impact**: 为 Dashboard 建立了清晰的功能路线图和设计边界

### Round 6: Dashboard 定位升级 — 纯观察平台

**Sources**: 用户深度反馈 + 四模块愿景
**关键转变**: Dashboard 从"观察+分诊（有 approve/annotate）"收紧为**纯观察平台（零写操作）**

#### 定位修正

> **Decision**: Dashboard 移除所有写操作，包括 approve 和 annotate
> - **Context**: 用户明确"不希望让 Dashboard 拥有编辑的权限以及审批的功能"
> - **Previous**: R4 认为 approve/annotate 是正确的"人工审查域"写操作
> - **New**: 连审批也移出 Dashboard — 审批通过 CLI 或其他机制完成
> - **Reason**: "在复杂的分布式系统中，观测能力（Observability）比操作能力（Actionability）更难获得"。Dashboard 是"第二屏幕"，在写代码时提供侧面的信息支撑，不打断开发者心流
> - **Impact**: REC-4（批量审批）不再属于 Dashboard 范围；approve/annotate 端点保留但仅供 CLI/API 调用；Dashboard 变为 100% 只读

#### 四模块重构

用户提出的四模块架构比 Round 5 的分维度方案更具产品思维，重新组织如下：

**模块 A：规则脉络与激活拓扑 (Rule Topology)**

不是看 .md 文件，而是看规则之间的**继承与生效关系**。

| 功能 | 描述 | 数据源 | 复杂度 |
|------|------|--------|--------|
| 动态激活高亮 | AI 处理 `src/components/Dialog.ts` 时，实时高亮激活的规则链（L0→L1→L2） | SSE `meta:updated` + `fab_get_rules` 调用日志 | M |
| 命中理由可视化 | 展示规则为何被加载 — Glob 匹配？Description 语义匹配（REC-1）？Always-on？ | `get-rules.ts` 返回值增加 `matchReason` 字段 | S |
| 覆盖率热力图 | 哪些目录有完善的规则覆盖，哪些是"知识荒原" | `agents.meta.json` scope_glob 与项目文件树交叉 | S |
| 规则冲突报警 | L0 说用 Tabs、L2 说用 Spaces — 可视化冲突比终端报错更直观 | 规则内容语义分析（需 NLP 或人工标记冲突维度） | L |

**模块 B：认知偏差探针 (Cognitive Forensic)**

让用户看到 **AI 眼睛里的项目**长什么样。

| 功能 | 描述 | 数据源 | 复杂度 |
|------|------|--------|--------|
| 技术栈指纹图 | 基于 REC-2 的 AST 扫描，可视化框架版本、组件依赖关系图 | `forensic.json` 扫描结果 | M |
| 信心指数度量 | MEDIUM confidence 模块用颜色预警，提醒用户补充文档 | `forensic.ts` confidence 评分 | S |
| 认知覆盖地图 | AI 对项目各模块的理解深度热图（HIGH/MEDIUM/LOW 三色） | forensic 扫描 + 规则覆盖率 | M |

**模块 C：语义时间线 (Semantic Timeline)**

保留 IntentTimeline 的观察能力，但**移除写操作**（注解通过 CLI 完成）。

| 功能 | 描述 | 数据源 | 复杂度 |
|------|------|--------|--------|
| AI 推理链路追踪 | 瀑布图展示：读取 L0 → 触发 L1 cross-cutting → 应用 L2 镜像 | ledger 事件流 | L |
| 漂移可视化 | "代码现状"与"规则要求"的偏差展示（只看不审批） | human-lock drift 状态 | S |
| 注解展示 | 展示通过 CLI 添加的注解，Dashboard 只读 | ledger human entries | XS |

**模块 D：时间胶囊与回溯 (Historical Ledger)**

| 功能 | 描述 | 数据源 | 复杂度 |
|------|------|--------|--------|
| 认知 Diff | 不只是代码 Diff，而是**项目认知的 Diff** — "3 小时前 AI 认为安全，为什么现在觉得有风险？" | ledger 时间线 + forensic 快照 | L |
| 交互回放 | "幻灯片"模式回放 AI 思考的每一步 | ledger entries 按时序排列 | M |
| 状态快照对比 | 任意两个时间点的规则树 + 认知状态并排对比 | history replay API + forensic snapshots | L |

#### 突破性概念：规则沙盒

> **Finding**: 用户提出"规则沙盒" — 在不改变文件的前提下，模拟"如果我增加这条规则，AI 的认知会发生什么变化"
> - **Confidence**: 概念验证阶段
> - **Scope**: 这是 Dashboard 从"被动观察"进化到"主动洞察"的关键跃迁
> - **Implementation Path**: 需要 server 端支持 `dry-run` 模式的 `fab_get_rules` — 接受临时规则注入，返回模拟后的激活结果，但不写入文件系统
> - **Effort**: L — 涉及 server 端 dry-run API + Dashboard 模拟 UI

#### 关于规则冲突可视化的回应

用户问：规则冲突的可视化提示是否比 AI 终端报错更能提升开发体验？

**是的，显著优于终端报错**，原因：

1. **冲突是结构性问题，需要空间思维** — 终端只能展示线性文本（"L0 says X conflicts with L2 says Y"），而可视化能在规则拓扑图上同时高亮冲突的两端，让开发者看到冲突在规则层级中的**位置**
2. **冲突有传播性** — 一个 L0 规则的修改可能与多个 L2 产生冲突。拓扑图能一眼展示波及范围，终端需要逐条报错
3. **冲突需要上下文** — 看到冲突时，开发者需要同时查看两条规则的内容、scope、优先级才能做判断。Dashboard 的并排展示比 CLI 翻文件高效得多
4. **被动发现 vs 主动探索** — 终端报错是被动的（AI 遇到冲突才报），Dashboard 可以**持续展示**所有潜在冲突，让开发者在编写规则时就预防问题

实现建议：从 `agents.meta.json` 的 scope_glob 交叉检测起步（相同 glob 范围内的不同层级规则），进阶到内容级语义冲突检测。

#### 修订后的 Dashboard 设计原则

1. **零写入** — Dashboard 不拥有任何写端点。审批和注解通过 CLI 完成
2. **第二屏幕** — 在写代码时提供侧面信息支撑，不打断心流
3. **架构腐烂照镜子** — 如果 Web 端画出一棵乱七八糟的规则树，你一眼就能发现架构腐烂
4. **SSoT 纯净度** — 保护 Git 记录不被"来自 Dashboard 的自动提交"污染
5. **AI 透明化** — 让人类看到 AI 眼中的项目，而不是 AI 告诉人类它看到了什么

#### Decision Log

> **Decision**: Dashboard 重新定位为纯观察平台（零写操作），采用四模块架构
> - **Context**: 用户反馈移除 approve/annotate，提出 A/B/C/D 四模块愿景 + 规则沙盒概念
> - **Chosen**: 四模块架构（Rule Topology + Cognitive Forensic + Semantic Timeline + Historical Ledger）+ 规则沙盒作为进阶目标
> - **Reason**: "观测能力比操作能力更难获得"；Dashboard 是第二屏幕；保护 SSoT 纯净度
> - **Impact**: REC-4/REC-5 废弃；Round 5 的 12 项建议按四模块重组；新增规则沙盒概念

#### Round 6 补充：用户关键约束

**约束 1：CLI 补偿机制**

> **Finding**: REC-4（批量审批）从 Dashboard 撤回后，CLI 必须具备 `fab approve --all` 或交互式批量处理能力
> - **Confidence**: HIGH — 用户明确指出
> - **Scope**: 否则操作摩擦力只是从 Web 端转移到终端，问题并未解决
> - **Implementation**: CLI 需新增 `fab approve --all`（批量审批所有 drift）和 `fab approve --interactive`（逐条确认）命令
> - **Priority**: 与 Dashboard 零写入决策绑定 — 如果 CLI 不补偿，Dashboard 零写入就是倒退

**约束 2：规则沙盒隔离性**

> **Finding**: 规则沙盒的 dry-run 模式必须是**纯内存语义模拟**
> - **Confidence**: HIGH — 用户明确要求
> - **Must NOT**: 触发任何真实的 Stop Hook、写入任何物理文件、修改 agents.meta.json、产生 ledger 事件
> - **Must**: 在内存中构建临时规则图，执行 `loadRulesForPath` 的模拟版本，返回"如果这条规则存在，哪些文件会受影响"的预测结果
> - **Implementation**: server 端需要一个 `simulateRules` 函数，接受临时规则 payload，返回模拟匹配结果，完全隔离于真实状态
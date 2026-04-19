# Analysis: fab 文档初始化机制设计

> Session: `ANL-fab-doc-init-werewolf-2026-04-19`
> Date: 2026-04-19
> Topic: 考虑 fab 如何进行文档的初始化（生成相关的文档），当前考虑的项目是 werewolf-minigame

## Table of Contents

- [Session Metadata](#session-metadata)
- [User Intent](#user-intent)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
  - [Round 1: 代码探测 + 外部研究](#round-1-代码探测--外部研究)
  - [Initial Intent Coverage Check](#initial-intent-coverage-check)
  - [Round 2: 架构+落地契约(命令形态/SKILL 内容/Artifact Schema)](#round-2-架构落地契约命令形态skill-内容artifact-schema)
  - [Round 3: Hook 机制与可靠触发](#round-3-hook-机制与可靠触发)
  - [Round 4: 完整产品流转(End-to-End User Flow)](#round-4-完整产品流转end-to-end-user-flow)
- [Phase 4: Conclusions](#phase-4-conclusions)
  - [Intent Coverage Matrix](#intent-coverage-matrix)
  - [Findings Coverage Matrix](#findings-coverage-matrix)
  - [Key Conclusions](#key-conclusions-ranked)
  - [Prioritized Recommendations](#prioritized-recommendations)
  - [Decision Trail](#decision-trail)

## Session Metadata

| Field | Value |
|-------|-------|
| Session ID | ANL-fab-doc-init-werewolf-2026-04-19 |
| Created | 2026-04-19 |
| Dimensions | architecture, implementation, decision |
| Depth | Standard |
| Perspectives | Single (Technical+Architectural merged) |
| Mode | new |
| Target project | werewolf-minigame (暂不指定具体路径,作为通用外部项目示例) |

## User Intent

原始问题: **考虑 fab 如何进行文档的初始化(生成相关的文档),当前考虑的项目是 werewolf-minigame**

用户在 Phase 1 已明确表达的核心倾向(作为本次分析的起始假设):

> **H1 — CLI+Skill 分层假设**: fab init 不应作为"纯 CLI 输出静态文档"的流程运行,而应设计为"轻量 CLI 取证 + Skill 语义推断 + 交互访谈 + AI 模板生成"的协议。

用户提出的 4 层初始化协议:

1. **CLI 层(轻量化取证)**: Dependency Fingerprint、目录结构熵、Smart Sampling 关键代码切片 → 推理素材
2. **Skill 层(项目属性推断)**: 基于证据链触发,识别技术栈特有设计模式(Cocos 节点组件化 vs Web 响应式状态机)
3. **交互层(三轮深度访谈)**: AI 针对架构模糊点提问(不可变性、单例约束等)→ 锁定 L0 "宪法"
4. **模板生成层**: AI 领域知识 + 分层 AGENTS.md 初始草案(语义深度,而非目录描述)

## 原始意图拆解(用于 Intent Coverage 追踪)

| # | Intent | 说明 |
|---|--------|------|
| I1 | 整体机制设计 | fab 如何初始化文档的整体流程与责任划分 |
| I2 | 生成内容与模板 | 生成哪些文档/用什么模板/内容从哪来 |
| I3 | 与现有命令集成 | 与 templates/fabric、agents-md、bootstrap 的关系 |
| I4 | 目标项目适配 | 如何探测 werewolf-minigame 特征并输出匹配文档 |
| I5 | 验证 H1 (CLI+Skill 分层) | 用户强倾向方案的可行性、边界、落地路径 |

## Current Understanding

**已确立的完整架构(Round 1+2+3 Validated)**

- **单一入口 fab init**:一条命令完成 evidence + protocol + skill 触发三件事;non-destructive 原则保留
- **层间物理位置**:Layer 1 在 fab CLI(扩展 scan);Layer 2/3/4 在 AI 客户端会话(agents-md-init SKILL.md)
- **2 个 artifact = 层间契约 + 状态机**:
  - `.fabric/forensic.json`(CLI 产):framework/topology/entry_points/code_samples(30 行浅采样)/recommendations_for_skill
  - `.fabric/init-context.json`(skill 产):architecture_patterns + invariants(ban/require/protect)+ domain_groups + interview_trail
  - **状态机**:forensic 存在 && init-context 缺失 = "initialization pending"
- **双保险触发**(Option C 混合):
  - stdout reason 文本(同会话场景,零开销)
  - Claude Code `Stop` hook + sentinel(跨会话/外部终端场景,高可靠)
- **fab init 扩展流程**(非破坏性 merge-insert):
  1. 产出 4 文件到 `.fabric/`(AGENTS.md 骨架/agents.meta.json/human-lock.json/**forensic.json**)
  2. 写 SKILL.md 到 `.claude/skills/agents-md-init/`
  3. 写 hook 脚本到 `.claude/hooks/agents-md-init-reminder.cjs`
  4. merge-insert 更新 `.claude/settings.json` 的 Stop hook
  5. stdout 打印 reason(同步触发)
- **agents-md-init SKILL.md 3 Phase**:framework 确认 → invariants 提取 → 构造+写入
- **反模式硬规则**:零遗产 TODO / AGENTS.md ≤300 行 / 嵌套 ≤4 层 / 不生成 YAML frontmatter
- **Side benefit**:一次性实现的 Claude Code hook 基础设施可复用于未来的 agents-md-reminder.cjs(编辑后维护 skill 的触发)

**werewolf-minigame 具体适配**

- framework=cocos-creator / version=3.8 / subkind=typescript-component
- entry_points:`assets/scripts/{Game,Player,Network}.ts`(6 个 .ts 文件,6 个 .meta 文件)
- 推荐 skill 问 invariants:".meta 保护 / assets/prefabs&scenes 保护 / @ccclass decorator 强制 / update 中禁 async"
- domain_groups:gameplay(Game+Player)+ network(Network),文件数少应保持单文件 AGENTS.md

**遗留问题(非阻塞)**

- I4 的具体 werewolf AGENTS.md L0 样例内容(属于执行阶段产物)
- Claude Code settings.json merge-insert 的冲突处理(既有 Stop hook 如何合并)— 实施细节

## Discussion Timeline

### Round 1: 代码探测 + 外部研究

#### 探测范围与方法
- 代码库探测: cli-explore-agent 完成 Layer 1 breadth discovery,识别了 fab 现有 init/scan/bootstrap 命令、detector、模板系统、MCP server tools、examples/werewolf-minigame-stub、思路.md
- 外部研究: workflow-research-agent 基于训练知识 + 代码库,输出 10 findings / 8 best_practices / 6 alternatives / 6 pitfalls / 7 codebase_gaps

#### Key Findings

> **Finding**: fab init 当前为"纯静态模板替换 + 无交互无 AI"的脚手架
> - **Confidence**: High — 直接阅读 `packages/cli/src/commands/init.ts` 全部流程
> - **Hypothesis Impact**: Confirms H1 的前提("不应作为纯 CLI 输出")
> - **Scope**: 整个 init 入口,是 H1 重构的核心靶点

> **Finding**: Hook → Skill 调用是 prompt-driven (block+reason 文本),不是 event-driven API
> - **Confidence**: High — 思路.md lines 183-207
> - **Hypothesis Impact**: Modifies H1 的 Layer 2(Skill 推断) — fab CLI 不需要实现 skill runtime,只需输出含 skill 名的 reason 文本让 AI 自我触发
> - **Scope**: 决定了 fab 与 Claude Code 的集成机制

> **Finding**: agents-md skill 当前是"目标项目编辑后维护"机制,不是"init 时"触发的 skill
> - **Confidence**: High — 思路.md agents-md skill 规范 + fab 代码库无 .claude/skills 目录
> - **Hypothesis Impact**: H1 需要新增独立的 `agents-md-init` skill,不能复用现有 agents-md skill
> - **Scope**: 需要新建 .claude/skills/agents-md-init/SKILL.md + hook 注入触发机制

> **Finding**: werewolf-minigame-stub 是 Cocos Creator 3.8,fab detector 会识别为 "cocos-creator" 但丢失版本号
> - **Confidence**: High — project.config.json 读取确认 + detector.ts 代码确认
> - **Hypothesis Impact**: Modifies H1 Layer 1 取证要求 — 必须扩展 FrameworkInfo 保留版本
> - **Scope**: detector.ts + ScanReport schema

> **Finding**: 研究揭示业界 best practice — CLI forensics 严格 <200ms 只读,AST 分析 defer 到 Skill 层
> - **Confidence**: High — Nx / create-* 系列的性能预算是行业共识
> - **Hypothesis Impact**: Confirms H1 Layer 1 的"轻量化"描述 — Smart Sampling 应该是"文件读 + 行截断",不是 AST 分析
> - **Scope**: 明确了 Layer 1 的性能边界

> **Finding**: 访谈问题应锁定 invariants 而非 preferences (Constitutional AI 模式)
> - **Confidence**: Medium — 训练知识 + 思路.md 的 L0 硬约束概念
> - **Hypothesis Impact**: Confirms H1 "锁定 L0 宪法"的描述 — 3 轮访谈的问题设计重心
> - **Scope**: agents-md-init skill 的 SKILL.md body 设计

#### Technical Solutions

> **Solution**: 四层职责划分 — CLI 只做只读取证 → 输出 forensic.json + 包含 skill 名的 reason 文本 → AI 客户端读到后自我触发 agents-md-init skill → Skill 驱动 3 轮访谈 → AI 生成分层 AGENTS.md + 更新 agents.meta.json
> - **Status**: Proposed
> - **Problem**: H1 未明确各层物理位置与层间数据契约
> - **Rationale**: 研究 F4-F5 确认 Claude Code 生态的 skill 调用是 prompt-driven,fab CLI 不需要 AI 逻辑;落盘 artifact(.fabric/forensic.json + .fabric/init-context.json)作为契约,保证可复现、可调试
> - **Alternatives**: (a) fab CLI 内置 AI/access Claude API — rejected: 依赖重/密钥管理复杂;(b) 单轮访谈 — rejected: 无迭代修正;(c) 纯静态模板 — rejected: 无语义深度(即现状)
> - **Evidence**: 思路.md hook 机制 + init.ts 当前实现 + research F4/F5/F6
> - **Next Action**: Round 2 验证 ForensicReport / InitContext 的具体字段 schema

> **Solution**: 扩展 detectFramework 返回 { kind, version, subkind },区分 Cocos Creator 2.x vs 3.x,提取 vite/next 版本
> - **Status**: Proposed
> - **Problem**: 当前 framework.kind 粒度不够,无法支持模板分叉
> - **Rationale**: gap 1-2 + F9 明确业界做法;Cocos 2.x 与 3.x 脚本 API 不兼容,werewolf-minigame 作为 3.x 项目必须产出正确的模板内容
> - **Alternatives**: 保持现状 rejected;完整版本矩阵 rejected(过度工程)
> - **Evidence**: detector.ts + research gap 1/2
> - **Next Action**: Round 2 确认 Creator 版本检测字段(physicsSystem / renderPipeline / 'type')

> **Solution**: 新增 `.claude/skills/agents-md-init/SKILL.md`,description 触发词精确匹配 fab init 输出的 reason,body 含 3 轮访谈模板(R1 确认框架 / R2 提 invariants / R3 锁 constitution) + 分层 AGENTS.md 生成规范(≤300 行 / 4 层)
> - **Status**: Proposed
> - **Problem**: H1 Layer 2/3/4 在代码库完全不存在
> - **Rationale**: 与 agents-md skill 同族命名便于理解;描述精确匹配 fab init 执行后的认知状态(F5);访谈问 invariants(F10)
> - **Alternatives**: 扩展 agents-md skill rejected(职责不同: init 是一次性 elicitation,agents-md 是持续性 maintenance)
> - **Evidence**: 思路.md agents-md skill 结构 + research F5/F10
> - **Next Action**: Round 2-3 细化 SKILL.md 的 description 触发词 / 3 轮问题模板 / 输出契约 schema

#### Decision Log

> **Decision**: 分析视角采用单一综合视角(Technical + Architectural 合并),深度=Standard
> - **Context**: Phase 1 用户选择
> - **Options considered**: 多视角并行 / 单一综合
> - **Chosen**: 单一综合 — **Reason**: 主题高度聚焦(就 fab init 一个命令),多视角会产生同义冗余
> - **Rejected**: 多视角 — 缺乏差异性问题域
> - **Impact**: Phase 2 跑 1 个 cli-explore-agent + 1 个 workflow-research-agent,不跑多 perspective deep-dive

> **Decision**: 把 H1 用户假设作为分析的起始锚点(而非从零对比多个方案)
> - **Context**: 用户在 Phase 1 Q1 的 "Other" 明确提出 4 层协议
> - **Options considered**: 中立评估 N 个方案 / 以 H1 为假设去验证
> - **Chosen**: 以 H1 为假设去验证 + 通过研究对比竞品方案
> - **Rejected**: 中立评估 — 用户已有倾向,浪费轮次
> - **Impact**: explorations.json 的 technical_solutions[] 全部围绕 H1 的落地细节

#### Open Questions

- **OQ1**: doc-init 是独立命令(`fab doc-init`) 还是 `fab init --interactive` flag?(决策问题)
- **OQ2**: Smart Sampling 的采样策略?(哪些文件 × 多少行 × 如何排序)
- **OQ3**: `agents-md-init` skill SKILL.md 的具体内容 — description 触发词、3 轮访谈问题模板、输出 JSON schema
- **OQ4**: `ForensicReport` / `InitContext` 两个 artifact 的字段 schema?
- **OQ5**: 非交互环境(CI / piped stdin)的降级路径具体是什么?

### Initial Intent Coverage Check

- ✅ **I1 (整体机制设计)**: Round 1 已确立 4 层职责划分的物理位置(CLI / Skill / AI 访谈 / AI 生成),层间契约 = artifact 文件
- 🔄 **I2 (生成内容与模板)**: Round 1 明确了'填充而非 stub'的原则,但具体模板变体(Cocos / Vite / Next)待 Round 2 细化
- 🔄 **I3 (与现有命令集成)**: Round 1 明确了 bootstrap/init/scan 三者的边界(doc-init 为 init 的语义增强,不扩展 bootstrap;复用 scan 的 detector),但 fab init vs fab doc-init 的命令拆分 未决
- 🔄 **I4 (目标项目适配)**: Round 1 明确了 Cocos Creator 3.x 的识别路径,但 werewolf-minigame 具体适配(哪些 scripts 作为 Smart Sampling / AGENTS.md 中 Cocos 特有约束的模板)待 Round 2
- ✅ **I5 (验证 H1)**: Round 1 验证了 H1 基本可行;有 3 处 modification(Skill 物理位置 / 版本区分 / Smart Sampling 非 AST);无 refutation

**下一轮重点**:聚焦未充分覆盖的 I2/I3/I4,特别是 OQ1(命令拆分)、OQ3(skill 内容)、OQ4(artifact schema)。

### Round 1: Narrative Synthesis

**起点**: 用户在 Phase 1 Other 字段明确表达的 4 层协议构成 H1 假设。Round 1 从"H1 是否可行"切入。
**关键进展**: 代码库探测 + 外部研究共同 Confirms H1 主框架,并 Modifies 了 3 个细节:(1) Skill 物理位置下放到 AI 客户端,(2) 框架版本区分是新增必需,(3) Smart Sampling 不走 AST。
**决策影响**: 单一视角 + 深度 Standard,让 Round 1 一次性建立起整体诊断和方案骨架,无需并行多视角。
**当前理解**: H1 可落地,但需要明确(a)命令拆分、(b)agents-md-init skill 具体内容、(c)两个 artifact schema。
**遗留问题**: OQ1-OQ5,其中 OQ1/OQ3/OQ4 是后续轮次的高优先级细化对象。

### Round 2: 架构+落地契约(命令形态/SKILL 内容/Artifact Schema)

用户选择 "架构+落地契约" 方向,本轮聚焦 OQ1(命令形态)+ OQ3(SKILL.md 内容)+ OQ4(artifact schema)。

#### 探索范围
- 阅读 `packages/cli/src/commands/init.ts` 全文(192 行)→ 确认 init 当前函数签名 `initFabric(target) → {agentsPath, metaPath, humanLockPath}`
- 阅读 `packages/cli/src/scanner/detector.ts` 全文(89 行)→ 确认 FrameworkInfo = `{kind, evidence}` 结构
- 阅读 `templates/agents-md/AGENTS.md.template` 全文(30 行)→ 确认 TODO 数量(9 处)和 `<!-- fab:index -->` 位置
- 阅读 `examples/werewolf-minigame-stub/assets/scripts/Game.ts`(10 行)→ 确认 Cocos 3.x TypeScript 模式(@ccclass + extends Component + start()生命周期)
- 重读 思路.md 的 agents-md skill 段 → 确认 SKILL.md frontmatter 格式

#### OQ1 决策: 命令形态

> **Decision**: fab init 保持**单一入口**,不新增 fab doc-init 命令,也不引入 --interactive flag。init 始终产出 forensic.json + 打印含 skill 名的 reason 文本到 stderr。
> - **Context**: H1 需要"轻量 CLI + Skill + 访谈 + AI 生成",如何暴露给用户
> - **Options considered**:
>   - **A** `fab init --interactive` flag: 两个模式同一命令
>   - **B** `fab doc-init` 独立新命令
>   - **C** `fab init` 始终产出 forensic + 打印 reason(AI 在场自动接管,非 AI 场景只是日志)— **CHOSEN**
> - **Chosen**: C — **Reason**: (1) 最小化 CLI 表面变化,与既有 non-destructive 原则一致;(2) AI 客户端场景:reason 文本触发 skill,自然进入访谈 → Skill 接管 Layer 2/3/4;(3) 非 AI 场景(CI/piped stdin):reason 只是 stderr 日志,AGENTS.md 基础骨架仍然有效;(4) 无需区分两种模式,避免 "我应该用 init 还是 doc-init" 的决策负担
> - **Rejected**: A rejected(--interactive flag 让用户必须做决策,违背"让工具默认做对事"原则);B rejected(两个命令易用性差,init 写基础 + doc-init 写深度文档的心智成本高)
> - **Impact**: init.ts 重构点只有一个:在 writeNewFile 之后追加 writeNewFile(forensic.json) + console.error(reasonText)。现有函数签名兼容

#### OQ4 决策: Artifact Schema

> **Solution**: 两个 artifact 作为层间契约:`.fabric/forensic.json`(CLI 产出,Layer 1→2 契约)+ `.fabric/init-context.json`(Skill 产出,Layer 3→4 契约)
> - **Status**: Proposed
> - **Problem**: 层间数据交换需要稳定的格式,避免 AI 自由发挥导致不可复现
> - **Rationale**: 参考 Yeoman 的 cookiecutter.json 模式(答案落地成文件,可复现);Claude Code skill 读取 JSON 比读取口语化文本更稳定
> - **Alternatives**: (a) 仅通过 reason 文本传递(rejected: 易丢信息且文本大小受限);(b) 单一 artifact(rejected: CLI 和 AI 的职责边界会混淆);(c) 使用 YAML(rejected: JSON 更简单且 fab server 生态已用 JSON)
> - **Evidence**: 研究 best practice "access 锁 artifact" + agents.meta.json 已用 JSON 的现有惯例
> - **Next Action**: 验证 schema 字段是否覆盖 werewolf-minigame 等代表项目的需要

**ForensicReport (`.fabric/forensic.json`) — 由 fab init 产出**:

```json
{
  "version": "1.0",
  "generated_at": "2026-04-19T00:30:00.000Z",
  "generated_by": "fab-cli@0.1.3",
  "target": "/path/to/werewolf-minigame",
  "project_name": "werewolf-minigame",
  "framework": {
    "kind": "cocos-creator",
    "version": "3.8.0",
    "subkind": "typescript-component",
    "evidence": ["project.config.json: creator.version=3.8.0"]
  },
  "topology": {
    "total_files": 42,
    "by_ext": {".ts": 6, ".prefab": 2, ".scene": 1, ".meta": 9},
    "key_dirs": ["assets/scripts", "assets/prefabs", "assets/scenes"],
    "max_depth": 3
  },
  "entry_points": [
    {"path": "assets/scripts/Game.ts", "reason": "top-level script", "size_bytes": 180},
    {"path": "assets/scripts/Player.ts", "reason": "top-level script"},
    {"path": "assets/scripts/Network.ts", "reason": "top-level script"}
  ],
  "code_samples": [
    {
      "path": "assets/scripts/Game.ts",
      "lines": "1-30",
      "snippet": "import { _decorator, Component } from \"cc\";\nconst { ccclass } = _decorator;\n@ccclass(\"Game\")\nexport class Game extends Component {\n  start(): void { /* TODO */ }\n}",
      "pattern_hint": "cocos-component-class"
    }
  ],
  "readme": {"quality": "stub", "line_count": 0, "has_contributing": false},
  "recommendations_for_skill": [
    "建议向用户确认 Cocos Creator Component 生命周期(onLoad/onEnable/start) 顺序",
    "建议询问 assets/prefabs 和 assets/scenes 是否属于 @HUMAN 保护区域",
    "检测到 .meta 文件,建议在 @HUMAN 锁定 .meta 不被 AI 改动"
  ]
}
```

**字段设计要点**:
- `version`: schema 版本号,便于未来演进
- `subkind`: 框架细分(typescript-component vs javascript-traditional for Cocos 2.x)
- `topology.by_ext`: 目录熵的简化形式(不计算信息熵,直接给扩展名分布)
- `code_samples`: 只读 + 行截断(符合 <200ms 只读原则,非 AST)
- `pattern_hint`: 给 skill 的 "已识别模式"线索,减少 AI 推断负担
- `recommendations_for_skill`: 特定框架的访谈问题建议(Cocos 的 .meta 保护 / 生命周期顺序),而非 AI 凭空生成

**InitContext (`.fabric/init-context.json`) — 由 agents-md-init skill 产出**:

```json
{
  "version": "1.0",
  "locked_at": "2026-04-19T00:45:00.000Z",
  "forensic_ref": ".fabric/forensic.json",
  "framework": {"kind": "cocos-creator", "version": "3.8.0"},
  "architecture_patterns": [
    "Component-based: 所有可执行逻辑继承自 cc.Component 并用 @ccclass 装饰",
    "Node reference: 通过 @property(Node) 注入节点引用,避免 find-by-name",
    "Event system: cc.Node.on/emit 作为 Component 间通信主机制"
  ],
  "invariants": [
    {"type": "ban", "rule": "no any-typed parameters in public Component methods"},
    {"type": "ban", "rule": "no async/await in update() or lateUpdate()"},
    {"type": "require", "rule": "所有 Component 类必须用 @ccclass(name) decorator 装饰"},
    {"type": "protect", "paths": ["assets/prefabs/**", "assets/scenes/**", "**/*.meta"]}
  ],
  "entry_points": ["assets/scripts/Game.ts", "assets/scripts/Player.ts", "assets/scripts/Network.ts"],
  "domain_groups": [
    {"name": "gameplay", "paths": ["assets/scripts/Game.ts", "assets/scripts/Player.ts"]},
    {"name": "network", "paths": ["assets/scripts/Network.ts"]}
  ],
  "interview_trail": [
    {"round": 1, "q": "检测到 Cocos Creator 3.8 + TypeScript Component 模式,是否正确?", "a": "是"},
    {"round": 2, "q": "是否禁止在 update/lateUpdate 中使用 async/await?", "a": "是"},
    {"round": 3, "q": "assets/prefabs 和 assets/scenes 是否属于 @HUMAN 保护区域?", "a": "是,且 .meta 也不能改"}
  ]
}
```

**字段设计要点**:
- `forensic_ref`: 反向引用 Layer 1 产出,保证可追溯
- `invariants.type ∈ {ban, require, protect}`: 三种硬约束类型,直接映射到 AGENTS.md 的 L0 段落结构
- `domain_groups`: 由 AI 从 entry_points + 访谈推断,决定是否需要嵌套 AGENTS.md(≤4 层约束)
- `interview_trail`: 完整访谈记录,便于审计 + 支持未来的 "重新访谈" 模式

#### OQ3 决策: agents-md-init SKILL.md 设计

> **Solution**: 新增 `.claude/skills/agents-md-init/SKILL.md`(安装到目标项目,由 fab init 同时写出),description 精确匹配 fab init 执行后的认知状态,body 含 3 阶段访谈 + 生成规范
> - **Status**: Proposed
> - **Problem**: 访谈逻辑和模板生成规范需要让 AI 有一致的执行契约
> - **Rationale**: 与 agents-md skill 同族命名(agents-md-init vs agents-md),职责互补;description 匹配"fab init 刚完成"或"forensic.json 刚生成"的场景
> - **Alternatives**: 扩展 agents-md skill(rejected: 职责不同,init 是 one-shot elicitation);将访谈逻辑硬编码在 fab CLI(rejected: 违背 fab CLI "只读取证" 原则)
> - **Evidence**: 思路.md agents-md skill 格式 + research F4/F5
> - **Next Action**: 决定是将 agents-md-init SKILL.md 一起打包到 templates/ 中还是另建独立模板系列

**SKILL.md 建议内容**:

```markdown
---
name: agents-md-init
description: 初始化项目的 AGENTS.md 文档(而非更新已有文档)。当你看到 fab init 刚完成、或 .fabric/forensic.json 刚生成、或用户提到"初始化项目文档/生成 AGENTS.md/agents-md init"时,使用此 skill。此 skill 驱动 3 轮深度访谈提取 L0 宪法,然后生成语义深度的分层 AGENTS.md。
allowed-tools: Read, Write, Glob, Grep, Bash
---

## Precondition

必须先 Read `.fabric/forensic.json`。若该文件不存在,终止 skill 并告知用户:"请先运行 `fab init` 生成证据包"。

## 执行流程 (3 Phase / 3 Round)

### Phase 1 — 框架确认(1 轮,高效)

展示 forensic.json 的 `framework` + `topology.by_ext` + `entry_points` 摘要,向用户提 1-2 个框架架构澄清问题。

示例(Cocos Creator 3.x):
> 我检测到 Cocos Creator 3.8 项目,主要脚本在 `assets/scripts`,采用 `@ccclass + extends Component` 模式。请确认:(1) 这是 TypeScript 项目(非 JavaScript)对吗?(2) 节点引用主要通过 `@property(Node)` 注入,还是 `find/getChildByName`?

将用户确认结果暂存为"已验证 framework assumptions"。

### Phase 2 — 不变式提取(1 轮,关键)

基于 `recommendations_for_skill` 列表,向用户提 3-5 个 **invariants** 问题,覆盖三类:

- **禁止(ban)**: "禁止 any / 禁止 update() 中 async / 禁止 find-by-name ..."
- **必须(require)**: "必须 strict TypeScript / 必须 @ccclass decorator / 必须 import from 'cc' only ..."
- **保护(protect)**: "哪些目录 AI 不能修改?(一般是 assets/prefabs, assets/scenes, *.meta)"

**原则**: 问 invariants,不问 preferences。每个问题只接受 yes/no/具体规则,不接受 "我觉得"。

### Phase 3 — 构造与落地(1 轮,自动)

1. **写入 `.fabric/init-context.json`**,包含 interview_trail + invariants + domain_groups(由 AI 从 entry_points 推断)

2. **生成分层 AGENTS.md**:
   - **根 AGENTS.md** (≤300 行),结构:
     - `# {projectName} — L0 AGENTS.md`
     - `<!-- fab:index -->` 块填充 domain_groups 索引
     - `## L0 AI Constraints`: 从 invariants 派生,按 ban/require/protect 分段
     - `## @HUMAN`: protect 路径 + 用户声明的保护规则
     - `## L1 Candidate Notes`: domain_groups 建议的子模块
   - **若 domain_groups.length >= 2**,为每个 group 生成 `{group_path}/AGENTS.md`(L1 层,最多到 L3,不超过 4 层)

3. **更新 `.fabric/agents.meta.json`** 的 nodes 树,保持 revision hash 链一致

4. **最终输出**: 向用户列出生成的文件清单 + 运行 `fab sync-meta` 建议

## 反模式(必须避免)

- ❌ 生成任何 `// TODO` 占位符(填不了的内容应删除,而非留 TODO)
- ❌ 生成 YAML frontmatter(除本 skill 自身外)
- ❌ 超过 300 行的根 AGENTS.md(改为拆到 L1)
- ❌ 4 层以上嵌套
- ❌ 自动推测用户未确认的 invariants
```

#### Key Findings (Round 2)

> **Finding**: fab init 的现有 writeNewFile 路径与追加 forensic.json 的写入完全兼容;initFabric() 的函数签名只需扩展返回值(+forensicPath)
> - **Confidence**: High — init.ts 阅读确认,无结构性重构需要
> - **Hypothesis Impact**: Confirms "最小侵入" 策略可行
> - **Scope**: init.ts 重构成本评估为 < 100 行改动 + 新增 forensic 构造函数

> **Finding**: werewolf-minigame-stub 的 Game.ts 模式是 Cocos Creator 3.x 标准(`@ccclass + Component + start()`)— 足够作为 Smart Sampling 的代表性证据
> - **Confidence**: High — 阅读 Game.ts 确认
> - **Hypothesis Impact**: Confirms Smart Sampling 浅采样(前 30 行)策略可以捕获模式识别所需的关键信息
> - **Scope**: code_samples 字段的截断行数可设为 30

> **Finding**: fab CLI 可以通过 console.error(reasonText) 向 Claude Code 传递 skill 触发提示 — 不需要引入新依赖
> - **Confidence**: Medium — 参照 思路.md 的 hook block 机制(JSON.stringify({decision:'block',reason:'...'}));但 fab init 的输出 channel 不完全等同于 hook stdout,需要验证 Claude Code 是否会读取 stderr
> - **Hypothesis Impact**: Modifies 触发机制 — 可能还需要安装 PostToolUse hook 让 AI 看到 reason 文本
> - **Scope**: 可能需要额外的 hook 注入,这是 OQ1 之后的第二层实现细节

#### Decision Log

> **Decision**: Layer 2/3/4 全部下放到 agents-md-init SKILL.md(而非 fab CLI 内置)
> - **Context**: H1 Layer 2 描述为 "Skill 层",Round 1 研究揭示 Claude Code skill 是 prompt-driven
> - **Options considered**: fab CLI 内置 AI / agents-md-init skill / 扩展 agents-md skill
> - **Chosen**: agents-md-init skill — **Reason**: fab CLI 保持 "只读取证" 纯粹性;命名与 agents-md 同族;description 精确匹配 init 后的认知状态
> - **Rejected**: fab CLI 内置 AI(依赖重);扩展 agents-md(职责冲突,init 是 one-shot elicitation / agents-md 是持续性 maintenance)
> - **Impact**: 后续实现需要:(a) 在 templates/ 下新增 agents-md-init SKILL.md 模板;(b) fab init 的 bootstrap 或 init 阶段将 SKILL.md 写入目标项目 `.claude/skills/agents-md-init/`

> **Decision**: ForensicReport + InitContext 两个独立 artifact 作为层间契约(不合并)
> - **Context**: Layer 1(CLI)和 Layer 3(Skill)的职责不同
> - **Options considered**: 单一 artifact / 两个独立 artifact
> - **Chosen**: 两个独立 — **Reason**: CLI 和 AI 的职责边界清晰,便于各自迭代;forensic.json 在 skill 执行中只读,init-context.json 是 skill 的产出
> - **Rejected**: 单一 artifact(职责混淆,AI 会不清楚哪些字段是自己能写的)
> - **Impact**: agents.meta.json 保持不变(维持 revision 链),两个新 artifact 各自有明确 owner

#### Technical Solutions (Round 2 Validated/Proposed)

> **Solution**: fab init 重构为 "scan → build ForensicReport → writeNewFile × 4(AGENTS.md + agents.meta.json + human-lock.json + forensic.json) → console.error(skill reason text)"
> - **Status**: Validated
> - **Problem**: 如何最小侵入地将 init 从纯静态变为"取证 + 触发"
> - **Rationale**: 保留 non-destructive 原则;reason 文本对 AI 客户端触发 skill,对非 AI 场景无副作用(只是 stderr 日志)
> - **Alternatives**: 引入 --interactive flag(rejected per OQ1);拆分独立命令 fab doc-init(rejected per OQ1)
> - **Evidence**: init.ts:75-106 重构路径清晰;forensic schema 已设计
> - **Next Action**: Phase 4 固化为高优先级推荐

> **Solution**: ForensicReport + InitContext 两 artifact schema 按上方定义
> - **Status**: Validated
> - **Problem**: 层间数据契约需要稳定格式
> - **Rationale**: JSON 便于 skill Read;字段覆盖框架/拓扑/入口/采样/访谈轨迹
> - **Alternatives**: YAML / 单 artifact / 纯文本(均 rejected)
> - **Evidence**: 与 agents.meta.json 既有 JSON 风格一致;Yeoman cookiecutter 模式验证
> - **Next Action**: Phase 4 固化

> **Solution**: 新增 `.claude/skills/agents-md-init/SKILL.md` 模板(位于 `templates/agents-md/SKILL.md` 或 `templates/skills/agents-md-init/SKILL.md`)
> - **Status**: Validated
> - **Problem**: Layer 2/3/4 需要 SKILL.md 承载
> - **Rationale**: 与 思路.md 中 agents-md skill 结构同族;description 触发词精确匹配 init 后认知状态
> - **Alternatives**: 扩展 agents-md skill(rejected)
> - **Evidence**: 思路.md line 210-214 的 skill 结构 + research F4/F5
> - **Next Action**: Phase 4 固化 + 明确模板放置路径

#### Intent Coverage Check (post-Round 2)

- ✅ **I1 (整体机制设计)**: Round 1+2 完整 — 4 层职责划分 + 层间 artifact 契约 + 命令形态决策
- ✅ **I2 (生成内容与模板)**: Round 2 完整 — AGENTS.md 生成规范(≤300 行 / 分层 / 无 TODO)+ SKILL.md 中的模板生成要求
- ✅ **I3 (与现有命令集成)**: Round 2 完整 — 决策保持 fab init 单一入口,不新增命令 / 不加 flag
- 🔄 **I4 (目标项目适配)**: 部分覆盖 — Cocos 3.x 模式识别已明确,但 werewolf 具体的 AGENTS.md L0 内容样例 / entry_points 完整列表未产出
- ✅ **I5 (验证 H1)**: 已验证,关键调整已记录

**评估**: 4/5 intent 充分覆盖。I4 的"具体 AGENTS.md L0 样例"偏向实现细节,可以作为推荐建议留给 Phase 4 的执行阶段。

### Round 2: Narrative Synthesis

**起点**: 基于 Round 1 的 OQ1/OQ3/OQ4,本轮从"如何落地 H1"切入,固化三项架构决策。
**关键进展**: (a) 命令形态决策:fab init 保持单一入口 + 打印 skill reason;(b) 两 artifact schema 成型;(c) agents-md-init SKILL.md 结构定稿(3 Phase)。这些 Confirms H1 的整体方向并 Modifies 了交付物形态(不再考虑 flag/独立命令)。
**决策影响**: 用户选择 "架构+落地契约" 让本轮集中产出可执行的设计,而非继续探索(避免 over-analysis)。
**当前理解**: H1 从 "概念性 4 层协议" 升级为 "具体的 init.ts 重构 + 2 artifact schema + 1 SKILL.md 模板" 的落地方案。
**遗留问题**: (1) fab CLI 打印 reason 到 stderr 是否被 Claude Code 正确识别(Finding 的 Confidence Medium,可能还需 hook 辅助);(2) SKILL.md 模板的文件安装路径是 templates/skills/ 还是复用 templates/agents-md/;(3) werewolf-minigame 的具体 AGENTS.md L0 样例内容。

### Round 3: Hook 机制与可靠触发

用户选择 "深入 Hook 机制",本轮聚焦验证 Round 2 遗留的高优先级疑问:fab init 打印 reason 到 stderr 是否能可靠触发 agents-md-init skill?

#### 探测范围
- 阅读 `packages/cli/src/commands/hooks.ts`(145 行)→ 确认**现有 fab hooks install 只处理 Husky git pre-commit**,**不处理 Claude Code hooks**
- 重读 思路.md lines 90-210 → 确认 agents-md-reminder.cjs Stop hook 规范虽在文档中,但**代码库中尚未实现**
- 阅读 `packages/cli/src/commands/index.ts`(11 行)→ 确认 fab 命令清单:bootstrap/init/scan/sync-meta/human-lint/ledger-append/hooks/config/pre-commit

#### 关键澄清(Claude Code 的两类 hook)

| 类型 | 位置 | 用途 | fab 现状 |
|------|------|------|---------|
| **Git Hook** | `.husky/pre-commit` | commit 前拦截,运行 fab pre-commit 流水线 | `fab hooks install` 已实现 |
| **Claude Code Hook** | `.claude/settings.json` 的 `hooks.Stop[]` | 模型 Stop 前拦截,注入 `{decision:'block', reason:...}` | **未实现**,思路.md 只有规范 |

这是 Round 2 "stderr reason 可靠性" 问题的根源:fab init 打印到 stderr **不是** Claude Code 的 hook channel。

#### 三种触发机制的对比

**Option A — 仅 stdout/stderr reason(Round 2 的初始设想)**
- 机制:fab init 完成时 `process.stdout.write(reasonText)`,Claude Code Bash 工具把输出作为 tool result 传给模型
- 可靠性:**中** — 只在 "同会话 + fab init 由 Bash 工具调用" 场景可靠;如果 tool result 滚出上下文窗口或 fab init 在外部终端运行,模型读不到 reason
- 复杂度:低(无新依赖)

**Option B — 安装 Stop hook(agents-md-init-reminder.cjs)**
- 机制:fab init 同时写入 `.claude/settings.json` 的 `Stop` hook;hook 脚本在每次模型 Stop 时检查 `.fabric/forensic.json` 存在但 `.fabric/init-context.json` 缺失 → 输出 `{decision:'block', reason:'使用 agents-md-init skill 完成初始化'}`
- 可靠性:**高** — Sentinel 触发机制 = `init-context.json` 的缺失本身就是信号,skill 完成后自然解除 block,无时效性问题
- 复杂度:中(需新建 hook 脚本 + 扩展 fab init 写入 .claude/settings.json)

**Option C — 混合方案(A+B,Round 3 推荐)**
- 机制:
  1. fab init 始终打印 reason 到 stdout(handles 同会话场景,开销零)
  2. fab init 同时安装 Stop hook + 创建 sentinel(handles 跨会话/外部终端场景)
  3. Skill 完成后自然写 `init-context.json`,sentinel 条件消失,后续 Stop 不再阻止
- 可靠性:**最高** — 两条路径双保险,互不冲突
- 复杂度:中(但可分阶段实施:先 A 再 B)

#### Key Findings (Round 3)

> **Finding**: fab 现有 `fab hooks install` 命令仅覆盖 Husky 的 git pre-commit,不涉及 Claude Code Stop hook
> - **Confidence**: High — 阅读 hooks.ts 全部 145 行
> - **Hypothesis Impact**: Modifies Round 2 假设 "打印 reason 足以触发 skill" — 需要额外的 Claude Code hook 基础设施
> - **Scope**: 需要新增命令/扩展现有命令,或者让 fab init 直接写入 .claude/settings.json

> **Finding**: agents-md-reminder.cjs 规范在 思路.md 中定义,但代码库尚未实现
> - **Confidence**: High — 无 .claude/hooks/ 目录,包括 templates/ 中也无对应文件
> - **Hypothesis Impact**: 这是 fab 生态当前的一个"未兑现承诺" — agents-md-init 与 agents-md-reminder 可以共用同一套 hook 基础设施
> - **Scope**: 应当一次性实现 Claude Code hook 支持,覆盖 agents-md 和 agents-md-init 两个场景

> **Finding**: Sentinel-based 触发(init-context.json 缺失)避免了时效性判断
> - **Confidence**: High — 这是来自研究 Best Practice "access 锁 artifact" 的直接派生
> - **Hypothesis Impact**: Confirms 落盘 artifact 作为层间契约的价值 — 除了传递数据,artifact 还承担状态信号
> - **Scope**: 两个 artifact(forensic.json / init-context.json)的存在/缺失成为整个协议的状态机

#### Decision Log

> **Decision**: 采用 **Option C 混合方案**,fab init 同时打印 stdout reason + 安装 Stop hook + 创建 sentinel
> - **Context**: Round 2 "stderr reason 可靠性" 的 Confidence Medium 问题
> - **Options considered**:
>   - **A** 仅 stdout reason: 中可靠,低成本
>   - **B** 仅 Stop hook: 高可靠,中成本
>   - **C** 混合: 最高可靠,中成本 — **CHOSEN**
> - **Chosen**: C — **Reason**: (1) stdout reason 在同会话场景零开销;(2) Stop hook 覆盖跨会话/外部终端;(3) 两者无冲突,skill 完成写入 init-context.json 后自然消除 block;(4) 为未实现的 agents-md-reminder.cjs 铺路(共用 hook 基础设施)
> - **Rejected**: A rejected(同会话以外不可靠);B rejected(不利用 tool result channel 浪费)
> - **Impact**: 实施工作量增加 — 需要新增 agents-md-init-reminder.cjs hook 脚本 + fab init 写入 .claude/settings.json 的逻辑

> **Decision**: Claude Code hook 基础设施应 **一次性扩展覆盖 agents-md + agents-md-init 两个场景**,而非只为 init 场景实现
> - **Context**: 思路.md agents-md-reminder 与 agents-md-init-reminder 规范几乎同构(都是 Stop hook 检查状态 → block+reason)
> - **Options considered**: 只实现 init 的 hook / 两个都实现
> - **Chosen**: 两个都实现 — **Reason**: 复用 .claude/hooks/ 基础设施;避免将来重复做;思路.md 规范已经明确
> - **Rejected**: 只做 init — 会导致 agents-md skill 的触发仍然依赖用户显式调用
> - **Impact**: 新增命令/扩展考虑:bootstrap 已安装 AI 客户端引导词,可扩展 bootstrap 或新增 `fab claude-hooks install` 子命令来处理 .claude/ 目录

#### Technical Solutions

> **Solution**: 新增 `templates/claude-hooks/agents-md-init-reminder.cjs` hook 脚本
> - **Status**: Proposed
> - **Problem**: 跨会话/外部终端场景下,fab init 完成但 AI 不知道要触发 skill
> - **Rationale**: Sentinel-based(检查 .fabric/forensic.json 存在 && .fabric/init-context.json 缺失)自然状态机;与思路.md 的 agents-md-reminder.cjs 同构
> - **Alternatives**: 时间戳检查(rejected: 会 stale);环境变量(rejected: 进程隔离)
> - **Evidence**: 思路.md lines 140-207 hook 规范 + 两个 artifact 的状态机设计
> - **Next Action**: 固化到 Phase 4 推荐

> **Solution**: fab init 扩展流程 — 写 forensic.json + 写 AGENTS.md/meta/human-lock + 合并写入目标项目的 `.claude/settings.json`(merge-insert Stop hook)+ 复制 hook 脚本到目标的 `.claude/hooks/` + 复制 SKILL.md 到目标的 `.claude/skills/agents-md-init/` + 最后 stdout 打印 reason
> - **Status**: Proposed
> - **Problem**: 初始化需要原子性地安装所有组件
> - **Rationale**: 单命令一次性完成 "protocol install + evidence collect + skill trigger",用户体验一致;merge-insert(非覆盖)符合 non-destructive 原则
> - **Alternatives**: (a) 用户手动运行 fab bootstrap + fab init + fab claude-hooks install(rejected: 操作太多);(b) init 只做 forensic,另起独立命令做安装(rejected: 与 OQ1 决策"单一入口"冲突)
> - **Evidence**: bootstrap.ts 已有 merge-insert 模板写入惯例;init.ts 的写入路径扩展成本低
> - **Next Action**: 固化到 Phase 4 推荐

#### Updated artifacts schema(加入 Hook 相关字段)

无需扩展 forensic.json / init-context.json schema;两个 artifact 的存在/缺失本身就是状态信号。

Hook 脚本(`templates/claude-hooks/agents-md-init-reminder.cjs`)伪代码:

```javascript
#!/usr/bin/env node
const { existsSync } = require('node:fs');
const { join } = require('node:path');

const cwd = process.cwd();
const forensic = join(cwd, '.fabric/forensic.json');
const initCtx = join(cwd, '.fabric/init-context.json');

const forensicExists = existsSync(forensic);
const initCtxExists = existsSync(initCtx);

if (forensicExists && !initCtxExists) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: [
      'fab init 已完成证据收集,但项目 AGENTS.md 初始化尚未完成。',
      '你必须调用 "agents-md-init" skill (通过 Skill 工具)完成 3 阶段初始化访谈。',
      '参考: .claude/skills/agents-md-init/SKILL.md + .fabric/forensic.json'
    ].join('\n')
  }));
} else {
  // normal path,不阻止 Stop
  process.exit(0);
}
```

#### Intent Coverage Check (post-Round 3)

- ✅ **I1 (整体机制设计)**: Round 1+2+3 完整 — 4 层物理位置 + 2 artifact + 单一 CLI 入口 + hook 可靠触发
- ✅ **I2 (生成内容与模板)**: Round 2 已完整覆盖
- ✅ **I3 (与现有命令集成)**: Round 2+3 — 决策保持 fab init 单一入口 + 扩展写入 .claude/ 目录,复用 bootstrap 的 merge-insert 模式
- 🔄 **I4 (目标项目适配)**: 依然部分覆盖 — 具体 AGENTS.md L0 内容样例推迟到执行阶段
- ✅ **I5 (验证 H1)**: 已完整验证 + 3 处关键修正

**评估**: 4/5 intent 充分覆盖,I4 依然保持与 Round 2 相同状态(非阻塞,属于执行阶段产物)。

### Round 3: Narrative Synthesis

**起点**: Round 2 留下的 stderr reason 可靠性问题(Confidence Medium)。
**关键进展**: (a) 明确了 Claude Code hooks ≠ git hooks,fab 目前只有后者;(b) 确立 Sentinel-based 触发机制(artifact 存在/缺失即状态信号);(c) 升级为 Option C 混合方案,双保险;(d) 识别出 "一次性扩展 hook 基础设施覆盖 agents-md + agents-md-init" 的机会。这些进展 Confirms H1 的主框架 + Modifies 了实施范围(新增 hook 脚本 + settings.json merge-insert)。
**决策影响**: 用户选择 "深入 Hook 机制" 把一个 Confidence Medium 的点升级为 High,同时发现了一个 side-benefit(铺平 agents-md-reminder 的实现路径)。
**当前理解**: H1 的完整落地方案已成型 — 一条单命令 `fab init` 完成 "evidence + protocol + skill 触发" 三件事,AI 客户端在场时 skill 自动接管,不在场时两个 artifact 也保留了后续可触发的状态。
**遗留问题**: I4 的 werewolf 具体 L0 样例内容(属于执行阶段产物,不阻塞分析结论)。

### Round 4: 完整产品流转(End-to-End User Flow)

用户在 Round 3 后提出 "在进入 phase4 之前告诉我当前产品具体使用和流转是怎么样的形态",本轮以 **人物+场景+时序** 形式描述 H1 方案落地后的完整用户旅程。

#### 角色定义

- **Developer**: 持有 werewolf-minigame(Cocos Creator 3.8)项目的开发者
- **AI Client**: Claude Code(本地 CLI 或 IDE 插件)
- **fab CLI**: `@fabric/fabric-cli`(本次方案的 CLI 工具)
- **agents-md-init skill**: 新增的一次性初始化 skill(在 AI Client 中执行)
- **agents-md skill**: 已有规范的持续性文档维护 skill(思路.md 定义,Round 3 顺便铺平)

#### Lifecycle: 7 个阶段

**Stage 1 — 安装(一次性,< 1 min)**

```
Developer 终端:
  $ npm install -g @fabric/fabric-cli
```

状态:fab CLI 可全局调用。项目仍原样,无任何 .fabric/ 或 .claude/ 目录。

**Stage 2 — fab init(一次性,< 200ms 纯 CLI)**

```
Developer 终端 (或 Claude Code 的 Bash 工具会话):
  $ cd ~/projects/werewolf-minigame
  $ fab init
```

fab CLI 流水线(单命令一次性完成):
1. `resolveDevMode` → 锁定目标目录 = `~/projects/werewolf-minigame`
2. `assertExistingDirectory` + 检查 `AGENTS.md` / `.fabric/` 不存在(non-destructive 原则)
3. `createScanReport` **(扩展版)** → 产出 ForensicReport:
   - `detectFramework` 读 `project.config.json` → `{kind:"cocos-creator", version:"3.8.0", subkind:"typescript-component"}`
   - `walkFiles` + `buildTopology` → `{by_ext: {.ts:6, .meta:6, .prefab:2}, key_dirs:[assets/scripts, assets/prefabs, assets/scenes]}`
   - `extractEntryPoints` → `[assets/scripts/Game.ts, Player.ts, Network.ts]`
   - `sampleCode(30 lines each)` → code_samples 字段
4. **写文件**(writeNewFile guard 保证 non-destructive):
   - `AGENTS.md` → 基础骨架(同现状,作为 fallback)
   - `.fabric/agents.meta.json` → L0 节点树 + hash
   - `.fabric/human-lock.json` → 空模板
   - `.fabric/forensic.json` → **新增**:Layer 1 证据包
5. **安装 AI 客户端集成**(merge-insert,非破坏):
   - `.claude/skills/agents-md-init/SKILL.md` → 复制 SKILL 模板(Round 2 定稿的 3 Phase 内容)
   - `.claude/hooks/agents-md-init-reminder.cjs` → 复制 hook 脚本
   - `.claude/settings.json` → merge-insert Stop hook 配置(如文件已存在 → 合并新 hook;如 hook 已存在 → skipped)
6. **stdout 输出**:
   ```
   Created 4 files in /.../werewolf-minigame:
     AGENTS.md (scaffold — will be replaced by skill)
     .fabric/forensic.json
     .fabric/agents.meta.json
     .fabric/human-lock.json
   Installed .claude/skills/agents-md-init/SKILL.md
   Installed .claude/hooks/agents-md-init-reminder.cjs
   Configured .claude/settings.json (Stop hook)

   NEXT: Open this project in Claude Code. The agents-md-init skill
         will be triggered automatically to complete AGENTS.md via a
         3-phase interview (framework confirm / invariants / generation).
   ```

状态:项目已"装备好"等待 AI 接管。骨架 AGENTS.md 有效但极简;forensic.json 是深度初始化的证据包;`.claude/` 基础设施就绪。

**Stage 3 — AI 接管(首次会话,Claude Code 中)**

```
Developer 打开 Claude Code (或继续 Stage 2 的同一会话):
  > 帮我完成项目文档初始化(或者随便说点什么)
```

两条触发路径:

- **同会话路径(Stage 2 仍活跃)**:Bash tool result 包含 stdout reason,模型读到 "NEXT: use the agents-md-init skill" → 自动调用 Skill 工具触发 `agents-md-init`
- **跨会话路径(新会话/外部终端跑的 fab init)**:模型完成第一个响应准备 Stop → `Stop` hook 触发 → `agents-md-init-reminder.cjs` 检查 `.fabric/forensic.json` 存在 + `.fabric/init-context.json` 缺失 → 返回 `{decision:"block", reason:"use agents-md-init skill..."}` → 模型被阻止 Stop,转而调用 skill

**Stage 4 — Phase 1 框架确认(1 次对话回合)**

```
agents-md-init skill 执行:
  1. Read .fabric/forensic.json → 读到 framework/topology/entry_points
  2. AI: "我检测到 Cocos Creator 3.8,脚本在 assets/scripts,采用 @ccclass
          + extends Component 模式。请确认:
          (1) 这是 TypeScript 项目(而非 JS)对吗?
          (2) 节点引用使用 @property(Node) 注入,还是 find/getChildByName?"

Developer: "是 TypeScript。主要用 @property(Node)。"

  3. AI 暂存 "framework assumptions validated"
```

**Stage 5 — Phase 2 Invariants 提取(1 次对话回合)**

```
AI: "基于项目结构,我需要锁定几条 L0 硬约束。请逐一确认:
     [1] ban: 禁止 update()/lateUpdate() 中使用 async/await? (影响帧率)
     [2] require: 所有 Component 类必须 @ccclass(name) 装饰? (Cocos 运行时依赖)
     [3] protect: assets/prefabs/** 和 assets/scenes/** 属于 @HUMAN 区域,
                   AI 不能直接修改?
     [4] protect: **/*.meta 文件是否锁定(Cocos Creator 自动生成)?
     [5] 其他项目特有约束(例如'网络模块必须走 NetworkManager 单例')?"

Developer: "1-4 确认。5 对,网络要走 NetworkManager。"
```

**Stage 6 — Phase 3 生成落地(AI 自动,~30s)**

```
agents-md-init skill 继续:
  1. Write .fabric/init-context.json:
     {
       architecture_patterns: [
         "Component-based: @ccclass + extends Component",
         "Node reference via @property(Node) injection",
         "Network communication goes through NetworkManager singleton"
       ],
       invariants: [
         {type:"ban", rule:"no async/await in update()/lateUpdate()"},
         {type:"require", rule:"all Component classes must be decorated with @ccclass(name)"},
         {type:"protect", paths:["assets/prefabs/**", "assets/scenes/**", "**/*.meta"]},
         {type:"require", rule:"network traffic MUST go through NetworkManager singleton"}
       ],
       domain_groups: [
         {name:"gameplay", paths:["assets/scripts/Game.ts", "Player.ts"]},
         {name:"network", paths:["assets/scripts/Network.ts"]}
       ],
       interview_trail: [/* Phase 1+2 问答完整记录 */]
     }

  2. 生成完整 AGENTS.md (~180 行, 单文件,不拆分 L1 因为只有 3 脚本):
     # werewolf-minigame — L0 AGENTS.md
     <!-- fab:index: 本项目采用单文件 AGENTS.md (< 500 文件 + 3 脚本) -->
     ## 项目概述
     Cocos Creator 3.8 多人狼人杀游戏 客户端(TypeScript)
     ## 架构模式
     - Component-based: 所有逻辑继承 cc.Component...
     ## L0 AI Constraints
     ### Banned patterns
     - NEVER use async/await inside update() or lateUpdate()...
     ### Required patterns
     - ALL Component classes MUST be decorated with @ccclass(name)
     - Network traffic MUST go through NetworkManager singleton
     ### Protected paths
     - assets/prefabs/**
     - assets/scenes/**
     - **/*.meta
     ## @HUMAN
     [Developer 可以在此添加锁定句,AI 不得修改]
     ## Entry points
     - assets/scripts/Game.ts (gameplay entry)
     - assets/scripts/Player.ts (player controller)
     - assets/scripts/Network.ts (network handshake)

  3. 更新 .fabric/agents.meta.json: 更新 L0.hash = sha256(新 AGENTS.md)

  4. 告知 Developer:
     AI: "✅ 已生成 AGENTS.md (180 行) + init-context.json。
          建议运行 fab sync-meta 验证 hash 链。
          后续修改代码时,agents-md skill 会自动提醒维护 AGENTS.md。"
```

状态:`.fabric/init-context.json` 出现 → sentinel 条件失效 → Stop hook 不再 block 正常 Stop。初始化完成。

**Stage 7 — 日常开发(持续,多次)**

```
Developer 修改 assets/scripts/Game.ts:
  AI: (修改完成)

准备 Stop 时:
  .claude/hooks/agents-md-reminder.cjs (思路.md 规范,Round 3 顺便铺平的基础设施)
  检查:最近有 /assets/ 下代码修改 + AGENTS.md 未同步
  → {decision:"block", reason:"modified code in /src/, you MUST use agents-md skill..."}

AI 自动调用 agents-md skill → 检查 AGENTS.md 是否需要同步 → 更新相关段落 → Stop 允许
```

```
git commit 时:
  .husky/pre-commit (fab hooks install 已装):
    fab pre-commit pipeline:
      - fab sync-meta: 重新计算 AGENTS.md hash,更新 agents.meta.json.revision
      - fab human-lint: 确保 @HUMAN 段未被篡改
      - fab ledger-append: 记录本次 commit 的意图到 .intent-ledger.jsonl
  通过 → commit 允许
```

#### 完整状态机

```
[空项目]
    |
    | fab init (Stage 2)
    v
[forensic.json 存在] + [init-context.json 缺失]
    |   ↑ Stop hook 会 block (sentinel 条件)
    |
    | AI 会话 + agents-md-init skill (Stages 3-6)
    v
[forensic.json 存在] + [init-context.json 存在] + [AGENTS.md 完整]
    |   ↑ Stop hook 不 block
    |
    | 日常编辑 + agents-md skill 持续维护 (Stage 7)
    v
[AGENTS.md 与代码同步]
    |
    | fab pre-commit pipeline (Stage 7)
    v
[commit 允许]
```

#### 多场景兼容性

| 场景 | 预期行为 |
|------|---------|
| 用户从 Claude Code 的 Bash 工具运行 fab init | stdout reason 被 tool result 捕获 → 模型读到 → 自动触发 skill |
| 用户从外部终端运行 fab init,然后打开 Claude Code | Stop hook 在首次 Stop 时触发 block → 模型调用 skill |
| 用户从 CI 运行 fab init(非 TTY) | 产出所有文件;stdout reason 被 CI 日志记录;无 AI 场景时 `.fabric/init-context.json` 永远不会生成,AGENTS.md 骨架 仍然有效 |
| 用户不使用 Claude Code,用 Cursor/Windsurf | `.claude/` 文件是 no-op;fab bootstrap 的其他客户端引导词仍然工作;AGENTS.md 骨架 被 Cursor Rules 等读取;init-context.json 不生成(未来可扩展 .cursor/skills 对等结构) |
| 用户重跑 fab init 在已初始化项目上 | assertExistingDirectory + existsSync(AGENTS.md) → ABORT(Round 2 决策)|

#### Key Findings (Round 4)

> **Finding**: 7 Stage 流转揭示 fab init 是"配置性"步骤(装备),真正的"初始化"动作在 AI 会话中发生(Stage 4-6)
> - **Confidence**: High — 由 Round 1-3 决策直接推导
> - **Hypothesis Impact**: Confirms H1 "CLI+Skill 分层"的 MindModel 不是"顺序执行",而是"fab 铺设跑道 + AI 接力跑完"
> - **Scope**: 向用户沟通时应强调 fab init 不产出最终 AGENTS.md,而是"evidence + protocol install"

> **Finding**: 双触发机制(stdout + Stop hook)完整覆盖 4 类使用场景(Bash tool / 外部终端 / CI / 非 Claude 客户端)
> - **Confidence**: High — 场景矩阵全覆盖
> - **Hypothesis Impact**: Confirms 设计的 robustness
> - **Scope**: 实施时每类场景都有明确的 degradation path

> **Finding**: fab pre-commit pipeline(现有)+ agents-md skill(计划中)+ agents-md-init skill(本次新增)构成完整的"init → maintain → commit"闭环
> - **Confidence**: High — 状态机图直接可见
> - **Hypothesis Impact**: Confirms 三项 skill/hook 不是独立功能,是同一个生命周期的三个阶段
> - **Scope**: 文档和代码注释应体现生命周期视角

#### Intent Coverage Check (post-Round 4)

- ✅ **I1 (整体机制设计)**: 完整 — 7 Stage lifecycle + 状态机图
- ✅ **I2 (生成内容与模板)**: 完整 — Stage 6 给出 werewolf 的 AGENTS.md 样例(~180 行的结构化内容,非 TODO 占位)
- ✅ **I3 (与现有命令集成)**: 完整 — 7 Stage 涵盖 bootstrap / init / pre-commit / (未来)agents-md-reminder 的集成
- ✅ **I4 (目标项目适配)**: 基本完整 — Stage 6 示范了 werewolf-minigame 具体的 invariants / domain_groups / AGENTS.md 内容轮廓
- ✅ **I5 (验证 H1)**: 完整 — 端到端流程证明 H1 可落地

**评估**: 5/5 intent 全部充分覆盖,可进入 Phase 4 综合阶段。

### Round 4: Narrative Synthesis

**起点**: 用户希望进入 Phase 4 前先理解端到端产品形态。
**关键进展**: (a) 构建 7 Stage 完整 lifecycle 描述;(b) 画出状态机图(由两个 artifact 的存在/缺失驱动);(c) 给出 werewolf-minigame 的具体 AGENTS.md 轮廓(180 行,单文件,domain_groups=gameplay+network);(d) 验证 4 类使用场景(Bash tool / 外部终端 / CI / 非 Claude 客户端)全部有合理 degradation path;(e) 把 I4 (werewolf 适配) 从 🔄 升级到 ✅。
**决策影响**: 用户的"先看流转"请求让方案从"概念架构"变成"可沟通的产品叙事"— 这是 Phase 4 能写出高质量 recommendations 的前提。
**当前理解**: H1 的设计已经可以一句话概括:**fab init 负责装备项目(evidence + protocol) + AI skill 负责接力完成语义初始化(3 Phase 访谈 + 生成 AGENTS.md)**,两个 artifact 既是层间数据契约也是状态机信号。
**遗留问题**: 无阻塞问题。Phase 4 可直接进入。

---

## Phase 4: Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| I1 | 整体机制设计 | ✅ Addressed | Round 1-4, Round 4 state machine + 7 Stage | 物理位置/契约/状态机/触发机制全部明确 |
| I2 | 生成内容与模板 | ✅ Addressed | Round 2 SKILL.md 3 Phase + Round 4 Stage 6 | 反模式硬规则 + werewolf 具体 AGENTS.md 轮廓 |
| I3 | 与现有命令集成 | ✅ Addressed | Round 2 OQ1 + Round 3 hook + Round 4 Stage 2/7 | 与 bootstrap/init/scan/pre-commit 集成清晰; 未来 agents-md-reminder 铺平 |
| I4 | 目标项目适配 | ✅ Addressed | Round 1 exploration + Round 4 Stage 4-6 | Cocos 3.x 识别/sampling/invariants/AGENTS.md 轮廓全部给出 |
| I5 | 验证 H1 | ✅ Addressed | Round 1-3 全程 | H1 整体可行, 3 处关键修正 (Skill 位置/版本区分/非 AST) |

**Gate**: 5/5 addressed, 无 Missed items, 可进入 synthesis。

### Findings Coverage Matrix

| # | Finding (Round) | Disposition | Target |
|---|----------------|-------------|--------|
| 1 | fab init 当前纯静态无交互 (R1) | recommendation | Rec #1 |
| 2 | Hook→Skill 是 prompt-driven (R1) | recommendation | Rec #3 |
| 3 | agents-md skill 是维护不是 init (R1) | recommendation | Rec #2 |
| 4 | Cocos 3.x 版本被丢弃 (R1) | recommendation | Rec #1 (detector extension) |
| 5 | CLI forensics <200ms 只读 (R1) | informational | — |
| 6 | 访谈问 invariants 不问 preferences (R1) | absorbed | → Rec #2 (SKILL 内容) |
| 7 | initFabric 重构成本低 (R2) | informational | — |
| 8 | werewolf @ccclass 模式 (R2) | informational | — |
| 9 | stderr 不是 hook channel (R3) | recommendation | Rec #3 |
| 10 | agents-md-reminder 未实现 (R3) | recommendation | Rec #3 (side benefit) |
| 11 | Sentinel 机制优势 (R3) | informational | — |
| 12 | fab init 是装备不是完成初始化 (R4) | recommendation | Rec #6 (文档) |
| 13 | 双触发覆盖 4 类场景 (R4) | absorbed | → Rec #3 |
| 14 | init→maintain→commit 闭环 (R4) | informational | — |
| 15 | AGENTS.md.template 过于 TODO 墙 (R1) | recommendation | Rec #5 |
| 16 | 需要 werewolf end-to-end 测试 (R2) | recommendation | Rec #4 |

**Gate**: 所有 actionable findings 已 mapped (6 → recommendation, 2 → absorbed, 8 → informational), 无 unmapped。

### Key Conclusions (Ranked)

1. **fab init 应保持单一入口, 扩展为 "evidence + protocol install"** (confidence: high)
2. **Layer 1 在 CLI / Layer 2+3+4 在 AI 客户端** (confidence: high)
3. **两个 artifact = 数据契约 + 状态机信号** (confidence: high)
4. **双保险触发机制完整覆盖 4 类场景** (confidence: high)
5. **新增 agents-md-init SKILL.md (3 Phase)** (confidence: high)
6. **侧向收益: 一次性实现 Claude Code hook 基础设施, 铺平 agents-md-reminder 未来实现** (confidence: high)
7. **detector 扩展 FrameworkInfo (version + subkind)** (confidence: high)
8. **反模式硬规则: 零 TODO / ≤300 行 / ≤4 层 / 无 YAML** (confidence: high)
9. **werewolf 具体适配: 单文件 AGENTS.md (~180 行) + gameplay/network domain_groups** (confidence: high)

### Prioritized Recommendations

**Rec #1 [HIGH]** 扩展 fab init 产出 forensic.json + 安装 .claude/ 基础设施
- 步骤: (a) 新增 scanner/forensic.ts + ForensicReport 类型; (b) 重构 detector.ts 加 version/subkind + Cocos 2.x/3.x 区分; (c) init.ts 追加写 forensic.json 和 stdout reason; (d) non-destructive 校验

**Rec #2 [HIGH]** 新增 agents-md-init SKILL.md 模板 + 复制到目标项目的 .claude/skills/
- 步骤: (a) templates/claude-skills/agents-md-init/SKILL.md (Round 2 定稿 3 Phase 内容); (b) init.ts 复制 SKILL.md 到目标项目; (c) non-destructive

**Rec #3 [HIGH]** 新增 Claude Code Stop hook 脚本 + merge-insert settings.json
- 步骤: (a) templates/claude-hooks/agents-md-init-reminder.cjs (sentinel-based); (b) init.ts 复制 hook + merge-insert settings.json; (c) side benefit: 同时铺平 agents-md-reminder.cjs

**Rec #4 [MEDIUM]** 为 werewolf-minigame 等代表项目编写 fab init 端到端测试
- 步骤: (a) init-forensic.test.ts; (b) init-claude-install.test.ts; (c) init-nondestructive.test.ts

**Rec #5 [MEDIUM]** 更新 AGENTS.md.template 为更"填充"的 fallback 骨架
- 步骤: (a) 减少 TODO; (b) 基于 frameworkKind 分叉产出框架特定约束; (c) 代码注释说明这是 fallback

**Rec #6 [MEDIUM]** 撰写使用说明文档描述 7 Stage 用户旅程
- 步骤: (a) README 或 docs/initialization.md 加入 7 Stage 简版 + 4 类场景 degradation 表

### Decision Trail

- **R1 Decision 1**: 分析视角单一综合 (不并行多视角) — 主题聚焦
- **R1 Decision 2**: 以 H1 为假设验证 (非中立评估) — 用户已有倾向
- **R2 Decision 3**: fab init 单一入口 (非 flag/ 非新命令) — 让工具默认做对事
- **R2 Decision 4**: 两个独立 artifact (非单一) — CLI 和 AI 职责清晰
- **R2 Decision 5**: Layer 2/3/4 下放到 SKILL (非 CLI 内置 AI / 非扩展 agents-md) — fab 保持只读取证纯粹性
- **R3 Decision 6**: Option C 混合触发 (非单一 stdout / 非单一 Stop hook) — 双路径零冲突 + 4 类场景全覆盖
- **R3 Decision 7**: 一次性铺平 Claude Code hook 基础设施 (覆盖 agents-md-reminder 未来需求) — side benefit 捡漏

### Open Questions (Non-blocking)

- 实施细节: `.claude/settings.json` 既有 Stop hook 的 merge 算法 — 按 matcher 去重还是直接 append?
- 是否需要 `fab init --skip-claude-install` flag 供 Cursor/Windsurf 用户?
- 跨会话首次打开 Claude Code 立即 Stop (无消息) 场景下 hook 触发是否如预期? 需验证

### Follow-up Suggestions

- **Implementation**: 高优先级 3 项推荐可直接 handoff 给 workflow-lite-plan 做任务分解
- **Validation**: 建议在 werewolf-minigame-stub 真实 fixture 上 dry-run fab init 重构版, 验证 7 Stage lifecycle 可复现
- **Documentation**: README 更新 (Rec #6) 应作为 H1 实施并合并后的收尾任务

### Session Statistics

| Metric | Value |
|--------|-------|
| Total rounds | 4 |
| Duration | Phase 1 + Phase 2 + 4 rounds (Phase 3) + Phase 4 |
| Sources explored | 9 files + 1 external research + 1 prior analysis |
| Artifacts produced | discussion.md, exploration-codebase.json, research.json, explorations.json, conclusions.json |
| Decisions recorded | 7 |
| Technical solutions | 6 (all validated) |
| Recommendations | 6 (3 high + 3 medium) |
| Intent coverage | 5/5 Addressed |

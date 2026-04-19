# Analysis: fab init 启发式语义探索（Heuristic Discovery）重构

> Session: `ANL-fab-init-heuristic-discovery-2026-04-19`
> Date: 2026-04-19
> Topic: 针对 fab init 流程进行"启发式语义探索"重构设计 — 从被动问询转向主动侦察、定义分层文档物理拓扑、优化抹茶（Matcha）交互体验

## Table of Contents

- [Session Metadata](#session-metadata)
- [User Intent](#user-intent)
- [Prior Context](#prior-context)
- [Initial Hypotheses](#initial-hypotheses)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
  - [Round 1: 代码探测 + 外部研究](#round-1-代码探测--外部研究)
  - [Initial Intent Coverage Check](#initial-intent-coverage-checkround-1-完成后)
  - [Round 2: 具体方案设计（基于 Q1-Q6 决策）](#round-2-具体方案设计基于-q1-q6-决策)
  - [Round 3: Zero-Pollution Runtime Association 提案评估](#round-3-zero-pollution-runtime-association-提案评估)

## Session Metadata

| Field | Value |
|-------|-------|
| Session ID | ANL-fab-init-heuristic-discovery-2026-04-19 |
| Created | 2026-04-19 |
| Dimensions | architecture (physical topology), implementation (skill heuristics), decision (interaction UX) |
| Depth | Deep Dive (TBD user-confirmed) |
| Perspectives | Single comprehensive (Technical + UX merged) |
| Mode | new |
| Continuation of | ANL-fab-doc-init-werewolf-2026-04-19 (refining SKILL side) |

## User Intent

**原始问题**: 针对 fab init 流程进行"启发式语义探索（Heuristic Discovery）"重构设计。

三个具体目标：

### I1 — 从"被动问询"转向"主动侦察"
优化现有 Claude Skill 逻辑，使其在启动访谈前，先利用 `Glob/Read` (ls_r / read_file) 自行完成项目技术栈采样与模式识别，基于"既成事实"生成初步结论，再引导开发者进行**针对性校验（Check-not-Ask）**。

### I2 — 定义分层文档（Layered Docs）的物理拓扑
明确除根目录 AGENTS.md 外，后续 L1/L2 层的语义文档是采用：
- **就近原则**（存放在对应子目录 `packages/foo/AGENTS.md`），还是
- **集中原则**（统一放在 `.fabric/agents/packages-foo.md`）

并设计配套的**索引同步机制**（让 L0 能可靠发现并引用 L1/L2）。

### I3 — 优化"抹茶（Matcha）"交互体验
降低开发者的输入负担，使初始化过程更像是一次"架构评审"（assistant 说"我看到 X，对吗？"）而非"空白填表"（assistant 问"请告诉我 X"）。

## Prior Context

### 上一会话（ANL-fab-doc-init-werewolf-2026-04-19）已确立的架构

- **单一入口 fab init**: evidence + protocol install + stdout reason 三件事
- **物理层划分**: CLI = Layer 1 取证（forensic.json），AI Skill = Layer 2/3/4（init-context.json + AGENTS.md）
- **双保险触发**: stdout reason + Stop hook + sentinel
- **3 Phase SKILL**:
  - Phase 1: 框架确认（1-2 问）
  - Phase 2: invariants 提取（3-5 问 ban/require/protect）
  - Phase 3: 构造落地（写 init-context.json + 生成 AGENTS.md）

### 本会话要改进的点

现有 SKILL.md 在 Phase 1/2 仍是"问询式"（"是 TypeScript 还是 JavaScript？"）——
- 信息其实已经在 `forensic.json` 或源码里可以直接确认
- 用户需要回答 5-7 个基础性问题
- 缺乏"AI 先假设，用户再 Check"的节奏

## Initial Hypotheses

### H1 — Check-not-Ask 主动侦察假设
当 SKILL 被触发时，它应当：
1. 读 forensic.json 作为起点
2. **主动补采**：对关键证据路径（最多 N 个文件）执行 Read，提取具体模式（e.g. 发现 `@ccclass`+`@property`+`onLoad` → 推断 "Cocos 组件化模式 + 响应式生命周期"）
3. 形成"框架图景"初稿（architecture_patterns），然后向用户展示一次性 Check 请求（最多 1 轮 5-8 个要点批量 yes/no）
4. 只对**低置信度项** (confidence < threshold) 或**证据冲突项**才发起真正的问询

### H2 — 层间物理拓扑混合原则假设
L1/L2 AGENTS.md 的物理位置应由**语义所属**决定，不是统一原则：
- **就近**：代码目录耦合的约束（如 `packages/server/AGENTS.md`、`assets/scripts/gameplay/AGENTS.md`）—— 对应"该子模块写代码时的规矩"
- **集中**：跨切面的约束（如 `.fabric/agents/security.md`、`.fabric/agents/testing.md`）—— 对应"横跨多模块的风格/流程"
- **索引机制**：L0 AGENTS.md 的 `<!-- fab:index -->` 段列出所有 L1/L2 路径 + 一句话摘要，由 `fab sync-meta` 扫描 AGENTS.md 文件头部 metadata（或路径枚举）自动维护

### H3 — Matcha 交互范式假设
降低输入负担的核心技巧：
1. **批量 Check**: 一次性列出 5-8 条推断，用户回 "1/3/5 对，2 错，4 改为 X"
2. **默认接受**: 高置信度项默认 accept，只有用户明确否定才回退
3. **分层挑战**: Framework 确认 → Architectural Pattern 确认 → Invariants 确认，逐层降低抽象度
4. **可视化证据锚**: 每个推断伴随 `file:line` 链接，让用户在 2 秒内验证

## 原始意图拆解（用于 Intent Coverage 追踪）

| # | Intent | 说明 |
|---|--------|------|
| I1 | Check-not-Ask 主动侦察 | 重写 SKILL Phase 1/2：先用 Read/Glob 收集事实，再批量 Check |
| I2 | 分层文档物理拓扑 | L1/L2 AGENTS.md 存哪里 + 索引同步机制 |
| I3 | Matcha 交互优化 | 降低输入负担，让 init 像架构评审而非填表 |

## Current Understanding

**Round 3 Update（待用户决策）**

用户提出 **Zero-Pollution Runtime Association** 架构（`.fabric/agents/` 1:1 源码镜像 + 取消静态生成器 + 纯 MCP 工具驱动）。

**关键发现（打破 Round 2 前提）**：代码证据显示系统**已经是 MCP-first** — `packages/server/src/tools/get-rules.ts:28-29` 已注册 `fab_get_rules` 且声明 "MANDATORY: Call before modifying any file"；6 份 bootstrap 模板（Cursor / Claude / Gemini / Codex / Roo / Windsurf）均强制 AI 调用 MCP。因此用户提案**并非架构范式转变**，而是 "规则文件物理存放位置" 的选择。

**综合评估**: Reasonable-with-caveats — 技术可行（`get-rules.ts:38` 的 minimatch 解耦了物理位置和作用范围），但牺牲以下价值：
1. **非 MCP 客户端及人类 Code Review 的降级路径丢失**（就近 AGENTS.md 对不连 MCP 的 Cursor / 旧版 IDE / 人类 reviewer 不可见）
2. **Claude Code ancestor-chain 原生机制放弃**（Round 2 Finding 4 被颠覆）
3. **AI 感知期（探索/规划阶段）规则真空**（`fab_get_rules` 只在编辑时触发；阅读 / Plan / 全局扫描时无规则约束）
4. **跨切面规则表达变笨拙**（1:1 mirror 无法自然表达 "security.md 适用于 **/*.ts"；必须借 `scope_glob` 做虚拟路由）

**Round 2 的三项结论需要重新评估**：
- Rec #2 SKILL Phase 2 生成逻辑 → 若采纳需改为"只生成 `.fabric/agents/` 镜像"
- Rec #3 sync-meta 的 `.claude/rules/` 扫描扩展 → 若采纳则废弃
- "@import 原生索引" → 若采纳则废弃（因为不再有 colocated 文件可 @import）

**前置 Round 1+2 基础（仍有效）**：forensic schema 升级（Rec #1）、SKILL Phase 0 主动侦察（Rec #2 前半）、置信度定量三档、candidate_files 预给、agents-meta schema 扩展等与本次提案**正交**，不受影响。

---

**Round 1+2 Established（完整设计方案）**

### 核心架构决策（Q1-Q6 全部完成）

1. **置信度定量三档** (Q1): HIGH = coverage ratio ≥ 0.8 + multi-pattern 共现（或 AST 级强特征）；MEDIUM = 0.5-0.8 单 pattern；LOW = < 0.5 或证据冲突
2. **CLI 预给 candidate_files** (Q2): forensic.ts 按 pattern family (entry/component/config/test/domain) × top-3，总量 ≤ 12
3. **跨切面涌现式生成** (Q3): fab init 不预创建 .claude/rules/，由 SKILL Phase 1 侦察时识别横向模式才产出
4. **@import 原生索引** (Q4): 根 AGENTS.md 用 `@packages/*/AGENTS.md` 语法，sync-meta 不再维护索引段
5. **单轮 Architecture Review** (Q5): Phase 0 侦察 → Phase 1 单屏批量 Check → Phase 2 自动构造
6. **Token 硬限** (Q6): 15 文件 × 100 行；超限降级为 pattern-family 前三

### 关键数据契约变更

- `ForensicAssertion` schema: `{ type, statement, confidence, evidence[], coverage, proposed_rule?, alternatives? }` 替换 `recommendations_for_skill: string[]`
- `candidate_files: CandidateFileEntry[]` 新增到 ForensicReport
- `AgentsMetaNode` 新增 `layer` + `topology_type` + `paths_frontmatter?` 字段
- `InitContextInvariant` 新增 `confidence_snapshot` 字段

### 硬规则重定义（DISPLAY vs WRITE 分离）

- WRITE 层：只有**被显式或隐式接受**的 assertion 才能写入 init-context.json
- DISPLAY 层：HIGH 档 = 隐式接受（用户不纠错即视同意）；MEDIUM/LOW = 必须显式接受
- HIGH 档定性门槛硬性约束（coverage + co-occurrence 或 AST 强特征）

### 交互节奏变化

| 旧版 | 新版（Matcha） |
|------|----------------|
| 2 轮 × 3.5 问 = 7 次回应 | 1 轮批量 Check |
| "请告诉我 X" | "我看到 X（证据: Y），对吗？" |
| 展示 forensic 摘要 + 提问 | 主动 Read 源码 → 展示 assertion 列表 + file:line 锚 |

## Discussion Timeline

### Round 1: 代码探测 + 外部研究（H1/H2/H3 初步验证）

#### 分析过程

- **cli-explore-agent**：深度扫描 17 个文件（templates/claude-skills/agents-md-init/SKILL.md + packages/cli/src/scanner/* + packages/shared/src/schemas/* + packages/cli/src/commands/{init,sync-meta}.ts + templates/agents-md/variants/* + docs/initialization.md），按 I1/I2/I3 三类意图分组输出 `current_behavior / evidence / gaps`
- **workflow-research-agent**：研究 Claude Code /init、CLAUDE.md 解析模型、.claude/rules/* 机制、npm init 的 detect-then-default 范式、CLI UX 文献（clig.dev）、Cursor vs Claude Code 两种学派

#### Key Findings

> **Finding**: Claude Code 的 `CLAUDE_CODE_NEW_INIT=1` 新 /init 流程 = fabric 的 Matcha 范式直接参照
> - **Confidence**: High — **Why**: 官方文档明确描述 "subagent explores codebase, fills gaps via follow-up questions, presents a reviewable proposal before writing any files"
> - **Hypothesis Impact**: Confirms H1（Check-not-Ask 主动侦察）+ Confirms H3（架构评审风格交互）
> - **Scope**: 整个 SKILL 重构的设计蓝本

> **Finding**: Claude Code CLAUDE.md 采用 **ancestor 链拼接**（非 nearest-wins），子目录懒加载；`.claude/rules/*.md` 的 `paths:` frontmatter 是原生 "co-located without duplication" 原语
> - **Confidence**: High — **Why**: code.claude.com/docs/en/memory 明确说明 "files concatenate, not override"；`.claude/rules/` paths frontmatter 是一等公民
> - **Hypothesis Impact**: Modifies H2 — 不是"就近 vs 集中"二选一，而是**由语义决定**：scope-bound 走就近、cross-cutting 走 rules-frontmatter
> - **Scope**: L1/L2 物理拓扑、sync-meta 扫描范围、索引机制全部受此约束

> **Finding**: `forensic.json` 当前缺乏结构化断言 + 置信度字段；`recommendations_for_skill` 是 2-3 条自然语言 `string[]`，`inferPatternHint()` 返回单值字符串
> - **Confidence**: High — **Why**: packages/cli/src/scanner/forensic.ts:249-267 和 294-323 源码证实；packages/shared/src/schemas/forensic-report.ts schema 定义 `z.array(z.string())`
> - **Hypothesis Impact**: Confirms — H1 落地的**第一块短板**是 CLI 端数据契约，必须先升级 schema
> - **Scope**: forensic.ts 重构；SKILL 消费接口变化

> **Finding**: 现有 SKILL `allowed-tools` 包含 Read/Glob/Grep/Bash，但 Phase 1/2 话术从未要求调用 → 工具权限空置
> - **Confidence**: High — **Why**: templates/claude-skills/agents-md-init/SKILL.md:1-5 声明 + 18-39 话术对比
> - **Hypothesis Impact**: Confirms H1 — SKILL 侧改造成本低，话术升级 + Phase 0 主动侦察步骤即可
> - **Scope**: SKILL.md 重写

> **Finding**: 硬规则 "NEVER infer unconfirmed invariants; ask the user or omit the rule" 与 Matcha 默认接受直接冲突
> - **Confidence**: High — **Why**: templates/claude-skills/agents-md-init/SKILL.md:90-91 vs 研究得出的 "HIGH confidence pre-accept" 最佳实践
> - **Hypothesis Impact**: Modifies H3 — 硬规则不能废除，但需**区分"写入 init-context"和"展示给用户"**：前者必须经确认，后者允许默认接受+批量纠错
> - **Scope**: 硬规则重述 + 批量 Check 的语义定义

> **Finding**: Pitfall — 文件存在 ≠ 模式遵守（典型：tsconfig.json 存在但 strict=false）；HIGH confidence 必须基于 **DIRECT code evidence**（grep 命中计数）而非文件存在
> - **Confidence**: High — **Why**: CLI UX 原则 + Poetry "silent smart defaults" 反模式
> - **Hypothesis Impact**: Refines H1 — 置信度评分公式需要**量化**（覆盖率 / 命中密度），不能基于"看到了某个文件"
> - **Scope**: ForensicReport assertion schema 的 confidence 字段定义

> **Finding**: `fab sync-meta` 只扫描 `entry.name === 'AGENTS.md'`，**不识别 .claude/rules/*.md**；且**不维护 L0 的 `<!-- fab:index -->` 块** → 两处拓扑漂移点
> - **Confidence**: High — **Why**: packages/cli/src/commands/sync-meta.ts:112-141 只匹配 AGENTS.md；61-89 只重算 hash
> - **Hypothesis Impact**: Confirms H2 — sync-meta 必须扩展扫描范围 + 决定索引维护归属
> - **Scope**: sync-meta 重构 + agents-meta.ts schema 扩展（layer, topology_type 字段）

#### Technical Solutions (Proposed)

> **Solution**: `ForensicReport` schema 升级 — `recommendations_for_skill: Assertion[]`，每条 `{type: 'framework'|'pattern'|'invariant', statement, confidence: 0-1, evidence: [{file, lines, match_count?}], proposed_rule?: {type: ban|require|protect, body}}`
> - **Status**: Proposed
> - **Problem**: SKILL 无法做 Check-not-Ask 因为输入缺乏结构
> - **Rationale**: CLI 端做语义推断无 LLM 成本、可测试；SKILL 端只做展示+交互
> - **Alternatives**: SKILL 自己从 snippet 重新推断（浪费 tokens）；外置 pattern registry（复杂度高）
> - **Evidence**: packages/shared/src/schemas/forensic-report.ts, forensic.ts:294-323
> - **Next Action**: Round 2 确认 assertion schema 字段 + 置信度公式

> **Solution**: SKILL Phase 0+1 合并 — Phase 0 "主动侦察"（强制 Glob + Read N 个文件 × M 次 grep） + Phase 1 "Architecture Review 批量 Check"（单轮展示所有 assertion，HIGH 项 pre-accept，用户只纠错）
> - **Status**: Proposed
> - **Problem**: 当前 2 轮 × 3.5 问 = 7 回应；split 分散用户注意力
> - **Rationale**: Claude Code /init 的成熟范式；批量 Check 减少 round-trip
> - **Alternatives**: 保留 Phase 1/2 但话术改 Check-not-Ask（不减少回合）；拆成更多短轮（更散）
> - **Evidence**: SKILL.md:18-39, code.claude.com/docs/en/memory (/init 流程)
> - **Next Action**: Round 2 设计 Phase 0/1 的具体话术 + 批量 Check 视觉结构

> **Solution**: 混合拓扑原则 — `colocated AGENTS.md` for scope-bound + `.claude/rules/{concern}.md` with `paths:` frontmatter for cross-cutting；Claude Code 原生识别
> - **Status**: Proposed
> - **Problem**: 单一 "就近 vs 集中" 无法覆盖所有语义类型；`.fabric/agents/` 集中方案不被 Claude Code 原生识别
> - **Rationale**: ancestor 链拼接 + paths-frontmatter 原生机制直接匹配混合语义
> - **Alternatives**: 全就近（cross-cutting 重复）、全集中 .fabric/agents/（不被 Claude 识别）、单一 root 大文件（破 300 行规则）
> - **Evidence**: code.claude.com/docs/en/memory, SKILL.md:60-69
> - **Next Action**: Round 2 确认跨切面约束初始集合 + sync-meta 扫描扩展

> **Solution**: 三档置信度策略 + 硬规则重定义
> - **Status**: Proposed
> - **Problem**: HIGH-confidence 默认接受与 "NEVER infer unconfirmed" 硬规则直接冲突
> - **Rationale**: 区分 "写入 init-context.json"（要求显式确认）和 "展示给用户"（允许默认接受 + 批量纠错）
> - **Alternatives**: 放弃 Matcha 保守（UX 差）；放弃硬规则全自动（不安全）
> - **Evidence**: SKILL.md:88-92
> - **Next Action**: Round 2 明确 HIGH/MEDIUM/LOW 量化定义

#### Discussion Points → Open Questions（引导 Round 2）

- **Q1 (I1)**: HIGH 档置信度阈值具体值是多少？0.9? 0.95? 基于什么量化指标（文件覆盖率 / grep 命中密度 / 单一 snippet 多 pattern 共现）？
- **Q2 (I1)**: SKILL 主动补采的文件数上限是多少？forensic 已采 5 文件×30 行，SKILL 再补多少合适？按目录 top-3 还是按 pattern family 补采？
- **Q3 (I2)**: 跨切面约束的**初始集合**是？security / testing / performance 是否在 `fab init` 时预创建 `.claude/rules/` 骨架（可能过早推测），还是仅在用户显式提出时按需生成？
- **Q4 (I2)**: L0 索引机制选择？(a) `fab sync-meta` 重写 `<!-- fab:index -->` vs (b) 改用 Claude-Code-native `@packages/*/AGENTS.md` 系列 `@import`（后者让 sync-meta 变可选）
- **Q5 (I3)**: Matcha 批量 Check 的粒度？(a) Phase 1+2 合并成一屏 vs (b) 保留两轮但每轮内批量 vs (c) 分 framework/pattern/invariant 三分区的单屏
- **Q6 (I3)**: SKILL 主动 Read 源码时如何控制 token 成本？预定义 pattern family 清单？forensic 预先给出 `candidate_files` 清单？

### Initial Intent Coverage Check（Round 1 完成后）

| # | Intent | Status | Covered in Round 1 |
|---|--------|--------|---------------------|
| I1 | Check-not-Ask 主动侦察 | 🔄 in-progress | ✅ 结构性问题定位 + 技术方案提出（assertion schema + Phase 0）。✅ 置信度策略大框架。🔄 量化阈值 (Q1)、补采策略 (Q2)、token 成本控制 (Q6) 未定 |
| I2 | 分层文档物理拓扑 | 🔄 in-progress | ✅ 混合原则确立 + Claude Code 原生机制对齐。🔄 跨切面初始集合 (Q3)、L0 索引机制选择 (Q4)、sync-meta/schema 扩展细节未定 |
| I3 | Matcha 交互优化 | 🔄 in-progress | ✅ Phase 0+1 合并方向 + 批量 Check + evidence 锚点原则。🔄 粒度选择 (Q5)、具体话术设计未展开 |

**Round 2 接下来**聚焦 Q1-Q6 决策，并把选择落到具体的 schema/话术/实现方案。

### Round 1: Narrative Synthesis

**起点**: 用户 3 个目标（Check-not-Ask / 物理拓扑 / Matcha），无中立评估阶段，直接进入 H1/H2/H3 假设验证。

**关键进展**: 代码探测精确定位了三大结构性问题（工具权限空置 / 数据契约缺结构 / 硬规则冲突）+ file:line 证据锚；外部研究发现 Claude Code 新 /init 是 Matcha 的一比一参照，Claude Code 的 ancestor-concat + paths-frontmatter 机制是混合拓扑的原生支持。H1/H2/H3 假设全部被研究数据**Confirmed** 或 **Modified 细节**，无 Refuted。

**决策影响**: 分析方向从 "要不要做 Check-not-Ask" 升级为 "如何做 — assertion schema 字段定义 + 置信度公式 + Phase 话术"。H2 从 "就近 vs 集中二选一" 被 Modified 为 "混合语义决定"。

**当前理解**: 三大改造点的技术方案骨架已清晰（forensic schema 升级 + SKILL Phase 0/1 重写 + .claude/rules/ paths-frontmatter 引入 + sync-meta 扩展扫描 + 硬规则重定义）。

**遗留问题**: Q1-Q6（6 个决策点）需 Round 2 落到具体值/算法/话术。


### Round 2: 具体方案设计（基于 Q1-Q6 决策）

#### Decision Log（用户 Q1-Q6 选择）

> **Decision**: Q1 置信度三档采用**定量指标**（视觉/命中密度）
> - **Context**: HIGH 默认接受需要严格量化，避免"文件存在 ≠ 模式遵守"的典型误判
> - **Options considered**: 定量三档 / 按证据强度分级 / 统一单档批量确认
> - **Chosen**: 定量三档 — **Reason**: 可测试、与 pitfall 分析直接对应（要求 DIRECT code evidence）
> - **Rejected**: 按强度分级（缺乏可量化评判）；统一单档（失默认接受优势）
> - **Impact**: forensic.ts 必须计算并输出 match_ratio、pattern_cooccurrence 等量化字段

> **Decision**: Q2 主动补采策略 = **CLI 预给 candidate_files**
> - **Context**: SKILL 不应自己 Glob，token 与行为可预测
> - **Chosen**: CLI 预给 — **Reason**: 推断权在 CLI（便宜、可测试），SKILL 只消费；行为可预测
> - **Impact**: forensic.ts 增加 candidate_files 字段（pattern family × top-3）

> **Decision**: Q3 跨切面约束 = **SKILL 涌现式生成**
> - **Context**: 预创建 security/testing/performance 可能过早推测不相关项目
> - **Chosen**: 涌现式 — **Reason**: 避免 YAGNI；保留架构能力但不强加内容
> - **Impact**: SKILL Phase 1 侦察时识别横向模式才产出；init 时 .claude/rules/ 目录不预创建

> **Decision**: Q4 L0 索引 = **@import 原生语法**
> - **Context**: 利用 Claude Code 原生机制避免双套维护
> - **Chosen**: @import — **Reason**: sync-meta 成为可选；AGENTS.md 升级为 Claude-Code-native；无漂移风险
> - **Impact**: SKILL Phase 2 生成时使用 @import 行替代 `<!-- fab:index -->` 块；sync-meta 不强制维护

> **Decision**: Q5 Matcha 粒度 = **单轮 Architecture Review**
> - **Context**: 减少 round-trip + 让用户看到全局图景
> - **Chosen**: Phase 0 侦察 → Phase 1 单屏批量 Check → Phase 2 自动构造 — **Reason**: 最贴近 Claude Code /init 范式
> - **Impact**: SKILL 从 3 Phase 3 轮变为 3 Phase 1 轮交互

> **Decision**: Q6 token 预算 = **15 文件 × 100 行硬限**
> - **Context**: 可预算、降级可控
> - **Chosen**: 硬限 — **Reason**: 覆盖中小项目（中小项目通常 <15 个语义代表文件）+ 超限降级为 pattern-family 前三
> - **Impact**: SKILL Phase 0 必须在侦察阶段监控已读文件数

#### Key Findings

> **Finding**: Q1-Q6 全部选择"推荐"选项 — 架构方向与研究/代码证据强一致
> - **Confidence**: High — **Why**: 6/6 推荐项均有 file:line 或文档锚点支撑
> - **Hypothesis Impact**: Confirms H1/H2/H3 整体
> - **Scope**: 全部 3 个 Intent 的具体实施路径已锁定

#### Technical Solutions (Validated / Proposed)

> **Solution**: **ForensicAssertion schema** — 结构化断言（核心数据契约）
> - **Status**: Validated
> - **Problem**: `recommendations_for_skill: string[]` 无法支撑 Check-not-Ask
> - **Rationale**: CLI 侧定量、可测试；SKILL 只消费结构化输入做批量展示
> - **Design**:
> ```typescript
> // packages/shared/src/schemas/forensic-report.ts (new)
> type Confidence = 'high' | 'medium' | 'low';
> type AssertionType = 'framework' | 'architecture_pattern' | 'invariant_candidate' | 'domain_boundary';
>
> interface ForensicAssertion {
>   type: AssertionType;
>   statement: string;            // 展示给用户的陈述句，如"检测到 @ccclass 装饰器"
>   confidence: Confidence;       // 定量计算结果（见下方 confidence 公式）
>   evidence: Array<{             // 证据锚（SKILL 批量展示时附 file:line）
>     file: string;               // e.g. "assets/scripts/Game.ts"
>     lines: string;              // e.g. "3-7"
>     match?: string;             // e.g. "@ccclass('Game')"
>     match_count?: number;       // grep 命中计数（高置信度必须）
>   }>;
>   coverage?: {                  // 定量指标
>     files_matched: number;      // 含该模式的文件数
>     files_total: number;        // 同类型文件总数
>     ratio: number;              // files_matched / files_total
>     co_occurring_patterns?: string[]; // 共现 pattern（HIGH 需要 ≥ 2 个）
>   };
>   proposed_rule?: {             // 可选：对应的 invariant 规则草案
>     invariant_type: 'ban' | 'require' | 'protect';
>     body: string;
>   };
>   alternatives?: string[];      // 同一推断的替代假设（LOW 档使用）
> }
> ```
> - **Confidence 量化公式**：
>   - **HIGH**: `ratio >= 0.8` AND `co_occurring_patterns.length >= 2` (OR 含 AST 级强特征如 `@ccclass`)
>   - **MEDIUM**: `0.5 <= ratio < 0.8` OR 单 pattern 命中但无共现
>   - **LOW**: `ratio < 0.5` OR evidence 冲突（e.g. tsconfig strict=false vs strict pattern 预期）
> - **Evidence**: Round 1 external research 指出 HIGH 必须基于 DIRECT code evidence（grep 命中计数）
> - **Next Action**: 落地时在 `packages/shared/src/schemas/forensic-report.ts` 定义，`forensic.ts::buildAssertions()` 新函数替换 `buildSkillRecommendations()`

> **Solution**: **candidate_files schema** — CLI 预给主动侦察清单
> - **Status**: Validated
> - **Problem**: SKILL 自主 Glob token 不可预测
> - **Rationale**: forensic.ts 同一遍扫已知 entry_points + 结构，按 family 分类最多 15 文件预给
> - **Design**:
> ```typescript
> // 追加到 ForensicReport
> interface CandidateFileEntry {
>   path: string;
>   family: 'entry' | 'component' | 'config' | 'test' | 'domain';
>   rationale: string;   // 为什么进入补采清单，e.g. "top-3 in assets/scripts/gameplay by size"
> }
>
> interface ForensicReport {
>   // ... existing fields
>   candidate_files: CandidateFileEntry[]; // 总数 ≤ 12
>   sampling_budget: { max_files: 15, max_lines_per_file: 100 };
> }
> ```
> - **Family 分配规则**（forensic.ts 实现）：
>   - `entry` family: 已有的 entry_points 前 3 个（code_samples 已覆盖，候选中仅保留路径不重复读）
>   - `component` family: `scope_glob` 下按大小 top-3（例：assets/scripts/* for Cocos）
>   - `config` family: tsconfig.json / package.json / vite.config.* / next.config.*
>   - `test` family: __tests__/*.{spec,test}.* 前 2
>   - `domain` family: 若检测到多个 paths 分簇（e.g. gameplay/ 和 network/），各取 1
> - **Next Action**: forensic.ts 增加 `buildCandidateFiles(target, topology, entryPoints)` 函数

> **Solution**: **SKILL.md 3 Phase 重构 — 单轮 Architecture Review**
> - **Status**: Validated
> - **Problem**: 当前 Phase 1/2 两轮 × 3.5 问分散用户注意力
> - **Design**:
> ```
> Phase 0 — 主动侦察（无用户交互，SKILL 自动执行）
>   输入: .fabric/forensic.json
>   动作:
>   1. Read forensic.json 的 assertions[] 和 candidate_files[]
>   2. 对每个 candidate_files[] 条目 Read（硬限 15 × 100 行；超限按 family 前 3 降级）
>   3. 对 forensic 未覆盖的可疑 pattern 执行 Grep 验证 (每个 pattern 最多 1 次)
>   4. 合并 forensic assertions + 新发现 → final_assertions[]
>   5. 生成一份结构化 "Architecture Review" 文本 (ready for Phase 1)
>
> Phase 1 — Architecture Review（单轮批量 Check）
>   展示结构（一屏）:
>
>   ## 我检测到的项目架构（请校对）
>
>   ### 📦 Framework 识别
>   [✓ HIGH] Cocos Creator 3.8.0 (TypeScript)
>          证据: project.config.json:3-7 ("creator.version": "3.8.0")
>
>   ### 🏗️ Architecture Patterns
>   [✓ HIGH] 组件化 — @ccclass + extends Component
>          证据: 覆盖率 100% (3/3 文件), assets/scripts/Game.ts:4
>   [? MEDIUM] 场景入口模式 — 单 SceneManager
>          证据: 覆盖率 60% (3/5), assets/scripts/SceneManager.ts:12
>
>   ### 🚫 提议的 AI 约束（您可编辑/删除）
>   [✓ HIGH] ban update-async: "update() 内不得使用 async/await"
>          证据: Cocos 生命周期约定 + Game.ts:31 示例
>   [✓ HIGH] protect-assets: ".meta / prefabs / scenes 不可 AI 修改"
>          证据: 检测到 120 个 .meta 文件
>   [? MEDIUM] require-ccclass: "所有 Component 类必须 @ccclass 装饰"
>          证据: 当前 3/3 已遵守 (MEDIUM 因样本少)
>
>   ### 🗂️ Domain Boundary（用于 L1 拆分）
>   [? MEDIUM] gameplay/ 和 network/ 分属独立领域
>          证据: assets/scripts/gameplay/*.ts (12 文件) vs assets/scripts/network/*.ts (4 文件)
>
>   ---
>   请告诉我: 哪条不对? 要改哪条? 要加什么?
>   (HIGH 项默认接受，您不纠正即视为同意)
>
>   用户回复示例:
>     "第2条改成 Scene Director 模式，第5条改成 'require-ccclass for @property-using classes only'"
>
> Phase 2 — 构造与落地（自动，无交互）
>   1. 合并最终 assertions[] → invariants[] + architecture_patterns[] + domain_groups[]
>   2. 写 .fabric/init-context.json
>      - interview_trail 记录 Architecture Review 展示内容 + 用户修正
>      - confidence_snapshot 保存每条 accept 时的置信度
>   3. 生成分层 AGENTS.md:
>      - 根 AGENTS.md ≤ 300 行, 含 L0 Constraints + @HUMAN
>      - 若 domain_groups.length >= 2: 每个 group_path/AGENTS.md (colocated)
>      - 若侦察出横向模式（security/testing/perf）: .claude/rules/{concern}.md with paths: frontmatter
>   4. 根 AGENTS.md 使用 @import 语法列出子文件：
>
>      <!-- 自动生成的子文档索引（Claude Code 原生解析，无需 sync-meta 维护） -->
>      @assets/scripts/gameplay/AGENTS.md
>      @assets/scripts/network/AGENTS.md
>      @.claude/rules/security.md
>
>   5. 更新 .fabric/agents.meta.json nodes 树（含新 layer 和 topology_type 字段）
>   6. 最终输出：生成文件清单 + 后续维护建议（fab sync-meta 重算 hash）
> ```
> - **Alternatives**: 分层多轮（用户选 Q5 时拒绝）
> - **Evidence**: SKILL.md 当前结构（80-92）+ Q5 单轮决策
> - **Next Action**: 重写 templates/claude-skills/agents-md-init/SKILL.md 主体段落

> **Solution**: **硬规则重定义 — DISPLAY vs WRITE 分离**
> - **Status**: Validated
> - **Problem**: `NEVER infer unconfirmed invariants` 与 HIGH 默认接受冲突
> - **New Hard Rules**（替换当前 88-92 行）:
> ```
> - NEVER WRITE to .fabric/init-context.json an invariant that the user has not implicitly or explicitly accepted.
>   * HIGH-confidence assertion shown in batch Architecture Review = IMPLICITLY ACCEPTED unless user rejects it.
>   * MEDIUM/LOW-confidence assertion = EXPLICIT ACCEPTANCE REQUIRED.
> - NEVER display an assertion as HIGH without:
>   * coverage.ratio >= 0.8 AND co_occurring_patterns.length >= 2, OR
>   * AST-level strong feature (e.g. @ccclass decorator with verified import from 'cc')
> - NEVER display an assertion with proposed_rule.invariant_type at HIGH unless DIRECT code evidence (grep match count >= coverage threshold) is present.
> - NEVER use <!-- fab:index --> block; instead use Claude-Code-native @import lines for cross-referencing child AGENTS.md files.
> - MUST record confidence_snapshot in init-context.json for every invariant, so future fab sync-meta or audits can reproduce acceptance logic.
> ```
> - **Evidence**: Q1 决策 + Q5 单轮 batch 模式 + Q4 @import 选择
> - **Next Action**: SKILL.md 硬规则段重写

> **Solution**: **agents-meta.ts schema 扩展 — layer + topology_type**
> - **Status**: Validated
> - **Problem**: fab sync-meta 无法区分 L0/L1/L2 和 colocated vs rules-frontmatter
> - **Design**:
> ```typescript
> // packages/shared/src/schemas/agents-meta.ts
> interface AgentsMetaNode {
>   file: string;
>   scope_glob: string;
>   deps: string[];
>   priority: 'high' | 'medium' | 'low';
>   hash: string;
>   // NEW
>   layer: 'L0' | 'L1' | 'L2';                           // 层级（由路径深度+SKILL 标注）
>   topology_type: 'colocated' | 'rules-frontmatter';   // 物理拓扑类型
>   paths_frontmatter?: string[];                        // 若 rules-frontmatter, 记录 paths: 值
> }
> ```
> - **sync-meta 扩展逻辑**：
>   - findAgentsFiles 扩展为 `findAgentsFiles()` + `findRulesFiles()` (扫描 `.claude/rules/*.md`，解析 paths: frontmatter)
>   - deriveLayer: L0 = root AGENTS.md; L1 = 一层子目录 AGENTS.md; L2 = 两层子目录 AGENTS.md 或 .claude/rules/*.md
>   - sync-meta 不再试图维护 L0 索引（@import 由 Claude Code 解析）
> - **Next Action**: schema 扩展 + sync-meta 扫描增强

#### Round 2 Intent Coverage Check

| # | Intent | Status | Where Addressed |
|---|--------|--------|-----------------|
| I1 | Check-not-Ask 主动侦察 | ✅ addressed | Round 2 — ForensicAssertion schema + candidate_files + Phase 0 侦察 + 置信度公式 + 硬规则 DISPLAY/WRITE 分离 |
| I2 | 分层文档物理拓扑 | ✅ addressed | Round 2 — 混合拓扑原则 + @import 索引 + agents-meta layer/topology_type 扩展 + sync-meta rules-frontmatter 扫描 |
| I3 | Matcha 交互优化 | ✅ addressed | Round 2 — 单轮 Architecture Review 话术模板 + 证据锚内联 + HIGH 隐式接受机制 |

**所有原始意图在 Round 2 完整覆盖**。还可选做 Round 3：验证 `werewolf-minigame-stub` fixture 上的端到端 Architecture Review 示例 + werewolf-specific assertion 列表；但核心架构已可执行。

### Round 2: Narrative Synthesis

**起点**: Round 1 遗留 6 个决策点（Q1-Q6）+ 技术方案骨架。

**关键进展**: 用户 6/6 选择"推荐"，证明 Round 1 的证据链+研究驱动方向与用户直觉一致。Round 2 将推荐方向落到具体：schema 字段、置信度量化公式、SKILL.md 话术模板、硬规则重述、agents-meta 扩展 — 每项都有 file:line 锚或代码片段示例。

**决策影响**: 架构从"应该这样"升级为"这样做" —— ForensicAssertion 定义、candidate_files family 分配规则、Phase 0/1/2 伪代码、新硬规则集完成。

**当前理解**: 三个 Intent 全部 addressed，所有关键组件的接口+行为明确，可直接 handoff workflow-lite-plan 做任务分解。

**遗留问题**: 无阻塞。可选延伸：
- werewolf-minigame-stub 上的端到端 assertion 样例（用于端到端测试 fixture）
- agents-meta.ts 的迁移路径（旧 meta 文件无 layer/topology_type 字段时的向后兼容）

---

## Phase 4: Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|-----------------|--------|-----------------|-------|
| I1 | Check-not-Ask 主动侦察 | ✅ Addressed | R1 gap 定位 + R2 (ForensicAssertion schema + candidate_files + Phase 0 伪代码 + 置信度公式 + 硬规则重写) | 全部落到代码级设计 |
| I2 | 分层文档物理拓扑 | ✅ Addressed | R1 (Claude Code 原生机制) + R2 (混合原则 + @import 索引 + agents-meta layer/topology_type + sync-meta 扩展) | 含迁移路径 |
| I3 | Matcha 交互优化 | ✅ Addressed | R1 (/init 范式) + R2 (单轮 Architecture Review 话术 + 证据锚 + HIGH 隐式接受) | 含视觉结构示例 |

**三意图全部 addressed，无 ❌/⚠️ 项**。

### Findings Coverage Matrix

| # | Finding (Round) | Disposition | Target |
|---|-----------------|-------------|--------|
| 1 | SKILL allowed-tools 已声明但 Phase 1/2 不调用 (R1) | recommendation | Rec #2 |
| 2 | recommendations_for_skill 是 string[] 无结构 (R1) | recommendation | Rec #1 |
| 3 | 硬规则 NEVER infer unconfirmed 与 Matcha 冲突 (R1) | recommendation | Rec #2 |
| 4 | Claude Code CLAUDE.md ancestor 拼接 + 懒加载 (R1) | informational | — |
| 5 | .claude/rules/*.md paths-frontmatter 原生 (R1) | recommendation | Rec #3 |
| 6 | fab sync-meta 只扫 AGENTS.md (R1) | recommendation | Rec #3 |
| 7 | HIGH 需 DIRECT code evidence 非仅文件存在 (R1) | absorbed | → Rec #1 coverage 公式 |
| 8 | npm init canonical detect-then-default (R1) | informational | — |
| 9 | Claude Code /init 是 Matcha 参照蓝本 (R1) | informational | — |
| 10 | Poetry silent smart defaults 反模式 (R1) | absorbed | → Rec #2 |
| 11 | Q1-Q6 全选推荐 (R2) | informational | — |
| 12 | ForensicAssertion schema 设计 (R2) | recommendation | Rec #1 |
| 13 | candidate_files pattern family 规则 (R2) | recommendation | Rec #1 |
| 14 | SKILL.md Phase 0/1/2 伪代码 (R2) | recommendation | Rec #2 |
| 15 | 硬规则 DISPLAY/WRITE 分离 (R2) | recommendation | Rec #2 |
| 16 | agents-meta layer + topology_type 扩展 (R2) | recommendation | Rec #3 |
| 17 | init-context confidence_snapshot 扩展 (R2) | recommendation | Rec #4 |
| 18 | 向后兼容迁移路径 (R2) | absorbed | → Rec #3 |

**全部 findings 有 disposition，无 null 未映射项**。

### Key Conclusions (Ranked)

1. **SKILL 从 3 Phase 3 轮降级为 3 Phase 1 轮交互** — Phase 0 主动侦察 + Phase 1 单轮 Architecture Review 批量 Check + Phase 2 自动构造，参照 Claude Code 新 /init 流程。用户回应数从 7 降到 1
2. **ForensicReport.recommendations_for_skill 升级为 ForensicAssertion[]** — 结构化断言（type/statement/confidence/evidence/coverage/proposed_rule）是 Check-not-Ask 落地第一短板
3. **置信度定量三档公式**：HIGH = coverage ≥ 0.8 + multi-pattern 共现（或 AST 级强特征）；MEDIUM = 0.5-0.8 单 pattern；LOW = < 0.5 或矛盾
4. **混合物理拓扑** — scope-bound 用 colocated AGENTS.md（Claude Code 原生 ancestor 拼接），cross-cutting 用 `.claude/rules/{concern}.md` with `paths:` frontmatter；由 SKILL 涌现式生成
5. **@import 原生索引** — 根 AGENTS.md 用 `@packages/*/AGENTS.md` 语法；sync-meta 不再维护 `<!-- fab:index -->`
6. **硬规则 DISPLAY/WRITE 分离** — HIGH 批量展示时隐式接受；WRITE init-context 要求显式/隐式确认
7. **token 硬预算** — SKILL Phase 0 限 15 文件 × 100 行，超限降级 pattern-family 前 3
8. **agents-meta / init-context schema 扩展** — layer + topology_type + paths_frontmatter + confidence_snapshot
9. **CLI 预给 candidate_files** — 按 pattern family (entry/component/config/test/domain) × top-3，总量 ≤ 12
10. **改造成本结构**: allowed-tools 无需改；SKILL.md 重写 + forensic.ts 扩展 + schema 扩展 + sync-meta 扩展 + 测试 fixture + 文档更新

### Prioritized Recommendations

**HIGH 优先级**

1. **Rec #1 — 升级 ForensicReport schema**（新增 ForensicAssertion[] + candidate_files[] + sampling_budget）
2. **Rec #2 — 重写 templates/claude-skills/agents-md-init/SKILL.md**（Phase 0/1/2 + 硬规则 DISPLAY/WRITE 分离 + @import 规则）
3. **Rec #3 — 扩展 agents-meta.ts + sync-meta.ts**（layer/topology_type 字段 + findRulesFiles 扫描 .claude/rules/*.md + 向后兼容）

**MEDIUM 优先级**

4. **Rec #4 — 扩展 init-context.ts schema**（InitContextInvariant.confidence_snapshot + InitContextDomainGroup.topology_type）
5. **Rec #5 — werewolf-minigame-stub 端到端测试 fixture**（assertions / candidate_files / init-context 三类 test）
6. **Rec #6 — 更新 docs/initialization.md**（Matcha 用户旅程 + HIGH/MEDIUM/LOW 说明 + @import 样例）

### Decision Trail

（详见 conclusions.json `decision_trail[]`）

- R1: 单一综合视角 + 假设验证而非中立评估
- R2 × 6: 用户在 Q1-Q6 全部选推荐方向 — 定量三档 / CLI 预给 candidate / 涌现式跨切面 / @import 原生 / 单轮 Architecture Review / token 硬限

### Session Statistics

| Metric | Value |
|--------|-------|
| 总轮次 | 2 (R1 探测+研究 / R2 决策+设计) |
| 关键决策 | 9（含 Q1-Q6 全部 + 3 个 Round 2 设计决策） |
| Technical Solutions (Validated) | 6 |
| Key Findings | 14 |
| 代码证据锚 (file:line) | 12 |
| Recommendations | 6 (3 HIGH + 3 MEDIUM) |
| 引用外部研究源 | 8 |
| 用户 AskUserQuestion 回合 | 3 (初始 depth + Q1/Q3/Q4/Q5 + Q2/Q6 + 完成选择) |
| 产出物 | discussion.md / exploration-codebase.json / explorations.json / research.json / conclusions.json |

---

### Round 3: Zero-Pollution Runtime Association 提案评估

#### 用户原始提案

主张 **"零污染的运行时语义关联（Zero-Pollution Runtime Association）"** 架构：

1. **物理隔离（Storage）**: 坚持 Scheme B — 在 `.fabric/agents/` 中维护一套与源码 1:1 镜像的深层嵌套文档
2. **按需发现（Discovery）**: 取消所有静态生成器（不生成 `.claude/rules/` 等桥接文件）
3. **工具驱动（Mechanism）**: 通过定制化 MCP 工具（如 `fab_get_context`），赋予 AI 主动侦察能力 — 每当 AI 操作某一路径时，通过 MCP 运行时动态获取该路径对应的镜像规则、具体作用和相应变更，实现"语义层"对"代码层"的透明覆盖

#### 关键代码证据（颠覆 Round 2 前提）

> **Finding**: 系统**已经是 MCP-first**，不是 Round 2 推论的"Claude Code ambient context 为主 + MCP 为辅"
> - **Confidence**: High — **Why**:
>   - `packages/server/src/tools/get-rules.ts:28-29` 已注册 `fab_get_rules` 工具，描述为 "MANDATORY: Call before modifying any file to retrieve Fabric rules for a target path"
>   - `templates/bootstrap/CLAUDE.md`, `cursor-fabric-bootstrap.mdc`, `GEMINI.md`, `codex-AGENTS-header.md`, `roo-fabric.md`, `windsurf-fabric.md` — 6 份 bootstrap 模板**全部**包含 `MUST: Before editing any file, call the MCP tool fab_get_rules(path=<target file>)`
>   - `examples/werewolf-minigame-stub/AGENTS.md:41` 明文写 `MUST call fab_get_rules(path=<file>) before editing any file when MCP is available`
> - **Hypothesis Impact**: Modifies — 用户提案并非"从 ambient 切到 MCP-first"，而是"在已有 MCP-first 基础上，改变规则文件的物理存放位置 + 删除 `.claude/rules/` 静态生成"
> - **Scope**: 重新评估 Round 2 所有 Recs

> **Finding**: `get-rules.ts:38` 的 minimatch 逻辑**已经解耦了文件物理位置与作用范围**
> - **Confidence**: High — **Why**: `matchedNodes = Object.entries(meta.nodes).filter(([, node]) => minimatch(requestedPath, normalizePath(node.scope_glob), { dot: true }))` — 只要 `agents.meta.json` 中 `scope_glob` 正确，文件放哪都能被查询到
> - **Hypothesis Impact**: Confirms — 用户提案技术上完全可行，无需改动 `get-rules` 逻辑
> - **Scope**: Zero-Pollution 是 schema-transparent 的

#### 5-Axis 批判评估

| # | 维度 | 证据 | 评估 |
|---|------|------|------|
| 1 | **Bootstrap paradox** | `templates/bootstrap/CLAUDE.md` + `cursor-fabric-bootstrap.mdc` | ✅ **已解决** — 根级 bootstrap 文件必须存在（告知 AI 调用 MCP），这是 protocol-level overhead 不可消除，但用户提案保留根 AGENTS.md 即可 |
| 2 | **Non-MCP client fallback** | `examples/werewolf-minigame-stub/AGENTS.md:1-60` | ❌ **破坏** — 就近 AGENTS.md 原是 Cursor 未连 MCP、旧版 IDE、人类 Reviewer 的降级通道；Zero-Pollution 后这些场景彻底失去子域规则可见性 |
| 3 | **Cross-cutting concerns** | Round 2 solution: `.claude/rules/*.md` with `paths:` frontmatter | ⚠️ **变笨拙** — 1:1 源码镜像难以自然表达 "security 适用于 **/*.ts"；必须在 `agents.meta.json` 的 `scope_glob` 做虚拟路由（`.fabric/agents/_cross/security.md` + `scope_glob: "**/*.ts"`）— 可行但失去 paths-frontmatter 原生自解释性 |
| 4 | **Round 2 evidence conflict** | Round 2 Finding 4 (ancestor-chain) + Finding 5 (paths-frontmatter) | ⚠️ **直接放弃** — 这两项是 Round 2 将"混合拓扑"判定为最优的核心证据；用户提案等于声明"Claude Code 原生机制不值得利用" |
| 5 | **Ambient loading (感知期真空)** | `get-rules.ts` 逻辑 + AI 工作流观察 | ❌ **最致命** — `fab_get_rules` 只在 AI 准备**编辑**时触发；在 AI 阅读代码、做架构规划、全局 codebase 扫描时**不会调用** → 规划阶段 AI 可能做出违反局部约束的方案才到编辑才发现要回退 |

#### Trade-off Matrix

| 评估维度 | Round 2 (Hybrid) | Round 3 (Zero-Pollution) | 胜出 |
|---|---|---|---|
| 源码目录污染度 | 中（散落 AGENTS.md） | **极低（纯 .fabric/）** | R3 |
| 非 MCP 客户端友好度 | **高（就近可见）** | 低（隐形于 .fabric/） | R2 |
| 人类 Code Review 友好度 | **高（PR diff 含子域规则）** | 低（需跳转 .fabric/agents/ 查阅） | R2 |
| Claude Code 原生机制契合 | **完全（ancestor-chain + paths）** | 放弃 | R2 |
| 跨切面规则表达 | **原生优雅（paths-frontmatter）** | 依赖全局 scope_glob 映射 | R2 |
| AI 感知期规则密度 | **高（ambient 注入）** | 低（感知期真空） | R2 |
| 单一事实源清晰度 | 中（colocated + rules/） | **极高（全在 .fabric/）** | R3 |
| sync-meta 维护复杂度 | 高（双源扫描） | **低（单源）** | R3 |
| Token 成本（ambient） | 高（预加载所有 rules） | 低（按需查询） | R3 |
| Token 成本（查询频次） | 低 | 高（每文件操作必调） | R2 |

**R2 胜出 6 项（多数为质量维度），R3 胜出 4 项（多数为结构维度）**。

#### Technical Solutions (Proposed)

> **Solution**: **修正版方案 — Structural Zero-Pollution + Ambient Preserve**（混合折中）
> - **Status**: Proposed
> - **Problem**: 用户追求的"源码目录零污染"与 Round 2 追求的"ambient 原生机制"可部分兼得
> - **Design**:
>   - 保留用户的 `.fabric/agents/` 1:1 镜像作为**单一事实源**（Single Source of Truth）
>   - `fab init` / SKILL Phase 2 仅写 `.fabric/agents/` 下的镜像文件 — 源码目录保持**零 AGENTS.md 散落**
>   - 但**自动同步生成**两份"桥接工件"保留 ambient loading：
>     - `.claude/rules/{concern}.md` with `paths:` frontmatter（Claude Code 读）— 为跨切面和感知期规则覆盖
>     - 根 `AGENTS.md` 使用 `@import` 行引用 `.fabric/agents/*`（Claude / Codex 读）
>   - 桥接工件在 git 中**可忽略**（`.gitignore`），仅本地生成；真正要 review 的内容是 `.fabric/agents/**/*.md`
>   - `fab_get_rules` 仍作为跨客户端权威接口；桥接仅是 ambient fallback
> - **Rationale**: 既满足用户"源码目录零污染 + 单一事实源"，又保留 Claude Code 原生机制和非 MCP 客户端降级路径
> - **Alternatives**: 完全采纳 Zero-Pollution（失去 ambient）；完全保留 Round 2（未满足用户零污染诉求）
> - **Evidence**: `get-rules.ts:38` 已证明物理位置解耦；ForensicReport 升级 + SKILL Phase 0 保持不变
> - **Next Action**: 需用户回答 4 个澄清问题确定走向

#### Clarifications Needed (需要用户确认)

**CQ1 — 感知期真空是否可接受？**
AI 在阅读代码 / 做架构规划 / 全局扫描时不会主动调 `fab_get_rules`（只在编辑前触发）。这意味着：AI 可能做出违反子域规则的方案，直到 Phase 5 编辑时才被 tool-return 纠正并回退。是否可接受？或需要哪些补偿机制（e.g. 初始加载全 concern 规则到 system prompt / 增加 `fab_plan_context` 聚合查询）？

**CQ2 — 非 MCP 客户端 & 人类 Code Review 是否放弃？**
Cursor 未连 MCP 时 / 人类 Code Reviewer 查看 `packages/server/` 的 PR 时，失去就近 AGENTS.md 的规则可见性。接受此代价，还是需要**自动生成降级文件**（例如 `.fabric/agents/packages/server/_readme.md` 软链接到源码目录为 `AGENTS.md`）？

**CQ3 — 跨切面规则如何表达？**
`.fabric/agents/` 严格 1:1 源码镜像时，cross-cutting 规则（如 `security` 适用于 `**/*.ts`）无法自然归属到某个源码路径。方案选择：
- (a) 在 `.fabric/agents/_cross/{concern}.md` 下集中，靠 `agents.meta.json` 的 `scope_glob: "**/*.ts"` 映射
- (b) 在每个源码目录对应的 `.fabric/agents/path/concern-security.md` 下重复（违反 DRY）
- (c) 放弃跨切面的 Fabric 原生支持，要求团队用 TS eslint / lint-staged 等传统工具表达

**CQ4 — `.claude/rules/` 是否保留作为 ambient 桥接？**
若接受"修正版方案（Structural Zero-Pollution + Ambient Preserve）"：`.fabric/agents/` 作为 SSOT（单一事实源）+ `.claude/rules/*.md` 作为**自动生成的 gitignored 桥接**给 Claude Code ambient 用。这样源码目录仍零污染，感知期真空缓解。可接受吗？

#### Round 3 Intent Coverage Check

| # | Intent | Status | Notes |
|---|--------|--------|-------|
| I1 | Check-not-Ask 主动侦察 | ✅ 已在 R2 addressed，不受本次提案影响 |
| I2 | 分层文档物理拓扑 | 🔄 **重新打开** — 用户提出第三种方案（纯 `.fabric/agents/` 镜像）推翻 R2 混合拓扑结论 |
| I3 | Matcha 交互优化 | ✅ 已在 R2 addressed，不受本次提案影响 |

**新增探索意图（I4）**: 在 MCP-first 已是事实的前提下，规则文件的物理存放位置如何取舍"源码零污染" vs "ambient 覆盖 vs 人类友好"。

#### Round 3: Narrative Synthesis

**起点**: 用户在 Round 2 完成后提出 "Zero-Pollution Runtime Association"，要求评估其合理性。

**关键进展**: 代码探测发现**系统早已是 MCP-first**（6 份 bootstrap 均强制 `fab_get_rules`），这颠覆了 Round 2 对"ambient 为主"的隐含假设。用户提案的本质被澄清为：不是范式切换，而是"规则文件物理位置选择"。5-axis 批判评估揭示 **Round 2 仍在 6/10 维度胜出**，但**用户在 4/10 维度的诉求（源码零污染、SSOT、sync-meta 简化、ambient token 成本）是合法的**。

**决策影响**: 提出"修正版方案（Structural Zero-Pollution + Ambient Preserve）"作为折中 — 用 `.fabric/agents/` 作 SSOT + 自动生成 gitignored 的 `.claude/rules/` 和根 AGENTS.md `@import` 桥接，既零污染源码目录又保留 ambient loading。

**当前理解**: 纯 Zero-Pollution = **Reasonable-with-caveats**（技术可行，但 4 项质量维度代价需用户明确接受）。推荐走**修正版折中方案**。待用户回答 CQ1-CQ4 确认走向。

**遗留问题**: CQ1-CQ4 未决；Rec #2/#3 的具体重写内容依赖用户回答。

---

### Round 3 — Decision Log（用户 CQ1-CQ4 决策）

> **Decision**: CQ1 — **强化 MCP 协议，启用 Shadow Mirroring 架构**
> - **Context**: AI 感知期（阅读 / 规划 / 扫描）规则真空问题需硬规则解决
> - **Options considered**: 接受真空（信任编辑期回退）/ 补偿机制（fab_plan_context）/ ambient 桥接
> - **Chosen**: 强化协议规则 — **Reason**: 用户原话 "本仓库采用 **Shadow Mirroring（影子镜像）**架构。业务目录（如 src/）不存放规则文件。AI 在进行**任何代码阅读、架构规划或逻辑修改前**，必须（MANDATORY）先调用 `fab_get_rules(path)` 探测该路径在 `.fabric/agents/` 中的影子约束。严禁在未获取局部上下文的情况下进行方案推演。"
> - **Rejected**: Ambient 桥接（违背 Zero-Pollution 初衷）；fab_plan_context 补偿（非本质）
> - **Impact**: 所有 6 份 bootstrap 模板必须重写 — 从 "Before editing any file" 升级为 "Before any code reading, architecture planning, or logic modification"；需引入 hook / 记录机制监控合规

> **Decision**: CQ2 — **完全放弃非 MCP 客户端与人类 Code Review 的降级路径**
> - **Context**: 就近 AGENTS.md 对不连 MCP 的 Cursor / 人类 reviewer 的可见性
> - **Options considered**: 完全放弃 / 自动生成 gitignored 桥接 / 源码侧软链接
> - **Chosen**: 完全放弃 — **Reason**: 纯 Zero-Pollution 立场；所有 AI 客户端必须支持 MCP；人类 review 查 `.fabric/agents/` 是一次性学习成本
> - **Rejected**: 桥接方案（破坏 SSOT）；软链接（破坏"业务目录不存放规则文件"原则）
> - **Impact**: 产品规则明确 "Fabric 要求 MCP-capable client"；docs/initialization.md 需注明 client compatibility matrix

> **Decision**: CQ3 — **`_cross/` 子树 + scope_glob 映射**
> - **Context**: 1:1 源码镜像下跨切面规则（security / testing / perf）的归属
> - **Options considered**: _cross/ 子树 / 每目录重复 / 放弃 Fabric 原生支持
> - **Chosen**: `_cross/` 子树 — **Reason**: `.fabric/agents/_cross/{concern}.md` 集中存 + `agents.meta.json` 用 `scope_glob` 做全局绑定；仍保持 SSOT，无重复
> - **Rejected**: 每目录重复（违反 DRY）；放弃 Fabric 原生支持（功能倒退）
> - **Impact**: agents-meta schema 新增 `topology_type: 'shadow-mirror' | 'cross-cutting'`；SKILL Phase 2 侦察到跨切面模式时写入 `.fabric/agents/_cross/`

> **Decision**: CQ4 — **坚持纯 Zero-Pollution**
> - **Context**: 是否自动生成 gitignored 桥接工件保 ambient
> - **Chosen**: 纯 Zero-Pollution — **Reason**: 用户立场坚定；与 CQ1 强化 MCP 协议保持一致
> - **Rejected**: 折中方案（感知期真空由强化协议解决）；Round 2 回退（用户明确否定）
> - **Impact**: `@import` 原生索引废弃；根 AGENTS.md 退化为 Fabric Bootstrap Protocol（仅告知 AI 调 fab_get_rules）

#### Round 3 Technical Solutions (Validated — 最终架构)

> **Solution**: **Shadow Mirroring 架构** — 业务目录零规则 + `.fabric/agents/` 1:1 镜像 + `_cross/` 跨切面 + MCP 强制分发
> - **Status**: Validated
> - **Design**:
>   ```
>   项目根/
>   ├── AGENTS.md                         # Bootstrap Protocol only (告知 AI 调 fab_get_rules)
>   ├── CLAUDE.md / .cursor/*.mdc / ...   # 6 份 bootstrap 模板（协议级 overhead 不可避免）
>   ├── src/                              # 业务目录 — 零规则文件
>   │   └── auth/...
>   ├── packages/
>   │   ├── server/                       # 业务目录 — 零规则文件
>   │   └── cli/                          # 业务目录 — 零规则文件
>   └── .fabric/
>       ├── agents.meta.json              # 路径映射 registry（file → scope_glob）
>       ├── agents/                       # 影子镜像树
>       │   ├── root.md                   # 项目级约束
>       │   ├── src/
>       │   │   └── auth/
>       │   │       └── index.md          # 对应 src/auth/ 的约束
>       │   ├── packages/
>       │   │   ├── server/
>       │   │   │   └── index.md
>       │   │   └── cli/
>       │   │       └── index.md
>       │   └── _cross/                   # 跨切面子树
>       │       ├── security.md           # scope_glob: **/*.ts
>       │       ├── testing.md            # scope_glob: **/*.{spec,test}.{ts,js}
>       │       └── performance.md
>       ├── human-lock.json
>       └── ledger.jsonl
>   ```
> - **MCP 工具**:
>   - `fab_get_rules(path)` — 已存在，读 agents.meta.json → 按 scope_glob 匹配 → 返回所有 matched `.fabric/agents/**/*.md` 内容
>   - `fab_plan_context(paths[])` — **新增（可选，提案）** — 聚合多路径规则，支持 Plan 阶段批量查询
>   - `fab_update_registry` — 已存在，维护 agents.meta.json 映射
> - **Bootstrap 协议升级**:
>   - 所有 6 份模板硬规则升级为:
>     ```
>     MUST: Before ANY code reading, architecture planning, or logic modification,
>           call fab_get_rules(path=<target file>) to retrieve shadow constraints from .fabric/agents/.
>     NEVER: Reason about or modify code before obtaining local shadow context via MCP.
>     ```
> - **Evidence**: `get-rules.ts:38` minimatch 已解耦物理位置；`agents-meta.ts` schema 已支持任意 file → scope_glob 映射
> - **Next Action**: 重写所有 6 份 bootstrap 模板 + SKILL Phase 2 镜像生成器 + agents-meta schema `topology_type` 扩展

> **Solution**: **agents-meta.ts schema 简化重构**（替代 Round 2 的 layer/colocated/rules-frontmatter 三态方案）
> - **Status**: Validated
> - **Design**:
>   ```typescript
>   // packages/shared/src/schemas/agents-meta.ts
>   interface AgentsMetaNode {
>     file: string;              // 始终位于 .fabric/agents/ 下
>     scope_glob: string;        // 映射到真实源码路径（如 "src/auth/**" 或 "**/*.ts"）
>     deps: string[];
>     priority: 'high' | 'medium' | 'low';
>     hash: string;
>     topology_type: 'mirror' | 'cross-cutting';  // mirror = 1:1 源码对应；cross-cutting = _cross/ 下全局规则
>     layer: 'L0' | 'L1' | 'L2';
>   }
>   ```
> - **简化点**: 去掉 Round 2 的 `paths_frontmatter` 字段（不再使用 `.claude/rules/` 原生语法）
> - **Next Action**: schema 扩展 + sync-meta 只扫描 `.fabric/agents/**/*.md`

#### Round 3 Intent Coverage Check（最终）

| # | Intent | Status | Where Addressed |
|---|--------|--------|-----------------|
| I1 | Check-not-Ask 主动侦察 | ✅ Addressed (R2) | 不受 R3 影响，继续 Round 2 设计 |
| I2 | 分层文档物理拓扑 | ✅ Addressed (R3) | **更新结论** — Shadow Mirroring 架构取代混合拓扑 |
| I3 | Matcha 交互优化 | ✅ Addressed (R2) | 不受 R3 影响，继续 Round 2 设计 |
| I4 (新) | MCP 优先规则分发 | ✅ Addressed (R3) | Bootstrap 协议升级 + Shadow Mirroring 纯 MCP 架构 |

#### Round 3: Narrative Synthesis

**起点**: 用户提出 Zero-Pollution Runtime Association 架构挑战 Round 2 混合拓扑结论。

**关键进展**: 代码证据揭示系统早已是 MCP-first，颠覆了 Round 2 的隐含前提。5-axis 评估识别 4 项代价（非 MCP 降级、Round 2 证据、感知期真空、跨切面）并提出折中方案。用户在 4 个 clarification 中**坚定选择纯 Zero-Pollution**，并自创 "**Shadow Mirroring 架构**" 名词 + 升级 MCP 强制协议（从"编辑前"扩展到"读/规划/编辑前"）以解决感知期真空。

**决策影响**: Round 2 的 Rec #3 混合拓扑被**完全替换**；Rec #2 SKILL Phase 2 生成器改为"只写 .fabric/agents/ 镜像树"；新增 Rec #7 bootstrap 协议升级（6 份模板同步）；`@import` 索引废弃；agents-meta schema 简化（去掉 paths_frontmatter）。Rec #1（forensic schema）、Rec #2 前半（Phase 0 主动侦察）、Rec #4/5/6 不受影响。

**当前理解**: Shadow Mirroring 架构立场明确，技术可行，所有质量代价用户知情接受。产品定位升级为 "Fabric 要求 MCP-capable AI 客户端"。

**遗留问题**: 无阻塞。可选补强：
- (a) `fab_plan_context(paths[])` 新增 MCP 工具以聚合查询；
- (b) hook / 遥测机制监控 bootstrap 规则合规（AI 未调用 fab_get_rules 即写入时的警告）；
- (c) docs/initialization.md 增加 client compatibility matrix。

---

## Phase 4 (Updated for Round 3): Final Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|-----------------|--------|-----------------|-------|
| I1 | Check-not-Ask 主动侦察 | ✅ Addressed | R1 gap + R2 (ForensicAssertion/candidate_files/Phase 0) | 不受 R3 影响 |
| I2 | 分层文档物理拓扑 | ✅ Addressed (修订) | R3 (Shadow Mirroring 架构替换 R2 混合拓扑) | 决策回归"全集中" |
| I3 | Matcha 交互优化 | ✅ Addressed | R1 + R2 (单轮 Architecture Review + evidence 锚) | 不受 R3 影响 |
| I4 | MCP-first 协议强化 | ✅ Addressed (新增) | R3 (bootstrap 协议 + Shadow Mirroring + 感知期硬规则) | 用户在 R3 引入 |

### Updated Recommendations（R3 后）

**HIGH 优先级**

1. **Rec #1 — 升级 ForensicReport schema**（不变，来自 Round 2）
2. **Rec #2 — 重写 SKILL.md**：Phase 0/1 不变（R2），Phase 2 生成器**只写 `.fabric/agents/` 镜像树**，不生成 colocated AGENTS.md / `.claude/rules/` / `@import` 行
3. **Rec #3 — agents-meta.ts schema 扩展 + sync-meta.ts 重写**：`topology_type: 'mirror' | 'cross-cutting'` + `layer`；sync-meta 只扫描 `.fabric/agents/**/*.md`；不再扫描源码目录 AGENTS.md
4. **Rec #7 (新)** — 升级所有 6 份 bootstrap 模板（CLAUDE.md / cursor-fabric-bootstrap.mdc / GEMINI.md / codex-AGENTS-header.md / roo-fabric.md / windsurf-fabric.md）：硬规则从 "Before editing any file" 扩展为 "Before any code reading, architecture planning, or logic modification"
5. **Rec #8 (新)** — 根 `AGENTS.md` 精简为 Fabric Bootstrap Protocol（告知 AI 调 fab_get_rules；不再 `@import`）；`examples/werewolf-minigame-stub/AGENTS.md` 示例同步更新

**MEDIUM 优先级**

6. **Rec #4 — 扩展 init-context.ts schema**（不变，来自 Round 2）
7. **Rec #5 — werewolf-minigame-stub 端到端测试 fixture**（需更新为 Shadow Mirroring 结构）
8. **Rec #6 — 更新 docs/initialization.md**（加 Shadow Mirroring 章节 + client compatibility matrix）
9. **Rec #9 (新, 可选)** — 新增 `fab_plan_context(paths[])` MCP 工具，支持 AI Plan 阶段批量查询多路径规则
10. **Rec #10 (新, 可选)** — 遥测 / hook 机制监控 bootstrap 规则合规（未调 fab_get_rules 即写入时告警）

### Session Statistics（更新）

| Metric | Value |
|--------|-------|
| 总轮次 | 3 (R1 探测+研究 / R2 设计决策 / R3 架构重评估) |
| 关键决策 | 13（R2 × 9 + R3 × 4） |
| Technical Solutions (Validated) | 8 (R2 × 6 + R3 × 2) |
| Key Findings | 16 (R1 × 7 + R2 × 1 + R3 × 2 其中 R3 两项颠覆 R2 前提) |
| 代码证据锚 (file:line) | 15 |
| Recommendations | 10 (4 HIGH + 6 MEDIUM, 含 R3 新增 3 项) |
| 用户 AskUserQuestion 回合 | 4 (Q1-Q6 × 2 + CQ1-CQ4 × 1) |
| 产出物 | discussion.md / exploration-codebase.json / explorations.json / research.json / conclusions.json |

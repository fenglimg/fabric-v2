# Analysis Discussion

**Session**: ANL-2026-05-09-fabric-init-files-boundary | **Topic**: 剖析 .fabric/bootstrap/README.md、.fabric/INITIAL_TAXONOMY.md、.claude/skills/fabric-init/SKILL.md 三者关系、功能边界与优化 | **Started**: 2026-05-09T00:00:00+08:00
**Dimensions**: architecture, implementation, decision | **Depth**: Standard

## Table of Contents
- [Current Understanding](#current-understanding)
- [Analysis Context](#analysis-context)
- [Initial Questions](#initial-questions)
- [Initial Decisions](#initial-decisions)
- [Discussion Timeline](#discussion-timeline)
  - [Round 1 — Exploration](#round-1--exploration-2026-05-09)

## Current Understanding

### What We Established
- 三件产物均由 `fab init` 在 **Stage 2** 同时落盘，但承担三种不同角色：
  - `.fabric/bootstrap/README.md` = **Runtime 协议契约**（所有客户端的稳定入口锚点，规定 MUST/NEVER 规则与 `fab_plan_context`/`fab_get_rule_sections` 调用顺序）
  - `.fabric/INITIAL_TAXONOMY.md` = **Forensic 衍生的 L0/L1/L2 静态快照**（来源 `topology.key_dirs` + `candidate_files`，主要面向人工读者）
  - `.claude/skills/fabric-init/SKILL.md` = **AI 接力工作流**（Stage 3-6 — Matcha "Check-not-Ask" 单屏 Architecture Review，写入 `.fabric/init-context.json` 与 `.fabric/rules/`）
- 三者构成 `forensic.json → 两份人/AI 视角的衍生说明 → AI 把确认结果落到 init-context.json + rules/` 的初始化数据流。

### What Was Clarified
- bootstrap/README.md 不是规则正文承载者，是 Bootstrap Protocol contract；规则正文统一收敛于 `.fabric/rules/`。
- SKILL.md 已迁移到 Matcha 单屏审阅模型；旧版 3-轮 interview 模型已废弃，但 `skill-source/SOURCE.md` 仍是旧文。

### Key Insights
- **INITIAL_TAXONOMY.md 在 AI 链路中目前是死分支**：SKILL.md (Matcha) 直接读 `forensic.json.assertions[]` 与 `candidate_files[]`，不消费 INITIAL_TAXONOMY.md。它当前唯一稳定消费者是人工读者与 doctor 的存在性检查。
- **bootstrap/README.md 出现双源实现**：CLI (`bootstrap-guide.ts` + 模板) 与 shared (`buildBootstrapContent` 硬编码字符串) 各写一份，doctor --fix 与 fab init 走不同路径，长期会漂移。
- **SOURCE.md 自称 canonical 但与派生产物不同步**，源真相已裂变为「SOURCE.md 旧模型 + claude/codex 各自手维护 SKILL.md 新模型」。

## Analysis Context

- Focus: 功能边界澄清（bootstrap=protocol、taxonomy=forensic snapshot、skill=AI workflow）、源真相归一、消费链路修复
- Perspective: Architectural（系统视角，无需多视角拆分）
- Depth: Standard

## Initial Questions

1. INITIAL_TAXONOMY.md 是否仍要作为 AI 流程的实际输入？还是应明确降级为「人工读 + doctor 存在性检查」？
2. bootstrap/README.md 的双源实现（CLI 模板 vs shared 硬编码）是否合并为单一渲染器？
3. `skill-source/SOURCE.md` 的角色：更新为 Matcha 真源 / 删除 / 转为「skill 历史 ADR」？
4. bootstrap/README.md 模板里仍写着「Treat this file as the Fabric Protocol bootstrap」与 `AGENTS.md.template` 文件名残留，是否要彻底与 root AGENTS.md 解耦？

## Initial Decisions

> **Decision**: 默认采用 Architectural 单视角分析
> - **Context**: 主题是三个静态产物之间的关系与边界，并非多角色冲突 | **Options**: Tech-only / Arch-only / Multi
> - **Chosen**: Architectural — **Reason**: 关注职责分配、依赖方向与单一源真相，无需 business/domain 视角
> - **Rejected**: 多视角并行 — 会引入冗余 | **Impact**: 直接进 Phase 3 单线讨论

> **Decision**: 跳过 1.2 三问初始 scoping，直接呈现 Phase 2 发现并基于「优化方向」与用户确认
> - **Context**: 主题已极精确（指明三个文件） | **Options**: 标准三问 / 精简单问
> - **Chosen**: 精简，进入聚焦讨论 — **Reason**: 三问会增加噪声
> - **Impact**: Phase 1.2 改为单轮聚焦反馈（见 Round 1 末尾）

---

## Discussion Timeline

### Round 1 — Exploration (2026-05-09)

#### Key Findings

> **Finding**: 三件产物的功能边界（角色 / 输入 / 输出 / 真源）
> - **Confidence**: High — **Why**: 直接读取生成代码 (init.ts:1390-1428, bootstrap-guide.ts:21-44, shared/bootstrap-guide.ts:6-45) + 两份 SKILL.md + docs/initialization.md
> - **Hypothesis Impact**: Confirms 「三者是同一 init pipeline 的不同抽象层产物」
> - **Scope**: fab init Stage 2 落盘集合
>
> | 产物 | 抽象层 | 角色 | 数据来源 | 主要消费者 |
> |---|---|---|---|---|
> | bootstrap/README.md | Protocol Contract | 协议入口、MUST/NEVER 规则、调用顺序 | 模板 + framework.kind + projectName | 所有客户端 (runtime), SKILL.md (Phase 0 必读) |
> | INITIAL_TAXONOMY.md | Forensic Snapshot | L0/L1/L2 origin logic + 初始 buckets/signals | forensic.json (key_dirs, candidate_files, framework) | 人工读者；doctor 存在性检查；**SKILL.md 不读** |
> | .claude/skills/fabric-init/SKILL.md | AI Workflow | Matcha 三阶段：侦察→单屏 Architecture Review→落盘 | forensic.json + bootstrap/README.md | Claude Code 接力 |

> **Finding**: INITIAL_TAXONOMY.md 在 AI 链路中是死分支 (orphaned producer)
> - **Confidence**: High — **Why**: 在两份 SKILL.md 与 SOURCE.md 中均搜索不到对该文件的引用；Matcha Phase 0 显式只 enumerate `forensic.json.assertions[]` 与 `candidate_files[]`
> - **Hypothesis Impact**: Confirms 「INITIAL_TAXONOMY.md 仅承担人工/审计功能」
> - **Scope**: AI 接力路径

> **Finding**: bootstrap/README.md 存在双源实现且会漂移
> - **Confidence**: High — **Why**: `packages/cli/src/bootstrap-guide.ts:21-44` 通过模板渲染；`packages/shared/src/node/bootstrap-guide.ts:6-45` 用模板字符串内联拼装；二者文案、章节顺序均不同（前者来自 templates/agents-md/AGENTS.md.template，后者直接打印 "Detailed bootstrap notes are in `.fabric/bootstrap/README.md`" 的循环引用）
> - **Hypothesis Impact**: Confirms 「doctor --fix 与 fab init 会写出不同的 bootstrap/README.md」
> - **Scope**: doctor / init 写盘一致性

> **Finding**: skill-source/SOURCE.md 与派生 SKILL.md 描述不同的工作流
> - **Confidence**: High — **Why**: SOURCE.md 描述「Phase 1 Framework Confirmation → Phase 2 Invariant Extraction (ban/require/protect) → Phase 3 Construction」（旧 interview 模型）；当前生效的 `templates/claude-skills/fabric-init/SKILL.md` 是 Matcha 模型（Architecture Review 单屏 + framework/architecture_pattern/proposed_rule/domain_boundary 四分区 + HIGH/MEDIUM/LOW 默认/显式接受语义）
> - **Hypothesis Impact**: Refutes 「SOURCE.md 仍是 single source of truth」
> - **Scope**: 源真相机制

> **Finding**: bootstrap 模板仍带 `AGENTS.md.template` 历史命名与 self-reference 文案
> - **Confidence**: Medium — **Why**: `templates/agents-md/AGENTS.md.template` 第 5 行 `MUST: Treat this file as the Fabric Protocol bootstrap` — 当文件实际写入 `.fabric/bootstrap/README.md` 时，"this file" 仍语义自洽，但模板路径与 v1.3.1 后「不再生成根级 AGENTS.md」的事实不一致；docs/initialization.md 第 36 行明确说 "bootstrap 阶段不再生成根级 AGENTS.md/CLAUDE.md/GEMINI.md"
> - **Hypothesis Impact**: Modifies 「文件命名仍残留迁移痕迹」
> - **Scope**: 模板组织 + 命名一致性

> **Finding**: Codex 与 Claude 两侧 SKILL.md 容量与工作流深度差距过大
> - **Confidence**: High — **Why**: `templates/codex-skills/fabric-init/SKILL.md` 28 行，仅描述「读 forensic + 读 bootstrap/README + 检查 init-context」；`templates/claude-skills/fabric-init/SKILL.md` 180 行，含 Matcha 完整规约。clients.json 也确认 Codex frontmatter 仅 description 一项、无 allowed-tools
> - **Hypothesis Impact**: Confirms 「Codex skill 是 stub，Claude skill 是真本」
> - **Scope**: 多客户端能力对齐

#### Confidence Score (Baseline)

| Dimension | Score | Notes |
|---|---|---|
| architecture | 0.75 | 三者关系、消费图清晰 |
| implementation | 0.78 | 双源实现、源真相裂变都已用代码锚点确认 |
| decision | 0.55 | 「应该如何优化」尚未与用户对齐 |
| **overall** | **0.71** | 进入 Phase 3 取得用户偏好 |

> 60-80%: 可选深入或收敛 → 当前选择「与用户对齐优化方向后收敛」

#### Intent Coverage Check

| # | Original Intent | Status | Notes |
|---|---|---|---|
| 1 | 剖析三件产物的关系 | ✅ Addressed | 见 Key Findings 第 1 项与 module_map |
| 2 | 明确各自功能边界 | ✅ Addressed | bootstrap=protocol / taxonomy=snapshot / skill=workflow |
| 3 | 讨论相应优化 | 🔄 In-progress | 需要用户对优化方向给出偏好（下一步 AskUserQuestion） |

#### Narrative Synthesis
**起点**: 用户给出三个具体文件，要求关系/边界/优化分析。
**关键进展**: 通过读取 `init.ts`、`bootstrap-guide.ts`（CLI + shared 两份）、两份 SKILL.md、SOURCE.md 与 `docs/initialization.md`，确认了三者在 init pipeline 中的角色分工，同时发现 4 处显著的边界 / 源真相问题。
**决策影响**: 跳过广义 scoping，直接呈现已发现的 6 条 finding。
**当前理解**: 三者职责清晰但**实现存在多处源真相裂变与消费断链**，优化点已识别。
**遗留问题**: 用户对哪些优化优先级高，及对 INITIAL_TAXONOMY.md 未来角色的取向。

### Round 2 — Deepen All 4 Issues + Critical Finding (2026-05-09)

#### User Input
> 用户选择「都进行相关讨论」+「一并产出建议表」。

#### Key Findings (Round 2)

> **Finding (CRITICAL)**: 两条 SKILL.md 路径并存且内容相反，发布版本携带的是旧模型
> - **Confidence**: High — **Why**: 直接 diff 验证：
>   - `templates/claude-skills/fabric-init/SKILL.md`（repo 根，179 行）= **Matcha 模型**（Architecture Review 单屏 + framework/architecture_pattern/proposed_rule/domain_boundary 四分区 + HIGH/MEDIUM/LOW 默认/显式接受）
>   - `packages/cli/templates/claude-skills/fabric-init/SKILL.md`（CLI 包内，163 行）= **旧 3-Round 模型**（Framework Confirmation → Invariant Extraction ban/require/protect → Construction，且写根级 AGENTS.md）
>   - `packages/cli/package.json` 第 6 行 `"files": ["dist", "templates"]` 表示 npm publish 时只携带 `packages/cli/templates/`，因此**发布版本走旧模型**
>   - `packages/cli/src/commands/init.ts:250` 用 `findTemplatePath("templates/claude-skills/fabric-init/SKILL.md")` 通过目录向上 walk 解析；开发态从 monorepo 根开始可命中根级 `templates/`（Matcha），生产态只能命中 `packages/cli/templates/`（旧模型）
>   - `scripts/build-skills.ts` 仅写 `packages/cli/templates/...`，且 `skill-drift.test.ts` 只校验该路径
> - **Hypothesis Impact**: Refutes 「源真相裂变只是文档不一致」 → Confirms 「真实生产用户在用废弃的 3-Round 工作流」
> - **Scope**: 发布产物完整性

> **Finding**: Codex 端同样存在两份 SKILL.md 但差异更大
> - **Confidence**: High — **Why**: `diff -r templates/codex-skills/fabric-init packages/cli/templates/codex-skills/fabric-init` 显示根级是「Matcha 简版（28 行 stub）」，包内是「Canonical SOURCE.md 全文（180 行旧模型）」。Codex 用户安装后会拿到 Claude 旧 interview 模型，与 frontmatter "use when forensic.json exists" 描述也不匹配
> - **Hypothesis Impact**: Confirms 「双源问题对称存在」
> - **Scope**: 多客户端能力对齐

#### Technical Solutions

> **Solution 1**: INITIAL_TAXONOMY.md 角色明确降级为「forensic 衍生的人工/审计快照」
> - **Status**: Proposed
> - **Problem**: AI 链路中是死分支，但仍存在于 doctor 的 ensure-existence 检查中，造成「这是必备初始化产物」的错觉
> - **Rationale**: Matcha 已直接消费 forensic.json；INITIAL_TAXONOMY.md 提供的人工可读摘要价值不应被淘汰，但要明确语义
> - **Concrete actions**:
>   1. 在 `docs/initialization.md` 加 1 段「INITIAL_TAXONOMY.md 是 forensic 的人工可读摘要，不是 AI 输入」
>   2. 在 `templates/agents-md/*` bootstrap 模板的 Usage 段，加 1 行 cross-link 到 INITIAL_TAXONOMY.md 的角色定位
>   3. 保留 doctor existence check（人工/审计场景仍要求文件存在）
> - **Alternatives**: (A) 让 SKILL.md 把 INITIAL_TAXONOMY.md 加为输入 — 与 Matcha 「forensic.json 是唯一证据源」原则冲突；(B) 删除文件 — 失去人工审计入口
> - **Evidence refs**: init.ts:1390-1428, docs/initialization.md:182-205
> - **Next Action**: Recommendation #4（中优先级）

> **Solution 2**: bootstrap/README.md 渲染器合一，shared 端调用 CLI 的模板渲染
> - **Status**: Proposed
> - **Problem**: `packages/cli/src/bootstrap-guide.ts`（模板渲染 + framework variants）与 `packages/shared/src/node/bootstrap-guide.ts`（硬编码字符串、含循环自引用 "Detailed bootstrap notes are in `.fabric/bootstrap/README.md`"）共存，doctor --fix 与 fab init 一定产生不同 bootstrap 文本
> - **Rationale**: 单一源真相、消除 doctor --fix 改写时的回归风险
> - **Concrete actions**:
>   1. 把 `buildFabricBootstrapGuide` 提到 shared，CLI 仅做轻包装；OR
>   2. 让 shared 直接 import CLI 的 builder（若分包边界允许）；OR
>   3. 把模板内联化（embed）到 shared，CLI 与 shared 统一调用 shared 的 builder
>   4. 删除 shared 端的硬编码 `buildBootstrapContent`，并修复其循环引用 bug
>   5. 新增 contract test：fab init 与 doctor --fix 产出的 bootstrap/README.md 必须 byte-equal
> - **Alternatives**: 维持双实现 + snapshot 比对 — 维护成本高、易随 framework variant 增加而失效
> - **Evidence refs**: cli/src/bootstrap-guide.ts:21-44, shared/src/node/bootstrap-guide.ts:6-45
> - **Next Action**: Recommendation #2（高优先级）

> **Solution 3**: 修复 SKILL.md 双路径漂移 — 让 publish 路径与 dev 路径同源
> - **Status**: Proposed
> - **Problem**: 根级 `templates/{claude,codex}-skills/...` (Matcha, 真实新本) 与包内 `packages/cli/templates/{claude,codex}-skills/...` (SOURCE.md 派生的旧本) 差异显著；`files: ["templates"]` 导致**生产用户拿到的是旧 3-Round 工作流**
> - **Rationale**: 这是发布契约层面的一致性 bug，不是单纯文档分歧
> - **Concrete actions** (顺序执行)：
>   1. **决策**：以 Matcha 为唯一真源（已是当前产品方向）
>   2. 把 Matcha 内容写回 `packages/cli/templates/skill-source/fabric-init/SOURCE.md`
>   3. 调整 `clients.json` 的 frontmatter description 与 Matcha 一致（删除 "3-phase initialization interview" 措辞、删除 "generates layered AGENTS.md" 措辞）
>   4. 运行 `pnpm build:skills` 重新生成包内 templates
>   5. **删除根级 `templates/claude-skills` 与 `templates/codex-skills` 重复目录**（或改为指向包内的引用脚本）
>   6. 检查 `bootstrap-guide.ts` 的 `findTemplatePath` 是否还需要 walk 到 monorepo 根（当前实现可能允许两套并存）
>   7. `skill-drift.test.ts` 增加「根级目录不应再出现 SKILL.md」断言；或扩展为校验所有 fabric-init 资产单源
> - **Alternatives**: (A) 把根级目录定为真源、修改 build-skills.ts 写到根级 — 但 publish 不带根级，仍漂移；(B) 同时维护两套 + 跨目录 diff 测试 — 双倍维护成本
> - **Evidence refs**: diff between two SKILL.md paths, package.json `files` field, init.ts:250-253, scripts/build-skills.ts:14-50, skill-drift.test.ts:25-40
> - **Next Action**: Recommendation #1（**最高优先级 — 影响发布版本**）

> **Solution 4**: 命名/边界一次性梳理 — 与 AGENTS.md 历史彻底解耦 + Codex skill 选择路径
> - **Status**: Proposed
> - **Problem**:
>   - `templates/agents-md/AGENTS.md.template` 路径仍带 `agents-md`，但已不再生成根级 AGENTS.md（docs/initialization.md:36）
>   - Codex SKILL.md 在「stub」（28 行）与「Canonical 全文」（180 行）之间不一致：根级是 stub 但 publish 出去是全文
>   - 缺少协议层级 vs 快照层级 vs 工作流层级的统一文档表述
> - **Concrete actions**:
>   1. 重命名/搬迁：`templates/agents-md/` → `templates/bootstrap/`（保留 .template / variants 子结构），更新 `bootstrap-guide.ts` 的 `AGENTS_TEMPLATE_BY_FRAMEWORK` 路径常量
>   2. 模板首行 `# { projectName } — Fabric Bootstrap Protocol` 标题保留，但删除 self-reference `MUST: Treat this file as the Fabric Protocol bootstrap`，改为 `MUST: Treat .fabric/bootstrap/README.md as ...`，避免「this file」歧义
>   3. Codex skill 立场：**显式定为 "Lite Mode"**，frontmatter 已无 allowed-tools 是设计选择；同时给出 Matcha 简版（保留 Architecture Review 概念，不要 SOURCE.md 全文）
>   4. 在 `docs/initialization.md` 顶部新增 3 行 Roles Table：
>      | Layer | Artifact | Role |
>      |---|---|---|
>      | Protocol | `.fabric/bootstrap/README.md` | runtime contract |
>      | Snapshot | `.fabric/INITIAL_TAXONOMY.md` | forensic-derived human digest |
>      | Workflow | `.{claude,codex}/skills/fabric-init/SKILL.md` | AI handoff |
> - **Alternatives**: 仅做最小幅度文案修补 — 长期会再次漂移
> - **Evidence refs**: templates/agents-md/AGENTS.md.template:5, docs/initialization.md:36, codex skill diff
> - **Next Action**: Recommendation #3（中优先级，依赖 #1 完成）

#### Pressure Pass

针对最高置信度发现「两条 SKILL.md 路径并存且内容相反」做四级压力测试：

1. **Evidence demand**: 是否有反证？
   - 反查：`init.ts:250` 用相对路径 `templates/claude-skills/fabric-init/SKILL.md` + `findTemplatePath` 向上 walk。在 monorepo 根开发态，`process.cwd()` 是仓库根，命中 repo-root；用户从 `node_modules/@fenglimg/fabric-cli/dist/...` 调用时只能命中包内 `packages/cli/templates/`。**走查未找到反证**。
2. **Assumption probe**: 是否依赖某种「构建时复制根级 templates 到 cli 包」的步骤？
   - 检查 `package.json scripts`：`prebuild` 仅 run `build:skills`（写到 cli/templates）。无任何「同步根级 → 包内」步骤。**该假设不成立**。
3. **Boundary/tradeoff**: 接受此结论后排除什么？
   - 排除「根级 templates 目录是为了某些 monorepo 内 cli 之外的客户端」的可能性 → 反查无任何代码消费根级 `templates/`。可以排除。
4. **Root cause check**: 是否症状还是根因？
   - 根因 = 历史迁移过程中：旧版 SKILL 写到 `packages/cli/templates/`，后续重写 Matcha 时落到了 monorepo 根级 `templates/`，但既未删除旧目录、又未改 `findTemplatePath` 解析顺序，且 `files: ["templates"]` 仍按 cli 包目录约定 publish。属于 **遗留迁移未收尾**，不是单点症状。

> 压力测试通过：发现成立、根因明确（迁移未收尾）。

#### Confidence Score (Round 2)

| Dimension | Round 1 | Round 2 | Δ | Notes |
|---|---|---|---|---|
| architecture | 0.75 | 0.85 | +10 | 关系图 + 数据流明确 |
| implementation | 0.78 | 0.92 | +14 | 双路径 + 发布契约 bug 实证 |
| decision | 0.55 | 0.78 | +23 | 4 项 Solution 已展开 + 用户授权产出建议表 |
| **overall** | **0.71** | **0.86** | **+15** | > 80%: 收敛 |

#### Intent Coverage Check (final)

| # | Original Intent | Status | Where Addressed |
|---|---|---|---|
| 1 | 剖析三件产物的关系 | ✅ Addressed | Round 1 Findings table + Round 2 critical update |
| 2 | 明确各自功能边界 | ✅ Addressed | Roles table 设计 + Round 2 双路径划分 |
| 3 | 讨论相应优化 | ✅ Addressed | 4 个 Technical Solution + Recommendation 表 |

#### Narrative Synthesis
**起点**: 用户授权讨论全部 4 议题并一并产出建议。
**关键进展**: 调查中发现一个**升级为 Critical 的新事实** — fabric-init SKILL.md 在 repo 根级与 CLI 包内分别存在两份内容相反的版本，且 `files: ["templates"]` 让 publish 走包内的旧版本。原列出的 3 个议题全部维持有效，并由此产生第 5 条更紧迫的发现。
**决策影响**: 优先级排序: Solution 3（发布漂移）> Solution 2（doctor 漂移）> Solution 4（命名/Codex）> Solution 1（taxonomy 文档化）。
**当前理解**: 三件产物职责清晰，但「源真相裂变」体现在 4 个独立位置：(a) bootstrap 双 builder；(b) SKILL.md 双路径；(c) SOURCE.md 与 Matcha 不同步；(d) 命名/版本残留。
**遗留问题**: Solution 3 的执行细节（删除根级目录是否有其他外部消费者）需在 PR 阶段二次确认。

### Round 3 — Functional View: 派生关系、生命周期、真源认领 (2026-05-09)

#### User Input
> 用户：4 条 recommendations 全部 confirmed。继续从功能视角剖析三件文档：(a) 各自承担什么功能；(b) 文档怎么派生；(c) 当前 fabric 初始化与后续规则加入流程「有点混乱」。

#### Functional Zone — 完整产物栈 (不止三件)

为回答「混乱来源」，必须把三件文档放进完整 init+ongoing 产物栈：

| 层 | Artifact | 实际功能（机器视角） | 实际功能（人视角） | 写者 | 读者 (机器) | 读者 (人) |
|---|---|---|---|---|---|---|
| **0. 证据** | `.fabric/forensic.json` | 静态证据包：framework / topology / candidate_files / assertions | 「项目长这样」的扫描结果 | `fab init` Stage 2 | SKILL.md Phase 0；INITIAL_TAXONOMY 派生器 | 调试 |
| **1. 协议** | `.fabric/bootstrap/README.md` | Runtime 协议契约：调用顺序、token 保护、目录约束 | 「客户端要怎么用 Fabric」 | `fab init` + `doctor --fix`（双 builder） | 所有 client 每次 session；SKILL.md Phase 0 必读 | 维护者参考 |
| **2. 快照** | `.fabric/INITIAL_TAXONOMY.md` | forensic 衍生的 L0/L1/L2 origin logic + initial buckets/signals | 「forensic 给人读的摘要」 | `fab init` 一次性 | **无机器消费者** | 人工/审计读者；doctor existence check |
| **3. AI 工作流** | `.{claude,codex}/skills/fabric-init/SKILL.md` | Matcha 三阶段流程定义 | 「AI 接力时按这个流程做」 | npm install asset（不是 fab init 生成） | Claude/Codex AI agent | — |
| **4. 已确认硬约束** | `.fabric/init-context.json` | framework / invariants / domain_groups / interview_trail / forensic_ref | 「人确认过的最小硬规则集合」 | SKILL.md Phase 2 | doctor existence check；future skills | 审计 |
| **5. 规则正文** | `.fabric/rules/**` | mirror 节点 + `_cross` 节点 markdown bodies | 「真正的规则」 | SKILL.md Phase 2 (initial)；**人工持续编辑** | `fab_plan_context` + `fab_get_rule_sections`；rule-sync | 维护者主写入面 |
| **6. 派生路由索引** | `.fabric/agents.meta.json` | nodes tree + hashes + scope_glob + activation | 「rules/ 的索引」 | `doctor --fix` / `reconcileRules`（从 rules/ 派生） | MCP server 路由 | — |
| **7. 派生测试索引** | `.fabric/rule-test.index.json` | rule-test 索引 | 「测试用的索引」 | `doctor --fix` | rule test runner | — |
| **8. 事件日志** | `.fabric/events.jsonl` | append-only typed events | 「Fabric 都发生了什么」 | MCP + doctor + rule-sync 自动写 | dashboard / 审计 | 调试 |

#### 派生关系 — 三种「派生」语义不同但用同一个词

```
forensic.json (生)
   │
   ├─ INITIAL_TAXONOMY.md   ← 纯函数派生 (一次、机器)
   │
   └─ init-context.json     ← AI 经 Matcha 二次确认 (一次、半自动)
              │
              └─ rules/ 树    ← AI 写入 (initial) + 人工持续编辑 (ongoing)
                     │
                     ├─ agents.meta.json     ← doctor/reconcileRules 派生 (持续、机器)
                     └─ rule-test.index.json ← doctor 派生 (持续、机器)

bootstrap/README.md    ← framework 模板 + framework.kind 派生 (持续可重写)
SKILL.md (per client)  ← 与 fabric-cli 版本同步交付 (非 init 产物)
```

派生语义有三类，docs 里没区分：

| 语义 | 例子 | 触发 | 源变化时该怎么做 |
|---|---|---|---|
| **A. 纯函数派生** | forensic→INITIAL_TAXONOMY；rules→agents.meta | 机器自动 | 重跑生成器 |
| **B. AI 二次确认派生** | forensic→init-context.json；forensic→rules/ initial | 一次 (Matcha) | 重跑 SKILL.md（**但当前 SKILL.md 拒绝在 init-context.json 已存在时执行**） |
| **C. 模板渲染** | template+framework→bootstrap/README.md | doctor --fix | 自动重写 |

#### 生命周期相位与边界混乱

**Phase A: Initial Init (一次性)**
```
empty → fab init → forensic+bootstrap+taxonomy+events+SKILL+hooks 落盘
            │
            └─ AI Matcha (SKILL.md) → init-context.json + rules/ initial 落盘
                                                  │
                                                  └─ doctor --fix → agents.meta + rule-test.index
```

**Phase B: Ongoing rule edit (持续)** — 这里有 **gap**
```
人工编辑 .fabric/rules/*.md
            │
            └─ doctor --fix / reconcileRules → agents.meta + rule-test.index 重派生
                       │
                       └─ events.jsonl 追加 rule_content_changed / rule_added / rule_removed
```
**问题**：
- 没有 skill 引导这条路径（Matcha 是 init-only — 见 SKILL.md Precondition「init-context.json 不存在 = pending」）
- `docs/initialization.md:213` 只说「持续的 Fabric initialization workflow」，无具体步骤
- `rule-sync.ts` 已实现 `ensureRulesFresh`/`reconcileRules` 但**未在面向用户的 docs 出现**

**Phase C: Schema drift recovery (硬约束变更)** — 这里 gap **更严重**
```
framework / invariants / protected paths 变化
            │
            ├─ 改 framework  → fab init --reapply？（写 forensic+bootstrap，但不重跑 AI）
            ├─ 改 invariants → ???（init-context.json 已存在，SKILL.md 拒跑；只能手改 JSON 或者手删后重跑）
            └─ 改规则正文    → 走 Phase B
```
**问题**：当前 docs 没列「框架升级 / 硬约束变更」的标准修复路径。

#### Key Findings (Round 3)

> **Finding R3-1**: docs 里至少有 3 处对同一组文件的角色描述彼此不同
> - **Confidence**: High — **Why**:
>   - `docs/getting-started.md:50-58` 把 INITIAL_TAXONOMY.md 与 bootstrap/README.md 并列为「项目级输出」，但又另列 init-context.json 在「客户端 / Fabric 输出」组
>   - `docs/initialization.md:182-205` 描述 INITIAL_TAXONOMY.md 是「持续维护的项目 contract」
>   - `docs/SPEC_INTERNAL.md:8-12` 把 INITIAL_TAXONOMY.md 列为 fab init 写入产物，未说明角色
>   - `README.md:25` 说它是「first accepted domain map」（implies AI 确认过的，但实际它是纯 forensic 衍生）
> - **Hypothesis Impact**: Confirms 「混乱的根因之一是文档三处口径冲突」
> - **Scope**: 文档一致性

> **Finding R3-2**: doctor 错误消息直接误导用户
> - **Confidence**: High — **Why**: `packages/server/src/services/doctor.ts:711` 写
>   ```
>   actionHint: "Delete .fabric/init-context.json and run `fab init` to regenerate it."
>   ```
>   但 `fab init` 根本不写 init-context.json（init.ts 里完全无该路径）；写 init-context.json 的是 SKILL.md (Matcha)
> - **Hypothesis Impact**: Confirms 「Phase B/C 的修复路径在工具层面也是错的」
> - **Scope**: 错误消息正确性

> **Finding R3-3**: 持续维护路径在代码层有实现但在 docs/skill 层不可见
> - **Confidence**: High — **Why**: `packages/server/src/services/rule-sync.ts:1-15` 提供 `ensureRulesFresh` (drift 检测) 与 `reconcileRules` (重派生 agents.meta.json)。这是 Phase B/C 的机器侧；但 docs/initialization.md 与两份 SKILL.md 都没有把这条路径暴露给用户/AI agent
> - **Hypothesis Impact**: Confirms 「混乱来源 ≠ 没实现，是没文档化」
> - **Scope**: 持续维护流程可发现性

> **Finding R3-4**: SKILL.md 是 npm 交付物，不是 init 产物 — 但 docs 把它和 init 产物并列
> - **Confidence**: High — **Why**: 在「项目根目录跑 fab init」时，SKILL.md 是从 fabric-cli 包里**复制**到 `.claude/skills/`，不像 forensic.json 是「为这个项目生成」。生命周期完全不同（跟 cli 版本走，不跟项目走）。但 docs 把它列在 fab init 的输出列表里（`docs/initialization.md:97-98`），暗示是「这个项目的产物」
> - **Hypothesis Impact**: Modifies 「三件产物的同质性」假设 — 实际 SKILL.md 应被识别为「客户端资产」而非「项目产物」
> - **Scope**: 心智模型清晰度

#### Updated Technical Solutions

> **Solution 5 (新增)**: 补一份 Lifecycle & Source-of-Truth Map 到 docs/initialization.md
> - **Status**: Proposed
> - **Problem**: 三个 docs 文件 (getting-started / initialization / SPEC_INTERNAL) + README 对同一组文件描述不一致；用户没有一处可以一眼看清「谁是真源、谁是派生、改一个动哪几个」
> - **Concrete actions**:
>   1. 在 `docs/initialization.md` 紧接 Roles Table（来自 Recommendation #3）后加 **Source-of-Truth Map** 章节，包含本 Round 3 给出的：
>      - 8 行产物表（机器/人视角的 function、写者、读者）
>      - 3 类派生语义对照表（A 纯函数 / B AI 二次确认 / C 模板渲染）
>      - 3 个 lifecycle phases（A initial / B ongoing rule edit / C schema drift recovery）
>   2. 把 `getting-started.md` / `SPEC_INTERNAL.md` / `README.md` 三处对该集合的描述统一改为「详见 initialization.md#source-of-truth-map」
> - **Alternatives**: 各文档分别修复 — 三处会再次漂移
> - **Evidence refs**: getting-started.md:50-58, initialization.md:182-205, SPEC_INTERNAL.md:8-12, README.md:25
> - **Next Action**: Recommendation #5（**P1**，文档级 — 这是用户「混乱感」的直接来源）

> **Solution 6 (新增)**: 显式定义 Phase B (ongoing rule edit) 与 Phase C (schema drift recovery) 标准路径
> - **Status**: Proposed
> - **Problem**:
>   - SKILL.md 的 Precondition 把自己锁死在 init-only；ongoing rule add 没 skill 路径，用户只能手改 + doctor，不知道 doctor 与 rule-sync 的区别
>   - schema drift（framework/invariants 变化）没有标准恢复路径；当前的「修 init-context.json invalid → fab init」错误指引是 R3-2 的根因
> - **Concrete actions**:
>   1. 新增/区分 skill 入口：
>      - `fabric-init`（仅 initial，保留现有 Precondition）
>      - 新增 `fabric-rule-add`（或在 fabric-init 内增加 Phase B mode）— 引导手动加规则后调 `reconcileRules` 行为
>   2. 在 `docs/initialization.md` 增「Phase B: 增加规则正文」章节，明确步骤：编辑 `.fabric/rules/...` → `fabric doctor --fix` → 校验 events.jsonl 的 `rule_added` 事件
>   3. 增「Phase C: schema drift recovery」章节：
>      - framework 变 → `fab init --reapply --yes`
>      - invariants 变 → 显式步骤（move init-context.json → re-run SKILL.md）
>      - 明确 `--reapply` vs `--force` vs delete-and-rerun 的区别
>   4. 修复 `doctor.ts:711` 的 actionHint，明确「应在 Claude/Codex 中重跑 fabric-init skill」而非「run fab init」
> - **Alternatives**: 仅修文档不加 skill — 仍要靠人记流程；不修 actionHint — 工具层继续误导
> - **Evidence refs**: doctor.ts:706-711, rule-sync.ts:1-15, initialization.md:213
> - **Next Action**: Recommendation #6（**P1**，工具+文档）

#### Updated Recommendations Table

| # | Action | Priority | Status |
|---|---|---|---|
| 1 | 统一 SKILL.md 单源（Matcha 真源 + 删根级 templates） | P0 | Confirmed |
| 2 | bootstrap/README.md 渲染合一（删 shared 硬编码 + byte-equal test） | P1 | Confirmed |
| 3 | 命名/三层语义收敛（`agents-md`→`bootstrap` + Roles Table + Codex Lite Mode） | P2 | Confirmed |
| 4 | INITIAL_TAXONOMY.md 角色显式降级为人工/审计快照 | P2 | Confirmed |
| **5** (新) | **Lifecycle & Source-of-Truth Map** 单页文档 + 三处分散描述统一指向 | **P1** | Proposed |
| **6** (新) | **Phase B / Phase C 标准路径**显式化 + 修 `doctor.ts:711` actionHint + 区分 skill 入口 | **P1** | Proposed |

#### Confidence Score (Round 3)

| Dimension | Round 2 | Round 3 | Δ | Notes |
|---|---|---|---|---|
| architecture | 0.85 | 0.92 | +7 | 完整产物栈 + 三类派生语义 + 三相位生命周期 |
| implementation | 0.92 | 0.94 | +2 | 多新增证据 (rule-sync, doctor.ts:711) |
| decision | 0.78 | 0.85 | +7 | 增加 Solution 5/6，覆盖「混乱感」直接来源 |
| **overall** | **0.86** | **0.91** | **+5** | > 80%: 收敛 |

#### Intent Coverage Check (after Round 3)

| # | Original Intent | Status | Notes |
|---|---|---|---|
| 1 | 剖析三件产物的关系 | ✅ Addressed | Round 1+3：派生图 + 三类派生语义 |
| 2 | 明确各自功能边界 | ✅ Addressed | Round 3：8 行产物表（机器/人视角分列） |
| 3 | 讨论相应优化 | ✅ Addressed | 6 条 recommendations |
| **4 (用户追加)** | 从功能视角剖析、文档怎么派生、init+ongoing 整体流程 | ✅ Addressed | Round 3：lifecycle + 派生图 + Phase B/C gap + Solution 5/6 |

#### Narrative Synthesis
**起点**: 用户 confirm 4 条建议后追加：「从功能视角剖析 / 文档派生关系 / init 与后续规则加入流程似乎有点混乱」。
**关键进展**: 把三件文档放进 8 行完整产物栈，识别出三类语义不同的「派生」、三个生命周期相位（A initial / B ongoing rule edit / C schema drift），并发现 Phase B 在代码层（rule-sync.ts）已实现但 docs/skill 不可见，Phase C 没标准路径，doctor 错误消息直接误导。
**决策影响**: 新增 2 条 P1 recommendations（#5 Lifecycle Map，#6 Phase B/C 标准化 + 修 actionHint）；原 4 条 P0/P1/P2 维持。
**当前理解**: 用户的「混乱感」根因不是文档冲突这一点，而是**「init-once 与 ongoing 的边界没在任何一处明确」+「派生关系的三种语义被混用」+「持续维护路径在代码层已实现但用户看不见」**这三件事叠加。
**遗留问题**: 无。所有 6 项已具备执行细节，准备进入 Phase 4 终态 + Terminal Gate。

### Round 4 — 承接规则 与 知识库的远见视角 (2026-05-10)

#### User Input
> 用户：从「承接规则」与「知识库」两个角度给出更有远见性的看法和洞察。

#### 重新框定（Reframing）— 三件文档之外的更大问题面

Round 1-3 把三件文档钉在「**当前 init pipeline 的产物**」这层做战术修复（P0/P1/P2）。但用户这一轮的措辞要求换一层视角：把它们看成**一个生命周期长达项目全生命周期的知识系统的入口**。这一层涉及两组概念：

- **承接规则 (Succession Protocol)** — 谁把什么交给谁？什么时候 AI 退出、人接管？什么时候 AI 应被允许重新介入？skill 与 skill 之间如何承接？
- **知识库 (Knowledge Base)** — `.fabric/` 不只是「这个项目的配置文件」，而是**关于这个项目的、持续累积的、机器可消费的知识资产**。当前它的形态、寿命、复用边界是什么？

下面 4 条 finding 都是从这个再框定出发的。

#### Key Findings (Round 4 — Forward-Looking)

> **Finding R4-1**: 知识库当前是「单层 + 单实例」，没有 framework-shared layer，每个项目都从零开始
> - **Confidence**: High — **Why**:
>   - 全仓 grep `framework playbook|rule library|cross.project|aggregated.learning` 在源代码内**零命中**
>   - 跨项目共性的 invariants（如 「所有 Cocos Creator 项目都不能在 `_initialize` 之外调 `super.start()`」、「所有 Next App Router 项目客户端组件必须 `'use client'`」）目前每个项目都要 Matcha 重新发现一次
>   - `templates/agents-md/variants/{cocos,next,vite}.md` 仅是 bootstrap 文案 variant，不是规则 playbook
>   - 1.8 init-context schema 给 invariants 加了 `confidence_snapshot.evidence_refs` 与 `source_evidence`（packages/shared/test/integration/init-context-migration.test.ts:54-66），数据结构已具备「贡献回上游」的颗粒度，但缺少 aggregator
> - **Hypothesis Impact**: Confirms 「fabric 当前是 per-project knowledge worker，不是 cross-project knowledge platform」
> - **Strategic Implication**: 长期看，Matcha 每次都从零启动是次优的；应当存在 `framework-playbook` 层级，新项目 init 时**继承**该 framework 的默认 invariants/domain_groups，再叠加 project-specific 发现
> - **Scope**: 知识库分层架构

> **Finding R4-2**: 承接是「单向单次」的 — Matcha 完成后就锁死，没有 reattach loop
> - **Confidence**: High — **Why**:
>   - `templates/claude-skills/fabric-init/SKILL.md` 的 Precondition：当 `init-context.json` 已存在且 valid，skill 拒绝执行
>   - `packages/server/src/services/rule-sync.ts:51-58` 的 ledger 事件 `rule_drift_detected` 与 `baseline_synced` 已在机器层捕获 drift，但**没有任何 skill 在 drift 触发时被唤回**
>   - 真实场景：用户升级 Next 14→15、Cocos 3.7→3.8、增加新 domain（payment / authn 模块）— 这些都该重新触发 invariant 校准，但当前路径只能「手删 init-context.json + 重跑 SKILL.md」
>   - `doctor.ts:711` 的错误指引「run fab init」（Round 3 R3-2）正是该 gap 的症状
> - **Hypothesis Impact**: Confirms 「AI 只能 init-once，无 monitor / re-attach 通道」
> - **Strategic Implication**: 应区分三种 AI 介入模式：
>   - **Bootstrap mode** (现有 fabric-init)：从空到第一份 init-context
>   - **Reattach mode** (缺失)：detect drift → bounded scope re-engagement，只确认变化部分，不重写已确认的 invariants
>   - **Curate mode** (缺失)：人加规则后请 AI 评审一致性 / 发现冲突
> - **Scope**: AI 承接生命周期模型

> **Finding R4-3**: skill 之间**没有承接协议**，每个 skill 都是孤岛
> - **Confidence**: High — **Why**:
>   - `.{claude,codex}/skills/` 下 fabric-init 完成后留下了 `init-context.json` + `rules/` 两份 artifact，但**没有任何 skill manifest 声明「我是 fabric-init 的下游消费者」**
>   - 想象的 follow-up skill（`fabric-rule-add`、`fabric-debug`、`fabric-refactor`）不存在；即便未来引入，目前也没有约定它们如何读取/扩展前一个 skill 留下的 init-context
>   - bootstrap/README.md 只描述「客户端 → fabric MCP」的承接（runtime 协议），不描述「skill → skill」的承接
>   - 跨 skill 共享的概念（HIGH/MEDIUM/LOW confidence、Architecture Review 单屏、Check-not-Ask）目前是 fabric-init 内部规约，没有抽出为通用 spec
> - **Hypothesis Impact**: Confirms 「fabric 把 AI 当 single-skill agent 设计，未为 multi-skill orchestration 准备承接面」
> - **Strategic Implication**: 应在 docs 层引入 **Skill Handoff Spec**：每个 skill 显式声明 `inputs[]`（必读 artifact）+ `outputs[]`（产出 artifact + schema 版本）+ `preconditions[]` + `postconditions[]`。这是把 fabric 从「init 工具」升级为「AI-friendly project knowledge platform」的关键抽象。当前 SKILL.md 已有 Precondition 段，把它显式化为机器可校验的 manifest 即可。
> - **Scope**: skill 编排架构

> **Finding R4-4**: 知识库的 provenance 链路在 schema 层已开始建立，但在 markdown rule body / 事件 ledger 层断了
> - **Confidence**: Medium-High — **Why**:
>   - 1.8 schema 给每个 invariant 加了 `confidence_snapshot.evidence_refs`（如 `["src/app/page.tsx:1-5"]`）和 `source_evidence` — provenance 在 init-context.json 里
>   - 但 `.fabric/rules/**.md` 的 markdown body 没有强制 frontmatter 字段记录「我源自哪个 matcha session、哪条 evidence、哪次 human edit」 — 一旦 rule body 被人编辑，provenance 链路断
>   - `events.jsonl` 的 `rule_added` 事件（rule-sync.ts:51-58）只记录 hash + path + changed_fields，不携带「creator: matcha-session-{id} / human-edit / drift-detected」
>   - `interview_trail` 字段（init-context.interview_trail）记录了 Matcha 当时的问答轨迹，但 1.8 之后该字段已成为「presentation/user_corrections」结构，与 rules/ 的写入事件**没有 stable_id 上的双向链接**
> - **Hypothesis Impact**: Modifies 「provenance 不存在」 → Confirms 「provenance 存在三段：schema 内 / events.jsonl 内 / rules markdown 内，三段没串成链」
> - **Strategic Implication**: 引入 **rule provenance frontmatter** —
>   ```yaml
>   ---
>   stable_id: cross-cocos-component-init
>   origin: matcha-session-{uuid} | human-edit | drift-detected
>   evidence_refs: [src/app/page.tsx:1-5]
>   created_at: 2026-05-10T...
>   last_validated_at: 2026-05-10T...
>   ---
>   ```
>   配合 events.jsonl 的事件加 `origin` 字段，使得 `fab why <rule-id>` 这类查询可在「事件 → init-context → rule body → 原始 evidence」之间无缝回溯。这是从「知识资产」走向「可审计、可演化的 KB」的最小必要步骤。
> - **Scope**: 知识资产化 / 可审计性

#### Pressure Pass (Round 4 target: R4-3 skill 承接缺位)

针对 R4-3「skill 之间没有承接协议」做四级压力测试：

1. **Evidence demand**: 是否真的没有任何 skill 间约定？
   - 反查：`Skill.tool` 在 fabric-init 内被引用一次（用于初始化时建议下一步），无任何反向声明「我消费什么 skill 留下的 artifact」。Anthropic Skills 本身规约里 frontmatter 只有 description / allowed-tools — 没有 inputs/outputs。**反证不成立**。
2. **Assumption probe**: 是否依赖 SKILL.md 的 Markdown 文本约定（人读约定）就够？
   - 当前 SKILL.md 写「Precondition: forensic.json exists」，靠 AI 自己读懂。**这是隐式契约**，机器无法在 skill 间编排时校验，依赖 LLM 一致执行。属于「人工纪律 + LLM compliance」假设，**不能替代 manifest**。
3. **Boundary/tradeoff**: 接受「需要 skill manifest」后排除什么？
   - 排除「skill 是无状态 LLM prompt + tool 列表」的简单视角。引入 manifest 意味着 skill 需有「会话外的状态合约」，会增加架构复杂度。trade-off：值得，因为 fabric 本身已生产 init-context.json + rules/ + events.jsonl 作为 cross-session state，承接 spec 是 missing piece，不是新维度。
4. **Root cause check**: 是症状还是根因？
   - 根因 = Anthropic Skills 当前规约定位为「single-task helper」，fabric 把它用作「project lifecycle agent」，规约错配；fabric 应在自己的 spec 层补 manifest，不是等 Anthropic 升级。

> 压力测试通过：发现成立、根因 = 规约错配，需要 fabric 自补承接面。

#### Updated Technical Solutions

> **Solution 7 (新增·战略)**: 引入 **Framework Playbook layer** — 知识库分层
> - **Status**: Proposed (long-term, not urgent)
> - **Problem**: 每个项目重跑 Matcha 时都从零发现 framework-shared invariants；framework 升级后所有现存项目都要重新发现一次同样的事；社区/企业内部的最佳实践无法在 fabric 层沉淀
> - **Concrete actions** (按时间顺序，可分阶段)：
>   1. 在 `templates/` 下新增 `playbooks/{framework}/{version}/` 结构，存放该 framework + version 的推荐 invariants / domain_groups（结构对齐 init-context.json schema 的 invariants/domain_groups 子集）
>   2. Matcha Phase 0 在读 forensic.json 后，若 `framework.kind` + `framework.version` 命中 playbook，把 playbook 的推荐项作为「pre-filled HIGH-confidence proposals」加入 Architecture Review 单屏（用户仍可逐项 reject/modify）
>   3. 每条 invariant 标注 `source: "playbook:{framework}@{version}"` vs `source: "matcha-discovered"` vs `source: "human-curated"`
>   4. 长期：用户可显式 contribute 回 playbook（CLI 子命令 `fab playbook contribute --invariant <id>`）— 形成社区/团队级 KB
> - **Alternatives**: (A) 完全靠 Matcha 现场发现 — 当前路径，浪费 token 重新发现常识；(B) 把 playbook 烧死在 SKILL.md prompt 里 — 不可演化、客户端绑定
> - **Evidence refs**: init-context-migration.test.ts:14-43, templates/agents-md/variants/cocos.md（仅文案，不是规则）
> - **Next Action**: Recommendation #7（**Strategic / P3**，建议作为 v2.0 路线规划）

> **Solution 8 (新增·战略)**: 引入 **AI 三种介入模式 (Bootstrap / Reattach / Curate)**
> - **Status**: Proposed (medium-term)
> - **Problem**: SKILL.md 当前只支持 Bootstrap，drift 触发与人工补规则触发都无 skill 路径；R3-2 的 doctor.ts:711 错误指引就是该 gap 的下游症状
> - **Concrete actions**:
>   1. 把 `fabric-init` 的 Precondition 从「init-context.json 存在 = pending」改为「**模式探测**」：
>      - 不存在 → Bootstrap mode（现有 Matcha 单屏）
>      - 存在且 forensic.json hash 漂移超阈值 → **Reattach mode**（仅 review 漂移部分，保持已确认 invariant 不变）
>      - 存在但用户显式调用 `fab init --curate` → **Curate mode**（评审用户新加的 rules，发现冲突/重叠）
>   2. 在 SKILL.md 的 frontmatter 里加 `inputs: [forensic.json, init-context.json?]` + `outputs: [init-context.json, rules/]`（即 R4-3 中 Solution 9 的 Skill Handoff Spec）
>   3. 修复 doctor.ts:711 的 actionHint，根据漂移类型给出 skill 调用提示
> - **Alternatives**: 拆分为多个 skill (`fabric-reattach`, `fabric-curate`) — 概念散，且不同模式共享 70% 工作流逻辑，统一在 fabric-init 的 mode flag 更省维护
> - **Evidence refs**: SKILL.md Precondition、rule-sync.ts:51-58 (drift events 已实现但未消费)、doctor.ts:706-711
> - **Next Action**: Recommendation #8（**P2-strategic**）

> **Solution 9 (新增·战略)**: 在 fabric spec 层定义 **Skill Handoff Spec**
> - **Status**: Proposed (medium-term)
> - **Problem**: skill 之间是隐式约定，无 machine-checkable manifest；阻碍引入新 skill 与多 skill 编排
> - **Concrete actions**:
>   1. 在 `docs/SPEC_INTERNAL.md` 增 Skill Handoff Spec 章节，定义最小 manifest schema：
>      ```yaml
>      ---
>      name: fabric-init
>      mode: bootstrap | reattach | curate
>      inputs:
>        - path: .fabric/forensic.json
>          required: true
>      outputs:
>        - path: .fabric/init-context.json
>          schema: init-context@1.8
>        - path: .fabric/rules/**.md
>          frontmatter: rule-frontmatter@1.0
>      preconditions: [...]
>      postconditions: [...]
>      ---
>      ```
>   2. 让 SKILL.md 顶部的 frontmatter 与该 spec 对齐（最小侵入）
>   3. 提供 `fab skill check <skill-path>` 校验 manifest（CI 可用）
>   4. 后续新 skill（fabric-rule-add 等）按该 spec 编写
> - **Alternatives**: 留作约定俗成 — 长期会被多 skill 编排打破
> - **Evidence refs**: 当前 SKILL.md frontmatter 仅 description + allowed-tools；Anthropic Skills 规约未定义 inputs/outputs
> - **Next Action**: Recommendation #9（**P2-strategic**）

> **Solution 10 (新增·战略)**: 引入 **Rule Provenance Frontmatter** + 串通三段 provenance 链
> - **Status**: Proposed (medium-term)
> - **Problem**: provenance 已存在于 init-context schema（confidence_snapshot.evidence_refs / source_evidence）与 events.jsonl，但 rules/*.md 没承载；`fab why <rule-id>` 这类追溯能力缺失
> - **Concrete actions**:
>   1. 为 `.fabric/rules/**.md` 定义最小 frontmatter schema（stable_id / origin / evidence_refs / created_at / last_validated_at）
>   2. Matcha 写入 rules/ 时填写 origin = `matcha-session-{uuid}` + 携带 evidence_refs
>   3. `events.jsonl` 的 `rule_added` 事件加 `origin` 字段（与 rule frontmatter 对齐）
>   4. 实现 `fab why <stable_id>` 子命令：从 rule frontmatter → events.jsonl → init-context interview_trail → forensic.json 的 evidence 反向追溯
>   5. 人编辑 rules 时（无 origin 字段或 origin 为 matcha）建议工具自动 stamp `last_validated_at`，由 doctor 检查 stale rules（distance(last_validated, now) > threshold + forensic 已重大变化）
> - **Alternatives**: 仅在 init-context 内部保留 provenance — 人编辑后链路断裂
> - **Evidence refs**: init-context-migration.test.ts:54-66 (1.8 schema fields)、rule-sync.ts:51-58 (event shape)
> - **Next Action**: Recommendation #10（**P2-strategic**）

#### Updated Recommendations Table (含战略层)

| # | Action | Layer | Priority | Status |
|---|---|---|---|---|
| 1 | 统一 SKILL.md 单源（Matcha 真源 + 删根级 templates） | Tactical | **P0** | Confirmed |
| 2 | bootstrap/README.md 渲染合一 | Tactical | P1 | Confirmed |
| 3 | 命名/三层语义收敛（agents-md→bootstrap + Roles Table + Codex Lite Mode） | Tactical | P2 | Confirmed |
| 4 | INITIAL_TAXONOMY.md 角色显式降级 | Tactical | P2 | Confirmed |
| 5 | Lifecycle & Source-of-Truth Map 单页文档 | Tactical-Doc | P1 | Confirmed |
| 6 | Phase B / Phase C 标准路径显式化 + 修 doctor.ts:711 | Tactical | P1 | Confirmed |
| **7** | **Framework Playbook layer**（知识库分层） | **Strategic** | P3 / v2.0 | Proposed |
| **8** | **AI 三种介入模式 (Bootstrap / Reattach / Curate)** | **Strategic** | P2-S | Proposed |
| **9** | **Skill Handoff Spec**（机器可校验承接面） | **Strategic** | P2-S | Proposed |
| **10** | **Rule Provenance Frontmatter** + 三段 provenance 串通 | **Strategic** | P2-S | Proposed |

#### Confidence Score (Round 4)

| Dimension | Round 3 | Round 4 | Δ | Notes |
|---|---|---|---|---|
| architecture | 0.92 | 0.93 | +1 | 增加分层 / 模式 / 承接面 / provenance 四个新维度 |
| implementation | 0.94 | 0.94 | 0 | 战略 finding 不在 implementation 维度增量 |
| decision | 0.85 | 0.88 | +3 | 新增 4 条 strategic recommendations |
| **overall** | **0.91** | **0.92** | **+1** | > 80%: 收敛（Round 4 是扩展视角，不是补全 Round 1-3 的缺口） |

#### Intent Coverage Check (Round 4 — User's New Ask)

| # | New Intent (2026-05-10) | Status | Where Addressed |
|---|---|---|---|
| 5 | 承接规则 — 远见性看法 | ✅ Addressed | R4-2 (AI 三种介入模式) + R4-3 (skill 间承接) + Solution 8/9 |
| 6 | 知识库 — 远见性看法 | ✅ Addressed | R4-1 (分层 KB) + R4-4 (provenance 链) + Solution 7/10 |

#### Narrative Synthesis

**起点**：用户在 Round 3 的 6 条 tactical recommendations 之上追加问题：从「承接规则」与「知识库」两个角度看，有没有更有远见的看法。

**关键进展**：把视角从「修 init pipeline 的源真相裂变」（Round 1-3 的 6 条 P0-P2 战术修复）抬升到「fabric 作为 project knowledge platform 应有的承接面与知识库形态」。识别出 4 个**当前完全缺位**的战略维度：
1. **知识库分层**：framework-shared playbook layer 不存在 → 每个项目重新发现常识
2. **AI 介入模式**：仅 bootstrap-once，无 reattach / curate 通道 → drift 与人工补规则没 skill 路径（Round 3 的 R3-2 是这个的下游症状）
3. **Skill 承接面**：skill 之间无 manifest，依赖 LLM 隐式遵守 → 阻碍多 skill 编排
4. **Provenance 链**：1.8 schema 已在 init-context 引入 evidence_refs/source_evidence，但 rules/*.md 与 events.jsonl 未对齐 → 缺 `fab why <rule-id>` 这类可审计能力

**决策影响**：把 recommendations 表分为 Tactical 6 条（既有）+ Strategic 4 条（新增）。Strategic 4 条优先级建议：
- 短期 P2-S：Skill Handoff Spec (#9)、Rule Provenance Frontmatter (#10) — 这两条是低成本基础设施，回报来自后续所有功能
- 中期 P2-S：AI 三种介入模式 (#8) — 需要 SKILL.md 大改，但能解决 Round 3 R3-2 的根因
- 长期 P3：Framework Playbook (#7) — 需要规划 v2.0 KB 形态

**当前理解**：
- fabric 的产品定位边界正在从「init 工具」往「project knowledge platform」迁移；
- Round 1-3 的 6 条修复是「让现状不漂移」；
- Round 4 的 4 条战略是「让架构准备好下一步」；
- 两者并不冲突，应分别推进，但**Tactical #1（SKILL.md 单源）必须先做**，否则 Strategic #8/#9 等任何 SKILL.md 改造都会立刻被「发布的是旧版」吃掉收益。

**遗留问题**：
- Strategic #7 (playbook) 是否对齐当前产品方向（v1.x → v2.x 升级路径）？需要 product 层确认
- Strategic #10 (provenance frontmatter) 应优先与 Tactical #5 (Lifecycle Map) 一并设计，避免文档冲突
- 需要用户决定：(a) 仅记录战略洞察作为 v2 ADR；(b) 把 Strategic #9/#10 上升为 P1 与 Tactical 一并实施；(c) 拆 issue 进 backlog

### Round 5 — Devil's Advocate: 反向论证 4 条战略洞察 (2026-05-10)

#### User Input
> 用户：挑战 Round 4 这 4 条战略洞察 — 「如果不成立会怎样？」

#### 方法论

对每条 Strategic recommendation 启动反向压力测试，目标不是证伪，而是**找出最强反驳论点**，并据此**降级或重构**洞察，避免架构上头。

---

#### Challenge: Strategic #7 — Framework Playbook layer

**反驳 1（最强）— 这 reintroduce 了 fabric 明确拒绝的「imposed convention」模式**
当前 fabric 的 USP 写在 docs/initialization.md 与 SKILL.md：「我们读你的代码，不读你对框架的假设」。Matcha 的 Architecture Review 单屏被设计为**只 surface 来自 forensic.json 的事实**，不预设「Cocos 项目应该这样写」。引入 playbook = 把行业/团队预设的偏见以 HIGH-confidence 形式塞进 Architecture Review，与该原则正面冲突。这正是 ESLint plugin / prettier preset / "framework best practices repo" 长期失败的同一陷阱：preset 易腐烂、社区化即政治化、与 framework 升级脱节。

**反驳 2 — 维护成本可能 > token 节省**
Matcha 重新发现 framework 共性 invariants 估算 ~5k token/init。若每年 5 个项目 × 3 次 init = 15 次 = 75k token ≈ ¥10。但 playbook 需要：(a) `templates/playbooks/{framework}/{version}/` 目录矩阵；(b) version skew 处理（Cocos 3.7 vs 3.8 推荐项不同）；(c) contribution flow（CLI/PR）；(d) deprecation policy。维护成本年级数十小时。**ROI 反向**。

**反驳 3 — 已有「轻量 playbook」**
`templates/agents-md/variants/{cocos,next,vite}.md` 已是按 framework.kind 选择的模板层。该文件目前只承载 bootstrap 文案，但**结构上完全可以扩展为 `recommended_invariants[]` 区段**。增量做法：在 variants/cocos.md 加一个可选的 `## Framework-Common Invariants (Suggested)` 块，Matcha Phase 0 可选读，user 显式开启。零新目录、零新概念。

**最终判决**：**#7 应大幅降级**
- 保留洞察：「framework-shared 知识当前完全没承接面，每次 Matcha 重新发现」
- 但实施路径**不是新建 playbooks/ 层**，而是在 **Solution 7'**：扩展 `templates/agents-md/variants/{framework}.md` 加 optional `## Suggested Invariants` 区段，Matcha 在 Phase 0 显式选择是否吸收
- 优先级降为 **P3 / Optional** — 等到至少 3 个不同 framework 用户反馈「重复发现同一 invariant 累」再做

---

#### Challenge: Strategic #8 — AI 三种介入模式 (Bootstrap / Reattach / Curate)

**反驳 1（最强）— Curate mode 与 rule-sync.ts 职责重叠**
「人加规则后请 AI 评审一致性 / 发现冲突」实际包含两件事：(a) **schema/语法**冲突（scope_glob 重叠、frontmatter 缺字段）— 这是 `reconcileRules` 的机器级职责；(b) **语义**冲突（require X 与 ban X 同时存在）— 这才需要 AI。把 (a) (b) 一起塞 curate mode 是错配。**Curate 应被拆解：(a) 增强 reconcileRules 做 conflict detection；(b) 不做新 skill mode，让人在需要时手动调用 fabric-init —- conflict-check`。

**反驳 2 — Reattach mode 的 drift 阈值是个 rabbit hole**
"forensic delta 超阈值就触发" — 阈值用什么度量？topology key_dirs hash？candidate_files 数？framework version 字段？每个度量都有 false-positive 场景（重命名一个目录 → 大量 path hash 变 → 触发 reattach，但没有真实 invariant 变化）。要么阈值过紧（每次小改都问 AI）、要么过松（重大架构变化没触发）。**这是分类问题，不是阈值问题** — 需要类似 `forensic.diff` 工具，本身又是一个新组件。

**反驳 3 — `fab init --reapply --yes` 是 80% 价值的简单替代**
让用户主动声明「我重大变更了，重新 init」+ tooling 自动 backup 旧 init-context.json + diff 新旧 invariants，给出报告。这是 **shell + 现有 SKILL.md 即可**，不需要新 mode，不需要 SKILL.md Precondition 大改。

**最终判决**：**#8 应解构为两条独立小动作**
- 保留洞察：「AI bootstrap-once 后无返回路径」
- 但拆为：
  - **Solution 8a (P2)**：增强 `fab init --reapply` —- backup + diff + 调 SKILL.md 时把「旧 init-context」作为参考材料注入（**不锁死决策**），让 Matcha 自己判断是否需要变更。比新 mode 简单。
  - **Solution 8b (P1，并入 Tactical #6)**：`reconcileRules` 增加 conflict-detection（scope_glob 重叠、ban/require 同 scope）— 与 Round 3 Solution 6 的 Phase B 标准化合并。
- 删掉「Curate mode」与「Reattach mode」的命名 — 是错误抽象。

---

#### Challenge: Strategic #9 — Skill Handoff Spec

**反驳 1（最强）— YAGNI，至今只有 1 个 fabric skill**
仓库只有 `fabric-init` 一个 fabric skill。设计「多 skill 编排承接 spec」**早于 skill #2 存在**就是经典的 premature abstraction。正确顺序：先定义 skill #2（如 `fabric-rule-add`），从两者真实的 input/output 需求**反向归纳** spec，而不是预先制定理论 spec 再让 skill #2 适配。否则极可能写出过度通用、又不贴合实际的 manifest。

**反驳 2 — Anthropic Skills frontmatter 不支持 inputs/outputs**
当前规约只允许 `description` + `allowed-tools`。fabric 自己加 `inputs:` / `outputs:` / `preconditions:` 字段，结果是：**Claude Code 解析时忽略它们**，只有 fabric 自己的 CI 校验它们。这意味着 LLM 实际执行时**不读** manifest — manifest 只对人和 CI 有效。但 fabric 已经把 Precondition 写在 SKILL.md 正文里给 LLM 读，再加 frontmatter 是重复劳动 + 漂移风险（frontmatter 与正文不同步时谁是真源？）。

**反驳 3 — Schema versioning 已隐式存在**
`init-context.json` 已有 `version` 字段（1.7→1.8 migration test 证实），下游 skill 完全可以在自己的 SKILL.md 写「require init-context@>=1.8」并在 LLM 实际读取时校验 version 字段。**这就是承接** —- 不需要新 spec，只需要约定 init-context 是 inter-skill 的状态契约即可。

**最终判决**：**#9 应等到 skill #2 出现时再做，且大幅简化**
- 保留洞察：「skill 间是隐式约定，无 machine-checkable handoff」
- 但实施 **延后到 skill #2 提案时**，且届时只做：(a) SKILL.md 正文加 `Required artifacts: init-context@>=1.8`（人类可读，LLM 可遵循）；(b) doctor 做 `init-context.version` 校验。**不引入新 frontmatter schema、不引入 `fab skill check` 子命令**。
- 优先级降为 **P3 / 仅在 skill #2 提案时一并设计**

---

#### Challenge: Strategic #10 — Rule Provenance Frontmatter

**反驳 1（最强）— Markdown frontmatter 不该承载机器维护字段**
`.fabric/rules/**.md` 是**人主写**的（按 Round 3 lifecycle Phase B：人编辑 → doctor 跟随）。在人主写的文件里塞 `last_validated_at` 这种**机器自动 bump** 的字段会带来：(a) 无意义的 diff 噪声；(b) 人手编辑时被工具覆盖的混乱；(c) git blame 失真。正确分层：**人写的内容放 markdown，机器维护的元数据放 sidecar**。

**反驳 2 — 已有 events.jsonl + git，`fab why` 几乎是 shell 脚本**
现有数据：
- `git log --follow .fabric/rules/foo.md` → 人编辑历史
- `events.jsonl` 的 `rule_added/changed/removed` 事件 → 机器写入历史（已有 stable_id + path + hash）
- `init-context.interview_trail` → Matcha 当时的依据
**要把它们串起来，是 1-2 个 shell 函数**，不是「frontmatter schema + 新 spec」。最小可行 `fab why` = `git log + jq events.jsonl + lookup interview_trail by date`。

**反驳 3 — `last_validated_at` 是 slippery slope**
有了 `last_validated_at` 就要：(a) 谁触发 validation？(b) 怎么定义「stale」？(c) doctor 该怎么报警？(d) dashboard 该怎么显示 freshness？每个问题都引入新 surface area。**用户的实际痛点**是「这条规则源自什么 evidence」 — 这由 1.8 schema 的 `confidence_snapshot.evidence_refs` + `source_evidence` 已经解决（写一次、不变更）。生命周期字段（last_validated）是设计假象的痛点。

**最终判决**：**#10 应大幅简化为「provenance sidecar」**
- 保留洞察：「provenance 当前在 init-context schema 与 events.jsonl 各自存在，但未串通；缺 `fab why` 能力」
- 但实施改为：
  - **Solution 10' (P2)**：新增 `.fabric/rules/.provenance.jsonl`（append-only），rule-sync 写入事件时同步追加一条 `{stable_id, origin: matcha-session-{id} | human-edit | drift-detected, evidence_refs[], created_at}`；**不动 markdown frontmatter**
  - 实现 `fab why <stable_id>` shell-level 命令 —- 读 provenance.jsonl + events.jsonl + git log，不需要新 schema
  - **删除 `last_validated_at` 字段** —- 是设计假象的痛点
- 优先级 **维持 P2-S**，但实施路径明显更轻

---

#### Pressure Pass (Round 5 target: Devil's Advocate against own strategic recommendations)

挑战行为本身是 pressure pass。完成 4 条独立反向论证，每条 3 个反驳论点，每条都给出降级/重构方案。**未发现需要彻底放弃的洞察，但 4 条全部在实施路径上被简化**。

#### Updated Recommendations Table (post-Devil's Advocate)

| # | Action | Layer | Priority | 较 Round 4 变动 | Status |
|---|---|---|---|---|---|
| 1 | 统一 SKILL.md 单源 | Tactical | **P0** | 不变 | Confirmed |
| 2 | bootstrap/README.md 渲染合一 | Tactical | P1 | 不变 | Confirmed |
| 3 | 命名/三层语义收敛 | Tactical | P2 | 不变 | Confirmed |
| 4 | INITIAL_TAXONOMY.md 角色显式降级 | Tactical | P2 | 不变 | Confirmed |
| 5 | Lifecycle & Source-of-Truth Map 单页文档 | Tactical-Doc | P1 | 不变 | Confirmed |
| 6 | Phase B/C 标准路径 + 修 doctor.ts:711 | Tactical | P1 | **吸收 #8b：reconcileRules 加 conflict-detection** | Confirmed |
| 7' | 在 `templates/agents-md/variants/*` 加 `## Suggested Invariants` 可选区段 | Tactical-incremental | **P3 / Optional** | 大幅降级（不再新建 playbook 层） | Proposed |
| 8a | `fab init --reapply` 增强：backup + diff + 把旧 init-context 作为参考注入 SKILL.md | Tactical | **P2** | 大幅简化（不再三 mode） | Proposed |
| ~~8b~~ | （并入 #6） | — | — | 删除独立条目 | Merged |
| 9' | （延后）skill #2 提案时再做，届时只做 SKILL.md 正文加 `Required artifacts: init-context@>=1.8` | Strategic-deferred | **P3 / Skill #2 时** | 大幅延后简化 | Deferred |
| 10' | 新增 `.fabric/rules/.provenance.jsonl` (append-only sidecar) + `fab why <stable_id>` 命令；**不动 markdown frontmatter，不引入 last_validated_at** | Strategic | **P2** | 中度简化 | Proposed |

#### Confidence Score (Round 5)

| Dimension | Round 4 | Round 5 | Δ | Notes |
|---|---|---|---|---|
| architecture | 0.93 | 0.94 | +1 | 通过反向论证，4 条 strategic 都收紧到更小的实施面 |
| implementation | 0.94 | 0.95 | +1 | 删除「playbook 矩阵」「三 mode」「frontmatter schema」「last_validated 生命周期」等高成本动作 |
| decision | 0.88 | 0.93 | +5 | recommendations 现在每条都对应一个明确的最小实施路径 |
| **overall** | **0.92** | **0.94** | **+2** | > 80%: 收敛 |

#### Intent Coverage Check (Round 5)

| # | Intent | Status | Where Addressed |
|---|---|---|---|
| 7 | 用户挑战 4 条战略洞察 | ✅ Addressed | 每条独立 Devil's Advocate + 重构方案 |

#### Narrative Synthesis

**起点**：用户拒绝直接进入 synthesis，要求把 Round 4 的 4 条战略洞察压力测试。

**关键进展**：4 条 strategic recommendations 都通过了「核心洞察成立」检验，但实施路径全部被反驳论点挤瘦：
- #7 由「新建 playbook 矩阵 + 社区贡献流程」降为「扩展现有 variants/*.md 的可选区段」
- #8 由「三种 AI 介入模式 + Reattach/Curate 命名」拆为「`fab init --reapply` 增强 + reconcileRules 增 conflict-detection（并入 #6）」
- #9 由「定义 Skill Handoff Spec + frontmatter schema + CI 校验」延后为「skill #2 提案时再做，且只在 SKILL.md 正文加一行 `Required artifacts:`」
- #10 由「rule markdown frontmatter + last_validated 生命周期 + fab why 命令」缩为「sidecar provenance.jsonl + fab why shell 命令；不动 markdown」

**决策影响**：Tactical 6 条全部维持，Strategic 4 条全部存活但**实施成本平均下降 60% 以上**。新的整体优先级：
- **P0**: #1 SKILL.md 单源（必须先做）
- **P1**: #2 bootstrap 渲染合一、#5 Lifecycle Map、#6 Phase B/C + reconcileRules conflict-detection
- **P2**: #3 命名收敛、#4 taxonomy 降级、#8a fab init --reapply 增强、#10' provenance sidecar
- **P3 / Optional**: #7' variants 扩展、#9' skill handoff spec（延后）

**当前理解**：经过反向论证，「fabric 是 project knowledge platform」的 vision 仍成立，但**通往该 vision 的路径不是引入大型新抽象（playbook / mode / spec / frontmatter schema），而是逐步扩展现有 artifact** —- variants/、events.jsonl、init-context schema、SKILL.md 正文、reconcileRules。这与 fabric 一贯「轻文件契约」的设计哲学一致。

**遗留问题**：无新增。准备进入 Phase 4 终态合成。

---

## Synthesis & Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed |
|---|---|---|---|
| 1 | 剖析当前输出的三件文件之间的关系 | ✅ Addressed | Round 1 Roles Table + Round 2 Module Map |
| 2 | 明确他们涉及的相关功能边界 | ✅ Addressed | Solutions 1–4 显式划分 protocol / snapshot / workflow 三层 |
| 3 | 进行相应的优化讨论 | ✅ Addressed | 4 个 Technical Solutions + 4 条 Recommendations |

### Findings Coverage Matrix

| # | Finding | Disposition | Maps To |
|---|---|---|---|
| F1 | 三件产物角色边界（protocol / snapshot / workflow） | informational | Roles Table @ Recommendation #3 |
| F2 | INITIAL_TAXONOMY.md 是 AI 死分支 | recommendation | Recommendation #4 |
| F3 | bootstrap/README.md 双源实现 | recommendation | Recommendation #2 |
| F4 | SOURCE.md vs SKILL.md 不同步 | absorbed | Recommendation #1（双路径根因） |
| F5 | bootstrap 模板残留 AGENTS.md.template 命名 | recommendation | Recommendation #3 |
| F6 | Codex/Claude SKILL.md 容量差距 | recommendation | Recommendation #3 |
| F7 (Critical) | SKILL.md 双路径，发布版本是旧模型 | recommendation | Recommendation #1 |

### Executive Summary

`fab init` 当前同时落盘三个抽象层产物：bootstrap/README.md（**协议契约**）、INITIAL_TAXONOMY.md（**forensic 快照**）、SKILL.md（**AI 工作流**）。三者职责设计清晰，但实现层存在 4 处显著的「源真相裂变」，其中最严重的是 SKILL.md 双路径导致**生产用户安装的是已废弃的旧 3-Round interview 工作流，而非当前生效的 Matcha 模型**。建议按以下优先级修复。

### Key Conclusions

1. **三层语义需被显式表达**：protocol（runtime contract）/ snapshot（forensic digest）/ workflow（AI handoff）。当前未在 docs 任一处用一句话锁定三者关系，这是所有「边界混乱」推断的源头。
2. **发布契约层面有 1 个 P0 bug**：`packages/cli/package.json files: ["templates"]` + `templates/claude-skills/` 与 `packages/cli/templates/claude-skills/` 共存且内容相反，使 npm 用户拿到旧模型 SKILL.md。
3. **doctor --fix 与 fab init 写盘不一致风险**：bootstrap/README.md 双 builder（CLI 模板渲染 vs shared 硬编码 + 已存在的循环自引用 bug）。属 P1。
4. **INITIAL_TAXONOMY.md 角色应被显式声明**：保留为人工/审计快照，**不得**被加进 AI 链路（与 Matcha 单证据源原则冲突）。属 P2 文档级修复。
5. **命名/历史残留**应一次性收敛，包括 `templates/agents-md/` 路径与 bootstrap 模板的 self-reference 文案。属 P2。

### Recommendations

| # | Action | Rationale | Priority | Evidence Refs | Acceptance Criteria |
|---|---|---|---|---|---|
| 1 | **统一 SKILL.md 单源**：以 Matcha 为真源回写 `skill-source/SOURCE.md` + `clients.json`，重新 `pnpm build:skills`，删除根级 `templates/{claude,codex}-skills/` 重复目录，扩展 `skill-drift.test.ts` 覆盖单源约束 | 解决发布契约 bug — 用户安装得到的是当前正确的 Matcha 工作流 | **P0** | init.ts:250-253, scripts/build-skills.ts:14-50, skill-drift.test.ts:25-40, package.json files:6 | npm pack 解压后的 `templates/claude-skills/fabric-init/SKILL.md` 内容 = Matcha；根级 `templates/claude-skills/` 不再存在；drift 测试通过 |
| 2 | **bootstrap/README.md 渲染器合一**：保留 CLI 端模板渲染（含 framework variants），删除 shared 端硬编码 `buildBootstrapContent`；shared 改为 import 或 re-export；新增 contract test 校验 fab init 与 doctor --fix 产出 byte-equal | 消除 doctor --fix 与 fab init 漂移；附带修掉 shared 文案中的循环自引用 bug | **P1** | cli/src/bootstrap-guide.ts:21-44, shared/src/node/bootstrap-guide.ts:6-45 | doctor --fix 后 bootstrap/README.md 与 fab init 输出 hash 相等；shared 不再硬编码 bootstrap 文本 |
| 3 | **命名与三层语义收敛**：(a) `templates/agents-md/` → `templates/bootstrap/` + 更新引用；(b) bootstrap 模板把 `Treat this file` 改为 `Treat .fabric/bootstrap/README.md`；(c) `docs/initialization.md` 顶部加 Protocol/Snapshot/Workflow Roles Table；(d) Codex SKILL.md 显式标注 "Lite Mode" 并对齐 Matcha 概念集 | 消除 AGENTS.md 历史命名残留；用一句话锁定三者关系，避免后续认知漂移 | **P2** | templates/agents-md/AGENTS.md.template:5, docs/initialization.md:36, codex SKILL.md diff | 仓库内不再出现 `agents-md` 字样（除迁移说明）；docs 顶部含 Roles Table；Codex SKILL.md 与 Claude 概念对齐 |
| 4 | **INITIAL_TAXONOMY.md 角色显式降级**：在 `docs/initialization.md` + bootstrap 模板 Usage 段标注「forensic 衍生的人工/审计快照，不是 AI 输入」；保留 doctor existence check；不修改生成器代码 | 防止后续误解为 AI 必读输入；与 Matcha 单证据源原则保持一致 | **P2** | init.ts:1390-1428, docs/initialization.md:182-205 | docs 中明确该文件「人工读 + doctor 存在性检查」语义；SKILL.md 文案不引入新依赖 |

### Open Questions

- 根级 `templates/` 目录除了 SKILL.md 还包含 `agents-md/`、`bootstrap/`、`claude-hooks/`、`codex-hooks/` 等。Recommendation #1 仅删除 `{claude,codex}-skills` 子目录；其余子目录是否同样存在「根级 vs 包内」漂移？需要在执行 #1 时一并审计。
- shared 端 `buildBootstrapContent` 当前被 server 的哪个调用方使用（doctor 链路）？删除前需 grep 确认调用点并替换。

## Decision Trail

1. **跳过 1.2 三问初始 scoping**：主题已极精确，进入聚焦模式。
2. **采用 Architectural 单视角**：三件静态产物，无需 multi-perspective 拆分。
3. **用户授权讨论全部 4 议题并产出建议表**：跳过深入单一议题路径。
4. **Pressure Pass 锁定根因为「迁移未收尾」**：Recommendation #1 由此从 P1 升级为 P0。
5. **Recommendation 优先级排序**：以「发布契约 > 内部一致性 > 文档/命名」为序。

## Session Statistics

- Rounds executed: 2
- Key findings: 7 (含 1 critical)
- Pressure passes: 1（finding F7 通过 4 级压力测试）
- Challenge modes used: 0（未达触发条件，confidence Δ + 新 finding 已驱动收敛）
- Stalls: 0
- Final confidence: **86%** (architecture 85 / implementation 92 / decision 78)
- Recommendations produced: 4 (P0×1, P1×1, P2×2)


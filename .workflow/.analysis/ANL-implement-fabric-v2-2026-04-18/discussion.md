# Analysis: 实现 Fabric v2.0 MCP-First Fortified 协议

**Session**: `ANL-implement-fabric-v2-2026-04-18`
**Started**: 2026-04-18
**Depth**: Standard (2-3 rounds)
**Source Brainstorm**: `.workflow/.brainstorm/BS-universal-ai-docs-2026-04-18/`

---

## Table of Contents

- [User Intent](#user-intent)
- [Initial Scoping](#initial-scoping)
- [Current Understanding](#current-understanding)
- [Round 1 — External Research & Landscape](#round-1--external-research--landscape)
- [Round 2 — Discussion & Refinement](#round-2--discussion--refinement)
- [Phase 4 — Conclusions](#phase-4--conclusions)

---

## User Intent

原始请求：**"查看 BS-universal-ai-docs-2026-04-18 目前想要实际实现这个规划"**

用户明确的 4 大关注点（Phase 1 反馈）：
1. **落地工程化** — repo 结构、tooling 选型（TS/Node 版本、monorepo vs 单包）、CLI 分发
2. **任务分解** — 把 7 天 MVP 拆成可执行 tasks，明确依赖与优先级
3. **接入路径细化** — fab init 对存量项目（尤其是 werewolf-minigame 这类）的具体挂载流程
4. **文档缺失/不规范项目的处理** ⭐ 用户补充 — 当项目 README/CONTRIBUTING 缺失、质量差或风格不统一时，fab init 如何初始化和扫描？后续如何维护？

工程决策：
- **仓库形态**：本地就地开发（pcf 目录改名即可）
- **分析深度**：标准（2-3 轮）

---

## Initial Scoping

### 源 Brainstorm 结论回顾

**首选方案**：Fabric v2.0 MCP-First Fortified（5 层架构）
- Layer 0 规范层 — Markdown AGENTS.md 树（入 git）
- Layer 1 元数据层 — `.fabric/agents.meta.json`（入 git，机器维护）
- Layer 2 意图层 — `.intent-ledger.jsonl`（append-only）
- Layer 3 分发层 — `fabric-context-server` (stdio MCP, 3 tools)
- Layer 4 防御层 — git pre-commit + tool desc + breathing prompt + revision_hash

**7 天 MVP 已定义**（见 mcp-first-fabric.md §5）：
Day 1 MCP server 骨架 → Day 2 六客户端配置 → Day 3 fab CLI → Day 4 pre-commit → Day 5 revision_hash → Day 6 bootstrap → Day 7 端到端挂载 werewolf-minigame

**3 个 Kill Switch**：AI 主动调工具率、stdio 延迟、Codex MCP 可用性

### Dimensions

- implementation（工程化落地）
- architecture（tooling 结构）
- governance（文档维护、存量项目治理）
- comparison（MCP SDK / CLI 脚手架对标）

### Perspectives

- Technical (Gemini) — MCP SDK 选型、TS 实现模式
- Architectural (Claude) — 包结构、CLI 分层
- Domain Expert — 存量项目文档扫描启发式

---

## Current Understanding

**经 Round 1 研究已建立的事实：**

1. **技术选型全部可验证**：MCP TS SDK v1.29.0 稳定；6 客户端全部支持 stdio MCP（包括 Codex — 这点 brainstorm 原先标记 "Day 2 实测" 的风险已降低）
2. **Codex TOML 分歧是首日需解决的具体工程问题**，不是运行时的惊喜
3. **CLI 工具链已有明确答案**：citty + tsup + Bun --compile（或降级 pkg）
4. **fab init 的乐观假设被修正**：用户的补充关注是对的 — 对文档缺失项目，brainstorm 原描述不足；需增加 `fab scan` 命令 + TODO-marker scaffold 策略
5. **维护层面**：doc drift 检测需自研，不在 MVP，作为 v1.1 milestone

**关键开放问题**（待 Round 2 与用户确认）：
- 仓库命名 & npm 发布策略
- Bun 是否可作为强依赖（影响分发体验）
- werewolf-minigame 是否真实存在，Day 7 端到端测试预案
- pre-commit 三件套的增量落地顺序（ledger 优先 vs 一起上）
- v1.1 维护 roadmap 是否在本次分解范围内

---

## Round 1 — External Research & Landscape

### Round 1: Narrative Synthesis

**起点**: 基于 brainstorm 已锁定的 Fabric v2.0 设计，聚焦工程化落地。主仓基本空白，无代码可探索，转向外部研究 + 技术选型验证。

**关键进展**（详见 `research.json`）:
- ✅ **确认**：6 客户端全支持 MCP stdio（Codex 亦然）→ 原 Kill Switch 3 风险可降级
- ✅ **确认**：MCP SDK v1.29.0 是当前稳定版；用 McpServer + StdioServerTransport + registerTool
- ⚠️ **修正**：Codex 用 TOML 而非 JSON 配置 → brainstorm Day 2 "6 客户端模板" 需拆为 JSON(5) + TOML(1)
- ⚠️ **修正**：Roo Code 文档 404 → 配置路径需运行时探测
- 🆕 **新增**：stdio MCP 严禁 stdout 写入 — 是静默故障点，需 CI lint
- 🆕 **新增**：fab init 的文档扫描启发式（<200 词 README = stub），配合 TODO-marker scaffold 策略应对缺文档项目
- 🆕 **新增**：doc drift 检测 2026 无现成工具 → 需自研，明确延后到 v1.1

**决策影响**: 用户的 4 大关注点全部有了工程答案；新暴露的问题是 Codex TOML 首日处理、Roo Code 探测、以及 v1.1 维护 roadmap 是否立刻分解。

**当前理解**: Fabric v2.0 可以在 7 天 MVP + 1 个 v1.1 维护 milestone 的双阶段规划下落地。

**遗留问题**: 仓库命名 / Bun 依赖接受度 / werewolf-minigame 实体 / pre-commit 三件套顺序 / 是否立即分解 v1.1。

> **Finding**: MCP SDK v1.29.0 stable + 6 client 确认 MCP 支持
> - **Confidence**: High — 官方文档直接验证
> - **Hypothesis Impact**: Confirms "MCP-First 跨端可行" 核心假设
> - **Scope**: Day 1-2 MVP 的全部技术栈

> **Finding**: Codex 使用 TOML 配置（独家）
> - **Confidence**: High — OpenAI 官方 developers.openai.com/codex/mcp
> - **Hypothesis Impact**: Modifies "Day 2 统一模板" 假设 → 需拆分任务
> - **Scope**: Day 2 模板任务 + `fab sync-config` 设计

> **Finding**: fab init 对缺失文档项目需要 Nx 模式而非乐观扫描
> - **Confidence**: Medium — 基于 Projen/Nx 行业通行做法推断
> - **Hypothesis Impact**: Modifies brainstorm §4.5 fab init 描述
> - **Scope**: Day 3 fab CLI 实现 + 新增 `fab scan` 命令

> **Decision**: CLI 工具链采用 citty + tsup
> - **Context**: 需选择 4-6 subcommand 的 CLI 框架
> - **Options considered**: commander.js, citty, clipanion, yargs
> - **Chosen**: citty — **Reason**: TS-first、lazy subcommand、UnJS 生态稳定、体积小
> - **Rejected**: commander (JS-first 类型差), clipanion (对 4-6 命令过度工程), yargs (冗长 JS-first)
> - **Impact**: Day 1 package.json + Day 3 CLI 实现锁定技术栈

> **Decision**: doc-code drift 检测从 MVP 剥离至 v1.1
> - **Context**: 用户关注"后续维护"，drift 是核心维护能力但 2026 无现成工具
> - **Options considered**: MVP 塞简易 mtime 版 / 完全延后 / 开源找替代
> - **Chosen**: 完全延后到 v1.1 — **Reason**: 自研启发式 + 规则库工程量大，会拖长 7 天时间线；MVP 先跑通 MCP 主链路
> - **Rejected**: MVP 塞简易版 — 半成品会误导用户；完全开源找替代 — 2026 无匹配工具
> - **Impact**: 明确 MVP 范围边界；需讨论 v1.1 是否本次一起分解

### Initial Intent Coverage Check

| # | Original Intent | Status | Notes |
|---|----------------|--------|-------|
| 1 | 落地工程化（repo / tooling / CLI 分发） | ✅ 基本覆盖 | citty + tsup + Bun 或 pkg；待 Round 2 确认 Bun 依赖可接受性 |
| 2 | 任务分解（7 天 MVP 转可执行 tasks） | 🔄 进行中 | Round 1 识别需拆分的任务点（Day 2 JSON/TOML 分叉等）；Round 2 完整分解 |
| 3 | 接入路径细化（fab init 存量项目挂载） | ✅ 覆盖 | 提出 heuristic chain + `fab scan` 独立命令 + TODO-marker scaffold |
| 4 | 文档缺失/不规范项目处理 + 后续维护 | 🔄 部分覆盖 | fab init 场景已有方案；维护（drift 检测）明确延后 v1.1，Round 2 需确认是否立即分解 |

**Round 2 焦点**：完成任务分解 + 4 个工程决策确认。

---

## Round 2 — Discussion & Refinement

### Round 2: Narrative Synthesis

**起点**: Round 1 的 4 个开放决策待用户确认。

**关键进展 — 4 个工程决策全部锁定**:

> **Decision**: 仓库采用 Monorepo (pnpm workspace) 结构
> - **Context**: 未来需支持 MCP server / CLI / shared 逻辑分离，可能扩展 compile-fallback / docs packages
> - **Options considered**: Monorepo / 单包 / 先单包后拆
> - **Chosen**: Monorepo — **Reason**: 用户明确推荐；为 v1.1+ 扩展留口子
> - **Rejected**: 单包/延迟拆 — 早期 refactor 成本
> - **Impact**: Day 1 第一个任务是 pnpm workspace 初始化

> **Decision**: CLI 分发双轨 — 主线 Node/tsup + 可选 Bun --compile release binary
> - **Context**: Bun 作为强依赖会限制用户安装路径
> - **Options considered**: Node only / Bun only / 两者共存
> - **Chosen**: 两者共存 — **Reason**: `npx fab` 兼容最好；Bun binary 作为 release asset 可选下载
> - **Rejected**: Bun only (2026 部分企业环境仍受限), Node only (放弃性能亮点)
> - **Impact**: CI 需构建 2 种 artifact；npm publish 是主通道

> **Decision**: Day 7 E2E 测试用新建 `examples/werewolf-minigame/` fixture（最小 React+Vite 小游戏骨架）
> - **Context**: 无现成可挂载项目
> - **Options considered**: 新建 fixture / 已有项目 / 公开 OSS
> - **Chosen**: 新建 fixture — **Reason**: 可控、可持续用于回归测试
> - **Rejected**: 公开 repo (外部变更风险)
> - **Impact**: Day 7 拆为 "fixture 搭建" + "挂载测试" 两个子任务

> **Decision**: v1.1 只列 milestone 高层标题，不在本次细分
> - **Context**: 用户希望先验证 MVP，v1.1 再单独规划
> - **Options considered**: 仅 MVP / MVP + v1.1 高层 / 全部 14 天细分
> - **Chosen**: MVP + v1.1 高层 — **Reason**: MVP 焦点不被稀释，但为用户的"维护"关注点留可见 roadmap
> - **Impact**: Phase 4 recommendations 区分 MVP 交付物与 v1.1 占位

**当前理解**: 所有实施细节已闭环。Monorepo 结构 + 双轨分发 + fixture 项目 + MVP/v1.1 分层规划，构成完整可交接给 lite-plan 的蓝图。

**遗留问题**: 无阻塞性问题。Round 2 可收敛。

### Intent Coverage Check (Round 2)

| # | Original Intent | Status | Notes |
|---|----------------|--------|-------|
| 1 | 落地工程化 | ✅ Addressed | Monorepo + citty + 双轨分发全部锁定 |
| 2 | 任务分解 | 🔄 In progress | Phase 4 将输出 Day-by-Day tasks |
| 3 | 接入路径细化 | ✅ Addressed | fab init heuristic + `fab scan` + fixture 项目 |
| 4 | 缺文档/不规范项目 + 维护 | ✅ Addressed | Nx 模式 + TODO scaffold；v1.1 maintenance milestone 明确标出 |

---

## Phase 4 — Conclusions

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| 1 | 落地工程化 | ✅ Addressed | Round 1 Tech Stack + Round 2 Decisions | Monorepo + citty + tsup + Bun 双轨 |
| 2 | 7 天 MVP 任务分解 | ✅ Addressed | Phase 4 Recommendations | Day-by-Day 拆解含子任务 + 依赖 |
| 3 | 接入路径（fab init） | ✅ Addressed | Round 1 Tech Solution #3 | Heuristic chain + `fab scan` 独立命令 |
| 4 | 缺文档/不规范项目 + 维护 | ✅ Addressed | Tech Solution #3, #4; Recommendation #5 | fab init 用 TODO-marker scaffold；drift 检测 → v1.1 maintenance milestone |

### Findings Coverage Matrix

| # | Finding (Round) | Disposition | Target |
|---|----------------|-------------|--------|
| 1 | MCP SDK v1.29 + zod v3 技术锁定 (R1) | recommendation | Rec #1 (Day 1 package.json) |
| 2 | Codex TOML 配置分歧 (R1) | recommendation | Rec #2 (Day 2 拆 JSON/TOML) |
| 3 | citty + tsup + Bun 工具链 (R1) | recommendation | Rec #1 (Day 1 tooling) |
| 4 | stdio 禁 stdout 写入 (R1) | recommendation | Rec #3 (Day 1 logging lint) |
| 5 | Roo Code 配置路径需探测 (R1) | recommendation | Rec #2 (Day 2 探测逻辑) |
| 6 | Claude Code CLI vs Desktop 分裂 (R1) | recommendation | Rec #2 (Day 2 双写) |
| 7 | citty + lefthook 选型 (R1) | recommendation | Rec #1 |
| 8 | Doc drift 2026 无工具 (R1) | deferred | v1.1 maintenance milestone |
| 9 | fab init heuristic + `fab scan` 新命令 (R1) | recommendation | Rec #5 |
| 10 | Monorepo + 双轨分发 + fixture (R2) | recommendation | Rec #1, Rec #6 |
| 11 | v1.1 高层 milestone 独立列出 (R2) | recommendation | Rec #7 |

所有 actionable findings 已映射。无 unmapped finding。

### Final Summary

Fabric v2.0 MCP-First Fortified 的实施从抽象设计走到了可交接的蓝图：技术栈完全验证（SDK v1.29 + 6 客户端确认含 Codex），工程决策全部锁定（monorepo / 双轨分发 / 新建 fixture / MVP+v1.1 分层），Round 1 暴露的 brainstorm 三处乐观假设（Codex 统一 JSON、fab init 乐观扫描、drift 检测 MVP 内完成）都有明确修正。下一步交给 workflow-lite-plan 做 Day-by-Day 任务生成。

### Recommendations — 7 项分级执行

**优先级 High — MVP 核心路径**：
1. **Day 0-1: 仓库初始化 + MCP server 骨架**（pnpm workspace + packages/{server,cli,shared} + @modelcontextprotocol/sdk@^1 + zod@^3 + tsup + lefthook + 3 个 MCP tools 空实现 + stdout-to-stderr lint 守卫）
2. **Day 2: 6 客户端配置（JSON×5 + TOML×1）** — 抽象 ClientConfigWriter，加 Roo Code 运行时路径探测，加 Claude Code CLI/Desktop 双写；MCP Inspector 验证
3. **Day 3: fab CLI 4 subcommand + `fab scan` 新增**（init / sync-meta / human-lint / ledger-append + scan 只读诊断）
4. **Day 4-5: pre-commit 三件套 + revision_hash 游标**（先 ledger-append 验证主链路，再 human-lint，再 sync-meta）
5. **Day 6-7: bootstrap 引导词 + werewolf-minigame fixture + 端到端**（examples/werewolf-minigame 建 React+Vite 骨架，6 客户端跑 Kill Switch）

**优先级 Medium — MVP 外的基石**：
6. **Fixture 项目独立可用**（examples/werewolf-minigame 保留为持续回归测试资产，CI 跑 fab init 冒烟）

**优先级 Low — v1.1 Maintenance Milestone（仅列标题，不细分）**：
7. **v1.1 维护能力** — drift-check 命令（git log 启发式）/ fab migrate（Fabric 升级时迁移用户 .fabric/）/ `fab doctor` 健康检查 / Copilot fallback compile 模式（若 Copilot MCP 2026 下半年 GA）

### Solution Readiness Check

所有 7 项 recommendation 选择已明确，无残留 ambiguity。Day 4-5 的 pre-commit 三件套顺序建议为：ledger-append → human-lint → sync-meta（依 brainstorm Kill Switch 1 风险权重）。

---

_Session statistics: 2 rounds, 1 external research call, 11 findings, 7 recommendations, 4 locked decisions._

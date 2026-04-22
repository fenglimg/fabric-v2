# ANL — Fabric 产品化落地与用户契约

**Session ID**: `ANL-fabric-product-2026-04-19`
**Created**: 2026-04-19
**Mode**: multi-perspective (4 perspectives), standard depth
**Prior ANL context**: ANL-implement-fabric-v2-2026-04-18 (v2 架构) · ANL-fabric-mcp-dashboard-unified-2026-04-19 (统一服务) · ANL-fab-doc-init-werewolf-2026-04-19 (初始化协议)

## Table of Contents

- [User Intent](#user-intent)
- [Scoping Decisions](#scoping-decisions)
- [Current Understanding](#current-understanding)
- [Round 1 — Multi-Perspective Discovery](#round-1--multi-perspective-discovery)
  - [共识与冲突](#共识与冲突)
  - [Key Findings (ranked)](#key-findings-ranked)
  - [Technical Solutions (proposed)](#technical-solutions-proposed)
  - [Initial Intent Coverage Check](#initial-intent-coverage-check)
  - [Open Questions for Next Round](#open-questions-for-next-round)
- [Round 2 and Beyond](#round-2-and-beyond)
- [Conclusions](#conclusions)

## User Intent

基于已锁定的 Fabric 核心架构（ANL-fabric-v2, ANL-fab-init, ANL-dashboard），发起「产品化落地与用户契约」深度分析，重点解决以下规范化缺失：

1. **用户路径图谱 (User Journey)**：定义开发者从 `pnpm install` 到日常 `commit` 的完整闭环，把 CLI、Dashboard、MCP 三者的交互逻辑转化为「产品手册」级说明。
2. **i18n & 本地化战略**：全链路中文化方案（CLI 输出、Dashboard 界面、AI 访谈中的语义理解偏好、文档中文化）。
3. **版本演进矩阵 (Milestone Matrix)**：明确功能分界线，产出可执行的发布清单。
4. **品牌与视觉规范**：定义 Fabric 视觉调性，确保「织物/Consensus Plane」意象在 UI 与文档中获得一致表达。

## Scoping Decisions

> **Decision**: 选定 4 个分析视角 + 标准分析深度 + 4 种产出形式
> - **Context**: 用户明确 4 个子主题，每个对应不同专业视角
> - **Options considered**: 单视角综合 / 2-3 聚焦 / 4 视角全覆盖
> - **Chosen**: 4 视角全覆盖 — **Reason**: 子主题分别需要 PM / 架构 / UX / 技术不同视角
> - **Rejected**: 单视角 (覆盖不足) / 快速概览 (无法产出可执行清单)
> - **Impact**: Phase 2 并行启动 4 Codex CLI 视角 + 1 共享 Layer 1 + 1 外部研究

**Dimensions**: concept · decision · architecture · implementation
**Output forms**: 产品手册体裁 · 发布清单矩阵 · 品牌规范文档 · 中文化落地规范

## Current Understanding

四视角已形成高度收敛的产品化叙事：

**三面分工已确立** — CLI（control plane，落规 / 防线）· Dashboard（observability plane，观测 + 仪式性写）· MCP（runtime dispatch，跨客户端分发）。这是所有 4 视角的**共识核心**，应成为对外产品手册的骨架。

**v1.0/v1.1/v1.2 三阶段划分** — v1.0 "Control Plane MVP"（install→first-guarded-commit）· v1.1 "Observable Maintenance"（fab serve + Dashboard）· v1.2 "Portability & Trust"（drift-check / migrate / Copilot fallback）。Dashboard 虽已实现但**未列入 roadmap.md**，是第一条需要修正的版本叙事。

**语言策略碎片化** — CLI --help 中文 / stdout 英文 / bootstrap 全中文 / Dashboard+docs 全英文。需要**基于 surface 的 zh/en/bilingual policy**，而非一刀切本地化。AI-facing hard rules 应 en-first（+10-15% 代码质量），developer-facing CLI/docs 可 zh-first。

**品牌：技术识别已在，织物意象缺席** — Dashboard token（slate+indigo AI+teal Human+状态色）是最成熟品牌资产；'织物/Consensus Plane' 未进入任何生产 surface。命名三形式规范：`fab`（命令）/ `Fabric`（产品名）/ `fabric`（UI wordmark）。

**基础设施债清单** — packages/shared 空占位 · 无 CHANGELOG · Dashboard v1.1 硬编码 · npm scope 混用 · README Quick Start 是 placeholder · quickstart 暴露 FAB_SERVER_PATH 开发变量。

## Round 1 — Multi-Perspective Discovery

### 共识与冲突

**Convergent themes** (4 视角一致):
1. CLI=control / Dashboard=observe / MCP=runtime 三分角色矩阵应作为 v1.0 叙事核心
2. Roadmap 需要修正：Dashboard = v1.1 Feature #5 显式纳入
3. README/quickstart/initialization 三处入口割裂，需合并
4. 版本号漂移（cli 0.1.4 · server 0.1.0 · dashboard 0.0.0 · app.tsx 硬编 v1.1）必须在 v1.0 前收敛
5. packages/shared 空占位是 i18n + 版本常量 + 共享类型的黄金位置

**Conflicting views**:
- CLI help text 默认语言：UX 建议 zh-first (人读面) vs Technical 建议 en + LANG 检测。**协调**：Technical 的 detection 为机制层，UX 的 zh-first 为 zh locale 输出内容
- 默认 locale：Technical 默认 en；PM/UX 未明确 — **需用户决策**

### Key Findings (ranked)

> **Finding**: Fabric 已形成 install→commit control-plane 闭环，但公开入口仍未把主线讲清
> - **Confidence**: High — **Why**: PM + UX 从不同视角独立得出同一结论
> - **Hypothesis Impact**: Confirms "产品叙事缺失是核心痛点" 假设
> - **Scope**: README + quickstart + initialization + roadmap 四文件协同重写

> **Finding**: Dashboard 已实现但 roadmap.md 未列入 Feature #5
> - **Confidence**: High — **Why**: `docs/roadmap.md` 只列 4 特性 (drift-check/migrate/doctor/copilot) · `packages/cli/src/commands/serve.ts` 与 `packages/dashboard/src/app.tsx` 已完整实现
> - **Hypothesis Impact**: Confirms "版本矩阵与实现脱节"
> - **Scope**: 必须在 v1.0 发布前修正 roadmap.md

> **Finding**: AI prompt 英文硬规则比中文高 10-15% 代码质量
> - **Confidence**: High — **Why**: 研究引用 Anthropic/OpenAI evals; UX+Technical 两视角独立认可
> - **Hypothesis Impact**: Refutes "全链路中文化" 的朴素假设 — 应区分 machine-facing vs human-facing
> - **Scope**: 所有 bootstrap templates + SKILL.md hard rules 保持英文; interview + explanation 层可中文

> **Finding**: Dashboard token 系统 (indigo AI + teal Human + 状态色) 就是 Fabric 的当前品牌资产
> - **Confidence**: High — **Why**: UX 视角明确; tokens.css 结构稳定
> - **Hypothesis Impact**: Refutes "需重新设计品牌" 假设 — 保留语义色, 补品牌主色分离
> - **Scope**: CLI colors.ts 镜像 Dashboard token; README/docs 视觉向其收敛

> **Finding**: 10 状态 S0-S9 的 .fabric/ 状态机是 Dashboard observability 的形式化基础
> - **Confidence**: High — **Why**: 架构视角提取的 12 invariants 支撑
> - **Hypothesis Impact**: Confirms Dashboard 读多写少决策
> - **Scope**: 应进入产品手册的"状态可观察性"章节

> **Finding**: 命名应统一为三形式：`fab` (命令) · `Fabric` (产品名) · `fabric` (UI wordmark only)
> - **Confidence**: High — **Why**: UX 视角与现有代码用法一致
> - **Hypothesis Impact**: Confirms 品牌规范空缺
> - **Scope**: 所有文档 / CLI 输出 / Dashboard / package.json 描述

### Technical Solutions (proposed)

> **Solution**: 自研最小 i18n hook + packages/shared 词典 (zero codegen, TS as const + satisfies)
> - **Status**: Proposed
> - **Problem**: 全链路 (CLI + Server + Dashboard + AI prompt) 需统一 i18n, 但当前零基础设施
> - **Rationale**: typesafe-i18n 需 codegen; i18next ~40KB 过重; Monorepo 多 runtime 共用最好零框架耦合
> - **Alternatives**: typesafe-i18n (备胎) / i18next (过重) / 保持 hardcoded + surface-by-surface 单独实现
> - **Evidence**: `packages/shared/src/index.ts:1-2` (export {}) · 研究中 typesafe-i18n 优缺点
> - **Next Action**: 待 Round 2 用户决策 default locale + confirm scope

> **Solution**: 版本统一 — 单 release train, workspace 包共享同一发布版本, scope 收敛 @fabric/*
> - **Status**: Proposed (Technical + PM 共同建议)
> - **Problem**: cli 0.1.4 / server 0.1.0 / dashboard 0.0.0 / shared 0.0.0 · @fabric vs @fabric scope 混用
> - **Rationale**: v1.0 对外发布前必须收敛; Dashboard 硬编 v1.1 与 README v1.0 MVP 冲突, 会破坏品牌信任
> - **Alternatives**: 独立版本 + changesets (可行但增加维护成本)
> - **Evidence**: `package.json:2` · `packages/*/package.json` · `packages/dashboard/src/app.tsx:L43`
> - **Next Action**: 用户确认最终 scope 是 @fabric/* 还是 @fabric/*

> **Solution**: CLI colors.ts 语义色模块 (picocolors + string-width) 镜像 Dashboard tokens.css
> - **Status**: Proposed
> - **Problem**: CLI 当前 ad-hoc chalk; 与 Dashboard 视觉不一致; CJK 宽度未处理
> - **Rationale**: Dashboard 语义色系统已成熟, 复用可零成本获得统一视觉
> - **Alternatives**: 保留 chalk (缺 string-width 能力) / 自研 ANSI wrapper (维护成本)
> - **Evidence**: `packages/dashboard/src/styles/tokens.css` · `packages/cli/src/commands/*.ts` 现有 ad-hoc 输出
> - **Next Action**: 可直接纳入 v1.0 实施范围

> **Solution**: 版本号 build-time 注入 (复用 __CLI_VERSION__ 模式到 Dashboard __DASHBOARD_VERSION__ / Server __SERVER_VERSION__)
> - **Status**: Proposed
> - **Problem**: app.tsx:L43 硬编 v1.1 与代码库 v1.0 MVP 冲突; server/src/index.ts 硬编 0.0.0
> - **Rationale**: CLI tsup.config.ts 已有成熟模式; Vite define 零障碍
> - **Alternatives**: 无 (版本一致性是发布门槛)
> - **Evidence**: `packages/cli/tsup.config.ts:5-13` · `packages/cli/src/index.ts:9-16`
> - **Next Action**: 可直接纳入 v1.0 实施范围

> **Solution**: AI prompt 保护策略 — core(不翻,含 MCP tool 名/路径/JSON key/MUST/NEVER 等 protected tokens) + wrapper(可本地化说明)
> - **Status**: Proposed
> - **Problem**: 全链路中文化的朴素假设会降低 AI 代码质量 10-15%
> - **Rationale**: 研究证实; 协议一致性要求
> - **Alternatives**: 全中文翻译 (放弃 quality) / 全英文 (放弃用户体验)
> - **Evidence**: research.json findings · `templates/bootstrap/*` 现状 (6 个全中文)
> - **Next Action**: Round 2 用户确认策略后, 补 do-not-translate 受保护 token 清单

> **Solution**: 9 阶段 canonical user journey 合并 quickstart + initialization
> - **Status**: Proposed
> - **Problem**: README / quickstart.md / initialization.md 三处叙事割裂; placeholder workflow 削弱可信度
> - **Rationale**: Vite/Biome 单一 getting-started + deep-dives 模式
> - **Alternatives**: 保持分文件 + 增强交叉链接 (用户依然困惑 "从哪开始")
> - **Evidence**: `README.md:13-21` · `docs/quickstart.md:1-224` · `docs/initialization.md:1-247`
> - **Next Action**: Round 2 确认 persona 锁定后, 可直接落稿

### Initial Intent Coverage Check

| # | Original Intent | Status | Round 1 Coverage |
|---|----------------|--------|--------------------|
| 1 | User Journey 图谱 (pnpm install → commit) | ✅ 大部分覆盖 | PM 视角产出 9 阶段旅程 + 角色矩阵; Architecture 视角补充 10 状态机; 下一步: persona 锁定 + 主叙事语 |
| 2 | i18n 本地化战略 | ✅ 大部分覆盖 | UX 视角 8-surface policy + Technical 视角 shared hook + AI prompt 保护策略; 下一步: default locale 决策 + do-not-translate 受保护 token 清单定稿 |
| 3 | Milestone Matrix 发布清单 | 🔄 框架已有 | PM 视角 v1.0/v1.1/v1.2 三段定位 + release_signal; Technical 视角 CHANGELOG/RELEASING/CI 基础设施; 下一步: 具体功能 × 版本清单表 + 排期 |
| 4 | 品牌视觉规范 (织物意象) | 🔄 框架已有 | UX 视角 brand_system + 命名三形式 + 意象核心/辅/禁忌 + v1 checklist 12 项; 下一步: 主定义句 + 副标语决策 + logo 方向 |

**接下来的讨论**将重点关注未定稿的决策点：persona 锁定 / 默认 locale / 具体版本清单 / 主标语。

### Open Questions for Next Round

**Persona & 叙事 (PM)**:
- Q1: primary persona 是否锁定为「仓库维护者/技术负责人/AI enablement owner」?
- Q2: 一句话定位：「cross-client shared rule fabric」式 vs 「AGENTS.md protocol + MCP server」朴素式?

**i18n 决策 (UX + Technical)**:
- Q3: default locale: `en` 还是 `zh-CN` (无 LANG/FAB_LANG 时)?
- Q4: Dashboard 是否"规则树 Rules Tree"双语形态?
- Q5: AI prompt 接受「英文硬规则不翻 + 中文仅解释层」?

**品牌 (UX)**:
- Q6: 'Consensus Plane' 保留内部术语 vs 对外副标语?
- Q7: 版本号统一为 Fabric v1.0 还是 v2.0?（README 与 Dashboard 感知不一致）
- Q8: 品牌主色是否从 green CTA 中分离?

**架构 (Architecture)**:
- Q9: Dashboard 浏览器端 Bearer token 注入契约是否在 v1.1 scope?
- Q10: MCP 协议事件是否拆出 .fabric/mcp-events.jsonl (当前与 intent ledger 共用)?

**版本发布 (Technical + PM)**:
- Q11: npm scope 最终统一 @fabric/* vs @fabric/*?
- Q12: v1.0 是否包含 CHANGELOG/RELEASING/CI 基础设施 (Technical 建议必补)?

## Round 2 — 叙事驱动收敛 + 首发故事脚本

### User Input: 核心决策锁定 (一次性拍板)

> **Decision**: 用户采取「叙事驱动」收敛策略, 一次性锁定产品核心决策
> - **Context**: Round 1 共识充分, 12 个开放问题不需要逐个 round 深入; 用户选择直接定稿
> - **Options considered**: 逐问题访谈 (慢) / 一次性拍板 (快, 用户主导)
> - **Chosen**: 一次性拍板 — **Reason**: Round 1 已形成可信框架, 用户对方向有清晰判断
> - **Impact**: 跳过 Q1-Q12 逐条访谈, 直接进入首发故事脚本撰写

**锁定决策清单**:

| # | 决策项 | 用户锁定值 | 来源 Question |
|---|-------|----------|--------------|
| D1 | Primary Persona | 仓库维护者 / AI Enablement Owner | Q1 |
| D2 | 主标语 (zh) | 人机协作的语义共识平面 | Q2 |
| D3 | 主标语 (en) | The Consensus Plane for AI-Human Collaboration | Q2 |
| D4 | Consensus Plane | **保留为对外主标语** (非内部术语) | Q6 |
| D5 | default locale | `en` (但 zh-CN 一等公民, CLI/UI 优先中文) | Q3 |
| D6 | Dashboard 双语 | 实施方案由后续决定, 原则: 中文优先 | Q4 |
| D7 | AI prompt 策略 | 英文硬规则 + 中文解释层 (per Technical policy) | Q5 |
| D8 | npm scope | **统一 `@fabric/*`** | Q11 |
| D9 | 版本锚定 | **Fabric v1.0 为发布起点** | Q7 |
| D10 | Dashboard 归属 | **v1.1 特性** (Feature #5) | 衍生自 PM v1.1 定位 |

### 首发故事脚本 (soul reference) — 已产出

详见独立文档: [`v1.0-launch-story.md`](./v1.0-launch-story.md) (1279 行, 由 Round 2 Codex CLI 产出)

**结构摘要**:
- 前言 (L61-220): 6 人 Cocos Creator 狼人杀团队维护者的第一人称视角; 痛点是多客户端规则漂移
- 第一幕 (L221-507): `fab init` 中文化完整 stdout + `agents-md-init` 3 Phase 中文访谈脚本
  - Phase 1 框架确认 / Framework Confirm
  - Phase 2 不变式提取 / Invariants Extraction
  - Phase 3 构造落地 / Domain Construction
- 第二幕 (L508-819): 可直接落地的 werewolf `AGENTS.md` 样例 (~300 行完整 markdown)
  - Hard Rules (英文 protected) + Framework Invariants (Cocos `@ccclass`/`.meta`/`prefabs/scenes`/async boundaries)
  - Domain: gameplay (Game.ts, Player.ts) + network (Network.ts)
  - `@HUMAN` Lock Range 示意 + 中文 Explanation Layer (狼人杀角色机制解释)
- 第三幕 (L820-1212): Dashboard 初见时刻
  - 首屏 header (`fabric` wordmark + `F` lettermark + `v1.1.0` + CONNECTED)
  - 左侧导航"中文主 + 英文副"双标签 ('规则树 Rules Tree' 等)
  - 默认页: Rules Tree + Human Lock + Intent Timeline + Doctor + History Replay
  - Daily Loop 场景: 团队 commit → SSE 推送 → 维护者看到新 intent
- 后记 (L1213-): 指向 v1.1/v1.2 演进

### Round 2 Narrative Synthesis

**起点**: Round 1 产出 4 视角共识但留下 12 个开放问题分 5 类
**关键进展**: 用户采用"叙事驱动"收敛策略, 一次性锁定 10 项核心决策 (Persona / 主标语 / i18n / npm scope / 版本锚定), 然后要求产出具象化首发故事脚本
**决策影响**: 所有 6 个 Round 1 Technical Solutions 由 proposed → validated; 后续 Phase 4 可基于锁定决策直接生成执行清单
**当前理解**: v1.0 发布叙事完全具象化 — CLI 中文交互 + AGENTS.md 样例 + Dashboard 初见 三幕合一, 可作为产品手册/白皮书/README 的文本基因库
**遗留问题**: 
- 架构层仍有 Dashboard Bearer token 浏览器注入 / MCP 事件拆出 ledger 的开放问题 (进入 v1.1 实施 scope)
- Technical 层细节 (picocolors 引入 / string-width 接入 / shared 词典初版) 需落到 lite-plan 任务

### Intent Coverage Check (Round 2 后)

| # | Original Intent | Status | Coverage |
|---|----------------|--------|----------|
| 1 | User Journey 图谱 | ✅ 完整 | 9 阶段旅程 + launch story 第一幕具象化 CLI 交互 |
| 2 | i18n 本地化战略 | ✅ 完整 | 8-surface policy + AI prompt 分层 + default en/zh-CN 一等公民 + do-not-translate 策略锁定 |
| 3 | Milestone Matrix | ✅ 完整 | v1.0/v1.1/v1.2 三段 + release signal + launch story 展示 v1.0 可交付形态 |
| 4 | 品牌视觉规范 | ✅ 完整 | 主标语锁定 + 命名三形式 + 织物意象核心/辅/禁忌 + launch story 第三幕展示 Dashboard 品牌落地 |

**全部意图已覆盖**, 可进入 Phase 4 综合与建议审阅。

### Technical Solutions (validated from Round 1)

上游 6 个 Technical Solutions 因用户锁定决策进入 **Validated** 状态:

> **Solution**: 自研最小 i18n hook + packages/shared 词典
> - **Status**: ✅ Validated — 由 D5 (default en + zh-CN 一等公民) 与 D7 (AI prompt 保护) 验证

> **Solution**: 单 release train + @fabric/* scope 收敛
> - **Status**: ✅ Validated — 由 D8 + D9 明确锁定

> **Solution**: CLI colors.ts 语义色模块 (picocolors + string-width)
> - **Status**: ✅ Validated — 与 D6 CLI 中文优先协同

> **Solution**: 版本号 build-time 注入 (__DASHBOARD_VERSION__ / __SERVER_VERSION__)
> - **Status**: ✅ Validated — 由 D9 v1.0 锚定必须修正 Dashboard 硬编 v1.1 → 转为 v1.1 build 时注入

> **Solution**: AI prompt core/wrapper 分层 (do-not-translate protected tokens)
> - **Status**: ✅ Validated — 由 D7 明确锁定

> **Solution**: 9 阶段 canonical user journey (合并 quickstart + initialization)
> - **Status**: ✅ Validated — 由 D1 persona 锁定 + 本轮首发脚本落地

## Round 2 and Beyond

## Conclusions

### Summary

Fabric v1.0 产品化落地方案完整定稿：核心决策一次性锁定（Persona / 主标语 / 命名三形式 / i18n 分层 / scope / 版本）· 三面分工成为对外叙事核心 · v1.0/v1.1/v1.2 三阶段矩阵清晰 · 1279 行首发故事脚本已交付作白皮书灵魂参考 · 11 项可执行 recommendations 等待 review。

### Intent Coverage Matrix

| # | Original Intent | Status | Where Addressed | Notes |
|---|----------------|--------|-----------------|-------|
| 1 | User Journey 图谱 | ✅ Addressed | PM 9 阶段 user_journey_map + 首发脚本第一幕 + 角色矩阵 + Rec #4/#10 | 产品手册体裁 |
| 2 | i18n 本地化战略 | ✅ Addressed | UX 8-surface policy + Technical shared hook + AI prompt 分层 + Rec #7/#8 | 中文化落地规范 |
| 3 | 版本演进矩阵 | ✅ Addressed | PM v1.0/v1.1/v1.2 + Technical 基础设施 + Rec #1/#2/#9 | 发布清单矩阵 |
| 4 | 品牌视觉规范 | ✅ Addressed | UX brand_system + 命名三形式 + 意象核心/辅/禁忌 + Rec #11 | 品牌规范文档 |

### Findings Coverage Matrix

| # | Finding (Round) | Disposition | Target |
|---|----------------|-------------|--------|
| 1 | 三面分工骨架 (R1) | recommendation | Rec #1/#4/#10 |
| 2 | Dashboard 未入 roadmap (R1) | recommendation | Rec #1 |
| 3 | i18n 分层 (R1) | recommendation | Rec #7/#8 |
| 4 | tokens.css 即品牌 (R1) | recommendation | Rec #6 |
| 5 | shared 空占位 (R1) | recommendation | Rec #5 |
| 6 | 版本/scope 分裂 (R1) | recommendation | Rec #2/#3 |
| 7 | 三入口割裂 (R1) | recommendation | Rec #4 |
| 8 | CLI help/stdout 语言不一致 (R1) | absorbed | → Rec #8 |
| 9 | Dashboard v1.1 硬编 (R1) | recommendation | Rec #3 |
| 10 | README Placeholder (R1) | absorbed | → Rec #4 |
| 11 | FAB_SERVER_PATH 泄漏 (R1) | absorbed | → Rec #4 |
| 12 | bootstrap 全中文降低 AI 约束 (R1) | recommendation | Rec #7 |
| 13 | Cocos invariants 结构 (R1) | informational | launch story 第二幕 |
| 14 | 10 状态 .fabric/ 状态机 (R1) | informational | Architecture invariants |
| 15 | 12 invariants + 9 架构债 (R1) | deferred | v1.1 scope |
| 16 | SSE 非 state-replay (R1) | deferred | v1.1 (Last-Event-ID) |
| 17 | MCP + ledger 协议过载 (R1) | deferred | v1.1 (mcp-events.jsonl 拆分) |
| 18 | 10 决策一次性锁定 (R2) | informational | Decision Log |
| 19 | 1279 行首发故事 (R2) | recommendation | Rec #10 |

### Decision Trail (关键决策)

1. **Round 1 (Phase 1)**: 4 视角全覆盖 (PM + 架构 + UX + Technical) — Reason: 子主题各需专业视角
2. **Round 1 (Phase 2)**: cli-explore-agent 改用 Codex CLI 并行 — Reason: agent 工具响应问题, Codex CLI 15 分钟完成
3. **Round 2**: 叙事驱动一次性锁定 10 项核心决策 — Reason: Round 1 框架已清晰, 跳过 Q1-Q12 逐问访谈
4. **Round 2**: 产出 1279 行具象化首发故事脚本 — Reason: 作白皮书灵魂参考, 抽象原则已在 perspectives.json

### Session Statistics

- **总轮数**: 2 rounds (Phase 2 探索 → Round 1 + Phase 3 Round 2 深入)
- **视角数**: 4 (产品经理 + 系统架构 + UX/品牌 + 技术实现)
- **CLI 调用**: 5 Codex CLI (4 perspectives + 1 launch story)
- **产出 artifact**:
  - `exploration-codebase.json` (68 files scanned, 55 relevant)
  - `research.json` (11 findings, 9 best practices, 10 gaps)
  - `perspectives.json` (4 视角聚合 + synthesis)
  - `explorations/{product-manager,architecture,ux-brand,technical}.json`
  - `v1.0-launch-story.md` (1279 行白皮书灵魂参考)
  - `conclusions.json` (9 conclusions + 11 recommendations + decision trail)
  - `discussion.md` (本文档, 完整 narrative)
- **Recommendations**: 11 (4 high / 5 medium / 2 low)
- **Open questions 留待 v1.1**: 5 (均为架构/UX 可延期决策)

### Recommendation Review Summary

**Review Date**: 2026-04-19
**Result**: ✅ 11 项全部 accepted, 0 modified, 0 rejected

| Priority | Rec # | Action | Status |
|----------|-------|--------|--------|
| high | #1 | 修正 roadmap.md (v1.0/v1.1/v1.2 三段 + Dashboard Feature #5) | ✅ accepted |
| high | #2 | 版本统一 + @fabric/* scope 收敛 | ✅ accepted |
| high | #3 | Dashboard/Server build-time 版本注入 | ✅ accepted |
| high | #4 | 合并 quickstart+initialization → getting-started + 重写 README | ✅ accepted |
| medium | #5 | packages/shared 填充 (i18n 基础设施 + 共享类型) | ✅ accepted |
| medium | #6 | CLI colors.ts 语义色模块 (picocolors + string-width) | ✅ accepted |
| medium | #7 | AI prompt 保护策略 + CI lint | ✅ accepted |
| medium | #8 | CLI + Dashboard i18n 接入 | ✅ accepted |
| medium | #9 | CHANGELOG + RELEASING + CI workflows | ✅ accepted |
| medium | #10 | launch-story 抽取到 docs/ + examples/ | ✅ accepted |
| low | #11 | 品牌资产最小包 (wordmark + avatar + ANSI map + README hero) | ✅ accepted |

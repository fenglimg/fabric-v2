# Analysis: Fabric MCP Server + Web Dashboard 统一服务系统架构探索

## Table of Contents
- [Session Metadata](#session-metadata)
- [User Intent](#user-intent)
- [Current Understanding](#current-understanding)
- [Round 1: Initial Exploration](#round-1-initial-exploration)

## Session Metadata

- **Session ID**: ANL-fabric-mcp-dashboard-unified-2026-04-19
- **Topic**: 基于项目 Fabric (原 pcf) 的架构愿景，探索设计一套集成了 MCP Server 与 Web Dashboard 的统一服务系统
- **Created**: 2026-04-19 (UTC+8)
- **Auto Mode**: false
- **Prior Analysis Reference**: `.workflow/.analysis/ANL-implement-fabric-v2-2026-04-18/` (Fabric v2.0 MVP 蓝图已锁定：monorepo pnpm、MCP SDK v1.29、6 客户端支持、7 天 MVP + v1.1 maintenance)
- **Current Codebase State**: packages/server (MCP stdio + 3 tools), packages/cli (fab CLI 5 subcommands), packages/shared — v0.1.3 已发布 npm

## User Intent

原始陈述：**"基于项目 Fabric (原 pcf) 的架构愿景，探索设计一套集成了 MCP Server 与 Web Dashboard 的统一服务系统。"**

拆解意图：
1. **架构愿景延伸** — 从当前 v1.0 MVP (纯 CLI + stdio MCP) 向包含 Web Dashboard 的更大系统演进
2. **MCP Server 定位** — MCP Server 在新架构中扮演什么角色？（继续 stdio？改 HTTP？双协议？）
3. **Web Dashboard 角色** — Dashboard 服务什么用例？（监控/配置/审计/人类在环/跨端同步可视化？）
4. **统一服务系统** — "统一"意味着什么？（单一部署？共享状态？统一 API？单进程？）
5. **与 v1.0 / v1.1 的关系** — 是 v2.0 演进、v1.1 扩展、还是平行产品线？

## Current Understanding

*待 Phase 2 探索后填充*

## Dimensions Identified

| Dimension | Keywords matched | Relevance |
|-----------|-----------------|-----------|
| **architecture** | 架构愿景、统一服务系统、设计、集成 | High |
| **decision** | MCP Server 与 Web Dashboard 如何集成、进程模型选型 | High |
| **comparison** | stdio vs HTTP MCP, 单体 vs 微服务, 本地 vs 云端 | Medium |
| **concept** | "统一服务系统"的设计哲学与边界 | Medium |

## Phase 1 Decisions

#### User Input (Phase 1 Scoping)

> **Decision**: Dashboard 定位为 **"项目语义共识层 (Semantic Consensus Layer)"**
> - **Context**: 用户在 AskUserQuestion 中追加关键语义定义
> - **Chosen positioning**:
>   - 定位为"**逻辑层 Linter**"与"**异步语义缓冲区**"
>   - **不中断开发心流** — 异步而非同步干预
>   - 作为 AI 意图与人类规范的"**磨合中心**"
>   - 在**预提交阶段**提供一致性审计视图
>   - 通过**异步仲裁**实现人机认知的最终对齐
>   - 确保项目意识协议 (Fabric) 的确定性与权威性
> - **Impact**: Dashboard 不是运行时 debug UI，而是**预提交前的一致性仲裁工作台**；与 v1.0 pre-commit 三件套（ledger-append / human-lint / sync-meta）深度耦合

> **Decision**: 多协议统一进程部署（fab serve 单进程同时提供 stdio MCP + HTTP Dashboard）
> - **Context**: MCP 与 Dashboard 在进程/部署层面的统一方式
> - **Chosen**: 单进程多协议
> - **Rejected**: 双进程共享状态、Dashboard 作为独立 MCP 客户端、让分析后再定
> - **Impact**: 锁定 `fab serve` 为 Phase 2 分析入口；需探索 stdio + HTTP 共存的运行时模型

> **Decision**: 分析深度 = Standard（3-4 轮 + 必要外部研究）
> - **Impact**: Phase 3 目标 3-4 轮收敛

#### Primary Focus Areas (from user multi-select)
- 可视化监控审计 (Monitoring & Audit Visualization)
- 人类在环配置 (Human-in-the-loop Configuration)
- 开发调试工具 (Dev/Debug Tooling)

## Current Understanding

**核心认知（Round 1 后）**:
- Fabric 统一服务系统 = `fab serve` 命令启动的**单进程单 Express app**，承载 MCP (HTTP) + Dashboard (REST + SSE) + 静态资源
- Dashboard 定位 = **项目语义共识层**：预提交阶段 pre-commit 三件套的数据可视化 + 人机认知异步仲裁工作台
- 技术栈：**零新增 npm 依赖**（MCP SDK v1.29 已传递依赖 Hono + Express），用 `createMcpExpressApp()` 直接 mount
- 关键约束：MCP SDK 不支持单 server 多 transport — HTTP MCP 必须用 per-session McpServer 工厂
- 代码切入点：`createFabricServer()` 已是纯工厂，HTTP 接入零改动现有 stdio；pre-commit 三件套的输出产物即 Dashboard 三个核心视图数据源

**已明确**:
1. 进程模型：单进程多协议（用户决策）
2. 定位：语义共识层、异步仲裁、不中断心流（用户决策）
3. 技术栈：Express v5（via createMcpExpressApp）+ StreamableHTTPServerTransport
4. 安全基线：127.0.0.1 + DNS rebinding 内置

**待澄清**:
1. 前端技术栈（纯 HTML / React SPA / HTMX）
2. 读/写权限边界（只读审计 vs 可写编辑）
3. 单项目 vs 多项目
4. MCP HTTP 引入时机（Dashboard 优先 vs 同期迁移）
5. Schema 迁移时机（shared 包统一化）
6. Intent-ledger schema 统一方案（字段对齐 vs 显式 tag 区分）

## Round 1: Initial Exploration

### Data Sources
- `exploration-codebase.json` — cli-explore-agent 扫描 28 文件、深读 22 文件
- `research.json` — workflow-research-agent 验证 MCP SDK v1.29 能力

### Key Findings

> **Finding**: MCP SDK v1.29 已传递依赖 Hono + Express — 接入 HTTP Dashboard 零新增 npm 依赖
> - **Confidence**: High — 源自 `@modelcontextprotocol/sdk/package.json` 实测
> - **Hypothesis Impact**: Confirms "单进程多协议" 可行性；大幅降低技术选型复杂度
> - **Scope**: 所有 HTTP 层决策 — 直接用 `createMcpExpressApp()` 作为 App 基础

> **Finding**: MCP SDK 不支持单 McpServer 连接多 transport（`connect()` 独占所有权）
> - **Confidence**: High — SDK `.d.ts` 定义 + 官方 `sseAndStreamableHttpCompatibleServer.js` 示例
> - **Hypothesis Impact**: Refutes "stdio + HTTP 复用同一 McpServer 实例" 的直觉；必须 per-session 工厂
> - **Scope**: HTTP MCP 实现模式 — 每 HTTP session 调用 `createFabricServer()` 返回新实例

> **Finding**: `createFabricServer()` (server/index.ts:L23-34) 已是无副作用工厂，零改动契合 per-session 模式
> - **Confidence**: High — 代码实测
> - **Hypothesis Impact**: Confirms Fabric v1.0 代码架构天然支持 HTTP 扩展
> - **Scope**: 实施路径 — stdio 逻辑完全不变，HTTP 平行新增

> **Finding**: pre-commit 三件套（sync-meta / human-lint / ledger-append）的输出产物即 Dashboard 三个核心视图的数据源
> - **Confidence**: High — 代码中每个命令产物与 Dashboard 视图一一对应
> - **Hypothesis Impact**: Confirms "Dashboard = 语义共识层" 定位可行；Dashboard 不是新增数据，而是已有数据的可视化
> - **Scope**: Dashboard 数据契约 — 复用 `.fabric/agents.meta.json` + `.fabric/human-lock.json` + `.intent-ledger.jsonl`

> **Finding**: `.intent-ledger.jsonl` 双路写入字段不一致（AI 侧缺 parent_sha/diff_stat，CLI 侧缺 commit_sha）
> - **Confidence**: High — append-intent.ts:L9-15 vs ledger-append.ts:L13-19
> - **Hypothesis Impact**: Modifies 时间线实现复杂度 — Dashboard 需处理异构记录
> - **Scope**: 数据契约 + Dashboard 时间线视图

> **Finding**: `packages/shared/src/index.ts` 为空占位，是迁移共享 schema 的黄金时机
> - **Confidence**: High — 代码实测 `export {}`
> - **Hypothesis Impact**: Enables 正确依赖方向 — Dashboard 从 @fabric/shared import，而非 server 内部
> - **Scope**: 工程结构 — AgentsMeta / LedgerEntry / HumanLockEntry 迁移

### Technical Solutions Proposed

> **Solution**: 单 Express App 架构 — `fab serve` 一次 `app.listen(port)` 承载 `/mcp` + `/api/*` + `/events` + `/`
> - **Status**: Proposed
> - **Problem**: 统一部署 MCP + Dashboard，避免多进程
> - **Rationale**: `createMcpExpressApp()` 已提供安全配置（DNS rebinding + express.json）；Express v5 是 SDK 传递依赖
> - **Alternatives**: Hono 直接用（失去 SDK 官方安全配置）、Fastify（需自己适配 MCP）、分进程 IPC（无必要）
> - **Evidence**: `research.json` findings[2][3]; `createMcpExpressApp` in SDK `.d.ts`
> - **Next Action**: 用户确认前端技术栈 + 读写权限边界后细化路由表

> **Solution**: Per-session McpServer 工厂 + JsonlEventStore 实现 MCP resumability
> - **Status**: Proposed
> - **Problem**: SDK 契约要求，多 session 场景需正确模式
> - **Rationale**: 官方示例明确；createFabricServer() 已是工厂契合此模式；.intent-ledger.jsonl 天然 append-only
> - **Alternatives**: stateless 模式（短会话可用但失去断线重连）、单 McpServer（SDK 不支持）
> - **Evidence**: `research.json` findings[1][4]
> - **Next Action**: stateful vs stateless 起步决策

> **Solution**: Service-Function 中间层 — 业务逻辑抽取为纯函数，MCP tool 和 HTTP API 共享
> - **Status**: Proposed
> - **Problem**: 避免 MCP tool 和 HTTP API 逻辑重复，保持 SSOT
> - **Rationale**: 现有 tool handler 天然无 transport 耦合，抽成 `services/{getRules,appendIntent,updateRegistry}.ts` 后，MCP 和 Express 都是薄 adapter
> - **Alternatives**: HTTP 转 MCP JSON-RPC（多层解析，错误边界模糊）、重复实现
> - **Evidence**: packages/server/src/tools/*.ts 三个 tool 均无 transport 耦合
> - **Next Action**: 设计 services/ 目录结构

> **Solution**: 共享契约上移至 @fabric/shared — AgentsMeta / LedgerEntry / HumanLockEntry / FabricConfig 统一 zod schema
> - **Status**: Proposed
> - **Problem**: 类型散落，Dashboard 引入会放大重复
> - **Rationale**: packages/shared 是私有包，专为内部契约存在；当前空占位零迁移成本
> - **Alternatives**: Dashboard 从 server/cli 直接 import（违反依赖方向）、复制类型（维护灾难）
> - **Evidence**: packages/shared/src/index.ts:L1-2 空占位；sync-meta.ts 和 init.ts 已有重复 AgentsMeta 定义
> - **⚠️ Ambiguity**: 迁移时机未定 — Dashboard 引入前 vs 同期
> - **Next Action**: 用户决策迁移时机

> **Solution**: Dashboard 独立 /events SSE + chokidar 监听 `.fabric/*` 和 `.intent-ledger.jsonl`
> - **Status**: Proposed
> - **Problem**: 审计视图需实时反映，避免手动刷新
> - **Rationale**: SSE 单向推送对审计足够；chokidar 成熟；不与 MCP SSE 混用避免协议耦合
> - **Alternatives**: WebSocket（过度）、轮询（浪费）、复用 MCP notification（耦合）
> - **Evidence**: research.json best_practices[3]
> - **Next Action**: 与前端技术栈一起落地

> **Solution**: Intent Ledger Schema 统一
> - **Status**: Proposed
> - **Problem**: 双路写入字段不一致
> - **⚠️ Ambiguity**: 两种方案未定：(A) 字段对齐 — AI 侧补 parent_sha/diff_stat；(B) 显式 tag: `{type: 'ai' | 'human', ...}` 分开渲染
> - **Next Action**: 用户决定语义 — 两路是"同一事件的两种来源"(A) 还是"两类本质不同的事件"(B)

### Initial Intent Coverage Check
- ✅ **架构愿景延伸** — Round 1 确认 `fab serve` 单进程多协议蓝图
- ✅ **MCP Server 定位** — HTTP MCP 走 per-session 工厂，stdio 保留
- ✅ **Web Dashboard 角色** — 映射为 pre-commit 三件套的可视化仲裁工作台
- 🔄 **统一服务系统** — 进程模型已定，但 "统一" 的具体范围（前端栈/读写边界/多项目）待 Round 2 定
- 🔄 **与 v1.0/v1.1 的关系** — 需在 Round 2 或 Round 3 给出 roadmap 定位（独立 v1.2 / 扩展 v1.1 / 另起 v2.0）

## Round 2: Key Architectural Decisions

### Decisions Captured (User Input)

> **Decision**: Intent-ledger 采用 **显式 tag 区分方案 (B)**
> - **Context**: 两路写入字段不一致的统一策略
> - **Chosen**: 加 `source: 'ai' | 'human'` 字段，两类事件开箱分离渲染
> - **Rejected**: (A) 字段对齐（会丢失"双仓"语义）；(C) 保持现状（Dashboard 复杂度转嫁）
> - **Reason**: 符合"AI 意图 vs 人类规范磨合中心"的核心定位 — 异步仲裁工作台应在 UI 上**视觉分离**两种来源
> - **Impact**: LedgerEntry schema 需要 discriminated union；Dashboard 时间线默认双栏对照视图；AI 侧 append-intent.ts 写入时打 `source: 'ai'`，CLI ledger-append 打 `source: 'human'`

> **Decision**: Dashboard 采用 **仪式性写入权限模型**
> - **Context**: 读/写权限边界
> - **Chosen**: 仅允许 (1) human-lock approve hash 更新 (2) intent 批注
> - **Rejected**: 全量编辑（风险大、与 CLI/编辑器工作流冲突）；纯只读（弱化"人机仲裁"语义）
> - **Reason**: 与"不中断开发心流"契合 — AGENTS.md 直编辑仍在 IDE，Dashboard 只承担仪式性决定点
> - **Impact**: 两个写 API：`POST /api/human-lock/approve` 和 `POST /api/intent/annotate`；不需要乐观锁复杂度；仍需 audit 日志（写回 intent-ledger 作为 `source: 'human'` 条目）

> **Decision**: Dashboard 前端 = **Preact + Vite 轻量 SPA**
> - **Context**: 前端技术栈
> - **Chosen**: Preact (≈3KB) + Vite build → 静态 dist 内嵌 server
> - **Rejected**: Vanilla（组件化成本高）；HTMX（服务端渲染与 stateless SPA 不匹配）；React（体积大）
> - **Reason**: 组件化红利 + 超小体积 + Vite DX
> - **Impact**: Monorepo 新增 `packages/dashboard/`；Vite build 产出 `dist/` 被 server 静态服务；dev 时 Vite dev server 代理 `/api` `/mcp` `/events` 到 `fab serve`

> **Decision**: Dashboard 定位为 **v1.1 Feature #5**
> - **Context**: Roadmap 位置
> - **Chosen**: 加入 docs/roadmap.md v1.1 maintenance milestone 作为第 5 个特性（现有 drift-check / fab migrate / fab doctor / Copilot fallback 四个之后）
> - **Rejected**: 独立 v1.2/v2.0（破坏现有版本节奏）；并入 v1.0（拖长 7 天 MVP）；不定位（无 roadmap 对齐）
> - **Reason**: v1.1 本身是 "maintenance milestone" 主题，Dashboard 作为 "diagnostic + audit visualization tool" 契合此主题；与 fab doctor 高度互补（doctor = CLI 自检，Dashboard = 可视化自检）
> - **Impact**: 需要更新 docs/roadmap.md 加入第 5 个特性条目；v1.0 MVP 路径不受影响；fab doctor 可作为 Dashboard 的一个"诊断 tab"复用

### Round 2 Narrative Synthesis

**起点**: Round 1 已确认单 Express App 零新增依赖的可行性，但在"如何统一两路 ledger"、"Dashboard 写权限"、"前端栈"、"roadmap 定位"四个关键点存在歧义。
**关键进展**: 用户的 4 个决策以"异步仲裁 + 不中断心流"为主线形成内在一致的取舍 — 显式 tag 区分（视觉分离双仓）+ 仪式性写入（只管决定点）+ 轻量 SPA（契合 maintenance tool 体积预算）+ v1.1 定位（与 fab doctor 互补）。
**决策影响**: Dashboard 从"某种可视化界面"具化为"v1.1 的 5th feature — 预提交仲裁工作台 + 诊断可视化"，实施范围清晰。
**当前理解**: 架构主干确定，待 Round 3 深化路由细节、monorepo 结构变更清单、以及 Dashboard 与 fab doctor 的交互。
**遗留问题**:
  - v1.1 的 4 个已定特性 + Dashboard，5 个特性的实施顺序？(fab doctor 先还是 Dashboard 先？)
  - Dashboard SPA 与 server 在 monorepo 中的依赖方向（shared 是否也给 Dashboard 用？）
  - `fab serve` 启动后 AI 客户端如何发现？（可选：fab init 时自动写入 ~/.claude 等 HTTP MCP 配置）

### Intent Drift Check
- ✅ 架构愿景延伸：v1.1 Feature #5 定位
- ✅ MCP Server 定位：per-session 工厂 + HTTP（可选）+ stdio（保留）
- ✅ Web Dashboard 角色：仲裁工作台 + 诊断可视化
- ✅ 统一服务系统：单进程 Express App + 三类端点（MCP / API / SSE）+ 静态 SPA
- ✅ 与 v1.0/v1.1 关系：v1.1 Feature #5

所有原始意图均已覆盖。Round 3 聚焦落地细节（monorepo 结构 + 路由表 + v1.1 内部顺序）。

## Round 3: Implementation Blueprint

### Monorepo 结构变更（目标形态）

```
packages/
├── server/          [修改]
│   ├── src/
│   │   ├── index.ts            [修改] 导出 startStdioServer + startHttpServer
│   │   ├── http.ts             [新增] createFabricHttpApp() 返回 Express app
│   │   ├── api/                [新增] Dashboard REST/SSE endpoints
│   │   │   ├── ledger.ts       [新增] GET /api/ledger (读 .intent-ledger.jsonl)
│   │   │   ├── rules.ts        [新增] GET /api/rules (调 readAgentsMeta)
│   │   │   ├── scan.ts         [新增] GET /api/scan (调 createScanReport)
│   │   │   ├── human-lock.ts   [新增] GET + POST /api/human-lock
│   │   │   ├── intent.ts       [新增] POST /api/intent/annotate
│   │   │   ├── events.ts       [新增] GET /events (SSE + chokidar watcher)
│   │   │   └── static.ts       [新增] app.use('/', express.static(dashboardDist))
│   │   ├── services/           [新增] 纯函数业务层（MCP tool 和 HTTP API 共享）
│   │   │   ├── get-rules.ts    [新增] 从 tools/get-rules.ts 抽出
│   │   │   ├── append-intent.ts[新增] 从 tools/append-intent.ts 抽出
│   │   │   └── update-registry.ts[新增] 从 tools/update-registry.ts 抽出
│   │   ├── tools/              [修改] tool handler 改为薄 adapter 调 services/
│   │   │   ├── get-rules.ts
│   │   │   ├── append-intent.ts
│   │   │   └── update-registry.ts
│   │   └── meta-reader.ts      [保留] readAgentsMeta 不变
│   └── package.json            [修改] 依赖 @fabric/shared
│
├── cli/             [修改]
│   ├── src/
│   │   ├── commands/
│   │   │   ├── serve.ts        [新增] fab serve --port 7373 --target <dir>
│   │   │   └── ... (现有 9 个)
│   │   └── ...
│   └── package.json            [修改] 依赖 @fabric/shared, optional peer on @fabric/fabric-dashboard
│
├── shared/          [修改] 从 placeholder 充实
│   ├── src/
│   │   ├── index.ts            [修改] re-export all
│   │   ├── schemas/            [新增]
│   │   │   ├── agents-meta.ts  [新增] from server/meta-reader
│   │   │   ├── ledger-entry.ts [新增] discriminated union with source: 'ai' | 'human'
│   │   │   ├── human-lock.ts   [新增] from cli/human-lint
│   │   │   └── fabric-config.ts[新增] from cli/config/resolver
│   │   └── index.ts
│   └── package.json            [修改] 为公共导出做准备（暂保持 private）
│
└── dashboard/       [新增] Preact + Vite SPA
    ├── src/
    │   ├── main.tsx            [新增] Preact entry
    │   ├── app.tsx             [新增] 三视图路由
    │   ├── views/
    │   │   ├── rules-tree.tsx  [新增] 规则树浏览器（L0/L1/L2 + human_locked_nearby）
    │   │   ├── human-lock.tsx  [新增] 人类仓库审计卡 + approve 交互
    │   │   └── intent-timeline.tsx [新增] 双栏时间线 (AI | Human)
    │   ├── api/
    │   │   └── client.ts       [新增] fetch wrappers for /api/*
    │   ├── hooks/
    │   │   └── use-events.ts   [新增] SSE 订阅 hook
    │   └── components/
    ├── index.html              [新增] Vite entry HTML
    ├── vite.config.ts          [新增] proxy /api, /mcp, /events to :7373
    ├── tsconfig.json
    └── package.json            [新增] @fabric/fabric-dashboard (private or published)
```

### 关键数据流

**开发时 (`pnpm dev`)**:
```
Terminal 1: cd packages/server && pnpm dev (watch)
Terminal 2: cd packages/cli && pnpm fab serve --target ../../examples/werewolf-minigame-stub --port 7373
Terminal 3: cd packages/dashboard && pnpm dev  # Vite dev server :5173
                                                 # proxy /api, /mcp, /events → http://localhost:7373
Browser: http://localhost:5173 → Vite HMR
```

**生产时 (`fab serve` single command)**:
```
pnpm -r build                              # server + cli + shared + dashboard
pnpm fab serve --target /path --port 7373  # 单 Express app 服务所有
  ├─ POST /mcp          → per-session McpServer + StreamableHTTPServerTransport
  ├─ GET  /api/rules    → readAgentsMeta + human_locked_nearby
  ├─ GET  /api/ledger?source=ai|human&since=<ts>
  ├─ POST /api/human-lock/approve  {file, start_line, end_line, new_hash}
  ├─ POST /api/intent/annotate    {ledger_entry_id, annotation}
  ├─ GET  /events       → SSE (chokidar on .fabric/* + .intent-ledger.jsonl)
  └─ GET  /             → express.static(packages/dashboard/dist)
```

### 依赖图

```
@fabric/shared  (zod schemas, types)
       ↑
   ┌───┴────┐
   │        │
fabric-  fabric-cli  fabric-dashboard (build-time only)
server       ↑             ↑
   ↑         │             └─ build → dist/ bundled into server/dist/static/
   └─────────┘                        (via tsup copy or runtime __dirname)
```

**核心原则**: server 和 dashboard 都依赖 shared；cli 依赖 server（如现状）；dashboard 的 build 产物在 release 时被 tsup copy 进 server 包，或 server 运行时 `__dirname/../dashboard-dist` 查找。

### 实施阶段（Dashboard 作为 v1.1 Feature #5）

**v1.1 5 特性建议实施顺序（依赖分析）**:

1. **fab doctor**（先）— 为所有后续特性提供诊断基础；Dashboard 的"诊断 tab"复用 doctor 的检查结果
2. **Dashboard (fab serve)** + **shared 包迁移** — HTTP 基础设施 + 共享 schema 立项
3. **drift-check** — 可作为 Dashboard 的一个视图（drift badge）和一个 CLI 命令
4. **fab migrate** — 当 schema 演进出现，晚于 shared 迁移
5. **Copilot fallback** — 依赖 GitHub Copilot MCP GA 时间表（外部依赖，弹性）

### Dashboard 5-阶段任务包（v1.1 Feature #5 细分）

| Phase | Title | 核心交付 | 验证 |
|-------|-------|---------|------|
| D1 | Shared schema 迁移 | `@fabric/shared` 提供 AgentsMeta / LedgerEntry (discriminated union) / HumanLockEntry / FabricConfig；server/cli 切换 import | `pnpm -r build` 通过；server/cli 无本地重复类型 |
| D2 | MCP HTTP + Express app | `packages/server/src/http.ts` + `fab serve` 命令；per-session 工厂；stdio 保留 | `curl -X POST http://127.0.0.1:7373/mcp` 返回 MCP response；stdio 模式仍工作 |
| D3 | Dashboard REST API 层 | `/api/rules` `/api/ledger` `/api/scan` `/api/human-lock` `/api/intent/annotate` 五个端点 | httpie 请求返回预期 JSON；human-lock approve 后文件内容正确更新 |
| D4 | 实时 SSE + chokidar | `/events` + file watcher；ledger 追加/meta 变化即推送 | 外部改文件 → Dashboard 无刷新接收事件 |
| D5 | Preact SPA 三视图 + 生产打包 | 规则树 / 人类仓库 / 意图时间线 三视图；Vite build → server static serve；fab serve 一键启动完整 UI | 浏览器 http://127.0.0.1:7373 显示三视图；pre-commit 失败时 Dashboard 显示 violation 卡片 |

**可选扩展（v1.1 内或之后）**:
- E1: Bearer auth（从 localhost-only 扩展到 LAN 共享）
- E2: fab doctor 诊断 tab 集成
- E3: history replay（时间旅行规则状态）

### Round 3 Narrative Synthesis

**起点**: 架构主干和语义已锁定，需要产出"一眼看懂的工程蓝图"。
**关键进展**: 明确 packages/dashboard 作为独立包（Preact + Vite） + shared 从占位充实为单一契约 + services/ 层避免 MCP/HTTP 重复 + 5 阶段任务分解 (D1-D5) 可直接交接 lite-plan。
**决策影响**: 实施路径从"抽象概念"落为"具体 PR 序列"；v1.1 5 特性的顺序也清晰（doctor → Dashboard → drift-check → migrate → copilot）。
**当前理解**: 可以产出 conclusions.json。
**遗留问题**: Dashboard 生产时静态文件查找路径（tsup copy vs __dirname 查找）— 实施细节，lite-plan 决定即可。

### Intent Drift Check (Round 3)
- ✅ 全部原始意图已在 Round 1-3 覆盖
- ✅ 5 阶段任务分解已产出
- ✅ v1.1 5 特性实施顺序建议已给出

进入 Phase 4 Synthesis。

## Phase 4: Conclusions

### Summary
Fabric 的架构愿景从 v1.0 MVP（stdio MCP + CLI）延伸为 **v1.1 Feature #5** — 由 `fab serve` 启动的**单进程 Express 应用**，在同一端口同时承载 MCP HTTP（per-session 工厂）、Dashboard REST/SSE API、静态 SPA。Dashboard 定位为**项目语义共识层**：基于 pre-commit 三件套数据产物的可视化仲裁工作台，采用**仪式性写入**权限模型。

### Intent Coverage Matrix
| # | Intent | Status | Where |
|---|--------|--------|-------|
| 1 | 架构愿景延伸 | ✅ | Round 1 + 3 |
| 2 | MCP Server 定位 | ✅ | Round 1 |
| 3 | Web Dashboard 角色 | ✅ | Round 1 + 2 |
| 4 | 统一服务系统 | ✅ | Round 1-3 |
| 5 | 与 v1.0/v1.1 关系 | ✅ | Round 2 |

### Findings Coverage Matrix
见 `conclusions.json` `findings_coverage[]` — 19 条发现均已分发至 Recommendation / Deferred / Informational。

### Top Recommendations (7 条)
1. **D1: Shared Schema 迁移** (high) — AgentsMeta / LedgerEntry (discriminated union + source tag) / HumanLockEntry / FabricConfig 上移 @fabric/shared
2. **D2: MCP HTTP + fab serve** (high) — 单 Express app + per-session 工厂 + JsonlEventStore + 默认端口 7373
3. **D3: Dashboard REST API + services/ 中间层** (high) — 5 只读端点 + 2 仪式性写端点 + 错误契约
4. **D4: 实时 SSE + chokidar** (high) — /events + 文件监听 + 事件类型 discriminated union
5. **D5: Preact + Vite SPA 三视图** (high) — 规则树 / 人类仓库 / 意图时间线 + 生产打包
6. **Roadmap & Docs 更新** (medium) — v1.1 Feature 5 + 5 特性实施顺序
7. **可选扩展 E1-E3** (low) — Bearer auth / doctor tab / history replay

### Decision Trail
见 `conclusions.json` `decision_trail[]` — 8 条关键决策横跨 3 轮，形成以"异步仲裁 + 不中断心流"为主线的一致取舍。

### Session Statistics
- **Total Rounds**: 3
- **Agents Invoked**: 2 (cli-explore-agent + workflow-research-agent)
- **Files Deep Read**: 22
- **Key Decisions**: 8
- **Recommendations**: 7
- **Artifacts**: discussion.md / explorations.json / research.json / exploration-codebase.json / conclusions.json


# Analysis: CLI -> MCP Host -> MCP Server -> Agent -> Web Client 闭环交互链路审计

## Table of Contents
- [Session Metadata](#session-metadata)
- [User Intent](#user-intent)
- [Analysis Context](#analysis-context)
- [Current Understanding](#current-understanding)
- [Discussion Timeline](#discussion-timeline)
  - [Round 1: Multi-Perspective Exploration](#round-1-multi-perspective-exploration)
  - [Round 2: Four-Direction Deep Dive](#round-2-four-direction-deep-dive)
- [Initial Intent Coverage Check](#initial-intent-coverage-check)
- [Round 2 Intent Coverage Check](#round-2-intent-coverage-check)

## Session Metadata
- **Session ID**: ANL-cli-mcp-agent-web-audit-2026-04-21
- **Date**: 2026-04-21
- **Topic**: 深度审计 CLI -> MCP Host -> MCP Server -> Agent -> Web Client 闭环交互链路
- **Dimensions**: architecture, implementation, performance
- **Depth**: Deep Dive
- **Perspectives**: Technical, Architectural, Business, Domain Expert

## User Intent
1. 了解当前具体的全流程交互逻辑（CLI -> MCP Host -> MCP Server -> Agent -> Web Client）
2. 组件交互与集成：各组件之间的调用链路和数据流
3. 命令流程优化：命令从发起到响应的完整流程，识别冗余步骤和优化点
4. 设计模式审查：当前架构模式的合理性、耦合度、可扩展性
5. 具体组件命令优化：减少不必要的命令，增加必要的命令，优化现有命令（CLI, MCP Server 等）

## Analysis Context

### Directions
- 组件交互与集成：CLI/MCP Host/MCP Server/Agent/Web Client 之间的调用链路和数据流
- 命令流程优化：命令从发起到响应的完整流程，识别冗余步骤和优化点
- 设计模式审查：当前架构模式的合理性、耦合度、可扩展性
- 具体组件命令优化：减少不必要的命令，增加必要的命令，优化现有命令

### Perspectives
| Perspective | Tool | Focus |
|------------|------|-------|
| Technical | Gemini | 代码实现层面：调用链、数据流、具体实现细节 |
| Architectural | Claude | 系统设计层面：组件交互、耦合关系、扩展性 |
| Business | Codex | 用户体验和产品价值角度评估流程效率 |
| Domain Expert | Gemini | MCP协议与Agent模式的行业最佳实践对比 |

> **Decision**: 选择全部4个视角进行 Deep Dive 分析
> - **Context**: 用户明确要求全面审计闭环链路
> - **Options considered**: 2视角(Technical+Architectural), 4视角
> - **Chosen**: 4视角 — **Reason**: 用户选择了所有视角，且 Deep Dive 深度需要多角度覆盖
> - **Impact**: 将执行 multi-perspective 探索流程（共享 Layer 1 + 4个独立 Layer 2-3 深入分析）

## Current Understanding

### 系统全貌
4 个 monorepo 包构成闭环：CLI(fab) → Server(MCP+HTTP) → Agent(4 tools) → Dashboard(Preact SPA via REST+SSE)。架构设计合理（双传输、L0/L1/L2 分层、共享类型包），核心问题集中在三个方面：

### 已确认问题 → 优化方案

**热路径 I/O 冗余**:
- readAgentsMeta() 同步阻塞 + 无缓存 → **三层缓存 + chokidar 联动** (GetRulesContext/Rule LRU/Audit 滑动窗口)
- audit.jsonl O(n) 全读 → **字节偏移滑动窗口**（复用 events.ts 已有模式）

**MCP 协议利用不完整**:
- 4 工具无 outputSchema → **逐一添加 outputSchema + annotations**（已设计具体 schema）
- AGENTS.md 每次嵌入响应 → **MCP Resource (subscribe:true)** 实现 Agent 端缓存
- fab_plan_context/fab_get_rules n=1 重叠 → **paths.min(2)** + 描述区分
- 合规分数不返回 Agent → **fab_append_intent 返回 compliance 结果**
- MANDATORY 过度使用 → **fab_update_registry 改为条件语言**

**CLI 命令组织**:
- 缺少 update/status 命令 → **新增 `fab update` + `fab status`**
- bootstrap/hooks 隐藏命令 → **merge 入 init/config**
- pre-commit 无快速跳过 → **staged-files scope_glob 匹配**
- config 命令隐藏 → **提升为可见命令**

### 优化路线图
- **Quick Wins (4项)**: async readAgentsMeta + 缓存、audit 滑动窗口、paths.min(2)、MANDATORY 修正
- **Medium (6项)**: outputSchema、/mcp auth、compliance 反馈、pre-commit 优化、SSE Last-Event-ID、fab update
- **Strategic (4项)**: MCP Resources、三层缓存系统、共享 McpServer、notifications/tools/list_changed

## Discussion Timeline

### Round 1: Multi-Perspective Exploration

**Sources**: 4 perspective agents (Technical, Architectural, Business, Domain Expert) + external research (MCP spec)

#### Key Findings

**跨视角一致发现 (High Confidence)**:

| # | Finding | Perspectives | Severity |
|---|---------|-------------|----------|
| 1 | readAgentsMeta() 同步阻塞热路径，无缓存 | Tech + Arch + Biz + Domain | High |
| 2 | SSE 断连丢事件（无 Last-Event-ID） | Tech + Arch + Biz + Research | High |
| 3 | /mcp 端点无认证（FABRIC_AUTH_TOKEN 下） | Tech + Arch | High |
| 4 | 4 工具无 outputSchema | Domain + Research | High |
| 5 | audit.jsonl 无界增长 + O(n) 全读 | Tech + Domain | High |
| 6 | AGENTS.md 应为 MCP Resource（减少重复读取） | Domain + Research | Medium |

**视角独特发现**:

| Perspective | Unique Finding |
|------------|---------------|
| Technical | 每次 fab_get_rules 的 I/O 预算：1 sync + 2+ async + N rule reads + 1 audit write |
| Architectural | Dashboard 定义平行类型而非从 shared 导入（类型漂移风险）|
| Business | 缺少 update/upgrade 命令；drift-check 导航项可见但不可交互；pre-commit 无快速跳过 |
| Domain Expert | MANDATORY 过度使用致信号稀释；合规分数对 Agent 不可见；fab_plan_context/fab_get_rules 在 n=1 时语义重叠 |

#### Decision Log

> **Decision**: 确定 6 个跨视角一致问题 + 4 个视角独特发现作为分析基线
> - **Context**: 4 视角 + 外部研究完成 Round 1 探索
> - **Options considered**: 仅关注高频问题 vs 全面覆盖
> - **Chosen**: 全面覆盖 — **Reason**: Deep Dive 深度要求不遗漏视角独特发现
> - **Impact**: Phase 3 讨论将在此基线上深入

#### Discussion Points for Phase 3
1. readAgentsMeta() 缓存策略：TTL cache vs file-watch invalidation vs revision-hash check
2. MCP resources 采用路径：先 AGENTS.md 还是先 outputSchema
3. /mcp 认证：统一 bearer auth vs MCP 协议层认证
4. CLI 命令优化优先级：update/upgrade vs pre-commit fast-path vs 其他
5. Agent 合规反馈闭环：返回 compliance 结果 vs 保持单向审计

---

### Initial Intent Coverage Check

| # | Original Intent | Status | Coverage |
|---|----------------|--------|----------|
| 1 | 了解全流程交互逻辑 | ✅ Addressed | Round 1 完整映射了 CLI→Server→MCP→Agent→Dashboard 全链路，含调用链、数据流、传输协议 |
| 2 | 组件交互与集成 | ✅ Addressed | 5 个架构边界全部追踪：CLI↔Server, MCP Host↔Server, Server↔Agent, Server↔Dashboard, Shared 中介 |
| 3 | 命令流程优化 | 🔄 In-progress | 已识别热路径瓶颈(readFileSync, audit O(n))和冗余步骤；具体优化方案待深入讨论 |
| 4 | 设计模式审查 | ✅ Addressed | 双传输、per-session 实例、process.env 全局注入、L0/L1/L2 分层等模式已审查，合理性/耦合度/扩展性均有评估 |
| 5 | 具体组件命令优化 | 🔄 In-progress | MCP Server: 已识别 outputSchema 缺失、MANDATORY 过度使用、tools overlap；CLI: 已识别缺少 update/upgrade、pre-commit 优化。需深入讨论具体增/删/改方案 |

---

### Round 2: Four-Direction Deep Dive

**起点**: 基于 Round 1 的 6 个跨视角一致问题和 4 个独特发现，本轮从用户选择的全部 4 个方向切入：MCP 工具优化、CLI 命令审计、热路径缓存、全链路端到端优化。

---

#### Direction A: MCP 工具优化方案

##### fab_get_rules — 核心规则查询工具

**当前问题**:
- 描述过于简略："MANDATORY: Call before modifying any file to retrieve Fabric rules for a target path."
- 无 outputSchema — Agent 接收 JSON.stringify 文本，需盲猜结构
- `path` 参数无格式约束（相对/绝对路径歧义）
- 无 annotations（readOnlyHint 等）

**优化方案**:

> **Solution**: 增强 fab_get_rules 工具定义
> - **Status**: Proposed
> - **Problem**: Agent 无法获知返回结构，每次需推断 JSON 格式；描述缺乏使用指导
> - **Rationale**: MCP 2025-06-18 outputSchema + annotations 是标准最佳实践
> - **Evidence**: `packages/server/src/tools/get-rules.ts:27-38`, `packages/server/src/services/get-rules.ts:36` (GetRulesResult 类型)
> - **Proposed description**: "REQUIRED before modifying any file. Returns L0/L1/L2 layered Fabric rules for a target path. Pass `client_hash` from a prior response to detect stale rules without re-reading full payload. Path must be relative to project root (e.g., `src/auth/login.ts`)."
> - **Proposed outputSchema**: `{revision_hash: string, stale: boolean, rules: {L0: string, L1: [{path, content}], L2: [{path, content}], human_locked_nearby: [{file, excerpt}]}}`
> - **Proposed annotations**: `{readOnlyHint: true, openWorldHint: false}`

##### fab_plan_context — 批量规则查询

**当前问题**:
- `paths.min(1)` 与 fab_get_rules 在 n=1 时语义完全重叠
- Agent 无明确指导何时用哪个工具

**优化方案**:

> **Solution**: 消除 fab_get_rules/fab_plan_context 语义重叠
> - **Status**: Proposed
> - **Alternatives**:
>   - A) paths.min(2) + 描述明确区分 → 简单，保留两个工具
>   - B) 合并为一个工具 fab_get_rules 接受 `path: string | string[]` → 减少工具数，但改变 API
>   - C) 保持现状 + 仅优化描述 → 最小变更
> - **Recommended**: A — `paths.min(2)` + 描述增加 "Use fab_get_rules for single-file queries; use fab_plan_context for 2+ files during planning phases."
> - **Evidence**: `packages/server/src/tools/plan-context.ts:8-11`

##### fab_append_intent — 意图记录工具

**当前问题**:
- compliance result 存储在 audit.jsonl 但不返回给 Agent
- 使用 `aiLedgerEntrySchema.omit()` 作为 MCP 输入 — 内部 schema 泄漏到协议边界

**优化方案**:

> **Solution**: 合规反馈闭环 + 独立输入 schema
> - **Status**: Proposed
> - **Problem**: Agent 被审计但无法自我纠正（单向审计镜）
> - **Changes**:
>   1. 在 appendIntent 返回值中增加 `compliance: {compliant: boolean, matched_get_rules_ts: number|null, window_ms: number}` — 零额外成本（audit-log.ts L52-88 已计算）
>   2. 定义独立的 MCP 输入 schema 替代 aiLedgerEntrySchema.omit()
>   3. 添加 outputSchema
> - **Evidence**: `packages/server/src/services/audit-log.ts:52-88` (compliance 已计算但未返回), `packages/server/src/tools/append-intent.ts:14-18`

##### fab_update_registry — 注册表变更工具

**当前问题**:
- MANDATORY 但实际是条件性的（仅当 Agent 需要增删改注册表节点时）
- `data: z.record(z.unknown())` 完全无类型 — Agent 靠猜测

**优化方案**:

> **Solution**: 修正描述 + 类型化 data 字段
> - **Status**: Proposed
> - **Changes**:
>   1. 描述改为: "Call to add, remove, or update Fabric registry nodes. Use instead of editing .fabric/agents.meta.json directly. Required only when managing rule nodes."
>   2. data 字段类型化: `{file: string, scope_glob: string, deps?: string[], priority?: "high"|"medium"|"low"}`
>   3. 添加 `annotations: {destructiveHint: true, readOnlyHint: false}`
> - **Evidence**: `packages/server/src/tools/update-registry.ts:15-18`, `packages/shared/src/schemas/agents-meta.ts` (AgentsMetaNode 结构)

---

#### Direction B: CLI 命令增删审计

##### 现有 11 命令评估

| # | Command | Visibility | Frequency | Recommendation | Rationale |
|---|---------|-----------|-----------|---------------|-----------|
| 1 | `init` | visible | one-time | **OPTIMIZE** | 添加 `--partial` 支持部分重初始化（仅刷新 MCP config 或仅刷新 hooks），现有 abort-on-existing 改为 merge-or-skip |
| 2 | `scan` | visible | rare | **KEEP** | 框架检测，低频但有价值 |
| 3 | `serve` | visible | daily | **OPTIMIZE** | 添加 `--auth-token` CLI flag（不仅依赖 env var）；非 loopback host 降级时给出明确指导 |
| 4 | `doctor` | visible | on-demand | **KEEP** | 健康检查 + 审计，功能完整 |
| 5 | `sync-meta` | visible | per-commit | **KEEP** | 核心功能，无冗余 |
| 6 | `human-lint` | visible | per-commit | **KEEP** | 核心功能，无冗余 |
| 7 | `ledger-append` | visible | per-commit | **REVIEW** | 主要由 pre-commit 内部调用，用户直接使用场景少。考虑降级为 hidden |
| 8 | `pre-commit` | visible | per-commit | **OPTIMIZE** | 添加快速跳过：检测 staged files 是否包含 fabric-managed 文件（匹配 scope_glob），无匹配则跳过全部检查 |
| 9 | `bootstrap` | hidden | one-time | **MERGE** | 已被 init 内部调用，独立存在无意义 → 合并入 init |
| 10 | `config` | hidden | setup | **PROMOTE** | MCP 配置管理应为可见命令（`fab config mcp-install` 等） |
| 11 | `hooks` | hidden | setup | **MERGE into config** | hooks 管理归入 config 子命令：`fab config hooks` |

##### 建议新增命令

| Command | Description | Rationale | Rough Design |
|---------|-------------|-----------|-------------|
| `fab update` | 版本升级后刷新 MCP configs + hooks | 用户 `npm update` 后无法自动刷新 MCP host 配置 | 复用 init 的 MCP install + hooks 阶段，跳过文件创建阶段；对比当前配置与模板差异后合并 |
| `fab status` | 显示当前 fabric 状态 | 用户缺少快速了解系统状态的途径 | 显示: revision hash, node count, last audit timestamp, SSE client count (if serve running), compliance rate |

##### Pre-commit 快速跳过优化

> **Solution**: pre-commit 增加 staged-files 快速匹配
> - **Status**: Proposed
> - **Problem**: 每次 git commit 都运行 3 个检查（sync-meta --check-only, human-lint, ledger-append），即使提交不涉及任何 fabric-managed 文件
> - **Design**: 在 pre-commit.ts 开头增加: `git diff --cached --name-only` → 匹配 scope_glob → 无匹配则 exit 0
> - **Estimated savings**: 非 fabric 提交从 ~500ms → ~50ms
> - **Evidence**: `packages/cli/src/commands/pre-commit.ts:34-51`（串行执行 3 个命令）

---

#### Direction C: 热路径缓存架构

##### 当前 I/O 预算（每次 fab_get_rules）

```
1. readAgentsMeta()     → readFileSync (SYNC, 阻塞) + JSON.parse + zod.parse    ~2-5ms
2. readFile(AGENTS.md)  → async                                                  ~1-2ms
3. readHumanLock()      → readFile + N×hash (每个 locked file)                    ~2-10ms
4. N×readFile(rules)    → Promise.all (每个匹配的 rule 文件)                       ~1-5ms ×N
5. appendAuditEvent     → appendFile (best-effort)                                ~1ms
Total: ~7-23ms per call (不含 rule 文件数 N)
```

10 文件编辑周期 = 10 × (步骤 1-5) = 70-230ms 仅在 I/O 上，其中步骤 1-3 的数据在周期内完全不变。

##### 缓存分层设计

> **Solution**: 三层缓存 + chokidar 联动失效
> - **Status**: Proposed
> - **Design**:
>
> **Layer 1 — GetRulesContext 缓存**（最高收益）
> - 缓存 `{meta, l0Content, humanLockedNearby}` 整体（即 loadGetRulesContext 返回值）
> - 失效条件: chokidar 检测到 agents.meta.json / AGENTS.md / human-lock.json 任一变更
> - 位置: 服务器级别（非 per-session），因为所有 session 共享同一项目状态
> - 预期收益: 消除步骤 1-3 的冗余 I/O，10 次调用从 10×(2+1+2)ms → 1×5ms + 9×0ms
>
> **Layer 2 — Rule 文件内容缓存**（中等收益）
> - LRU Map 缓存 `{path → {content, mtime}}`
> - 失效条件: file mtime 变更（每次 readFile 前 stat 检查，或 chokidar watch .fabric/agents/ 目录）
> - 预期收益: 多次查询相同 rule 文件时避免重复读取
>
> **Layer 3 — Audit 滑动窗口**（解决 O(n) 问题）
> - audit.jsonl 不再全量读取，改为只读取最后 N 字节（基于 5 分钟窗口估算的最大条目数）
> - 复用 events.ts 中 readLedgerAppendedEvents 的字节偏移模式
> - 预期收益: audit.jsonl 增长不再影响 fab_append_intent 性能
>
> **实现路径**:
> 1. 将 readAgentsMeta() 从 readFileSync 改为 async readFile（所有调用点已在 async 上下文中）
> 2. 在 createFabricHttpApp() 中初始化 chokidar watcher（复用 events.ts 已有的 watcher 或共享）
> 3. 创建 `ContextCache` 类管理三层缓存 + 失效逻辑
> 4. loadGetRulesContext() 改为先查缓存再 fallback 到文件读取
>
> **与 per-session McpServer 的交互**: 缓存在 HTTP app 级别（closure scope），所有 session 共享。update_registry 写入后主动 invalidate Layer 1。

---

#### Direction D: 全链路端到端优化路线图

##### Agent 编辑周期时序

```
T0  Agent decides to edit src/foo.ts
T1  Agent calls fab_get_rules("src/foo.ts")
    ├─ readAgentsMeta [sync 2-5ms]
    ├─ readFile AGENTS.md [async 1-2ms]
    ├─ readHumanLock [async 2-10ms]
    ├─ N×readFile rules [async 1-5ms ×N]
    └─ appendAuditEvent [async ~1ms]
T2  Server returns rules [total: 7-23ms]
T3  Agent processes rules, edits file [Agent-side, ~seconds]
T4  Agent calls fab_append_intent
    ├─ readAuditLog FULL [async, grows O(n)]
    ├─ cross-reference per affected_path
    └─ appendFile intent + audit entries
T5  Server returns {success, timestamp}

SSE side-channel (parallel):
T3' chokidar detects file change [120ms awaitWriteFinish]
T4' debounce [75ms]
T5' broadcast to dashboard SSE clients
T6' Dashboard updates UI
Total SSE latency: ~195ms from file write to UI update
```

##### 优化路线图

**Quick Wins (< 1 day each)**:

| # | What | Why | Impact | File |
|---|------|-----|--------|------|
| Q1 | readAgentsMeta 改 async + 进程内缓存 | 消除热路径阻塞 | 每次工具调用 -3ms，10 文件周期 -30ms | `meta-reader.ts` |
| Q2 | audit.jsonl 滑动窗口读取 | 消除 O(n) 全读 | fab_append_intent 从 O(n) → O(1) | `audit-log.ts` |
| Q3 | fab_plan_context paths.min(2) | 消除工具语义重叠 | 减少 Agent 选择困难 | `plan-context.ts:9` |
| Q4 | fab_update_registry MANDATORY→conditional | 减少信号稀释 | 提升工具描述可信度 | `update-registry.ts:34` |

**Medium Efforts (1-3 days)**:

| # | What | Why | Impact | File(s) |
|---|------|-----|--------|---------|
| M1 | 4 工具全部添加 outputSchema | MCP 2025-06-18 合规 | Agent 结构化解析，减少 token 浪费 | `tools/*.ts` |
| M2 | /mcp 端点添加 bearer auth | 安全对称 | 消除认证漏洞 | `http.ts:131-135` |
| M3 | fab_append_intent 返回 compliance | 合规反馈闭环 | Agent 可自我纠正 | `append-intent.ts`, `audit-log.ts` |
| M4 | pre-commit 快速跳过 | 非 fabric 提交加速 | ~500ms → ~50ms | `pre-commit.ts` |
| M5 | Dashboard SSE Last-Event-ID | 断连事件恢复 | 消除事件丢失 | `use-events.ts`, `events.ts` |
| M6 | `fab update` 命令 | 版本升级自动化 | 用户无需手动刷新 MCP 配置 | 新文件 |

**Strategic (1+ week)**:

| # | What | Why | Impact | Complexity |
|---|------|-----|--------|-----------|
| S1 | AGENTS.md 作为 MCP Resource (subscribe:true) | Agent 端缓存 L0 规则 | 每次 fab_get_rules 响应减少 L0 内容 payload | 需修改 createFabricServer 注册 resources |
| S2 | 三层缓存 + chokidar 联动 | 系统性消除冗余 I/O | 10 文件周期从 70-230ms → ~15ms | 新增 ContextCache 类 |
| S3 | 共享 McpServer 实例 | 消除 per-session 工具重注册 | 减少内存和初始化开销 | 需重构 session 管理 |
| S4 | sync-meta 后发送 notifications/tools/list_changed | MCP 协议合规 | Agent 自动刷新工具列表 | 需在 CLI→Server 间建立通知通道 |

---

#### Round 2: Narrative Synthesis

**起点**: 基于 Round 1 的问题基线，本轮从 4 个方向全面深入，目标是产出具体可执行的优化方案。

**关键进展**:
1. MCP 工具优化：为 4 个工具各提出了具体的 description 重写、outputSchema 设计、annotations 添加方案
2. CLI 命令审计：完成 11 命令逐一评估，建议 merge 2 个 (bootstrap→init, hooks→config)、新增 2 个 (update, status)、优化 3 个 (init, serve, pre-commit)、promote 1 个 (config)
3. 缓存架构：设计了三层缓存方案 (GetRulesContext 缓存 + Rule 文件 LRU + Audit 滑动窗口)
4. 全链路优化：产出按 effort/impact 分级的路线图 (4 Quick Wins + 6 Medium + 4 Strategic)

**当前理解**: 系统架构设计合理（双传输、分层规则、共享类型），主要问题集中在：(a) 热路径 I/O 冗余（无缓存），(b) MCP 协议利用不完整（缺 outputSchema/resources/notifications），(c) CLI 命令组织可优化（隐藏命令应提升/合并，缺少 update/status）。

**遗留问题**: 优化路线图中的优先级排序需用户确认。

---

### Round 2 Intent Coverage Check

| # | Original Intent | Status | Coverage |
|---|----------------|--------|----------|
| 1 | 了解全流程交互逻辑 | ✅ Addressed | Round 1 完成，Round 2 补充了详细时序分析 |
| 2 | 组件交互与集成 | ✅ Addressed | Round 1 完成 |
| 3 | 命令流程优化 | ✅ Addressed | Round 2 Direction D: 全链路时序分析 + 分级优化路线图 |
| 4 | 设计模式审查 | ✅ Addressed | Round 1 完成，Round 2 Direction C 补充缓存架构设计 |
| 5 | 具体组件命令优化 | ✅ Addressed | Round 2 Direction A: 4 个 MCP 工具逐一优化方案；Direction B: 11 个 CLI 命令逐一评估 + 2 个新增建议 |

---

## Conclusions

### Summary
对 PCF (fabric) 项目的闭环链路进行了 2 轮 4 视角 Deep Dive 审计。架构设计合理，主要优化空间在热路径 I/O、MCP 协议利用、CLI 命令组织三方面。共 14 项建议。

### Key Conclusions (按置信度排序)

1. **[High]** 热路径 I/O 是 #1 性能瓶颈 — readAgentsMeta() sync + 无缓存，10 文件周期 30 次冗余读取
2. **[High]** 4 个 MCP 工具无 outputSchema — Agent 解析 JSON 文本浪费 token，违反 MCP 2025-06-18 最佳实践
3. **[High]** 合规审计单向 — Agent 被审计但无法获知结果，无法自我纠正
4. **[High]** /mcp 端点安全缺口 — FABRIC_AUTH_TOKEN 下 /api+/events 受保护但 /mcp 不受保护
5. **[High]** audit.jsonl O(n) 无界增长 — 每次 fab_append_intent 全量读取
6. **[High]** fab_plan_context/fab_get_rules n=1 语义重叠
7. **[High]** CLI 缺少 update 命令 — 版本升级后无法自动刷新 MCP 配置
8. **[High]** pre-commit 无快速跳过 — 非 fabric 提交约 500ms 可优化至 ~50ms
9. **[High]** SSE 断连丢事件 — 无 Last-Event-ID + EventSource 无法传 Auth header

### Prioritized Recommendations

**High Priority (Quick Wins)**:
1. readAgentsMeta async + 缓存 → -30ms/10-file-cycle
2. audit.jsonl 滑动窗口 → O(n)→O(1)
3. 4 工具 outputSchema + annotations → MCP 合规 + token 节省
4. /mcp bearer auth → 安全闭合
5. fab_append_intent 返回 compliance → 合规闭环

**Medium Priority**:
6. paths.min(2) 消除工具重叠
7. fab_update_registry 描述修正 + data 类型化
8. pre-commit 快速跳过
9. SSE Last-Event-ID
10. fab update 命令
11. CLI 命令重组 (promote config, merge bootstrap/hooks)

**Low Priority (Strategic)**:
12. AGENTS.md 作为 MCP Resource
13. 三层缓存系统
14. notifications/tools/list_changed

### Findings Coverage Matrix

| # | Finding (Round) | Disposition | Target |
|---|----------------|-------------|--------|
| 1 | readAgentsMeta sync 热路径 (R1) | recommendation | Rec #1 |
| 2 | audit.jsonl O(n) 全读 (R1) | recommendation | Rec #2 |
| 3 | 4 工具无 outputSchema (R1) | recommendation | Rec #3 |
| 4 | /mcp 无认证 (R1) | recommendation | Rec #4 |
| 5 | 合规审计单向 (R1) | recommendation | Rec #5 |
| 6 | tools n=1 重叠 (R1) | recommendation | Rec #6 |
| 7 | MANDATORY 过度使用 (R1) | recommendation | Rec #7 |
| 8 | 缺少 update 命令 (R1) | recommendation | Rec #10 |
| 9 | pre-commit 无快跳 (R1) | recommendation | Rec #8 |
| 10 | SSE Last-Event-ID (R1) | recommendation | Rec #9 |
| 11 | AGENTS.md→Resource (R1) | recommendation | Rec #12 |
| 12 | Dashboard 平行类型 (R1) | deferred | 低优先级 |
| 13 | drift-check 死导航 (R1) | deferred | UI polish |
| 14 | Gemini CLI 检测 (R1) | deferred | 边缘场景 |
| 15 | process.env 全局突变 (R1) | informational | 已知设计取舍 |
| 16 | JsonlEventStore O(n) (R1) | absorbed | → Rec #13 |
| 17 | per-session McpServer (R1) | informational | open question |

### Session Statistics
- **Rounds**: 2
- **Perspectives**: 4 (Technical, Architectural, Business, Domain Expert)
- **External research**: MCP protocol spec (6 sources)
- **Files analyzed**: 32 relevant files across 4 packages
- **Decisions recorded**: 3
- **Recommendations**: 14 (5 high, 6 medium, 3 low)
- **Full report**: `.workflow/.analysis/ANL-cli-mcp-agent-web-audit-2026-04-21/discussion.md`

# 从 maestro-flow 借鉴分析：16 项 REJECT（不实施）及理由

本文档记录 23 项候选借鉴点中 16 项被拒绝实施的条目，每项附代码级证据和架构理由。
完整分析见 `feature/maestro-borrow` 分支的 7 项 ADOPT 实施（PR #33）。

---

## 架构设计原则（判定基准）

fabric-v2 的 8 条设计原则是拒绝判定的核心依据：

| # | 原则 | 含义 |
|---|------|------|
| P1 | store-only | 知识只存在于 store，无项目 co-location 回退 |
| P2 | body-on-demand | 正文按需加载，不预载全文 |
| P3 | never-block | 任何操作不阻塞主流程 |
| P4 | minimal-install | 零配置安装，不引入重依赖 |
| P5 | dual-sink injection | SessionStart + PreToolUse 双通道注入 |
| P6 | clean-slate | 不保留/不迁移 legacy |
| P7 | honesty iron law | 宁可少报也不虚报 |
| P8 | agent-native | 为 AI agent 设计，非人类 UI |

---

## REJECT 清单

### A-INFRA-1: 向量检索（Embedding）

**来源**: maestro-flow `WikiIndexer` 的 ONNX all-MiniLM-L6-v2 embedding

**拒绝理由**: P4 (minimal-install) + P3 (never-block)

**代码证据**:
- `packages/server/src/services/vector-retrieval.ts` — 已实现但作为 **可选** 通道（`embed_enabled` 配置），默认关闭
- `packages/server/src/config-loader.ts` — `readEmbedConfig()` 返回 `{ enabled: false }` 默认值
- 向量依赖 `@xenova/transformers`（~50MB ONNX 模型）违反零依赖原则
- BM25F 文本检索（`packages/server/src/services/bm25.ts`）已覆盖内容相关性，无需向量

**判定**: REJECT — 向量作为可选增强保留，不作为默认/唯一通道

---

### A-INFRA-2: 知识图谱（MaestroGraph）

**来源**: maestro-flow `MaestroGraph` — SQLite+FTS5 存储 + 跨源边解析（defines/constrains/documents）

**拒绝理由**: P1 (store-only) + P8 (agent-native)

**代码证据**:
- fabric 的"图谱"是 `include_related` 的 frontmatter `related` 字段 1-hop 展开（`packages/server/src/services/plan-context.ts:462-488`）
- 不需要 SQLite/FTS5 — markdown frontmatter 是 agent-native 的数据结构
- `cross-store-recall.ts` 的 store 遍历 + BM25F 已覆盖跨源检索
- SQLite 引入持久化状态和迁移负担，违反 P4

**判定**: REJECT — frontmatter `related` + 1-hop 展开已满足 agent 场景，不引入图数据库

---

### A-INFRA-3: WikiIndexer 全文索引

**来源**: maestro-flow `WikiIndexer` — BM25F + ONNX embedding + 增量同步

**拒绝理由**: P1 (store-only) + P6 (clean-slate)

**代码证据**:
- fabric 的"索引"是每次 `planContext` 调用时对候选集（tens of entries）的即时 BM25F 建模（`bm25.ts:buildBm25Model()`）
- 候选集小（top_k ~30），无需持久化索引
- `bm25.ts` 的 `serializeBm25Model` / `rehydrateBm25Model` 提供跨调用缓存（`plan-context.ts` 的 `getOrBuildBm25Model`），但不引入独立索引服务
- maestro-flow 的增量同步（watch 文件变更）在 fabric 中无对应场景 — 知识写入走 `fab_propose → fab_review approve` 显式流程

**判定**: REJECT — 即时 BM25F 建模 + 可选缓存已覆盖，不引入持久化索引

---

### A-INFRA-4: 多源事件溯源（Event Sourcing）

**来源**: maestro-flow 的完整 event sourcing 架构

**拒绝理由**: P3 (never-block) + P4 (minimal-install)

**代码证据**:
- fabric 的 `events.jsonl`（`packages/server/src/services/event-ledger.ts`）是追加日志，非事件溯源
- `metrics.jsonl`（`packages/server/src/services/metrics.ts`）是计数器聚合，非事件流
- 事件溯源需要 CQRS + 投影重建，违反 P4
- fabric 的"真相源"是 store 中的 markdown 文件本身，事件日志只是可观测性辅助

**判定**: REJECT — 追加日志 + 计数器已满足可观测性需求

---

### A-INFRA-5: 跨源边解析（Cross-source Edge Resolution）

**来源**: maestro-flow 的 `defines/constrains/documents` 三类边 + 跨源自动连接

**拒绝理由**: P8 (agent-native) + P7 (honesty)

**代码证据**:
- fabric 的 `related` 字段是**显式声明**（人工/AI 写入 frontmatter），不是自动推断
- 自动边解析会产生虚假连接（误报），违反 P7 honesty iron law
- agent 场景下 LLM 自己判断关联性比预计算边更准确
- `plan-context.ts:462-488` 的 `include_related` 只展开显式声明的边

**判定**: REJECT — 显式 `related` 声明优于自动推断，不引入边解析引擎

---

### A-INFRA-6: 向量 Embedding 缓存

**来源**: maestro-flow 的 ONNX embedding 预计算 + 缓存

**拒绝理由**: P4 (minimal-install) — 与 A-INFRA-1 同根

**代码证据**:
- `packages/server/src/services/vector-retrieval.ts` — embed 缓存目录 `~/.fabric/cache/embed/`
- 仅当 `embed_enabled: true` 时使用，默认关闭
- 预计算所有条目的 embedding 需要遍历全量 store 条目，违反 body-on-demand (P2)

**判定**: REJECT — 作为可选功能保留但默认不启用

---

### C1: 知识成熟度自动升级

**来源**: maestro-flow 的 `maturity` 自动推进（draft → verified → proven）

**拒绝理由**: P7 (honesty) + P8 (agent-native)

**代码证据**:
- fabric 的 `maturity` 是**人工审核**字段（`packages/server/src/services/review.ts` 的 approve 流程设置）
- `doctor-knowledge-promotion.ts` 只**建议**升级候选（基于 `related` 入度），不自动执行
- 自动升级会虚假提升未经验证的条目，违反 P7
- 决策记录 `KT-DEC-0008` 明确 maturity 由 human-in-loop 判定

**判定**: REJECT — maturity 保持人工判定，promotion 只做建议不做自动

---

### C2: 全文内容 Embedding 向量检索

**来源**: maestro-flow 的 `WikiIndexer` embedding 全文检索

**拒绝理由**: P2 (body-on-demand) + P4 (minimal-install)

**代码证据**:
- fabric 的 body-on-demand 模型：`fab_plan_context` 返回摘要索引，`fab_get_knowledge_sections` 才加载正文
- 全文 embedding 要求预加载所有正文，违反 P2
- `bm25.ts` 的 BM25F 在摘要/标签/标题字段上评分（不碰正文），与 body-on-demand 一致

**判定**: REJECT — BM25F 在摘要层评分已足够，全文向量违反 body-on-demand

---

### C3: Salience 权重自动调整

**来源**: maestro-flow 的 salience 动态权重（基于使用频率自动调整）

**拒绝理由**: P7 (honesty) + P8 (agent-native)

**代码证据**:
- fabric 的 salience 是**静态** maturity 映射：`proven=15, verified=8, draft=0`（`plan-context.ts:1265-1267`）
- 使用频率自动调整会产生正反馈循环（热门条目越来越热），违反 P7
- agent 场景下 LLM 根据 intent 判断相关性，不需要预计算权重
- `doctor-consumption-lint.ts`（BORROW-005）提供消费频率**可观测性**，但不自动调整权重

**判定**: REJECT — 静态 maturity 权重 + 消费频率可观测性，不自动调整

---

### D1: 三端交互内集成（MCP + Hook + Skill 统一配置）

**来源**: maestro-flow 的统一配置层

**拒绝理由**: P5 (dual-sink injection) — fabric 已有更优解

**代码证据**:
- fabric 的 `fabric install` 自动生成三端 hook（`.claude/hooks/`, `.codex/hooks/`, `.cursor/hooks/`）
- `doctor-hooks-lints.ts` 验证三端 hook 存在性 + 内容一致性
- `doctor-bootstrap-lints.ts` 验证 L1/L2 managed block 字节级一致性
- 三端交互通过 `AGENTS.md` bootstrap 统一，不需要额外配置层

**判定**: REJECT — fabric install + bootstrap 已实现三端统一，不需要额外抽象

---

### D2: MCP-first 架构（所有操作走 MCP）

**来源**: maestro-flow 的 MCP-first 设计

**拒绝理由**: P5 (dual-sink) — fabric 的 hook 注入是更轻量的方案

**代码证据**:
- fabric 的 SessionStart hook 在会话启动时注入知识上下文（零网络调用）
- PreToolUse hook 在编辑文件前注入窄域提示
- MCP 工具（`fab_plan_context`, `fab_get_knowledge_sections`）是 AI 主动调用，不是被动推送
- hook 注入 + MCP 工具互补，不是 MCP-only

**判定**: REJECT — hook + MCP 双通道优于 MCP-only

---

### D3: 知识生命周期治理（Lifecycle Governance）

**来源**: maestro-flow 的完整 lifecycle 状态机

**拒绝理由**: P6 (clean-slate) + P8 (agent-native)

**代码证据**:
- fabric 的 lifecycle 是简化的：`draft → verified → proven`（`packages/shared/src/schemas/api-contracts.ts`）
- `doctor-knowledge-age.ts` 的 orphan_demote / stale_archive 处理衰减
- 不需要完整状态机 — agent 场景下知识条目的生命周期是"写 → 用 → 衰减 → 归档"，不是"创建 → 审核 → 发布 → 修订 → 废弃"

**判定**: REJECT — 简化三态 + 衰减 lint 已覆盖，不引入完整 lifecycle 状态机

---

### D4: AI-in-loop 质量闭环

**来源**: maestro-flow 的 AI 自动审核 + 质量评分

**拒绝理由**: P7 (honesty) + P8 (agent-native)

**代码证据**:
- fabric 的 `fabric-review` skill 是 AI **辅助**审核（human-in-loop），不是 AI 自动审核
- `summary-cold-eval.ts` 的零上下文冷评是质量**可观测性**，不自动修改
- AI 自动审核会产生幻觉确认，违反 P7
- `doctor-knowledge-review-recheck.ts` 的 recheck nudge 是提醒人工复查，不是自动重审

**判定**: REJECT — human-in-loop 审核 + AI 辅助，不引入 AI 自动闭环

---

### D5: 多语言管道（i18n Pipeline）

**来源**: maestro-flow 的多语言知识翻译管道

**拒绝理由**: P4 (minimal-install) + P8 (agent-native)

**代码证据**:
- fabric 的 i18n 仅覆盖 CLI 界面文案（`packages/cli/src/i18n.ts` + locale JSON）
- 知识条目本身是 agent 消费的，LLM 自带多语言理解能力
- 翻译管道引入额外复杂度和维护负担

**判定**: REJECT — CLI i18n 已足够，知识条目不需要翻译管道

---

### D6: 知识版本控制（Knowledge Versioning）

**来源**: maestro-flow 的知识条目版本历史

**拒绝理由**: P1 (store-only) + P4 (minimal-install)

**代码证据**:
- fabric 的 store 是 git 仓库（`storeGitRemote` / `fabric store sync`），git 本身就是版本控制
- `events.jsonl` 记录每次变更事件（`knowledge_promoted`, `knowledge_demoted` 等）
- 不需要额外的版本层 — git history + event ledger 已覆盖

**判定**: REJECT — git + event ledger 已提供足够的版本追溯

---

### D7: 交互层 store 边界可视化

**来源**: maestro-flow 的 store 边界在 UI 中显式展示

**拒绝理由**: P8 (agent-native) — fabric 无人类 UI

**代码证据**:
- fabric 是 CLI + MCP 工具，无 Web UI
- store 边界通过 `fabric store list` / `fabric info scope` 展示
- MCP 工具返回的 `candidates` 已包含 store 来源信息（store-qualified id: `alias:stable_id`）
- 不需要额外的可视化层

**判定**: REJECT — CLI + MCP 输出已展示 store 边界，无人类 UI 需求

---

## 汇总

| 类别 | ADOPT | REJECT | 总计 |
|------|-------|--------|------|
| 基础设施 (A-INFRA) | 0 | 6 | 6 |
| 内容增强 (C) | 4 | 3 | 7 |
| 架构设计 (D) | 3 | 7 | 10 |
| **总计** | **7** | **16** | **23** |

所有 REJECT 判定均基于 fabric-v2 的 8 条设计原则 + 代码级证据，非主观偏好。

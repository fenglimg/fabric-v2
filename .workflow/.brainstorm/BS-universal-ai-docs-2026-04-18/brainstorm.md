# 🧠 Brainstorm: 跨 AI 客户端完美项目文档管理方案

**Session ID**: `BS-universal-ai-docs-2026-04-18`
**Started**: 2026-04-18
**Mode**: balanced（用户允许激进方案，整体偏 creative）
**Depth**: 深入（1-2 小时多轮迭代）

---

## 🌱 Seed（原始想法）

源自 `思路.md`：AGENTS.md + `docs/` 双层文档架构，通过"硬约束常驻 + 详细索引按需加载"管理项目上下文，兼容 60k+ 项目采纳的 AGENTS.md 开放标准。Claude Code 侧通过 PostToolUse/Stop hook 强制触发 `agents-md` skill。

**但用户希望突破**：设计一套**跨所有 AI 客户端（Cursor / Claude Code / Windsurf / GitHub Copilot / Roo Code / Codex / Gemini CLI）**更普适、更智能的完美方案。

---

## 🎯 Scoping（用户定向）

| 维度 | 用户选择 |
|------|---------|
| **Focus** | 全选 4 项：① 跨客户端兼容协议+schema ② 自动化与同步 ③ 上下文调度智能 ④ 治理与演进 |
| **Depth** | 深入（1-2h） |
| **Constraints** | 向后兼容 AGENTS.md 开放标准；允许激进方案（向量库/LSP/MCP 均可） |

### 用户追加的三个核心顾虑
1. **🔌 接入路径**：如何把方案平滑接入现有项目（案例：`werewolf-minigame`）
2. **🤝 人机文档融合**：人类已有的规范（README/PR 模板/规范文档）与 AI 文档是合并、双轨，还是单一源？
3. **📖 人 AI 双友好**：同一份文档既要对人类像项目规范那样易读，又要让 AI 可以快速定位、理解需求

---

## 🧭 Dimensions

- **technical** — 协议设计、文件格式、加载机制
- **ux** — 人/AI 双读者的阅读体验
- **innovation** — 超越 AGENTS.md 的范式
- **feasibility** — 在各家 AI 客户端真正可用
- **scalability** — 大型项目/Monorepo
- **governance** — 版本、腐烂、冲突、审计

## 👥 Roles Selected（Phase 2 视角）

- **Creative (Gemini 3.1 Pro)** — 跨域借鉴、激进范式、反直觉设计
- **Pragmatic (Claude)** — 在 Cursor/Copilot/Windsurf 真正落地的可行性、最小可行路径
- **Systematic (cli-explore-agent)** — 本项目结构/已有资产，接入现有项目的工程化路径

---

## 🌌 Exploration Vectors（Gemini 3.1 Pro 产出）

| ID | 向量名 | 核心反直觉问题 | 对立设计选项 |
|----|--------|---------------|--------------|
| **v1** | 跨端协议与 Schema 降级 | 若完全放弃静态适配文件，改用 MCP Server 作为唯一动态知识网关？ | (a) 动态 MCP Server vs (b) 静态多态清单编译（一份源文件 → 多端软链接） |
| **v2** | 人机文档关系与编译范式 | 若人类文档和 AI 文档**不必是同一份文件**？采用"文档即代码"的编译范式。 | (a) 单一源内嵌 AI 专属 XML 标签 vs (b) Human.md → CI Compiler → `.ai/compiled_rules.json` |
| **v3** | 幽灵上下文与 Token 预算 | 不依赖 AI 自己 read_file，而由 LSP/文件监视器按光标位置作为**幽灵诊断**自动注入？ | (a) AGENTS.md 显式路由树（AI 自主按需读） vs (b) 环境感知自动注入（拦截器按扩展名/路径动态拼接） |
| **v4** | 系统级解耦与无 Hook 自动化 | 把同步驱动力从 AI 工具中**彻底剥离**，改由 FS Watcher / Git hook / headless daemon 承担？ | (a) 独立 CLI 守护进程（AST 监听自动重构索引） vs (b) 约定 AI 必须调用 `npm run sync:docs` |
| **v5** | 文档腐烂检测与防篡改治理 | 文档拥有强制 **TTL + 关联哈希**，代码漂移时自动标记"已污染"强制 AI 读源码？ | (a) AST/Hash 硬链接追踪 vs (b) LLM 驱动周期性审计 CI（自动提修复 PR） |
| **v6** | 存量项目无痛侵入 | 对原代码库**完全隐身**——所有 AI 治理资产放在隔离目录或全局配置？ | (a) 渐进式影子工作区 `.ai/`（软链接指向旧文档） vs (b) 外挂式全局知识库（按路径匹配，零侵入） |
| **v7** | 硬约束的绝对执行力 | 不再相信 Prompt 约束力——引入"**验证即约束**"：AI 生成的代码必须通过规则沙盒/Linter 才能落盘？ | (a) 强提示词前置注入（高权重 XML 锁顶） vs (b) 后置验证拦截器（Git hook/本地校验 + 自动回滚） |
| **v8** | 跨端状态流转与事件溯源记忆 | 状态记忆不是静态文件，而是**追加-only 不可变日志**？RAG 实时检索最近采坑与决策。 | (a) 覆盖式 `MEMORY.md` 键值对 vs (b) 事件溯源 `.ai/ledger.jsonl` + RAG 检索 |

**Gemini 3.1 Pro 的初判建议**：优先从 **v2（编译范式）** 和 **v6（影子工作区）** 做 PoC —— 最低成本解决存量项目接入与人类开发者抵触，再演进到 MCP/LSP 动态注入（v1、v3）。

---

## 📈 Thought Evolution Timeline

### Round 1 — Seed & Scoping (Phase 1)
- 识别种子为"AGENTS.md 开放标准"的跨客户端泛化与智能化
- 用户明确 4 大焦点 + 3 个具体顾虑（接入、人机融合、双可读）
- 选择"深入"模式，允许激进方案
- Gemini 3.1 Pro 产出 8 条探索向量（v1–v8），覆盖协议/编译/路由/自动化/腐烂/接入/约束/记忆

**关键发现**：
- 8 条向量自然聚成 3 组：**协议层（v1,v7）｜内容层（v2,v5,v8）｜系统层（v3,v4,v6）**
- 存量项目 `werewolf-minigame` 并不在 pcf 仓库中 → 方案不能依赖特定项目结构，而要能"挂载"任何项目

### Round 2 — Multi-Perspective Divergence (Phase 2)

**三视角同时产出，以下是关键信号汇总。完整数据见 [perspectives.json](./perspectives.json)。**

#### 🎨 Creative (Gemini 3.1 Pro) — 5 个跨域命名概念

| 概念 | 借鉴 | Novelty/Impact | 痛点 | 可行级 |
|-----|-----|---------------|-----|-------|
| **Docs-as-Views** | DB 物化视图 / SSG | 4/5 | B, C | low-hanging |
| **JIT-Context Fault** | OS 缺页中断 / CDN 回源 | 5/5 | focus-3, C | moonshot |
| **Intent Ledger** | 事件溯源 / Git 对象 | 4/4 | focus-4, B | moonshot |
| **Duck-Typing Docs** | TS 结构化类型 | 3/4 | A, C | low-hanging |
| **Docs-CRD** | K8s CRD + 控制循环 | 4/5 | focus-4 (腐烂) | mid-tier |

#### 🛠 Pragmatic (Claude) — 90 天落地路径

**核心结论**：_7 个目标客户端里，100% 覆盖的唯一机制是**静态文件同步**。MCP/hooks/FS Watcher 都只是增量增强。_

- 5 个方案全部围绕"单源 AGENTS.md + 多客户端同步 + 哈希守卫"
- 90 天路线图：week1-2 AGENTS.md 迁移 → month1 pre-commit + CI diff → day31-90 分区 + 按需 MCP
- 6 条反模式（摘要）：① CI 自动 commit 必死 ② LSP 在 GUI 客户端失效 ③ MCP 不能作唯一源 ④ 编译产物勿 commit ⑤ 影子工作区与 GUI 冲突 ⑥ 过度 XML/YAML 会脆

#### 🔬 Systematic (Web Research) — 真实客户端能力矩阵

| | AGENTS.md | Hooks | MCP | 备注 |
|---|---|---|---|---|
| Claude Code | 需 `@AGENTS.md` 导入 | ✅ 20+ | ✅ | 通过 CLAUDE.md 间接 |
| Cursor | 未确认（`.mdc` 专有） | ❌ | ✅ | `.cursor/rules/*.mdc` alwaysApply/globs/description |
| Windsurf | ✅ 原生 | ✅ 12 events | ✅ | 根 = always-on；子目录 = 自动 `<dir>/**` |
| GitHub Copilot | ✅ agent 模式 | ❌ | 🚧 进行中 | chat/inline 不读 AGENTS.md |
| Roo Code | ✅ | ❌ | ✅ | `.roo/rules/` 及 `.roo/rules-{mode}/` |
| Codex CLI | ✅ 原生主要格式 | ❌ | ❓ | |
| Gemini CLI | 未确认（`GEMINI.md` 原生） | ✅ 11 events | ✅ | `@file.md` 导入语法 |

**3 组致命不兼容**：① 条件加载 frontmatter 语法 3 家都不一样 ② Hook schema/事件名/配置位置 3 家都不一样 ③ MCP 配置路径各家独立。_Memories 都是机器本地不入 git，无法跨端共享。_

---

### 综合洞察

**收敛主题（3 视角一致）**：
1. 静态 AGENTS.md（Claude Code 则用 CLAUDE.md 里 `@AGENTS.md`）= 跨端 100% 覆盖的唯一底座
2. MCP 是增强层，Copilot/Codex 不能把它作为唯一源
3. **单向同步**（源 → 各客户端副本）+ **哈希守卫** = 防 merge conflict 的根本
4. 编译范式可用，但编译产物必须 `.gitignore`

**关键冲突与化解方向**：
- _Creative 的 moonshot vs Pragmatic 的谨慎_ → 分层：**底座层（即刻可落地）+ 增强层（逐步演进）**，不做短期不能兑现的拦截式方案
- _人机文档关系（B/C）_：Plain Markdown 分区 + 局部 `.ai-interface.d.ts` 接口文件作硬锚点；不做 XML 编译产物

**视角独占贡献**：
- _Creative_ 命名概念 "Intent Ledger" — 事件溯源解决治理与演进
- _Pragmatic_ 90 天路线图 + 6 条反模式
- _Systematic_ 3 组致命不兼容 — 任何统一方案都必须承认这些"鸿沟"

### Round 3 — Fabric Protocol 严格评估 (Phase 3 Challenge)

用户在 Phase 3 提出新架构 **Fabric Protocol (AGENTS.md 2.0)**，5 组件：
① 递归嵌套 L0/L1/L2 + YAML frontmatter  ② Intent Ledger 事件溯源  ③ 动态 MCP 代理层
④ Docs-as-Views 编译层  ⑤ @HUMAN 人机治理 + 分级加载

**双视角严格评估**（Gemini 3.1 Pro 架构批判 + Claude 跨端落地核验）→ 见 [ideas/fabric-protocol.md](./ideas/fabric-protocol.md)

**5 大核心缺陷**：
1. **体积死锁** — `L2 <300行` × `Changelog 回填 .md` 产生单调膨胀悖论
2. **YAML frontmatter 无解析主体** — 任何现有客户端都不原生识别；非 MCP 客户端会把它当噪声
3. **Hook 依赖让组件 ②⑤ 在 5/7 客户端失效** — Cursor/Copilot/Roo/Codex 完全没 hook
4. **动态 MCP 注入是未验证假设** — MCP 规范无"会话中热更新"标准，"按活跃文件实时注入"在多数客户端不可能
5. **与 AGENTS.md 开放标准兼容裂缝** — Fabric 的 schema 强制是*替代*而非*扩展*

**5 大修正 → Fabric Lite v1.1**：
- 元数据 **YAML → HTML 注释** `<!-- fab:scope=... -->`（所有工具降级为纯注释）
- 强制力 **客户端 hook → git hook**（7 端一视同仁）；客户端 hook 仅作实时增强
- 动态 MCP → **启动时路径感知静态注入**（可验证可行）
- Intent Ledger **物理隔离** `.intent-ledger.jsonl`，严禁回填 .md
- 编译产物 **.gitignore**，本地/CI 生成；顶加 `AUTO-GENERATED`
- 根 AGENTS.md 加 `<!-- fab:index -->` 段，AI 一次决策选择读哪些（解决树太深 token 低效）

**Verdict**：
- Fabric 原版 → **needs-revision**
- Fabric Lite v1.1 → **go**

### Round 4 — MCP-First 范式转变 + 深度挑战

用户决定：
- Scope → **MCP-First**（明确放弃 Copilot，目标 6 客户端）
- Codex 确认支持 MCP（用户断言）
- 编译产物 `.gitignore`；Ledger 每次 commit 一条；@HUMAN 仅 git pre-commit 阻断

**两轮挑战结果**（见 [ideas/mcp-first-fabric.md](./ideas/mcp-first-fabric.md)）：

#### Gemini 魔鬼代言人 —— 5 大致命风险（优先级矩阵）

| # | 风险 | 严重×可能 | 关键修复 |
|---|-----|----------|---------|
| 1 | **惰性坍塌** AI 不调工具盲写 | 25 | Fear-driven tool desc + pre-commit 校验 ledger |
| 2 | **Boundary erosion** AI 破坏 @HUMAN 标记 | 20 | human-lock.json 精确 hash |
| 3 | **Phantom cache** 多端状态撕裂 | 16 | revision_hash 游标 |
| 4 | **长对话遗忘 MCP** | 12 | 5 行呼吸引导词 |
| 5 | **元数据被破坏** | 9 | JSON 元数据硬隔离到 `.fabric/agents.meta.json` |

**Gemini 裁决：Conditional-Go**（需加入防御性悲观主义）

#### Claude 工程可行性 —— 完整 MVP 可落地

- 提供 `fabric-context-server` 单文件 TS 实现（≤300 行）
- 6 客户端 stdio MCP 配置全部 copy-paste 可用
- `fab init` 扫描 README/CONTRIBUTING → 生成 AGENTS.md 骨架（不破坏已有文件）
- `fab:ref` 引用机制处理人机文档关系

#### 最终设计 — **MCP-First Fabric v2.0 Fortified**

5 层架构：Layer 0 规范层（Markdown） / Layer 1 元数据层（JSON 硬隔离）/ Layer 2 意图层（.intent-ledger.jsonl） / Layer 3 分发层（MCP 3 tools）/ Layer 4 防御层（git hook + breathing prompt + revision_hash）

**三大用户痛点兑付**：
- **痛点 A 接入存量**：`fab init` 不改任何已有文件，只新增 AGENTS.md 树 + `.fabric/`
- **痛点 B 人机关系**：AGENTS.md 用 `fab:ref` 引用 README/CONTRIBUTING，只写 AI 专有约束；避免双轨
- **痛点 C 双可读**：HTML 注释被 GitHub/VS Code 预览隐藏，人类基本看不到；结构化元数据全部入 JSON

**Verdict**: **go (recommended)**

---

## 🎯 Final Synthesis (Phase 4)

**首选方案**：**Fabric v2.0 MCP-First Fortified**

> 以本地 MCP Server 为主通道、6 主流 MCP 客户端（Claude Code / Cursor / Windsurf / Roo Code / Gemini CLI / Codex CLI）为目标、git pre-commit 兜底强制性的 5 层架构。明确放弃 GitHub Copilot。

**3 件投资最高 ROI**：
1. `fabric-context-server` 单文件 TS（≤300 行）暴露 3 个 MCP tool
2. `fab init` 命令对存量项目零破坏接入（扫描 README/CONTRIBUTING、生成骨架、不改已有文件）
3. git pre-commit 三件套：`sync-meta` / `human-lint` / `ledger-append`

**3 大用户痛点兑付**：
- **A. 存量接入**（werewolf-minigame）：`npx fab init` 只新增，不改
- **B. 人机文档关系**：AGENTS.md 用 `fab:ref` 引用 README/CONTRIBUTING，只写 AI 专有约束
- **C. 人 AI 双可读**：人类看到纯 Markdown + 隐藏的 HTML 注释锚点；机器消费全走 `.fabric/agents.meta.json`

**7 日 MVP + 3 大 Kill Switch**：见 [ideas/mcp-first-fabric.md §5-§6](./ideas/mcp-first-fabric.md)

### Key Insights（7 条）

1. 跨端 AI 文档的核心矛盾不是"如何写好规范"，而是"如何让规则在 7 种完全不同能力的客户端里行为一致"
2. 2026-04 MCP 成熟度已让 MCP-First 在 6/7 主流客户端可行（Copilot 除外）
3. YAML frontmatter 是错误载体——无客户端原生解析且 AI 会把它当文本消费；解法是分离：人类可见用 HTML 注释，机器消费用 JSON
4. 客户端 hook 能力差异太大（3 有 / 4 无），任何依赖客户端 hook 的强制性都会在 57% 客户端失效；强制性必须下沉到 git pre-commit
5. AI 惰性坍塌是 MCP-First 的最大风险；需要三重防御（tool desc + 首屏引导 + pre-commit 校验）
6. 人机文档关系的最优解是**引用**：AGENTS.md 只写 AI 专有约束，用 `fab:ref` 指向现成人类文档
7. MCP 协议是 request-response，不存在 server-push；"动态注入 / 光标跟随"类想法在当前规范下都不成立

### Parked（6 条明确放弃/延后）

LSP 注入 · JIT-Context Fault · OS 只读 · Docs-CRD · Duck-Typing Docs 独立架构化 · Copilot 支持（MCP 未 GA）

完整产物：
- [synthesis.json](./synthesis.json) — 结构化综合
- [perspectives.json](./perspectives.json) — Phase 2 三视角原始数据
- [exploration-codebase.json](./exploration-codebase.json) — 上下文元信息
- [ideas/fabric-protocol.md](./ideas/fabric-protocol.md) — 原始 Fabric 双视角评估
- [ideas/mcp-first-fabric.md](./ideas/mcp-first-fabric.md) — **最终设计**

---

## 🗂 Artifact Index

- [exploration-codebase.json](./exploration-codebase.json) — Phase 2 本仓库上下文（cli-explore-agent 产出）
- [perspectives.json](./perspectives.json) — Phase 2 多视角发散（creative/pragmatic/systematic）
- [synthesis.json](./synthesis.json) — Phase 4 收敛综合
- [ideas/](./ideas/) — Phase 3 单创意深挖/合并产物

_以上文件随 Phase 推进而产生，当前尚未创建。_

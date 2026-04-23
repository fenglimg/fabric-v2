# Brainstorm: AI 客户端初始化规则与 Web 交互流程优化

## Session Metadata
- **Session ID**: BS-2026-04-23-ai-client-init-rules-web-interaction
- **Date**: 2026-04-23
- **Mode**: balanced (auto)
- **Dimensions**: technical, ux, architecture
- **Roles**: system-architect, ux-expert, product-manager

## Initial Context
- **Topic**: AI 客户端的初始化规则和 Web 交互流程的全景扫描与深度发散
- **Focus Areas**:
  1. 从 0 到 1 构建项目初始认知的过程
  2. 规则处理逻辑中的困惑和约束
  3. 本地环境与 Web 界面的协作效率
  4. 实现无感且精准的关键缺失环节
  5. 具体规则配置优化
- **Depth**: balanced
- **Constraints**: existing architecture

## Seed Expansion

### Original Idea
针对 AI 客户端的初始化规则和 Web 交互流程，进行全景扫描：如何从 0 到 1 构建项目认知？规则处理的困惑？本地与 Web 的协作效率？缺失的关键环节？规则配置优化？

### Exploration Vectors
1. **核心问题：初始化摩擦与"黑盒"化风险** [HIGH] — 随着 AGENTS.md 移除，用户如何确认 Fabric 协议已激活？
2. **用户视角：从"诊断警告"到"初始化向导"的体验转型** [HIGH] — Web 端集成初始化向导，允许 UI 点击确认框架识别、勾选规则集
3. **技��角度：影子规则的实时解析与缓存策略** [MEDIUM] — fab_get_rules 的 1:1 路径镜像性能及增量推送
4. **竞品对标：与主流 AI 客户端初始化策略的差异化** [MEDIUM] — Cursor/Windsurf/Copilot 对比
5. **挑战：本地配置与 Web 上下文的同步一致性** [HIGH] — 多端同时操作的冲突处理
6. **创新角度：基于上下文感知的"预判式"规则加载** [MEDIUM] — 利用 Forensic 扫描自动生成框架特定规则
7. **集成化方案：跨端协同的闭环初始化链路** [MEDIUM] — CLI 触发 → Web 确认的闭环

---

## Thought Evolution Timeline

### Round 1: Seed Understanding
- Identified 3 dimensions: technical, ux, architecture
- Generated 7 exploration vectors from Gemini analysis
- Key insight: Fabric 正从显式根目录文件向隐式影子配置转型，CLI 与 Web 存在明显断层

### Round 2: Multi-Perspective Exploration

**Creative (Gemini)** — 6 ideas, top picks:
- **AI协同逆向规则提议系统** (novelty 9, impact 10) — AI发现隐藏约定后主动提议规则，Dashboard Inbox审核
- **渐进式按需上下文感知 JIT Init** (novelty 9, impact 8) — 废除全量init，AI访问时按需生成
- **Dashboard驱动可视化互动初始化** (novelty 8, impact 9) — Web端可视化确认替代CLI盲写
- **后台守护态代码拓扑持续感知** (novelty 7, impact 9) — forensic增量监控替代手动scan
- **规则覆盖率热力图** (novelty 8, impact 7) — 空间TreeMap可视化AI认知盲区
- **Git Hooks分支级环境隔离** (novelty 7, impact 8) — 分支切换自动切换规则组合

**Pragmatic (Claude)** — 5 pain points ranked:
1. minimatch路径匹配无缓存 [HIGH] → 预计算倒排索引 (0.5d, low risk)
2. Dashboard无Init状态视图 [HIGH] → DoctorView增加FabricStatusPanel (1.5d, low risk)
3. Bootstrap阶段No-op噪音 [MEDIUM] → 条件静默 + 非Claude客户端引导 (1.5d, low risk)
4. Stale检测无细粒度 [LOW] → 扩展client_hash协议 (2d, medium risk)

**Systematic (Agent)** — 3 architectural approaches + deep bugs:
- Approach A: 增量修复 — 合并双chokidar, 修缓存bug, 统一分类 (1 week)
- Approach B: 事件溯源 — ledger→物化视图, cursor-based stale (3 weeks)
- Approach C: Dashboard控制面 — 写API + initFabric提取 (4 weeks)
- **发现关键bug**: meta_write invalidation不清除context slot (5s stale window)
- **发现冗余**: http.ts + events.ts两个独立chokidar监听重叠路径
- **发现并发风险**: atomicWriteText无并发保护，多AI客户端同时写会丢失

**Convergent Themes** (三方共识):
1. Dashboard必须从只读升级为交互控制面
2. minimatch/glob缓存优化是最高优先级quick win
3. 渐进式初始化优于一次性全量init
4. 缓存一致性是潜在的可靠性隐患

**Key Conflict**: 重构范围 — creative要大胆重构(可视化Bootstrap/JIT/AI提议), pragmatic要小步快跑(0.5-2天增量修复), systematic建议分层推进(1w→3w→4w)

### Round 3+: Refinement
*(pending)*

---

## Artifact Index
- [exploration-codebase.json](./exploration-codebase.json) — Codebase context from cli-explore-agent
- [perspectives.json](./perspectives.json) — Multi-CLI perspective findings
- [synthesis.json](./synthesis.json) — Final synthesis
- [ideas/](./ideas/) — Individual idea deep-dives

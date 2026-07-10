# v2.2 全候选池 — 零上下文冷评批判输入包

你是独立冷评 critic。对 Fabric(跨客户端 AI 知识层, TS monorepo, repo 根=本 --cd)v2.2 候选池逐条做**对抗式批判**。允许并鼓励读真代码 file:line 验证下方 grounding 声明(防 reimplemented-noop)。

## Fabric 是什么(30 秒)
跨客户端(Claude Code / Codex CLI / Cursor)AI 知识层。知识=`.fabric/knowledge/<type>/*.md`(decisions/pitfalls/guidelines/models/processes)。三形态:**Hook**(SessionStart 列 broad KB + PreToolUse narrow hint, exit2 reminder 不阻断) · **Skill**(archive/review/import 写入流) · **MCP**(fab_recall / fab_plan_context → fab_get_knowledge_sections 检索)。CLI(doctor/lint)做知识维护。检索核心: `packages/server/src/services/plan-context.ts`。

## 护城河 D(2026-05-30 human 重定义 — 批判须按此版 check 冲突)
- **D1 三端 AI-交互-内集成**: Hook+Skill+MCP 织进 CC/Codex/Cursor agent loop + cross-client parity(主 CC+Codex, Cursor 暂弱化)。最核心壁垒。
- **D2 MCP-first**: 行为由 MCP 连接驱动, CLI 为附带运维面。("离线零依赖"并入此条, 不单列)
- **D3 Lifecycle governance**: cite-contract + maturity + archive + orphan demote + health, 防 KB 慢速死。
- **D4 AI-in-loop curation**: 知识由 AI 在循环内自动 surface + propose 入库, capture→review→surface 闭环。
- **已剔除(不再是护城河, 别再拿它否决)**: ~~no-server-filter~~(废) · ~~离线零依赖~~(并入 D2)。
  → 重要: top_k 截断 / BM25 / 向量 **不再因 no-server-filter 或离线被否**。冷评须基于 D1-D4 重新判冲突。

## Frame 边界(human 已拍, 你不挑战 frame, 只 frame 内批判)
- ✅ 你只批判: **值不值得做 / 优先级对不对 / 与护城河 D 或彼此有无隐藏冲突 / 落地序对不对**。
- 🚫 不挑战: v2.1 全局化独立(不并入 v2.2) · v2.2 是跨多 rc 里程碑 · 已拒项(腾讯 B1-8/A1/A22/重图/SK4/H5)不重提。
- 不为批判而推翻已 grounded 结论 — 翻案需新证据/新冲突。

## 输出格式(严格)
对每条给: `id | verdict ∈ {absorb-v2.2 | reject | defer-v2.3} | priority(P0/P1/P2) | wave(1/2/3) | 1-2句 rationale(grounded, 带 file:line 若验证过) | moat冲突(D几或无) | 依赖`。
末尾给: (a) **隐藏冲突/重复**清单(候选间), (b) **落地序**建议(wave 划分理由), (c) 你与现 verdict **分歧**的条目(哪条你想翻案及新证据)。

---

## 候选池(36 条)

### 主题1 检索质量(现状: plan-context.ts `scoreDescriptionItem` 仅 2 信号=recency 二元 boost + locality tier, line ~620-660; candidates 不截断)
- **C3-salience** [现 P1]: scoreDescriptionItem 加 maturity/lifecycle/recency 线性信号(2信号→更多)。零依赖纯 TS。
- **A-INFRA-1-BM25** [现 P1]: 加 BM25 内容相关性打分(现仅 locality+recency, 无正文相关性)。依赖 A-INFRA-2。
- **A-INFRA-2-CJK** [现 P1]: CJK tokenizer, 中文 KB 上 BM25 生效前提。
- **C4-endorsement** [现 P2]: 把 cite confirm/dispute 信号接入排序(endorsement)。依赖 cite events 已有。
- **A-INFRA-3-topk** [现 P0]: candidates 加 top_k 有界上限截断(现 plan-context.ts 无 slice, 全返)。依赖 BM25 排序先行才安全。

### 主题2 注入治理 / Hook(.fabric/.../hooks 生成的 .cjs)
- **HK4-hygiene** [现 P0]: 修 3 个 hook bug — (a) cite-contract-reminder 只认 legacy `recalled` tag 漏 rc.37 `applied`; (b) archive-hint hook 未注册; (c) broad hook 去重非 session-scoped, 多窗口并发互抑。
- **HK1-alwayspin** [现 P1]: fabric-config 加 `always_knowledge_ids`, SessionStart 强制并入(always-inject pin)。
- **HK2-degrade** [现 P1]: SessionStart 注入降级阶梯 + markdown 截断(KB 多时按预算降级)。
- **C5-budget** [现 P2]: token budget(注入层 + MCP 层)。依赖 HK2。
- **HK3-telemetry** [现 P2]: per-inject telemetry(injections.jsonl 注入侧 log, 对比消费侧 counter 算真命中率)。

### 主题3 配套 Skill(现 archive/review/import 三写入 skill; 维护/治理轴空白)
- **SK1-audit** [现 P1]: fabric-audit skill(语义淘汰 deprecate-over-delete + rescue-before-delete)。最大 skill 缺口。
- **H2-related** [现 P1]: frontmatter 加 `related` 字段(知识图基础)。SK2 前置。
- **SK2-connect** [现 P2]: fabric-connect skill(找隐藏关联连接)。依赖 H2。
- **SK3-digest** [现 P2]: fabric-digest skill(主题聚类 + gap→pending)。
- **SK5-adjudication-sink** [现 P2]: 把裁决表 + cite 契约文档从 AGENTS.md 下沉进 skill 体(减 bootstrap 膨胀)。

### 主题4 MCP 知识设施(最大缺口)
- **MC3-fix-guidance** [现 P0]: 修 hook 工具引导矛盾(broad hook 输出里两处指令冲突)。
- **MC2-server-instructions** [现 P1]: MCP server-level instructions + tool manifest(净新最高价值, Fabric 全缺)。
- **MC1-recall-pack** [现 P1]: fab_recall 返回打包增量(directive / 截断标记 / _next / include_related)。
- **MC4-payload-budget** [现 P2]: MCP payload 预算(撞 64KB hard limit 前裁)。与 top_k 去重对齐。
- **MC5-action-hint** [现 P2]: 对称收敛 action_hint(廉价 UX)。

### 主题5 治理可观测
- **A14-doctor-health** [现 P2]: doctor 加 KB health 0-100 分 rollup(复用现有 lint 集, 互补)。

### 设计抉择(7 条, 给 absorb-v2.2 | reject | defer-v2.3 终判 + rationale)
- **A6-inline-ref**: 要不要引入"长文档"第二载体(短 entry ↔ 长 ref 双层)? 影响 schema。
- **A8-knowhow-fields**: 5 类型要不要加类型化字段(如 decision.status)做维度过滤? 影响 schema。
- **A18-virtual-wiki**: events.jsonl / archive 要不要只读投射成虚拟 KB 候选? 影响数据模型。
- **A21-progressive-fill**: 事件→category 自动沉淀; Fabric harness-agnostic 下等价触发器是什么?
- **A20-harvest-routing**: fabric-archive 单源单目的 → 要不要泛化成多源多目的路由?
- **A9-realtime-validator**: PreToolUse narrow hook 要不要加 frontmatter/glob 实时校验?
- **A2-injection-keyword**: 注入侧 keyword→entry 召回 hook 要不要做?(检索侧已由 BM25/CJK 解; 注意 no-server-filter 已废, 这条不再因 filter 被否)

### Defer 候选(8 条, 确认 defer-v2.3 带触发器, 或翻案 absorb-v2.2)
- **C1-RRF**: hybrid RRF(in-memory)。触发器: BM25+top_k 后 precision 仍不足。
- **C2-vector**: 向量(fastembed 可选依赖)+ fallback。原触发器: 规模阈值 + npm +180MB。**注意护城河重定义: 离线零依赖已剔除, MCP-first 下更重 server 可接受 → 请重评是否仍该 defer。**
- **HK5-token-cap**: token 双 cap 精确版。触发器: HK2 后规模需要。
- **A-INFRA-4-index-cache**: 倒排索引缓存。触发器: 随 BM25 引入。
- **A13-hook-tier**: hook tier(minimal/standard/full)。触发器: 隐私/性能诉求。
- **A19-A7-B11**: codify manifest / tool:true / catalog。触发器: 第二写入 skill / 工具诉求。
- **H1-readonly-cli**: fab knowledge ls/cat 只读 CLI 旁路。触发器: MCP 瘫痪兜底。
- **H4-personal-seed**: personal seed 一次性教学。

---
开始批判。先 spot-check 3-5 条 grounding 声明(读 plan-context.ts scoreDescriptionItem / candidates 无 slice), 再逐条给 verdict。诚实: 不确定就说不确定, 别善意补全。

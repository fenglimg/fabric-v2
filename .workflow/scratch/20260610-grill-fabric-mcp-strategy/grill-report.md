# Grill Report: Fabric MCP 工具套件最佳策略

**Session**: 20260610-grill-fabric-mcp-strategy
**Depth**: standard (5 branches)
**Date**: 2026-06-10
**Upstream**: none (接续本会话 fab_recall 机制调查)

## Discovery Summary

### Project Context
Fabric v2 跨客户端知识层。6 个 MCP 工具:检索三件套 (fab_recall / fab_plan_context / fab_get_knowledge_sections) + 写入/治理三件套 (fab_extract_knowledge / fab_archive_scan / fab_review)。

### Codebase Surface (code-grounded)
- **fab_recall** = 一次调用糖衣: `planContext()` 排序 → `getKnowledgeSections()` 灌全文。`services/recall.ts:112` `effectiveIds = rewrittenIds ?? candidateIds` → 没传 ids 就自动全选 top_k 候选并返回完整 body。
- **retrieval budget**: `shared/src/retrieval-budget.ts` 默认 `balanced` profile = top_k 24 / warn 16KB / hard 64KB / injection 2000 chars。`conservative`=12/8KB/32KB,`generous`=48/32KB/131KB。
- **排序链**: CJK 分词 → BM25(×50) + vector(×30,上限49) + locality(同文件+100/同目录+50/同包+25) + recency(7天+100) + maturity(proven+15)。排序精确,但 recall 无 relevance 阈值门。
- **哲学债**: rc.37 删 server-side `selectable=false`,`recall.ts:32` 注释承认 LLM 挑 id 是 no-op。
- **payload guard**: `shared/src/node/mcp-payload-guard.ts` hard 超限抛 413,无优雅降级;`plan-context` 有 `trimToPayloadBudget` 主动 tail-drop,recall 没有。
- **同构隐患**: `fab_review list/search + include_body` 无 filter→10MB+;`fab_archive_scan` 无 range→扫整本 ledger。
- **共享底座**: first-reconcile-gate (5s) / payload-warning / event-ledger / cross-store-write sandbox。

### Upstream Material
N/A

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries | ✅ | 2 | - |
| 2 | Retrieval Data Model (检索数据模型) | ✅ | 2 | - |
| 3 | Edge Cases & Failure Modes | ✅ | 2 | - |
| 4 | Integration & Dependencies | ✅ | 2 | cite 记账 locus 待 trace |
| 5 | Scale & Performance | ✅ | 2 | body 漏读监测 |

---

## Branch 1: Scope & Boundaries

**Status**: ✅ Completed
**Questions asked**: 2
**Decisions locked**: 2

### Q1.1: 策略边界 = 全套 6 工具 还是 检索热路径?

**Answer**: 先锁检索热路径 (recall/plan/get)。
**Evidence**: 日常 token 付费集中在 recall 每次 edit 触发、top_24 全文每轮重灌 (`services/recall.ts:112`);review/archive_scan 的返回体爆炸只在显式无约束查询时触发,非热路径。
**Decision**: locked
**Constraint**: 本次策略 MUST 只改 recall/plan_context/get_sections;review/archive_scan/extract 的 payload 隐患 MUST 仅记入 Risk Register,不在本轮动手。

### Q1.2: 修复落点 = 服务端代码 还是 bootstrap 策略?

**Answer**: 代码侧为主(改 recall.ts 返回策略,让 one-call 默认就瘦)。
**Evidence**: 策略侧依赖 AI 每次遵从两步指令;`recall.ts:32` 注释 + memory `feedback_no_server_side_kb_filter` 实证"AI 把每条 selectable 全选"是 no-op;cite 真实遵循率仅 2.5% (memory `project_lifecycle_efficacy_audit_and_design`) → 提示型约束不可靠,服务端默认才是硬约束。
**Decision**: locked
**Constraint**: 修复 MUST 落在 `services/recall.ts` 返回策略层(硬约束);bootstrap AGENTS.md MAY 同步描述但不作为唯一手段。

---

## Branch 2: Retrieval Data Model (检索数据模型)

**Status**: ✅ Completed
**Questions asked**: 2
**Decisions locked**: 2

### Q2.1: recall 新默认返回形状?

**Answer**: body-tier 混合——全 24 候选返 description,仅 top-N 返完整 body,next_steps 提示按需 get_sections 拉剩余。
**Evidence**: no-server-filter 哲学本质是"LLM 能看到全集" (`recall.ts:32`);硬砍丢描述会让 AI 不知低排条目存在,背叛哲学且漏可发现性。body-tier 既砍 token(~10.9k→~3k)又保候选可见性。
**Decision**: locked
**Constraint**: recall MUST 对全部 top_k 候选返回 description;body MUST 仅对 top-N 子集返回;next_steps MUST 提示剩余条目可经 fab_get_knowledge_sections 按需获取。

### Q2.2: top-N 的 N 怎么定?

**Answer**: 字节预算驱动——按排序依次填 body,撞 body-budget(复用 `payloadWarnBytes` ~16KB)即停,剩余只留 description。N 随 body 大小自适应。
**Evidence**: KB body 大小方差 >20×(`services/extract-knowledge.ts` 可写任意长度;一条详细 decision 10KB vs pitfall 400B)。固定 N 在"全胖子"时仍炸 hard ceiling、"全矮子"时浪费预算。retrieval-budget.ts:43 已有 payloadWarnBytes 旋钮可复用。
**Decision**: locked (量级见 Q5.1 修正)
**Constraint**: body 填充 MUST 按 BM25 排序累加字节,撞 BODY_BUDGET 即停;BODY_BUDGET MUST 随 profile 缩放。
**[REVISED by Q5.1]**: BODY_BUDGET 不复用 payloadWarnBytes(16KB),改为独立的小预算(默认 ~4KB)——见 Q5.1。

---

## Branch 3: Edge Cases & Failure Modes

**Status**: ✅ Completed
**Questions asked**: 2
**Decisions locked**: 2

### Q3.1: 排第一的 body 本身超预算怎么办?

**Answer**: 保底 top-1 + 超 hard ceiling 则截断打 truncated 标记。recall 永不返零条 body、永不抛 413。
**Evidence**: 当前 `mcp-payload-guard.ts:25` hard 超限抛 413;最相关条目拿不到是灾难;截断+标记保证可用性。
**Decision**: locked
**Constraint**: 当 body 累加为空时 MUST 至少返回 #1 候选 body;单条超 hard ceiling 时 MUST 截断 + 标 `truncated:true` + next_steps 指示完整获取路径,MUST NOT 抛 413。

### Q3.2: 显式 ids 是否受 body 预算夹?

**Answer**: 显式 ids 绕过 body 预算(仅守 hard ceiling)。预算只治"自动全选"默认路径。
**Evidence**: 逃生通道(按需拉剩余)若被预算反噬则形同虚设;`recall.ts` 显式 ids 表达 caller 有意图,应优先。
**Decision**: locked
**Constraint**: 当 caller 传显式 `ids` 时 MUST 全部返回 body,不受 body-budget 夹;body-budget MUST 仅作用于自动全选路径;hard ceiling 兜底对两条路径均生效。

---

## Branch 4: Integration & Dependencies

**Status**: ✅ Completed
**Questions asked**: 2
**Decisions locked**: 2

### Q4.1: 自动 cite 记账键 off candidates 还是 rules?

**Answer**: 按 candidates[](全部浮出候选)记账,body-tier 对 cite 覆盖率零影响。
**Evidence**: recall 浮出条目 = 系统承认其相关,与 body 是否实返无关;cite 覆盖率被 `fabric doctor --cite-coverage` 稽核,不能因 body-tier 静默下降。验证:cite-rollup.ts 是独立 ledger,recall-first path-overlap 记账为事件驱动,**精确键(candidates vs rules)需实现期 trace 确认** → 见 Risk Register。
**Decision**: locked (含实现期验证义务)
**Constraint**: 自动 cite 记账 MUST 键 off 浮出候选集(全部 surfaced descriptions),MUST NOT 仅键实返 body;实现前 MUST grep 确认当前记账 locus 与此一致,不一致则修正而非默认。

### Q4.2: 三个检索工具的边界(plan_context 是否冗余)?

**Answer**: 保留三工具,重画成清晰阶梯:recall=默认(全候选描述+top-N body);plan_context=纯菜单(零 body,超大库/只要描述时);get_sections=按 ids 拉 body 原语(逃生通道)。
**Evidence**: body-tier 依赖 two-step 作为按需逃生通道(Q3.2),拆掉 plan_context/get_sections 会废掉逃生通道;三者职责正交,合并反增回归面。
**Decision**: locked
**Constraint**: 三检索工具 MUST 保留;职责边界 MUST 文档化为阶梯(recall 日常 / plan_context 纯菜单 / get_sections fetch 原语);本次 MUST NOT 合并工具。

---

## Branch 5: Scale & Performance

**Status**: ✅ Completed
**Questions asked**: 2
**Decisions locked**: 2

### Q5.1: body 默认 eager 加载到什么量级?(用户挑战 frame)

**Answer**: 小 body 预算 ~4KB(典型 1~3 条),独立于 16KB 总响应顶。最相关的几条 eager,其余 description 按需拉。
**Evidence**: **用户 frame-pivot** —— "description + index 就已足够说明条目是干什么"。description = discovery 层,body = application 层。成本不对称:漏 body = 一次便宜 on-demand fetch(可恢复);多一条 eager body = 每次 recall 的永久 context 税(不可恢复)→ 偏 lean。原 Q2.2 复用 payloadWarnBytes(16KB≈8条)被认定偏肥。
**Decision**: locked
**Constraint**: 默认 BODY_BUDGET MUST 为独立小预算(~4KB,随 profile 缩放),MUST NOT 复用 payloadWarnBytes;典型出 1~3 条 eager body;预期 token 从 ~10.9k 降到 ~1.5–2k。

### Q5.2: 描述菜单 top_k 是否随之调整?

**Answer**: 描述 top_k 保持 24 不动,不捆绑改动。
**Evidence**: body-tier 解耦了 candidate 数与 body 成本,描述便宜(24×150B≈3.6KB)且正是 discovery 主力;coding philosophy = incremental / 一次一变,body-tier 与 top_k 同改会让归因变难、回归难回滚。
**Decision**: locked
**Constraint**: 本轮 top_k MUST 维持 24;"body-tier 解耦后 top_k 可上调"记为 future,MUST NOT 本轮 bundle。

---

## Synthesis

### 一句话策略
**fab_recall 改为 body-tier:全部候选返描述(discovery 层,top_k 24 不动),仅排名最高的 1~3 条返完整 body(独立 ~4KB 小预算,application 层),其余 description + 按需 get_sections 逃生。服务端硬约束落地,plan_context/get_sections 保留为阶梯。预期 token ~10.9k → ~1.5–2k。**

### Decision Summary
| # | Decision | Status | Branch | RFC 2119 |
|---|----------|--------|--------|----------|
| C-001 | 策略边界=检索热路径(recall/plan/get),其余三工具仅记 Risk | locked | 1 | MUST 只改三检索工具 |
| C-002 | 修复落点=服务端代码为主(硬约束),bootstrap 仅描述 | locked | 1 | MUST 落 services/recall.ts |
| C-003 | 返回形状=body-tier(全候选描述 + top-N body + next_steps) | locked | 2 | MUST 全候选返 description |
| C-004 | body 数=字节预算驱动(自适应),非固定 N | locked | 2 | MUST 按排序累加字节即停 |
| C-005 | 排第一 body 超预算→保底 top-1+超 hard 截断打标,永不抛 413 | locked | 3 | MUST 至少返 #1,MUST NOT 抛 413 |
| C-006 | 显式 ids 绕过 body 预算(仅守 hard ceiling) | locked | 3 | MUST 全返,逃生通道真可用 |
| C-007 | 自动 cite 记账键 off candidates[](cite-中性) | locked* | 4 | MUST 键浮出候选集,实现前 grep 核验 |
| C-008 | 保留三检索工具,职责画成清晰阶梯 | locked | 4 | MUST 保留,MUST NOT 合并 |
| C-009 | body 默认小预算 ~4KB(典型 1~3 条),不复用 16KB | locked | 5 | MUST 独立小预算,MUST NOT 复用 payloadWarnBytes |
| C-010 | 描述 top_k 维持 24,不捆绑改动 | locked | 5 | MUST 维持 24,top_k 上调记 future |

### Verified Constraints (code-grounded)
- recall 现状自动全选: `services/recall.ts:112` `effectiveIds = rewrittenIds ?? candidateIds`
- recall 已返 selection_token + candidates[]: `services/recall.ts:195-201` `...planResult` + tool 描述明示可复用 token follow-up → **逃生通道电线已存在**,body-tier 只需少传 ids 给 getKnowledgeSections
- 预算旋钮: `shared/src/retrieval-budget.ts:43` balanced=top_k24/warn16KB/hard64KB
- hard 超限抛 413: `shared/src/node/mcp-payload-guard.ts:25`
- plan_context 有 trimToPayloadBudget,recall 无 → 本次为 recall 补等效 body-tier 截断

### Open Questions
1. **cite 记账 locus**(C-007 verification):recall-first path-overlap 自动记账实际键 off candidates 还是 rules,需实现前 grep cite-rollup / hook / event 字段确认。若键 rules,body-tier 会静默降 cite 覆盖率 → 必须改为键 candidates。
2. **body 漏读监测**(C-009 风险):lean 后若 AI 不勤快 fetch 被截条目的 body,可能 cite [applied] 却没真读 body(违 cite policy 验证义务)。需观测 get_sections follow-up 率。

### Risk Register
| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| R1 | cite 记账若键 rules[] 则 body-tier 静默降 cite 覆盖率 | 4 | High | 实现前 grep 核验记账 locus;不一致则修正键到 candidates |
| R2 | lean body 后 AI 漏 fetch → cite[applied] 未真读 body | 5 | Med | 观测 get_sections follow-up 率;next_steps 措辞强提示;必要时回调 body 预算 |
| R3 | fab_review list/search + include_body 无 filter → 10MB+ | (out) | Med | 本轮不动,记入后续;list 服务层缺 trimToPayloadBudget |
| R4 | fab_archive_scan 无 range → 扫整本 events.jsonl | (out) | Low | 本轮不动;已有 L49 hint 提示传 range |
| R5 | body-tier 改默认行为影响所有用户 | 2 | Med | 服务端改动配 profile 旋钮;balanced 默认 lean,generous 可回肥 |

### Recommended Next Step
范围清晰、决策全锁 → 直接进实现规划(maestro-plan / 直接落 recall.ts)。实现首步 MUST 先做 R1 的 cite 记账 locus 核验(verify-before-fix)。


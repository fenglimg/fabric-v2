# Goal Checklist — 同空间 hybrid retrieval 产品调研 → Fabric 吸收决策包

> **真源是 `status.json`,本文件是投影视图。** mode ② 审计驱动。
> 终止判据: `ship_criteria` 五门全绿 (G-SCAN-COVERAGE 8/8 + G-DEEP-COVERAGE 4/4 + G-DECIDE 100% + G-CENTRAL-VERDICT + G-GROUNDED)。

## 中心问题

同空间 AI-agent memory/KB 产品**几乎一致选 BM25+vector+RRF hybrid retrieval**(CodeRAG/RepoDocs/lokb/persistor/valence/noosphere/OpenAkashic/Secrin),而我上一轮 infra session 因"同空间 maestro 选纯 lexical"把**向量(A-INFRA-6)+图检索(A-INFRA-5)reject** 了。但 maestro 是 workflow 编排器、不是 memory 产品 —— **真正同空间的 memory 产品的 hybrid 选择是更强的反向信号**。本轮以 N≥4 产品**源码 file:line**(非 README 营销词)为证据,给"hybrid/vector/graph 该不该进 Fabric"明确 grounded verdict。

## 与前两轮的关系

- `20260529-maestro-flow-mining`(抽象层)+ `20260529-maestro-flow-infra`(maestro 单产品 infra, 已 absorb A-INFRA-1 BM25 / A-INFRA-3 top_k, reject A-INFRA-5 图 / A-INFRA-6 向量)。
- 本轮**横向多产品**, 正面重开 A-INFRA-5/6, 承接 A-INFRA-1/3 既有结论。

## 边界契约

**IN**: Cat-B 同空间产品检索 infra(hybrid/RRF/向量/图融合/salience/token-bound injection/provenance/one-shot packing);Cat-A 只取检索 infra;每个 → Fabric 吸收判定 + 两痛点映射 + 中心问题证据。
**OUT**: 写 Fabric 代码;Cat-A 的 wiki 生成 pipeline/Mermaid/chat UI 本身;重挖前两轮;v2.1 全局化;重挑战已锁 boundary / 已 reject 的 A1/A22。
**关键约束**:
- **file:line 为准, 严禁信 README**(hybrid 营销词 ≠ 实现好: 核 RRF 真假/vector 维护成本/graph 是否真用于检索)。
- 中心问题必须 grounded verdict, 重开 A-INFRA-5/6 结论基于 ≥4 产品源码实证。
- absorb 带 `pain_target ∈ {injection-quality, mcp-payload-scale}`;诚实标 stub/两边没有。
- 护城河 Part D 冲突必标;向量若 absorb 必直面 MCP-first+离线零依赖+CLI 形态冲突。
- maestro 源端核验用 codex(跨目录读 clone repo), gemini 锁 Fabric 侧。

## Phase 1 — 速扫 8 个 (clone 已就位于 ~/Desktop/personal-projects/)

- [ ] **S1** deepwiki-open (Cat-A, RAG+FAISS) — 向量重开打分
- [ ] **S2** GitNexus (Cat-A, code→KG) — A-INFRA-5 图重开打分
- [ ] **S3** llm_wiki (用户指定) — 归类 + 检索 infra
- [ ] **S4** valence (Cat-B 顶级: provenance/contention/RRF/MCP 29 tools) — cite contract 关联
- [ ] **S5** noosphere (Cat-B: token-bounded injection/health/recall orchestration) — **痛点②**
- [ ] **S6** OpenAkashic (Cat-B: RRF+mention boost+confirm_count, one-shot context packing) — 对标 fab_recall/cite
- [ ] **S7** persistor (Cat-B: salience scoring=access+recency+boosts) — **痛点① 评分进化**
- [ ] **S8** lokb (Cat-B: Tantivy BM25+e5 embed+RRF+KG+MCP, local-first CLI) — **最对标 Fabric CLI 形态**

**备选(carry-over)**: MemoryOS(vector+KG+BFS fusion)· Secrin(Neo4j+KNN+Cypher hybrid)· atomic(sqlite-vec)· CodeRAG(AST+NL enrich+RRF+context budget)。

## Phase 2 — 深挖 top 4 (Phase1 打分定, file:line)

- [ ] **D1** top-1 深挖
- [ ] **D2** top-2 深挖
- [ ] **D3** top-3 深挖
- [ ] **D4** top-4 深挖
- [ ] **D5** 横向综合 + 中心 verdict + 双冷评 + 决策包 + memory 更新

## Ship Criteria 进度 — 五门全绿 ✅ (2026-05-30 completed)

- [x] **G-SCAN-COVERAGE** 8/8 速扫 — actual: 8/8 done
- [x] **G-DEEP-COVERAGE** 4/4 深挖 — actual: lokb/valence/OpenAkashic/persistor
- [x] **G-DECIDE** 候选三判定齐全 100% — actual: 9 candidate 三判定齐全 + pain_target
- [x] **G-CENTRAL-VERDICT** — hybrid CONDITIONAL ABSORB / 向量 A-INFRA-6 reject→CONDITIONAL ABSORB(推翻) / 重图 A-INFRA-5 reject 确认
- [x] **G-GROUNDED** — gemini Fabric 侧 100% + codex 产品源端 89%(0 refuted), 校正回写

**决策包**: `.workflow/.scratchpad/hybrid-retrieval-decision-package.md` · **数据集**: `hybrid-retrieval-phase1-scan.md`

## Resume

推进下一步: `/goal-mode continue`(推进一个 S/D 任务 → 取证 → 原子更新 status.json → 重检 gate)。
查看进度: `/goal-mode status`。显式收尾: `/goal-mode close`。

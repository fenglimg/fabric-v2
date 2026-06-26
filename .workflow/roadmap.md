# Roadmap: Fabric — 召回质量与一致性对齐

## Overview

对齐同空间产品 maestro-flow 的知识检索设计(选择性,非全面),修复 Fabric 召回的五个实证痛点:裸加法融合、score 不可观测、返回啰嗦+字节截断按位置误杀、中文语义召回默认关、hook 冷启动税。同时把 fab_pending 的子串浏览统一接入同一排序引擎,消除双 search 实现的 drift。拒绝 maestro 的代码图谱半套(Fabric 不索引代码)与常驻 daemon(收益错配+多窗口并发风险)。来源:grill GRL-20260625-knowledge-recall-align(14 条 locked decision)。

## Milestones

### Milestone 1: 召回质量与一致性对齐 (v2.4)
**Target**: fab_recall + fab_pending 共用单一可观测、量纲一致、中文友好的排序引擎;返回瘦身、截断按相关度。
**Status**: active

**Minimum-phase principle**: 单 phase。5 个波次为同模块(召回排序+返回)紧耦合工作,由 phase 内 wave DAG 处理排序与风险分级,无硬依赖边界需要 phase 切分。

#### Phases

- [ ] **Phase 1: 召回引擎重构与统一** — 排序融合/可观测/返回/语义/统一接入,5 波 DAG

#### Phase Details

##### Phase 1: 召回引擎重构与统一
**Goal**: 把 planContext 改造成单一可观测排序引擎(RRF 融合 + score 透出 + 瘦 item + 相关度优先截断 + CJK 语义),并让 fab_pending search 接入同一引擎。
**Depends on**: Nothing (first phase)
**Requirements**: R-001(选择性对齐 maestro 知识检索半套), R-002(召回可观测性基线), 锚定 grill 决策 D1–D14 / context-package C-001..C-014
**内部波次 (wave DAG, 按风险升序; 详见 plan 阶段)**:
- W1 可观测性+瘦 item(低): D3 score 透出 + D10 瘦 item + D4 绝对地板旋钮(默认0)
- W2 截断次序+冷启动(中): D11 先相关度后字节 + D9 BM25/store-walk 磁盘缓存(key=revision hash)
- W3 RRF 融合重构(高,带行为保持测试): D2 RRF/归一化替代裸加法
- W4 语义召回+形状统一(中): D5 fab_recall CJK 嵌入默认开 + D12 MCP/CLI 瘦 item 统一
- W5 fab_pending 统一接入(中): D13 接入 planContext 引擎+删 searchEntries + D14 triage 视图不设 ratio-floor 保完整性

**Success Criteria** (what must be TRUE):
  1. fab_recall 每条返回带可见 score(并可见信号分解),调用方能判断"为什么这条排前面"
  2. 召回截断先按相关度(top_k+ratio-floor)后按字节,字节闸退为安全网极少触发;dropped[]{id,reason} 常态可见
  3. BM25 与向量用 RRF/归一化融合,中文换一种说法仍能召回到同一条知识(语义稳定)
  4. fab_recall 默认启用 CJK 语义召回,常驻 MCP 路径无明显冷启动延迟
  5. hook(SessionStart/PreToolUse)冷启动延迟显著下降(磁盘缓存命中,实测可对比)
  6. fab_pending search 与 fab_recall 共用同一排序引擎、返回形状一致,且 triage 浏览不漏任何匹配项(无 ratio-floor 误藏)
  7. searchEntries 子串实现已删除,代码库只剩一套召回排序引擎

---

## Scope Decisions

- **In scope**: planContext 召回机(fab_recall + plan-context-hint CLI hook)的 RRF 融合、score 透出、瘦 item、相关度优先截断、CJK 语义默认开、磁盘缓存榨冷启动;fab_pending search 统一接入同一引擎(W5)。
- **Deferred**: 常驻 daemon(触发条件:W2 磁盘缓存落地后实测 hook 仍为瓶颈,且须 per-repo+per-session 隔离);代码符号索引/KG(YAGNI,便宜版退路=knowledge 增 relevance_symbols 字段)。
- **Out of scope**: maestro 代码图谱半套(code_fts/KG callers-callees/源权重 — Fabric 不索引代码);fab_review/propose/archive_scan/extract(写/扫描路径);给 fab_pending 加语义/嵌入排序作为独立目标(triage 子串/BM25 够用);把 fab_recall 改成 CLI(字节预算是 MCP 固有产物,误诊)。

## Progress

| Milestone | Phase | Status | Completed |
|-----------|-------|--------|-----------|
| 1. 召回质量与一致性对齐 | 1. 召回引擎重构与统一 | Not started | - |

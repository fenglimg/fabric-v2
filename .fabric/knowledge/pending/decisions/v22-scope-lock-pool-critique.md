---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-30T07:40:44.642Z
source_sessions: ["20260530-v22-pool-critique"]
proposed_reason: decision-confirmation
summary: "用户设 /goal 目标: 对 v2.2 全候选池(36 条)做多-LLM 对抗式批判审定, 锁定 scope, 产 roadmap-ready 集。守边界: 多-LLM 只 frame 内批判, frame 级 human 已拍。"
tags: ["v2.2", "roadmap", "retrieval", "scope-lock"]
relevance_scope: broad
x-fabric-idempotency-key: sha256:0a3cceaa24c738c52cdb43806ee760aba1ce4300ec9cd2340f5c8daffdc6eb88
---

## Summary

用户设 /goal 目标: 对 v2.2 全候选池(36 条)做多-LLM 对抗式批判审定, 锁定 scope, 产 roadmap-ready 集。守边界: 多-LLM 只 frame 内批判, frame 级 human 已拍。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

v2.2 全池 36 候选经 gemini+codex 双零上下文冷评 + claude 综合 quorum=3 批判, 终态 17 absorb / 16 defer / 3 reject。Wave1 检索地基 = MC3 修引导 + CJK→BM25→top_k→payload 统一截断链 + MC2 + H2。设计 7 条全 resolved(A6/A8/A18/A20/A21 defer, A9/A2 reject)。C2 向量 absorb(gemini) vs defer(codex) 真分歧升 human 待拍。MOAT-CLEAN + v2.1-BOUNDARY-CLEAN。v2.2 = 跨 rc 里程碑。

## Evidence

Recent paths:

- .workflow/.scratchpad/v22-roadmap-ready-candidate-set.md
- .workflow/.maestro/20260530-v22-pool-critique/status.json
- .workflow/.scratchpad/v22-master-consolidation.md

Notes:

- 用户设 /goal 目标: 对 v2.2 全候选池(36 条)做多-LLM 对抗式批判审定, 锁定 scope, 产 roadmap-ready 集。守边界: 多-LLM 只 frame 内批判, frame 级 human 已拍。

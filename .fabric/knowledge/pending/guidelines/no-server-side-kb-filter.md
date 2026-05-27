---
type: guidelines
maturity: draft
layer: team
created_at: 2026-05-27T06:30:12.757Z
source_sessions: ["a4978ef8-f7f7-42f7-ab58-a3852c677a9a"]
proposed_reason: decision-confirmation
summary: "rc.37 scoping 讨论中,用户挑战 TASK-10 (plan-context selectable algorithm audit+fix) 的设计前提。用户表达:\"算法不应该用服务端的吧?感觉用 llm 自己去抉择不是更好一点嘛?提供 description 和具体的 id 就行额,用服务器算法感觉不能够随机应变的感觉\"。明确锁定方向:server 端 relevance/selectable 过滤是 anti-pattern;LLM 看 description 自己选才是对的;TASK-10 reframe 为删 filter 而非修算法。用户最终确认\"可以入库\"。"
tags: []
relevance_scope: broad
intent_clues: ["designing or modifying any Fabric KB recall / retrieval / recommendation surface", "evaluating whether to add server-side relevance filter for KB candidates", "NOT for general-purpose search engines at >10K candidate scale"]
tech_stack: ["typescript", "nodejs", "fabric-mcp"]
impact: ["server-side filter blocks relevant entries from reaching LLM — observed 374→7→1 funnel breaks KB recommendation value prop", "server keyword/path matching cannot read user task nuance that lives only in LLM conversation context"]
must_read_if: "designing or modifying any Fabric retrieval / recall surface (plan-context, search, related_ids, KB recommendation)"
x-fabric-idempotency-key: sha256:a55825f07e6c2f48055a6937680620112ce8ec78ad25b749d9d498e0534676d7
---

## Summary

rc.37 scoping 讨论中,用户挑战 TASK-10 (plan-context selectable algorithm audit+fix) 的设计前提。用户表达:"算法不应该用服务端的吧?感觉用 llm 自己去抉择不是更好一点嘛?提供 description 和具体的 id 就行额,用服务器算法感觉不能够随机应变的感觉"。明确锁定方向:server 端 relevance/selectable 过滤是 anti-pattern;LLM 看 description 自己选才是对的;TASK-10 reframe 为删 filter 而非修算法。用户最终确认"可以入库"。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: rc.36 收尾后规划 rc.37 + 评估 v2.0.0 GA readiness;用户希望基于已有测评 framework 跑用户体验闭环 audit。
Turning point: 解释 TASK-10 selectable 算法时,用户挑战"为什么不让 LLM 自己选",一句"server 算法不能随机应变"把架构方向锁定。
含义: 这不只是 rc.37 单 task 修法变化,是 Fabric 所有 retrieval/recall surface 的 design rule——返回所有候选 + description,信任 LLM 做语义选择,不做 server 端预过滤。是 [[feedback-trust-recommendations]] 在 system-design 层的延伸。
TASK-10 影响: 由"P0 algo audit + retrieval 仿真回归"降为"小重构:删 selectable filter 直接全返回",工作量大幅下降。

## Evidence

Recent paths:

- .workflow/.lite-plan/rc36-extended-bundle-2026-05-26/progress.md
- .workflow/.lite-plan/rc36-extended-bundle-2026-05-26/plan.json
- .workflow/.lite-plan/rc36-extended-bundle-2026-05-26/planning-context.md

Notes:

- rc.37 scoping 讨论中,用户挑战 TASK-10 (plan-context selectable algorithm audit+fix) 的设计前提。用户表达:"算法不应该用服务端的吧?感觉用 llm 自己去抉择不是更好一点嘛?提供 description 和具体的 id 就行额,用服务器算法感觉不能够随机应变的感觉"。明确锁定方向:server 端 relevance/selectable 过滤是 anti-pattern;LLM 看 description 自己选才是对的;TASK-10 reframe 为删 filter 而非修算法。用户最终确认"可以入库"。

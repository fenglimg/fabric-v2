---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-30T07:40:25.917Z
source_sessions: ["20260530-v22-pool-critique"]
proposed_reason: decision-confirmation
summary: "用户主动纠正护城河定义: no-server-filter \"当前已经不存在了, 记忆中也去除\"; 离线零依赖\"主要还是通过 mcp 连接产生的行为, cli 属于附带效果\"。要求重新厘定护城河, 点明产品主要形态=AI Agent 交互内的 Hook/Skill/MCP + CLI 自带的知识维护更新。"
tags: ["moat", "product-strategy", "mcp-first", "retrieval"]
relevance_scope: broad
x-fabric-idempotency-key: sha256:3000266b0cd2a70f4a8581dc46e38c9f08a55082084ef813cbccc6c44454790e
---

## Summary

用户主动纠正护城河定义: no-server-filter "当前已经不存在了, 记忆中也去除"; 离线零依赖"主要还是通过 mcp 连接产生的行为, cli 属于附带效果"。要求重新厘定护城河, 点明产品主要形态=AI Agent 交互内的 Hook/Skill/MCP + CLI 自带的知识维护更新。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

v2.2 全池多-LLM 批判 session。批判前用户 frame 级纠正护城河 D 定义。这是整盘 moat_D_check 的基线, 错了会污染全部冲突判定。锁定后反转两条下游: top_k/BM25 不再撞护城河(纯质量工程), C2 向量反对理由大幅削弱。

## Evidence

Recent paths:

- .workflow/.scratchpad/v22-roadmap-ready-candidate-set.md
- .workflow/.maestro/20260530-v22-pool-critique/status.json
- packages/server/src/services/plan-context.ts

Notes:

- 用户主动纠正护城河定义: no-server-filter "当前已经不存在了, 记忆中也去除"; 离线零依赖"主要还是通过 mcp 连接产生的行为, cli 属于附带效果"。要求重新厘定护城河, 点明产品主要形态=AI Agent 交互内的 Hook/Skill/MCP + CLI 自带的知识维护更新。

---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-27T07:09:28.012Z
source_sessions: ["a4978ef8-f7f7-42f7-ab58-a3852c677a9a"]
proposed_reason: decision-confirmation
summary: "v2.0.0 GA 闭环体验 + 清理工作的 strategy 决策:(1) 用 6-wave plan (A 删 selectable+quarantine serve / B events.jsonl Plan B 拉入 GA / C UX 闭环 audit Phase 1-7 dogfood werewolf / D 工程 sweep 含 rc.x BREAKING 残留 + LICENSE + package.json metadata / E 文档清理含 CHANGELOG GA 汇总 + migration guide / F 测试补强含 fixture + cross-client parity + onboarding cliff 复测 / G GitHub polish + Release);(2) 用 P2 渐进式 audit sequencing — Phase 1 inventory + Phase 4 算法 audit 前置 (code-based 我直接跑),Phase 2/3/5 paper walkthrough + werewolf dogfood (user 端跑),Phase 6-7 收尾;(3) events.jsonl 心跳膨胀 (Plan B counter 化) 从 rc.37 deferred 拉入 GA scope, 因为 user-visible 痛点 (磁盘 + git diff + doctor 扫描慢) GA 用户不该承受;(4) 每 wave 低 subagent 执行 (per low-agent-spawn-cost),serial Edit/Write/Bash 优先,subagent 留给 wide grep 或 cross-LLM review。总估时 63-82h,可能 2-3 RC iteration 抵 GA。"
tags: []
relevance_scope: broad
intent_clues: ["planning v2.0.0 GA release closure work", "deciding sequencing of audit vs execution for large multi-wave plans", "evaluating whether to pull deferred rc.37 items into GA scope"]
tech_stack: ["typescript", "nodejs", "monorepo-pnpm", "fabric"]
impact: ["audit-parallel-with-execution 风险 D/E/F rework; audit-first 增加 critical path; P2 渐进式 是平衡点", "events.jsonl 心跳膨胀 是 user-visible (磁盘/git diff/doctor) 痛点, GA 不修会持续吃护费"]
must_read_if: "working on v2.0.0 GA closure plan or deciding whether to add/remove items from GA scope"
x-fabric-idempotency-key: sha256:45a46a76cd1c854d7b656f1f585d5398c3989896cc1062796c5a36e9d34514d5
---

## Summary

v2.0.0 GA 闭环体验 + 清理工作的 strategy 决策:(1) 用 6-wave plan (A 删 selectable+quarantine serve / B events.jsonl Plan B 拉入 GA / C UX 闭环 audit Phase 1-7 dogfood werewolf / D 工程 sweep 含 rc.x BREAKING 残留 + LICENSE + package.json metadata / E 文档清理含 CHANGELOG GA 汇总 + migration guide / F 测试补强含 fixture + cross-client parity + onboarding cliff 复测 / G GitHub polish + Release);(2) 用 P2 渐进式 audit sequencing — Phase 1 inventory + Phase 4 算法 audit 前置 (code-based 我直接跑),Phase 2/3/5 paper walkthrough + werewolf dogfood (user 端跑),Phase 6-7 收尾;(3) events.jsonl 心跳膨胀 (Plan B counter 化) 从 rc.37 deferred 拉入 GA scope, 因为 user-visible 痛点 (磁盘 + git diff + doctor 扫描慢) GA 用户不该承受;(4) 每 wave 低 subagent 执行 (per low-agent-spawn-cost),serial Edit/Write/Bash 优先,subagent 留给 wide grep 或 cross-LLM review。总估时 63-82h,可能 2-3 RC iteration 抵 GA。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: rc.36 已 ship,规划 v2.0.0 GA 发布前的闭环体验 audit + 清理工作。
Turning point: 用户 callout events.jsonl 优化"是不是忘了" — 触发把 rc.37 deferred 拉回 GA scope 的判断;用户问 Phase 1-7 audit 在 plan 哪里 — 触发 P2 audit-early sequencing 决策。
Strategy: 6 wave (A 决策性 deletion / B events.jsonl Plan B / C UX audit Phase 1-7 / D 工程 sweep / E 文档 + CHANGELOG / F 测试补强 / G GitHub + Release),P2 sequencing 让 audit Phase 1+4 (code-based) 前置以暴露 hidden BLOCKER, Phase 2/3/5 dogfood werewolf, Wave A/B 与 audit 同步推进。
约束: 每 wave 低 subagent (per [[feedback-low-agent-spawn-cost]]),serial 主线优先;每 task per-commit per-push 中文 message 保 traceable;改 shared schema 必 rebuild dist (per [[feedback-shared-rebuild-on-schema-change]]);release 前 tsc --noEmit (per [[feedback-local-tsc-vs-ci-tsc]])。
含义: 此 plan 是 v2.0.0 GA 的 final approach;之后增改通过 update 此 decision body 而非新决策。

## Evidence

Recent paths:

- .workflow/.lite-plan/rc36-extended-bundle-2026-05-26/progress.md
- .workflow/.lite-plan/rc36-extended-bundle-2026-05-26/plan.json

Notes:

- v2.0.0 GA 闭环体验 + 清理工作的 strategy 决策:(1) 用 6-wave plan (A 删 selectable+quarantine serve / B events.jsonl Plan B 拉入 GA / C UX 闭环 audit Phase 1-7 dogfood werewolf / D 工程 sweep 含 rc.x BREAKING 残留 + LICENSE + package.json metadata / E 文档清理含 CHANGELOG GA 汇总 + migration guide / F 测试补强含 fixture + cross-client parity + onboarding cliff 复测 / G GitHub polish + Release);(2) 用 P2 渐进式 audit sequencing — Phase 1 inventory + Phase 4 算法 audit 前置 (code-based 我直接跑),Phase 2/3/5 paper walkthrough + werewolf dogfood (user 端跑),Phase 6-7 收尾;(3) events.jsonl 心跳膨胀 (Plan B counter 化) 从 rc.37 deferred 拉入 GA scope, 因为 user-visible 痛点 (磁盘 + git diff + doctor 扫描慢) GA 用户不该承受;(4) 每 wave 低 subagent 执行 (per low-agent-spawn-cost),serial Edit/Write/Bash 优先,subagent 留给 wide grep 或 cross-LLM review。总估时 63-82h,可能 2-3 RC iteration 抵 GA。

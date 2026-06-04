---
type: decisions
maturity: draft
layer: team
created_at: 2026-06-02T02:35:56.551Z
source_sessions: ["20260601-issues-audit"]
proposed_reason: decision-confirmation
summary: "在 rc2 issues-audit 收尾, 用户对 5 条 confirmed-real 但 defer 的 CARRY-RC3 项拍板归属。KP-leak 簇(F11/F15/F16)在 option A(rc2 最小补丁)与 option B(defer 到 v2.1 global-refactor)间权衡后选 B; http-experimental 包 bug(F56/F63)defer 到包正式化。用户原话\"全部按照你推荐的就行\"确认 rationale 锁定。"
tags: ["rc-scoping", "defer-discipline", "refactor-boundary", "triage"]
relevance_scope: broad
intent_clues: ["confirmed bug 落在已规划的大重构会触及的代码面内时", "confirmed bug 宿主是 workspace-excluded/quarantine 实验包时", "NOT 用于独立可修、不被任何 in-flight 重构触及的 bug(那些应当 rc 内直接修)"]
impact: ["rc 内打最小补丁会被即将到来的重构推翻 = 返工", "半成品补丁 ripple 到既有 read path 引入回归面", "severity 误导: critical 也可能正确地 defer 到对的边界"]
must_read_if: "triage confirmed-real bug 且其修复面与已规划重构里程碑或隔离实验包重叠时"
x-fabric-idempotency-key: sha256:0164607ca9ccea5f04d3bcc1c1d163f8acec4e1f61976200262c30c438a845b6
---

## Summary

在 rc2 issues-audit 收尾, 用户对 5 条 confirmed-real 但 defer 的 CARRY-RC3 项拍板归属。KP-leak 簇(F11/F15/F16)在 option A(rc2 最小补丁)与 option B(defer 到 v2.1 global-refactor)间权衡后选 B; http-experimental 包 bug(F56/F63)defer 到包正式化。用户原话"全部按照你推荐的就行"确认 rationale 锁定。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

mode② 审计收尾: 64 簇 triage 完成, 18 FIX-NOW 全修, 剩 5 confirmed-real 落在"即将到来的架构重构面内"或"隔离实验包内"。转折点: 不在当前 rc 强修, 而按修复的正确归属边界 defer。两个实例锚定同一原则: 修复成本/正确性取决于它落在哪个边界, 不是 severity。

## Evidence

Recent paths:

- .workflow/.maestro/20260601-issues-audit/status.json

Notes:

- 在 rc2 issues-audit 收尾, 用户对 5 条 confirmed-real 但 defer 的 CARRY-RC3 项拍板归属。KP-leak 簇(F11/F15/F16)在 option A(rc2 最小补丁)与 option B(defer 到 v2.1 global-refactor)间权衡后选 B; http-experimental 包 bug(F56/F63)defer 到包正式化。用户原话"全部按照你推荐的就行"确认 rationale 锁定。

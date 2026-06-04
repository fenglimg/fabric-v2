---
id: KT-PIT-9102
type: pitfalls
maturity: verified
layer: team
semantic_scope: team
visibility_store: "team"
created_at: 2026-05-14T02:58:33.549Z
source_sessions: ["WFS-2026-05-14-fabric-skills-contract-fix"]
proposed_reason: wrong-turn-revert
tags: []
---

## Summary

添加新 doctor lint 前必须扫现有编号（grep inspectXxx 函数 + lint# 注释），不能依赖外部规划文档判断"下一个可用编号"。本次 TASK-003 规划文档要求 lint #26，实际 doctor.ts 里 #26 (`narrow_too_few`) 和 #27 (`session_hints_stale`) 都已被 rc.6 TASK-021/023 占用，最终 bump 到 #28；如果不查直接用 #26 就会编号冲突。

## Why proposed

wrong-turn-revert — 尝试某路径后回退，错误路径本身是值得记录的 pitfall。

## Session context

Session goal: 实施 TASK-003 给 fabric doctor 加 lint #26 relevance_fields_missing + apply-lint mutation。
Turning point: agent 实施时读 doctor.ts 现有 inspectXxx 列表，发现 #26/#27 已被占用，必须从规划文档的 #26 bump 到 #28，并在代码注释 + docs/configuration.md 记录编号 bump 决策。
Result: lint 编号实际为 #28；规划文档与实施代码之间需要这一层校验。
Implication: 未来任何 lint# 相关规划必须先跑 grep 校实再下定数；规划阶段写 lint# 应该用占位符（"next-available"）而非硬编码数字。

## Evidence

Recent paths:

- packages/server/src/services/doctor.ts
- packages/server/src/services/doctor.test.ts

Notes:

- 添加新 doctor lint 前必须扫现有编号（grep inspectXxx 函数 + lint# 注释），不能依赖外部规划文档判断"下一个可用编号"。本次 TASK-003 规划文档要求 lint #26，实际 doctor.ts 里 #26 (`narrow_too_few`) 和 #27 (`session_hints_stale`) 都已被 rc.6 TASK-021/023 占用，最终 bump 到 #28；如果不查直接用 #26 就会编号冲突。

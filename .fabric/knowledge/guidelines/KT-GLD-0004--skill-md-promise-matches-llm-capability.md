---
id: KT-GLD-0004
type: guidelines
maturity: verified
layer: team
created_at: 2026-05-14T02:59:02.636Z
source_sessions: ["WFS-2026-05-14-fabric-skills-contract-fix"]
proposed_reason: decision-confirmation
tags: []
---

## Summary

SKILL.md 给 LLM 的指令承诺不能超出 LLM 实际工具能力。LLM 只有 Write（直接 open+truncate+write，非原子）和 Bash，没有 atomicWriteJson 工具。文档不能笼统承诺"原子写入"让 LLM 自行揣摩——必须明示两步模拟：Write→`.tmp` + Bash `mv`（mv 在 POSIX 是原子）。同样 events.jsonl append 需明确单行 < 4KB（PIPE_BUF）约束，超过会有并发交织风险。SKILL.md 写作准则：可执行性 > 抽象优雅。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: 修复 import SKILL.md 的 state.json 原子写漂移（文档承诺 atomicWriteJson 但 LLM 没这个工具）。
Turning point: 设计 TASK-011 时面对 3 选项——(A) Bash 两步模拟、(B) 接受非原子、(C) 新 MCP 工具兜底——选 A 后意识到这条规则是通用的：SKILL.md 写作必须严格匹配 LLM 工具能力，不能用"原子写入"这种抽象描述。
Result: import SKILL.md 加了显式 Phase 0 .tmp 残留扫描 + 2-step atomic pattern + corruption recovery；三 skill 都加了 events.jsonl <4KB 约束注释。
Implication: 任何未来 SKILL.md 章节涉及文件系统/IPC 操作的描述都必须显式列出 LLM 可执行的 Write/Bash/Edit 步骤，避免"魔法"动词。这是 skill-authoring 通用规则。

## Evidence

Recent paths:

- packages/cli/templates/skills/fabric-import/SKILL.md
- packages/cli/templates/skills/fabric-archive/SKILL.md
- packages/cli/templates/skills/fabric-review/SKILL.md

Notes:

- SKILL.md 给 LLM 的指令承诺不能超出 LLM 实际工具能力。LLM 只有 Write（直接 open+truncate+write，非原子）和 Bash，没有 atomicWriteJson 工具。文档不能笼统承诺"原子写入"让 LLM 自行揣摩——必须明示两步模拟：Write→`.tmp` + Bash `mv`（mv 在 POSIX 是原子）。同样 events.jsonl append 需明确单行 < 4KB（PIPE_BUF）约束，超过会有并发交织风险。SKILL.md 写作准则：可执行性 > 抽象优雅。

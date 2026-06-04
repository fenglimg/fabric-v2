---
id: KT-DEC-9002
type: decisions
maturity: draft
layer: team
semantic_scope: team
visibility_store: "team"
created_at: 2026-05-18T02:31:33.670Z
source_sessions: ["1bced005-71b4-4d95-8798-611c3dfcf5ae", "36f76853-d78d-4f6e-9028-303d404e93ca"]
proposed_reason: decision-confirmation
tags: []
relevance_scope: narrow
relevance_paths: ["packages/cli/src/commands/install.ts", "packages/cli/src/commands/doctor.ts", "packages/shared/src/templates/bootstrap-canonical.ts", ".fabric/AGENTS.md"]
---

## Summary

grill-me 2026-05-15 锁定 rc.19 bootstrap consolidation 方案 X':用文件边界代替 marker 段边界。Fabric 写 .fabric/AGENTS.md 当 install snapshot anchor,项目自定义放 .fabric/project-rules.md;三端 (Claude/Codex/Cursor) managed block byte-level concat 两文件,doctor 字节级 diff,drift→abort 由 fab doctor --fix 接受。理由:机械化最干净,fabric 永远不碰 project-rules.md。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: 在 rc.18 soak 期间锁定下一对 rc (bootstrap consolidation + cite policy)。
Turning point: 在 marker-segment-boundary vs file-boundary 之间反复 grill 后,用户拍板 option 3 —— "用文件边界代替段边界,机械化最干净。Fabric 永远不碰 project-rules.md,doctor 对账只比 .fabric/AGENTS.md。"
Result: rc.19 12-commit chain 落地,managed block = `.fabric/AGENTS.md` + `\n---\n` + `.fabric/project-rules.md`;marker 改名 fabric:knowledge-base → fabric:bootstrap;两层 drift 检测 (upstream canonical + downstream 三端 block) 全字节级。

## Evidence

Recent paths:

- packages/cli/src/commands/install.ts
- packages/cli/src/commands/doctor.ts
- packages/shared/src/templates/bootstrap-canonical.ts
- .fabric/AGENTS.md
- .fabric/project-rules.md

Notes:

- grill-me 2026-05-15 锁定 rc.19 bootstrap consolidation 方案 X':用文件边界代替 marker 段边界。Fabric 写 .fabric/AGENTS.md 当 install snapshot anchor,项目自定义放 .fabric/project-rules.md;三端 (Claude/Codex/Cursor) managed block byte-level concat 两文件,doctor 字节级 diff,drift→abort 由 fab doctor --fix 接受。理由:机械化最干净,fabric 永远不碰 project-rules.md。

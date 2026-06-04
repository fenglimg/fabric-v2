---
id: KT-PIT-9103
type: pitfalls
maturity: draft
layer: team
semantic_scope: team
visibility_store: "team"
created_at: 2026-05-18T02:31:58.929Z
source_sessions: ["8baa566e-4561-408e-acac-b5fc7cbca9e3"]
proposed_reason: diagnostic-then-fix
tags: []
relevance_scope: narrow
relevance_paths: ["scripts/lint-protected-tokens.ts", "packages/shared/src/templates/bootstrap-canonical.ts"]
---

## Summary

rc.21 CI 的 Lint Protected tokens 阶段崩在 readdir() ENOENT —— packages/cli/templates/bootstrap 目录已在 rc.19 TASK-006 搬到 TS canonical (packages/shared/src/templates/bootstrap-canonical.ts),但 lint 脚本仍引用旧路径。修复:try/catch ENOENT → 返回空数组,让 bootstrap branch 变 no-op。rc.22 跟进:让 lint 直接指向 TS canonical 拿更强 drift 防护。

## Why proposed

diagnostic-then-fix — 诊断过程发现新模式或踩坑，修复后值得沉淀。

## Session context

Session goal: rc.21 重打 tag 后定位 GitHub Action CI 红的根因。
Turning point: MODULE_TYPELESS_PACKAGE_JSON warning 是噪音 (warning 不阻断),真正阻断的是 readdir 对已删除目录抛 ENOENT —— rc.19 把 bootstrap 内容搬到 TS canonical 后,lint 脚本没同步更新引用路径。
Result: scripts/lint-protected-tokens.ts 加 try/catch ENOENT 兜底 (commit 5ac25cf);本地 repro 通过 "3 template files checked"。Lesson: 内容搬迁/删除目录时必须 grep 所有 readdir/readFile 引用旧路径的脚本,可选目录的 IO 应优雅降级而非 crash。

## Evidence

Recent paths:

- scripts/lint-protected-tokens.ts
- packages/shared/src/templates/bootstrap-canonical.ts
- package.json

Notes:

- rc.21 CI 的 Lint Protected tokens 阶段崩在 readdir() ENOENT —— packages/cli/templates/bootstrap 目录已在 rc.19 TASK-006 搬到 TS canonical (packages/shared/src/templates/bootstrap-canonical.ts),但 lint 脚本仍引用旧路径。修复:try/catch ENOENT → 返回空数组,让 bootstrap branch 变 no-op。rc.22 跟进:让 lint 直接指向 TS canonical 拿更强 drift 防护。

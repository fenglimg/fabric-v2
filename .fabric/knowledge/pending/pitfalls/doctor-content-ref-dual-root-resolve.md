---
type: pitfalls
maturity: draft
layer: team
created_at: 2026-05-29T05:16:30.275Z
source_sessions: ["3ac70b48-e00f-404b-95cd-00d87ddd404f"]
proposed_reason: diagnostic-then-fix
summary: "用户报 doctor 有个 meta_manually_diverged 疑似误报,要我核实是否真存在。查实:inspectMetaManuallyDiverged 用裸 join(projectRoot, contentRef) 解析所有节点路径,但 dual-root 布局(KT-DEC-0003)下 personal 节点 content_ref 是 ~/.fabric/knowledge/ 前缀,被拼成 <repo>/~/.fabric/... 必然不存在 → 永久误报, --fix reconcile 用同样 ref 加回形成自指循环。修复用 knowledge-sync 既有的 resolveContentRefPath(导出之),已在 commit 238ada9 落地 + 2 回归测试。"
tags: ["doctor", "dual-root", "content-ref", "personal-layer"]
relevance_scope: narrow
relevance_paths: ["packages/server/src/services/doctor.ts", "packages/server/src/services/knowledge-sync.ts"]
tech_stack: ["typescript", "nodejs"]
impact: ["personal 节点 (~/.fabric/ 前缀) 被永久误报 meta_manually_diverged", "--fix reconcile 加回同 ref 形成自指循环, 用户无法清除"]
must_read_if: "新增/修改 doctor 检查里把 knowledge 节点的 content_ref 或 file 解析成磁盘绝对路径时"
evidence_paths: ["packages/shared/src/schemas/agents-meta.ts", ".fabric/agents.meta.json"]
x-fabric-idempotency-key: sha256:01edd2703ca16f76ff5cdbd6dc3a9bf31be59dc42347c177ab98520476a08af0
---

## Summary

用户报 doctor 有个 meta_manually_diverged 疑似误报,要我核实是否真存在。查实:inspectMetaManuallyDiverged 用裸 join(projectRoot, contentRef) 解析所有节点路径,但 dual-root 布局(KT-DEC-0003)下 personal 节点 content_ref 是 ~/.fabric/knowledge/ 前缀,被拼成 <repo>/~/.fabric/... 必然不存在 → 永久误报, --fix reconcile 用同样 ref 加回形成自指循环。修复用 knowledge-sync 既有的 resolveContentRefPath(导出之),已在 commit 238ada9 落地 + 2 回归测试。

## Why proposed

diagnostic-then-fix — 诊断过程发现新模式或踩坑，修复后值得沉淀。

## Session context

Session goal: 核实并修复 doctor meta_manually_diverged 误报。Turning point: 发现 personal 节点 KP-PRO-0001 的 content_ref 是 ~/.fabric/ 前缀, 裸 join(projectRoot,...) 解析错 → existsSync false → 误判 extraMetaEntries。Result: 改用 personal-root-aware 的 resolveContentRefPath, 误报消除 (doctor 从 warn 转 ok)。

## Evidence

Recent paths:

- packages/server/src/services/doctor.ts
- packages/server/src/services/knowledge-sync.ts
- packages/server/src/services/doctor.test.ts

Notes:

- 用户报 doctor 有个 meta_manually_diverged 疑似误报,要我核实是否真存在。查实:inspectMetaManuallyDiverged 用裸 join(projectRoot, contentRef) 解析所有节点路径,但 dual-root 布局(KT-DEC-0003)下 personal 节点 content_ref 是 ~/.fabric/knowledge/ 前缀,被拼成 <repo>/~/.fabric/... 必然不存在 → 永久误报, --fix reconcile 用同样 ref 加回形成自指循环。修复用 knowledge-sync 既有的 resolveContentRefPath(导出之),已在 commit 238ada9 落地 + 2 回归测试。

---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-27T06:55:06.827Z
source_sessions: ["a4978ef8-f7f7-42f7-ab58-a3852c677a9a"]
proposed_reason: decision-confirmation
summary: "v2.0.0 GA readiness audit 中讨论 fabric serve 是否需要显式暴露。Audit 发现:三 client (CC/Cursor/Codex) 全走 MCP stdio 模式,HTTP server (fabric serve) 没有任何 client 消费;无 web UI 计划;rc.29 BUG-K1 整套 default-deny hardening 都是为 HTTP server 做的 attack surface 维护税。用户在「删干净」/「浅 hide」/「中 hide 含文档清理」/「深 hide / quarantine 独立包」4 选项里选 C quarantine,rationale: 留 web UI 重启入口但脱离主线维护。Audit 验证 quarantine 对 MCP/Skill/CLI 其他子命令/Hook/外部 client 零功能影响,fabric install 的 lock check 退化为 no-op 无害。"
tags: []
relevance_scope: narrow
relevance_paths: ["packages/cli/src/commands/serve.ts", "packages/server/src/http.ts", "packages/server/src/services/serve-lock.ts", "packages/server/src/middleware/bearer-auth.ts"]
intent_clues: ["evaluating whether to delete or hide a subsystem with non-zero future reuse potential", "Fabric subsystem becoming dead code due to vision pivot (e.g. HTTP server when only stdio path used)", "NOT for actively-used subsystems"]
tech_stack: ["typescript", "nodejs", "monorepo-pnpm"]
impact: ["浅 hide 持续吃 attack surface + test maintenance 但无 simplicity 红利", "完全 delete 损失未来 web UI 重启入口", "quarantine 各取折中:主线 zero burden + archive 可复活"]
must_read_if: "deciding whether to delete or quarantine a Fabric subsystem with potential future reuse but zero current consumer"
x-fabric-idempotency-key: sha256:1766b48273c7dd485b9d37c0c7a55f0d615b119a37ad336d369a47db3cc1b110
---

## Summary

v2.0.0 GA readiness audit 中讨论 fabric serve 是否需要显式暴露。Audit 发现:三 client (CC/Cursor/Codex) 全走 MCP stdio 模式,HTTP server (fabric serve) 没有任何 client 消费;无 web UI 计划;rc.29 BUG-K1 整套 default-deny hardening 都是为 HTTP server 做的 attack surface 维护税。用户在「删干净」/「浅 hide」/「中 hide 含文档清理」/「深 hide / quarantine 独立包」4 选项里选 C quarantine,rationale: 留 web UI 重启入口但脱离主线维护。Audit 验证 quarantine 对 MCP/Skill/CLI 其他子命令/Hook/外部 client 零功能影响,fabric install 的 lock check 退化为 no-op 无害。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: v2.0.0 GA readiness audit (UX 闭环 lens),识别可删/可缩的 simplicity-win。
Turning point: 用户问"是否需要显式暴露 fabric server,当前没有 web 页面计划"。Audit 发现 HTTP server 是 v1.8 多协议愿景残留,实际 client 全 stdio。
权衡: 4 选项(纯删 / 浅 hide / 中 hide / quarantine 独立包),用户选 quarantine——保留 web UI 未来选项但脱离主线 CI/test/hardening 维护税。
含义: quarantine 是 simplicity-win 的折中形态,适用于「有非零未来复用概率但当前零消费者」的子系统。区别于完全 delete: 保留 archive;区别于 hide: 真脱离主线维护责任。
执行边界: 新包 packages/server-http-experimental/ (private + 默认不 build),主线删 serve.ts/http.ts/serve-lock/bearer-auth + 相关 docs/i18n/tests。

## Evidence

Recent paths:

- packages/cli/src/commands/serve.ts
- packages/server/src/http.ts
- packages/server/src/index.ts
- packages/cli/.mcp.json

Notes:

- v2.0.0 GA readiness audit 中讨论 fabric serve 是否需要显式暴露。Audit 发现:三 client (CC/Cursor/Codex) 全走 MCP stdio 模式,HTTP server (fabric serve) 没有任何 client 消费;无 web UI 计划;rc.29 BUG-K1 整套 default-deny hardening 都是为 HTTP server 做的 attack surface 维护税。用户在「删干净」/「浅 hide」/「中 hide 含文档清理」/「深 hide / quarantine 独立包」4 选项里选 C quarantine,rationale: 留 web UI 重启入口但脱离主线维护。Audit 验证 quarantine 对 MCP/Skill/CLI 其他子命令/Hook/外部 client 零功能影响,fabric install 的 lock check 退化为 no-op 无害。

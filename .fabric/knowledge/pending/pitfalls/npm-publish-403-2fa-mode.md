---
type: pitfalls
maturity: draft
layer: team
created_at: 2026-05-20T04:55:29.874Z
source_sessions: []
proposed_reason: diagnostic-then-fix
tags: []
relevance_scope: broad
relevance_paths: []
intent_clues: ["when release.yml publish job fails with 404/403 on npm scoped package", "when error cites 'granular access token with bypass 2fa enabled is required'", "NOT for genuine first-time scoped package creation"]
tech_stack: ["github-actions", "npm", "release-pipeline", "ci-cd"]
impact: ["浪费 30+ 分钟反复生 token 重 push,真正根因是账号级 2FA 模式而非 token 自身", "Release tag 已 push 但 npm 没拿到包,下游 consumer 安装会拿不到 rc.N", "诊断思路被 404 误导:'package 不存在' 错觉,实际是 auth 被掩盖"]
must_read_if: "Release workflow publish job fails with 403/404 on @fenglimg npm scope after tag push"
x-fabric-idempotency-key: sha256:e0ae0084b608f5aa78a20c648b625e4116bf32fd46dc4794f0100f1477fffa81
---

## Summary

用户通过 /release-rc skill 发 v2.0.0-rc.26 时 Release workflow 的 npm publish job 连挂两次:第一次 404 PUT "is not in this registry"(NPM_TOKEN 过期),第二次 403 "granular access token with bypass 2fa enabled is required"。诊断后发现 npm 账号 2FA 模式为 "Authentication and writes" 时 granular token 无法 bypass per-publish OTP — 必须改账号 2FA 模式为 "Authentication only",不是重新生 token。第三次 retry 绿。

## Why proposed

diagnostic-then-fix — 诊断过程发现新模式或踩坑，修复后值得沉淀。

## Session context

Session goal: 通过 /release-rc skill 发布 v2.0.0-rc.26 (doctor i18n closure)。
Turning point: Release workflow publish job 连挂两次 — 第一次 404 PUT 误以为 token 过期,重生 granular token 后第二次 403 揭示真正根因是 npm 账号 2FA 模式拦截 granular token publish。
Diagnosis: 404 PUT 在已存在的 scoped package 上 = npm 把 401/403 auth 错误伪装成 404;而 403 message "granular access token with bypass 2fa enabled is required" 指向账号 2FA 模式。
Result: 改 npmjs.com → Account → Two-Factor Authentication 模式从 "Authentication and writes" 到 "Authentication only";登录仍需 OTP(保留安全),publish 不需要(CI 友好)。第三次 retry 全绿,@fenglimg/fabric-{shared,server,cli}@2.0.0-rc.26 publish 成功。

## Evidence

Recent paths:

- .github/workflows/release.yml
- .fabric/fabric-config.json
- package.json
- packages/cli/package.json
- packages/server/package.json
- packages/shared/package.json
- CHANGELOG.md
- .gitignore

Notes:

- 用户通过 /release-rc skill 发 v2.0.0-rc.26 时 Release workflow 的 npm publish job 连挂两次:第一次 404 PUT "is not in this registry"(NPM_TOKEN 过期),第二次 403 "granular access token with bypass 2fa enabled is required"。诊断后发现 npm 账号 2FA 模式为 "Authentication and writes" 时 granular token 无法 bypass per-publish OTP — 必须改账号 2FA 模式为 "Authentication only",不是重新生 token。第三次 retry 绿。

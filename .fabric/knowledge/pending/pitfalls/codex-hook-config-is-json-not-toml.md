---
type: pitfalls
maturity: draft
layer: team
created_at: 2026-05-10T11:29:43.864Z
source_session: WFS-rc2-impl-2026-05-10
tags: []
x-fabric-idempotency-key: sha256:9a2eca53416b9925492a8c43af45723f5562eb98c606b57d9222a1aaf9848cc3
---

## Summary

陷阱：Codex CLI 的 project-level hook 配置文件是 .codex/hooks.json，不是 .codex/hooks.toml。用户级别的 MCP 配置 (~/.codex/config.toml) 才是 TOML；项目级 hooks 使用 JSON。排查锚点：packages/cli/src/config/resolver.ts:157 显式探测 existsSync(workspaceRoot, '.codex', 'hooks.json')。rc.2 原始 handoff.json 误标为 .toml，已在 schema-deviations 表里更正。

## Evidence (call 1)

Recent paths:

- packages/cli/src/config/resolver.ts
- packages/cli/templates/hooks/configs/codex-hooks.json

Notes:

陷阱：Codex CLI 的 project-level hook 配置文件是 .codex/hooks.json，不是 .codex/hooks.toml。用户级别的 MCP 配置 (~/.codex/config.toml) 才是 TOML；项目级 hooks 使用 JSON。排查锚点：packages/cli/src/config/resolver.ts:157 显式探测 existsSync(workspaceRoot, '.codex', 'hooks.json')。rc.2 原始 handoff.json 误标为 .toml，已在 schema-deviations 表里更正。

## Evidence (call 2)

陷阱：Codex CLI 的 project-level hook 配置文件是 .codex/hooks.json，不是 .codex/hooks.toml。用户级别的 MCP 配置 (~/.codex/config.toml) 才是 TOML；项目级 hooks 使用 JSON。排查锚点：packages/cli/src/config/resolver.ts:157 显式探测 existsSync(workspaceRoot, '.codex', 'hooks.json')。rc.2 原始 handoff.json 误标为 .toml，已在 schema-deviations 表里更正。

## Evidence (call 3)

陷阱：Codex CLI 的 project-level hook 配置文件是 .codex/hooks.json，不是 .codex/hooks.toml。用户级别的 MCP 配置 (~/.codex/config.toml) 才是 TOML；项目级 hooks 使用 JSON。排查锚点：packages/cli/src/config/resolver.ts:157 显式探测 existsSync(workspaceRoot, '.codex', 'hooks.json')。rc.2 原始 handoff.json 误标为 .toml，已在 schema-deviations 表里更正。

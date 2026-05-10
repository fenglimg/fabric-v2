---
type: guidelines
maturity: draft
layer: team
created_at: 2026-05-10T11:29:43.867Z
source_session: WFS-rc2-impl-2026-05-10
tags: []
x-fabric-idempotency-key: sha256:9ee3493ede177e9452047f9cb6cf4e19ff5cf4d687ce3fe51b361aa94e637e3c
---

## Summary

指导：当向已存在的 .claude/settings.json 合并 hooks.Stop[] 数组时，必须使用 deepMerge 的 arrayAppendPaths 选项 （按 command 字符串 dedupe），而非默认的数组替换语义。默认 deepMerge 在 packages/cli/src/config/json.ts:18-39 直接 REPLACE 数组，会覆盖用户已有的 Stop 钩子。TASK-005 已扩展 deepMerge 支持 arrayAppendPaths: ['hooks.Stop'] 以保留用户配置且对 fabric-archive 入口去重。复用模式：未来任何写入 settings.json hooks.* 数组的 init 步骤必须沿用此选项。

## Evidence (call 1)

Recent paths:

- packages/cli/src/config/json.ts
- packages/cli/src/install/skills-and-hooks.ts

Notes:

指导：当向已存在的 .claude/settings.json 合并 hooks.Stop[] 数组时，必须使用 deepMerge 的 arrayAppendPaths 选项 （按 command 字符串 dedupe），而非默认的数组替换语义。默认 deepMerge 在 packages/cli/src/config/json.ts:18-39 直接 REPLACE 数组，会覆盖用户已有的 Stop 钩子。TASK-005 已扩展 deepMerge 支持 arrayAppendPaths: ['hooks.Stop'] 以保留用户配置且对 fabric-archive 入口去重。复用模式：未来任何写入 settings.json hooks.* 数组的 init 步骤必须沿用此选项。

## Evidence (call 2)

指导：当向已存在的 .claude/settings.json 合并 hooks.Stop[] 数组时，必须使用 deepMerge 的 arrayAppendPaths 选项 （按 command 字符串 dedupe），而非默认的数组替换语义。默认 deepMerge 在 packages/cli/src/config/json.ts:18-39 直接 REPLACE 数组，会覆盖用户已有的 Stop 钩子。TASK-005 已扩展 deepMerge 支持 arrayAppendPaths: ['hooks.Stop'] 以保留用户配置且对 fabric-archive 入口去重。复用模式：未来任何写入 settings.json hooks.* 数组的 init 步骤必须沿用此选项。

## Evidence (call 3)

指导：当向已存在的 .claude/settings.json 合并 hooks.Stop[] 数组时，必须使用 deepMerge 的 arrayAppendPaths 选项 （按 command 字符串 dedupe），而非默认的数组替换语义。默认 deepMerge 在 packages/cli/src/config/json.ts:18-39 直接 REPLACE 数组，会覆盖用户已有的 Stop 钩子。TASK-005 已扩展 deepMerge 支持 arrayAppendPaths: ['hooks.Stop'] 以保留用户配置且对 fabric-archive 入口去重。复用模式：未来任何写入 settings.json hooks.* 数组的 init 步骤必须沿用此选项。

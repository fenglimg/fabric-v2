---
name: fabric-init
description: Use this skill when `.fabric/forensic.json` exists and this repository still needs the remaining Fabric initialization steps.
---

## Hard Rules (不要翻译受保护 token)

MUST: 先读取 `.fabric/forensic.json`，再做其他动作。
MUST: 把 `.fabric/bootstrap/README.md` 视为当前仓库的初始化说明。
MUST: 如果 `.fabric/init-context.json` 已存在，立即停止并报告当前仓库看起来已经完成后续初始化。
MUST: 使用 `.fabric/forensic.json` 和仓库结构中的依据，判断接下来该做什么。
MUST: Preserve protected tokens exactly: `AGENTS.md`, `FABRIC.md`, `.fabric/agents.meta.json`, `.fabric/init-context.json`, `.fabric/forensic.json`, `MUST`, `NEVER`.
NEVER: 在没有检查 `.fabric/init-context.json` 的情况下声称初始化已经完成。
NEVER: 改写或翻译受保护 token。
NEVER: 在判断下一步初始化动作时忽略 `.fabric/bootstrap/README.md`。

## Purpose

当你在 Codex 中处理这个仓库，并且 `fab init` 已经生成 `.fabric/forensic.json` 时，使用这个 skill 继续完成仓库专属的 Fabric 初始化。目标是基于当前仓库的初始化依据和内部说明，明确下一步该做什么，而不是重新解释一遍通用流程。

## Workflow

1. 读取 `.fabric/forensic.json`。
2. 读取 `.fabric/bootstrap/README.md`。
3. 检查 `.fabric/init-context.json` 是否已经存在。
4. 如果初始化仍未完成，明确总结当前仓库接下来要做的初始化动作。
5. 只讨论这个仓库的后续初始化，不扩展到无关建议。

# Fabric Bootstrap

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Before ANY code reading, architecture planning, or logic modification, call the MCP tool `fab_get_rules(path=<target file>)` to retrieve shadow constraints from `.fabric/agents/`.
MUST: When creating or changing an L1/L2 rule node, call `fab_update_registry`; keep `.fabric/agents.meta.json` synchronized through the tool.
MUST: Stop and ask the human before editing any `@HUMAN` protected range listed in `.fabric/human-lock.json`.
MUST: After each complete task, call `fab_append_intent` to write one intent ledger entry.
MUST: Preserve protected tokens exactly: `AGENTS.md`, `FABRIC.md`, `.fabric/agents/`, `.fabric/agents.meta.json`, `.fabric/human-lock.json`, `ledger_entry`, `agent_meta`, `shadow constraints`, `Shadow Mirroring`, `MUST`, `NEVER`.
NEVER: Translate, rename, or paraphrase MCP tool names, JSON keys, file paths, or the keywords `MUST` and `NEVER`.
NEVER: Reason about or modify code before obtaining local shadow context via MCP.
NEVER: Edit `.fabric/agents.meta.json` directly.
NEVER: Ignore stale or human-lock warnings returned by Fabric tools.

## 使用说明 / Explanation

- 本项目使用 Fabric Protocol 管理 AI 规则、分层 `AGENTS.md` 和意图记录。
- 上方 `CORE RULES` 是给 AI 客户端稳定执行的英文硬规则，不要翻译或改写其中的受保护 token。
- 本仓库采用 `Shadow Mirroring` 架构。业务目录如 `src/`、`packages/` 等包含 ZERO rule files；所有 AI 规则都放在 `.fabric/agents/`，其中按源码路径 1:1 镜像，跨领域规则放在 `.fabric/agents/_cross/`。
- 在任何代码阅读、架构规划或逻辑修改之前，先调用 `fab_get_rules` 获取本地 shadow context，避免出现 perception-phase vacuum，只凭上下文记忆推断规则。
- 新增或调整 L1/L2 规则节点时使用 `fab_update_registry`，不要手动改 `.fabric/agents.meta.json`。
- 触碰 `.fabric/human-lock.json` 记录的 `@HUMAN` 保护范围时必须停下并请求人类确认。
- 完整任务结束后调用 `fab_append_intent`，让变更意图进入可追踪 ledger。

@AGENTS.md

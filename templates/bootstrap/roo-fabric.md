<!-- fab:rule-id bootstrap/roo -->
# Fabric Bootstrap

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Before ANY code reading, architecture planning, or logic modification, call the MCP tool `fab_plan_context(paths=[<target file>])`, then call `fab_get_rule_sections` with selected L1 stable_ids before editing.
MUST: Treat `.fabric/events.jsonl` as the automatic typed Event Ledger; MCP tools, `fabric doctor --fix` write records without manual `ledger_entry` calls.
MUST: When creating or changing an L1/L2 rule node, update rule sources and run `fabric doctor --fix`; keep `.fabric/agents.meta.json` as the generated `agent_meta` baseline.
MUST: Preserve protected tokens exactly: `AGENTS.md`, `FABRIC.md`, `.fabric/agents/`, `.fabric/rules/`, `.fabric/agents.meta.json`, `.fabric/human-lock.json`, `.fabric/events.jsonl`, `ledger_entry`, `agent_meta`, `shadow constraints`, `Shadow Mirroring`, `MUST`, `NEVER`.
NEVER: Translate, rename, or paraphrase MCP tool names, JSON keys, file paths, or the keywords `MUST` and `NEVER`.
NEVER: Reason about or modify code before obtaining local shadow constraints via MCP.
NEVER: Edit `.fabric/agents.meta.json` directly.
NEVER: Ignore stale doctor warnings returned by Fabric tools.

## 使用说明 / Explanation

- 本项目使用 Fabric Protocol 管理 AI 规则、分层 `AGENTS.md` 和意图记录。
- 上方 `CORE RULES` 是给 AI 客户端稳定执行的英文硬规则，不要翻译或改写其中的受保护 token。
- 本仓库采用 `Shadow Mirroring` 架构。业务目录如 `src/`、`packages/` 等包含 ZERO rule files；所有 AI 规则都放在 `.fabric/rules/`，其中按源码路径 1:1 镜像，跨领域规则放在 `.fabric/rules/_cross/`。
- 在任何代码阅读、架构规划或逻辑修改之前，先调用 `fab_plan_context`，再用 `fab_get_rule_sections` 获取需要的规则段落。
- 新增或调整 L1/L2 规则节点时修改规则源文件，再用 `fabric doctor --fix` 接受 `.fabric/agents.meta.json` baseline；不要手动改 `.fabric/agents.meta.json`。
- Fabric 会把 MCP 和 doctor 行为写入 `.fabric/events.jsonl` typed Event Ledger。

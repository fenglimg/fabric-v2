# Fabric Bootstrap Protocol

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Treat `.fabric/agents/` as the authoritative home for all AI shadow constraints.
MUST: Before ANY code reading, architecture planning, or logic modification, call `fab_get_rules(path=<target file>)`.
MUST: Load `.fabric/agents/root.md` through Fabric before planning repository-wide changes.
MUST: Keep `.fabric/agents.meta.json` synchronized through Fabric tooling when `.fabric/agents/` changes.
MUST: Preserve protected tokens exactly: `AGENTS.md`, `.fabric/agents/`, `.fabric/agents.meta.json`, `fab_get_rules`, `shadow constraints`, `Shadow Mirroring`, `MUST`, `NEVER`.
NEVER: Add import-style directive lines to this bootstrap file.
NEVER: Put repository rule bodies or role-specific rules in this file.
NEVER: Recreate colocated `AGENTS.md` rule files under source directories.

## 使用说明 / Explanation

- 本文件只负责启动 Fabric Bootstrap Protocol，不承载狼人杀业务规则。
- This fixture uses `Shadow Mirroring`: source directories contain ZERO rule files, while `.fabric/agents/` mirrors the source structure for AI constraints.
- 根级完整规则位于 `.fabric/agents/root.md`；跨角色约束位于 `.fabric/agents/_cross/`。
- 在读取、规划或修改任何代码前，先用 `fab_get_rules` 获取对应路径的 shadow context。

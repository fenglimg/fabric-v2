# { projectName } — Fabric Bootstrap Protocol

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Treat `.fabric/agents/` as the authoritative home for all AI shadow constraints.
MUST: Before ANY code reading, architecture planning, or logic modification, call `fab_plan_context(paths=[<target file>])`, then call `fab_get_rule_sections`.
MUST: When creating or changing an L1/L2 rule node, keep `.fabric/agents.meta.json` synchronized through Fabric tooling.
MUST: Preserve protected tokens exactly: `AGENTS.md`, `.fabric/agents/`, `.fabric/agents.meta.json`, `fab_plan_context`, `fab_get_rule_sections`, `shadow constraints`, `Shadow Mirroring`, `MUST`, `NEVER`.
NEVER: Add import-style directive lines to this bootstrap file.
NEVER: Put Cocos, asset, prefab, scene, repository rule bodies, or submodule rules in this file.
NEVER: Create colocated `AGENTS.md` rule files under source directories.

## 使用说明 / Explanation

- 本文件只负责启动 Fabric Bootstrap Protocol，不承载 Cocos 业务或编辑器规则。
- Detected framework kind: `cocos-creator`.
- This repository uses `Shadow Mirroring`: source directories contain ZERO rule files, while `.fabric/agents/` mirrors source paths for AI constraints.
- 根级规则应放在 `.fabric/agents/root.md`；跨领域规则应放在 `.fabric/agents/_cross/`。
- If `.fabric/agents/root.md` is missing, stop normal coding and run the initialization flow that creates shadow constraints.

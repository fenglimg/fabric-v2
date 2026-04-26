# { projectName } — Fabric Bootstrap Protocol

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Treat `.fabric/rules/` as the source of truth for all Fabric rule bodies.
MUST: Before ANY code reading, architecture planning, or logic modification, call `fab_plan_context(paths=[<target file>])`, then call `fab_get_rule_sections`.
MUST: When creating or changing an L1/L2 rule node, keep `.fabric/agents.meta.json` synchronized through Fabric tooling.
MUST: Preserve protected tokens exactly: `AGENTS.md`, `.fabric/rules/`, `.fabric/agents.meta.json`, `fab_plan_context`, `fab_get_rule_sections`, `rule sources`, `rule source mirroring`, `MUST`, `NEVER`.
NEVER: Add import-style directive lines to this bootstrap file.
NEVER: Put Vite, browser, repository rule bodies, or submodule rules in this file.
NEVER: Create colocated `AGENTS.md` rule files under source directories.

## 使用说明 / Explanation

- 本文件只负责启动 Fabric Bootstrap Protocol，不承载 Vite 业务或浏览器规则。
- Detected framework kind: `vite`.
- This repository uses `rule source mirroring`: source directories contain ZERO rule files, while `.fabric/rules/` mirrors source paths for AI constraints.
- 根级规则应放在 `.fabric/rules/root.md`；跨领域规则应放在 `.fabric/rules/_cross/`。
- If `.fabric/rules/root.md` is missing, continue with the Fabric initialization flow before normal coding.

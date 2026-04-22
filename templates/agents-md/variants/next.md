# { projectName } — Fabric Bootstrap Protocol

## CORE RULES (DO NOT TRANSLATE)

MUST: Treat this file as the Fabric Protocol bootstrap for this repository.
MUST: Treat `.fabric/agents/` as the authoritative home for all AI shadow constraints.
MUST: Before ANY code reading, architecture planning, or logic modification, call `fab_get_rules(path=<target file>)`.
MUST: When creating or changing an L1/L2 rule node, keep `.fabric/agents.meta.json` synchronized through Fabric tooling.
MUST: Preserve protected tokens exactly: `AGENTS.md`, `.fabric/agents/`, `.fabric/agents.meta.json`, `fab_get_rules`, `shadow constraints`, `Shadow Mirroring`, `MUST`, `NEVER`.
NEVER: Add import-style directive lines to this bootstrap file.
NEVER: Put Next.js, route, repository rule bodies, or submodule rules in this file.
NEVER: Create colocated `AGENTS.md` rule files under source directories.

## 使用说明 / Explanation

- 本文件只负责启动 Fabric Bootstrap Protocol，不承载 Next.js 业务或路由规则。
- Detected framework kind: `next`.
- This repository uses `Shadow Mirroring`: source directories contain ZERO rule files, while `.fabric/agents/` mirrors source paths for AI constraints.
- 根级规则应放在 `.fabric/agents/root.md`；跨领域规则应放在 `.fabric/agents/_cross/`。
- If `.fabric/agents/root.md` is missing, stop normal coding and run the initialization flow that creates shadow constraints.

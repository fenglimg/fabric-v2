---
id: KT-PRO-0001
type: process
layer: team
maturity: verified
layer_reason: "project artifact (deterministic init scan)"
created_at: 2026-05-10T05:24:25.169Z
tags: [unknown, typescript, csv, ndjson, [none]]
---

# Build configuration

## [MISSION_STATEMENT]

Document the deterministic build/bootstrap configuration anchoring fabric-monorepo.

## [BUSINESS_LOGIC_CHUNKS]

1. Detect framework: `unknown`.
2. Read configuration files in declared order.
3. Honor compiler/bundler boundaries before generating new code.
4. Treat config drift as a fact-check signal — re-run `fab scan` after edits.

## [CONTEXT_INFO]

Framework: unknown

Configuration files:
- package.json
- examples/werewolf-minigame-stub/package.json
- examples/werewolf-minigame-stub/project.config.json

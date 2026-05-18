---
id: KT-PRO-0001
type: process
layer: team
maturity: verified
layer_reason: "project artifact (deterministic init scan)"
created_at: 2026-05-18T05:01:51.809Z
tags: []
relevance_scope: narrow
relevance_paths: ["package.json", "packages/cli/__tests__/fixtures/cocos-stub/package.json"]
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
- packages/cli/__tests__/fixtures/cocos-stub/package.json
- packages/cli/__tests__/fixtures/cocos-stub/project.config.json

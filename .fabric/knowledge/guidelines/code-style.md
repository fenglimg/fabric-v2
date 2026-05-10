---
id: KT-GLD-0001
type: guideline
layer: team
maturity: verified
layer_reason: "project artifact (deterministic init scan)"
created_at: 2026-05-10T05:24:25.169Z
tags: [unknown, typescript, csv, ndjson, [none]]
---

# Code style guidelines

## [MISSION_STATEMENT]

Codify the recurring authoring conventions observed in fabric-monorepo.

## [MANDATORY_INJECTION]

When generating or modifying source files in this repo, AI agents MUST:
- Treat scripts as the main execution boundary during initialization.
- Do not edit or delete .meta sidecars without explicit user confirmation.
- Read bootstrap and compiler config before generating new rules or project structure.

## [CONTEXT_INFO]

Detected patterns:
- Sampled entry file appears to be a generic source entry.
- Entry samples are concentrated in scripts, indicating a stable primary source boundary.

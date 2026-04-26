---
name: fabric-init
description: Use this skill when `.fabric/forensic.json` exists and Fabric initialization follow-up still needs to be completed for this repository.
---

## Hard Rules (DO NOT TRANSLATE)

MUST: Read `.fabric/forensic.json` before taking any other action.
MUST: Treat `.fabric/bootstrap/README.md` as the current bootstrap contract for this repository.
MUST: If `.fabric/init-context.json` already exists, stop and report that initialization follow-up appears complete.
MUST: Use evidence from `.fabric/forensic.json` and the repository layout to guide the initialization follow-up.
MUST: Preserve protected tokens exactly: `AGENTS.md`, `FABRIC.md`, `.fabric/agents.meta.json`, `.fabric/init-context.json`, `.fabric/forensic.json`, `MUST`, `NEVER`.
NEVER: Claim initialization is complete without checking `.fabric/init-context.json`.
NEVER: Rewrite or translate protected tokens.
NEVER: ignore `.fabric/bootstrap/README.md` while deciding next initialization steps.

## Purpose

Use this skill after `fab init` when Codex is working inside the repository and Fabric's evidence pack already exists. The goal is to continue the repository-specific initialization workflow using the generated forensic evidence and bootstrap contract.

## Workflow

1. Read `.fabric/forensic.json`.
2. Read `.fabric/bootstrap/README.md`.
3. Check whether `.fabric/init-context.json` exists.
4. If initialization is still pending, summarize the next repository-specific initialization actions Codex should take.
5. Keep the guidance tightly scoped to Fabric initialization follow-up for this repository.

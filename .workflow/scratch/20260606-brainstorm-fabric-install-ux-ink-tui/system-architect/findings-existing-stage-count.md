# Finding: Current Install Has 6 Stages, Not 7

> Role: system-architect | Impact: MEDIUM

## Description

The guidance-specification.md assumes a 7-stage install pipeline (SA-01: "Refactor install.ts from monolithic 2000+ lines to 7 discrete stages"). Analysis of the current install.ts reveals only 6 stages are implemented:

1. **preflight** — Target validation, serve-lock check (removed in rc.37)
2. **scaffold** — Create `.fabric/` directory structure
3. **bootstrap** — Install skills, hooks, bootstrap snapshots
4. **mcp** — MCP client configuration
5. **hooks** — Hook installation
6. **post-setup** — Store onboarding, semantic search prompt

The "global-setup" and "store-onboarding" stages mentioned in SA-01 are currently inlined within other stages:

- **global-setup** logic exists at lines 379-382 in runInitCommand, where it mints ~/.fabric if absent
- **store-onboarding** logic exists at lines 425-432 in runInitCommand, where it prompts for store binding

This discrepancy means the refactoring target is slightly different from the guidance assumption. The 7-stage decomposition requires extracting these inline blocks into dedicated stages.

## Affected Features

- **F-001-install-stage-refactor** — Must plan extraction of global-setup and store-onboarding from runInitCommand
- **F-004-uninstall-symmetry** — Uninstall must mirror 7 stages in reverse; currently mirrors only 3
- **TS-01-per-stage-testing** — Test harness must account for 7 stages, not 6

## Recommendation

Update the stage decomposition plan to explicitly identify:

1. **preflight** — Unchanged
2. **global-setup** — NEW: Extract from runInitCommand lines 379-382
3. **scaffold** — Unchanged
4. **store-onboarding** — NEW: Extract from runInitCommand lines 425-432
5. **bootstrap** — Unchanged
6. **mcp** — Unchanged
7. **hooks** — Unchanged

The **post-setup** stage should be eliminated; its responsibilities move to store-onboarding (wizard) and the final summary card (UI-02). This makes the 7-stage count accurate and provides clearer stage boundaries for testing.
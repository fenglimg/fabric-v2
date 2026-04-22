# Code Review: fab init Shadow Mirroring Refactor

**Reviewer**: Gemini CLI (codex review mode incompatible with prompt flag; fell back to gemini analysis)
**Review ID**: `fab-init-shadow-mirroring-2026-04-19-code-review-gemini`
**Scope**: 63 files changed, +2681 / -1487 lines across 10 tasks (TASK-001 through TASK-010)

## Summary

Shadow Mirroring refactor is structurally sound and satisfies all core R3 constraints. Residual `@AGENTS.md` import line in `templates/bootstrap/CLAUDE.md` was the only violation of R3-CQ4 "no bridge artifacts" — fixed inline.

## Verdict

**PASS** (after inline fix) — originally WARN.

## Detailed Findings

### ✅ R3 Compliance (PASS)

- **Topology enum**: `packages/shared/src/schemas/agents-meta.ts:7` — `mirror|cross-cutting` (not R2 `colocated|rules-frontmatter`) ✓
- **Schema backward-compat**: `fabric-config.ts`, `init-context.ts`, `agents-meta.ts` use `.optional()` additively; `z.preprocess` at `agents-meta.ts:24` maps legacy nodes via `deriveAgentsMetaLayer` ✓
- **SKILL Phase 2 write boundary**: `templates/claude-skills/agents-md-init/SKILL.md:89` enforces "Keep every generated rule artifact under .fabric/agents/ or .fabric/agents/_cross/"; no colocated AGENTS.md emission; no @import lines ✓
- **Bootstrap hard rule**: all 6 templates upgraded to "Before ANY code reading, architecture planning, or logic modification" (verified `windsurf-fabric.md:6`) ✓
- **Confidence formula**: `packages/cli/src/scanner/forensic.ts:868` `determineConfidence` — AST=HIGH; ratio<0.5=LOW; ratio≥0.8+co_occurring≥2=HIGH; else MEDIUM ✓
- **sync-meta scope**: `packages/cli/src/commands/sync-meta.ts:130` `findFabricAgentsFiles` scoped to `.fabric/agents/` only; no legacy AGENTS.md scanning ✓

### ⚠️ Issues Fixed Inline

1. **High — @AGENTS.md import in CLAUDE.md** (`templates/bootstrap/CLAUDE.md:26`)
   - Violated R3-CQ4 Zero-Pollution: static `@import` directives prohibited in favor of dynamic `fab_get_rules` fetching
   - **Fix applied**: Removed `@AGENTS.md` line; file now ends with the final usage note
   - Gemini also flagged `roo-fabric.md:21`, but inspection shows that line is legitimate Chinese explanation content, not an @import directive — no action needed

## Post-Fix State

- 1 inline fix applied to `templates/bootstrap/CLAUDE.md`
- All 6 bootstrap templates now consistent with R3 Shadow Mirroring: no residual `@import` lines, unified hard rule language
- All other R3 constraints verified PASS

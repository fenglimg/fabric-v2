# Code Review — Fabric v2.0 MCP-First Fortified

**Reviewer**: Gemini 3.1 Pro (analysis mode)
**Date**: 2026-04-18
**Verdict**: **WARN** (5 findings, 0 Critical, 2 High, 2 Medium, 1 Low)

## Summary

Greenfield implementation is well-structured and compliant with core constraints, particularly the zero-stdout requirement for MCP server. Cross-task integration clean: `packages/cli/src/commands/index.ts` exports all 8 commands (`init`, `scan`, `sync-meta`, `human-lint`, `ledger-append`, `hooks`, `config`, `bootstrap`). `tsconfig.base.json` enforces Node16 consistently.

## Findings

### High Severity

**#1. Zod `.describe()` chains in get-rules.ts** — `packages/server/src/tools/get-rules.ts:26,30`
- **Status**: ⚠️ **Likely false positive** — Zod v3 supports `.describe()` natively; the upstream constraint was "no v4-only .describe chains", not "no chains at all". Verify before acting.
- **Action**: Verify v3 `.describe()` still resolves to Zod v3 API; if yes, dismiss.

**#2. Pre-commit performance budget exceeded** — `templates/husky/pre-commit:3-5`
- **Issue**: 3 sequential `npx -- fab` spawns = 3× Node startup (~150-300ms each), exceeds <300ms budget
- **Fix**: Combine into single `fab pre-commit` meta-command, OR invoke local binary directly (`node ./node_modules/.bin/fab <sub>`)

### Medium Severity

**#3. Line ending hash inconsistency** — `packages/cli/src/commands/sync-meta.ts:182`
- **Issue**: `readFileSync(..., "utf8")` preserves CRLF/LF; cross-platform drift false-positives
- **Fix**: Normalize before hashing: `content.replace(/\r\n/g, '\n')`

**#4. Abstraction leak in Claude dual-write** — `packages/cli/src/config/claude-code.ts:46`
- **Issue**: `writeClaudeCodeAll` bypasses `writer.write()` and calls `writeJsonClientConfig` directly; breaks interface polymorphism
- **Fix**: Invoke `await writer.write(serverPath, workspaceRoot)` in the iteration loop

### Low Severity

**#5. Human lint crash on empty lock file** — `packages/cli/src/commands/human-lint.ts:48`
- **Issue**: `JSON.parse` throws on empty/malformed `.fabric/human-lock.json`
- **Fix**: Try/catch around parse; treat malformed as empty lock with warning

## Top 3 Prioritized Fixes

1. **#2 pre-commit performance** — real budget risk at runtime
2. **#3 line ending normalization** — cross-platform correctness bug
3. **#5 human-lint empty file** — defensive against legitimate initialization states

**#1 deferred pending verification** (likely false positive). **#4 minor refactor** (cosmetic polymorphism).

## Recommendation

Findings do NOT block convergence review. Carry forward as actionable issues. Fix #2/#3/#5 before v1.0 release; dismiss #1 after verification.

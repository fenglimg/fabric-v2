# Analysis: rc.19 Bootstrap Consolidation Code Review

**Reviewer**: Gemini CLI (gemini-3.1-pro-preview)
**Date**: 2026-05-15
**Scope**: rc.19 diff (44 files, +2813/-701)
**Verdict**: PASS (with 2 WARN findings, non-blocking)

## Summary
The rc.19 bootstrap consolidation refactor expertly establishes a resilient architecture by hoisting the canonical source-of-truth to `packages/shared` and utilizing strict byte-level checks. It prevents cross-package architectural leaks by purposefully duplicating minimal regex logic within the server doctor layer. There are zero instances of implicit normalization, though the logic driving line-ending verifications slightly relies on `startsWith` failing gracefully. A minor test coverage gap remains for L2 CRLF boundaries.

## Key Findings

1. **Cross-Package Architectural Purity (PASS)** — `packages/server/src/services/doctor.ts:4825`
   `rewriteThreeEndManagedBlocks` correctly re-implements inline regex replace instead of importing from `packages/cli`. Upholds strict dependency boundary (zero new `packages/cli` imports in `packages/server`).

2. **No Line-Ending Normalization (WARN)** — `packages/server/src/services/doctor.ts:2080`
   L2 `inspectL2ManagedBlockDrift` slicing prevents normalization but acts somewhat fragily:
   `if (body.startsWith("\n")) body = body.slice(1);`
   If `\r\n` follows the marker on Windows, `startsWith("\n")` correctly evaluates to `false`, carrying `\r\n` into byte comparison against LF-formatted `expectedBody`. Correctly flags CRLF difference as drift, but logic hinges on implicit non-match behavior rather than explicit `\r?\n` guard.

   **Note from orchestrator**: The reviewer's suggested fix `replace(/^\r?\n/, "")` would actually NORMALIZE by stripping `\r`, violating the invariant. The current `startsWith("\n")` is correct.

3. **L2 Drift CRLF Test Coverage Gap (WARN)** — `packages/server/src/services/doctor.test.ts:3545`
   Excellent `doctor-rc19-l1-crlf` check enforces NO normalization for L1 snapshots, but no corresponding L2 managed block CRLF equivalent. Given the brittle string slice logic in (2), this leaves a blind spot for CRLF regressions at L2 level.

4. **Regex Boundary Idempotency (PASS)** — `packages/shared/src/templates/bootstrap-canonical.ts`
   Marker templates effectively leverage non-greedy `[\s\S]*?` to prevent BOOTSTRAP_REGEX from engulfing user text across multiple disjoint markers.

5. **Atomic Operations & Idempotency (PASS)** — `packages/cli/src/install/skills-and-hooks.ts`
   Writers and inverse un-mergers correctly implement idempotency checks before operations; exclusively use `atomicWriteText`.

## Detailed Analysis

### Correctness
Logic execution solid. Functions correctly read snapshot states before applying managed wrappers. Legacy blocks (`fabric:knowledge-base`) accurately stripped and replaced without user intervention. Regex string slicing index bounds clean.

### Code Quality
Variable naming patterns match existing monorepo conventions. Shared module pattern for `BOOTSTRAP_CANONICAL` mirrors rc.16 `banner-i18n` flawlessly.

### Security
File traversals utilize static references natively, isolating `targetRoot` scopes. Atomic operations protect against partial files on process exit. No risky shell invocations.

### Performance
`.some()` closures for drift identification efficient. `Promise.all` blocks in `runDoctorReport` optimally manage I/O.

## Recommendations
1. **[Medium] Expand L2 CRLF Drift Coverage**: Add a dedicated test in `doctor.test.ts` mirroring `doctor-rc19-l1-crlf`, targeting `.cursor/rules/fabric-bootstrap.mdc` and root `AGENTS.md` with injected `\r\n` marker boundaries to guarantee the slice calculation holds over time.
2. ~~**[Low] Strengthen L2 Body Slicing Logic**~~ — **REJECTED**: Reviewer's suggested `replace(/^\r?\n/, "")` would violate the no-normalization invariant by stripping `\r`. Current `startsWith("\n")` correctly preserves CRLF as drift.

## Action Items
- Recommendation #1 (L2 CRLF coverage) is a valid follow-up. Tracked as: add to TASK-009 expansion or rc.19 follow-up commit. **Non-blocking for rc.19 merge.**
- Recommendation #2 is rejected (would break invariant); no action.

## Verification Checklist
- [x] Code assessed against established standards
- [x] Logic and edge cases reviewed
- [x] Security and performance evaluated
- [x] Test coverage and documentation validated

## Overall Verdict
**PASS** — rc.19 ready to merge. WARN findings are coverage-improvement opportunities, not regressions.

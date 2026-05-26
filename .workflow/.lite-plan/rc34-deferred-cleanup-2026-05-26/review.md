# rc.34 Gemini Batch Review — findings + disposition

**Reviewer**: gemini-3.1-pro-preview (via `maestro delegate --to gemini --mode analysis --rule analysis-review-code-quality`)
**Delegate execution ID**: `gem-124933-0850`
**Date**: 2026-05-26
**Scope**: 8-commit rc.34 closure batch (a533286 plan + 7 TASK commits 1b30a14..422294d)
**Verdict from reviewer**: **HOLD**
**Verdict after disposition**: **SHIP** (both findings addressed)

---

## Finding 1 — P0 BLOCK release — Windows path breakage in unarchive primitive

**Reviewer claim**:
- `packages/server/src/services/unarchive-knowledge.ts:51` (deriveType) + `:74` (caller)
- `deriveType` hardcodes `/` split; Windows callers pass backslashes; `.indexOf(".archive")` returns -1; whole unarchive aborts with derivation error

**Verification**: CORRECT. `basename` on POSIX treats `\` as a regular filename char, so the entire input would be returned as filename. `deriveType`'s split also assumed POSIX. Both produce wrong results on Windows callers.

**Fix applied** (this commit):
- Added `normalizeToPosix(p: string): string` helper (single-point normalization at function entry)
- `unarchiveKnowledge` now computes `archivePathPosix = normalizeToPosix(archivePathRel)` once, then all downstream helpers (`basename`, `deriveLayer`, `deriveType`, `existsSync` join) operate on the POSIX form
- All result.archivePath + event.archive_path fields now report POSIX form (consistent contract)
- New test: `Windows-style backslash archive path derives correctly` in `unarchive-knowledge.test.ts` (dry-run mode; passes the same path with backslashes; asserts stableId + restoredTo are derived as if POSIX)

**Risk**: Low. Single-direction transform (`\` → `/`), no path collisions on POSIX since `\` is rare in real .fabric/ filenames.

## Finding 2 — P1 fix before tag — Cooldown skew Math.max(0, …) doesn't help

**Reviewer claim**:
- `fabric-hint.cjs:1022`, `:1046`; `knowledge-hint-broad.cjs:386`
- `Math.max(0, nowMs - lastEmitMs) < cooldownMs` for negative delta: `Math.max(0, -X) = 0`, `0 < cooldownMs` always true → silenced permanently

**Verification**: PARTIALLY CORRECT.
- Reviewer's diagnosis: ✗ The hook is NOT silenced "permanently." Both with and without `Math.max(0, …)`, silence duration is the same `cooldown + |skew|` (real-time wallclock elapsed from t=0 to fire). Math.max was a no-op.
- Reviewer's proposed fix: ✓ The CORRECT fix is to fire immediately on backward skew (treat future-stamped sidecar as expired), which heals the skew rather than waiting. Reviewer's suggested logic `nowMs >= lastEmitMs && delta < cooldown` achieves this.

**Fix applied** (this commit):
- All 3 sites replaced `Math.max(0, delta) < cooldown` with `nowMs >= lastEmit && nowMs - lastEmit < cooldown`
- Behavior change: backward clock skew → gate FIRES on next invocation (heals immediately). Forward time → standard cooldown check unchanged.
- Updated test `rc.34 TASK-01 + review-fix: future-stamped lastEmit (backward clock skew) bypasses cooldown — fires immediately` in `fabric-hint.test.ts`. Previously asserted "stays silent" (matched old Math.max no-op behavior); now asserts `result.signal === "maintenance"` (fires).

**Risk**: Low. Forward-time semantics identical to pre-rc.34 (the Math.max was inserted in TASK-01 and didn't change forward-time outcomes). Only backward-skew behavior changes — and that scenario was already broken; this just fixes it differently than originally attempted.

## Items reviewer explicitly cleared (no action needed)

- `fabric-archive` + `fabric-review` SKILL.md splits — "meticulously preserve the Hard Rules (DO NOT TRANSLATE) constraints"
- `unarchiveKnowledge` unit tests — "cover all specified contracts accurately"
- Event-ledger schema additions — "integrate smoothly into the discriminated union without conflicts"
- Install pre-check — "safely bounds canonical SKILL templates under 10,000 tokens"

## Items NOT flagged (audit checklist for record)

- Hard Rules preservation count (33 MUST/NEVER across archive+review): verified
- Protected tokens lint coverage: 670 CLI tests pass (lint-protected-tokens.test.ts covers all 3 skills)
- cite-policy-evict hook: silent-exit invariants on all error paths; 28 tests cover off/fire/boundary/session-reset/stress
- cite-policy-evict Codex/Cursor scope: hook installed to `.claude/hooks/` only (HOOK_SCRIPT_DESTINATIONS.citePolicyEvict single-element array)
- TASK-07 cohort decay memo: analysis only, no code (correctly excluded from this review)

## Process notes (for next rc reviewer)

- Reviewer ran with Gemini `--rule analysis-review-code-quality` over 11-file `@`-list. Used ~198K tokens input / 970 output. Single-pass; no follow-up needed.
- Two-finding output is typical for tactical-cleanup batches (low surface area, scope-locked). For feature-heavy RCs expect 5-15 findings.
- Reviewer's HOLD verdict is preserved verbatim; my SHIP recommendation is post-disposition (both findings fixed in this commit batch).

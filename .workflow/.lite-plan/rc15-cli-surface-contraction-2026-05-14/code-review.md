# rc.15 Code Review — Gemini Batch Review

**Date**: 2026-05-14
**Range**: `bab4124..HEAD` (6 commits, 45 files, +924/-2017 net = -1093 lines)
**Reviewer**: Gemini CLI (`rc15-cli-surface-contraction-2026-05-14-code-review`)
**Verdict**: **CONDITIONAL PASS** (1 Medium + 5 Low)

## Findings

### Finding 1 — MEDIUM: ServeLockHeldError.actionHint may get silently dropped
- **Files**: `packages/cli/src/commands/serve.ts:74` + `packages/server/src/services/serve-lock.ts:55`
- **Description**: `acquireLock(projectRoot)` is invoked OUTSIDE a try-catch in serve.ts. When `ServeLockHeldError` throws, citty's default error handler prints `.message` but typically does NOT print `.actionHint`. The verbose lock-held message (PID + Ctrl-C/kill guidance) — the entire UX win of TASK-003 — may never reach the user.
- **Same risk** for `fab doctor` (calls `checkLockOrThrow(target)` which throws the same error class) and `fab install`/`uninstall` (same lock check pattern).
- **Verdict**: Real UX bug. Lock-held users see a generic message and miss the recovery guidance.
- **Fix**: Wrap `acquireLock`/`checkLockOrThrow` calls in try-catch with explicit `actionHint` rendering, OR install a process-level FabricError handler that always renders both `.message` and `.actionHint`. Latter is cleaner — single fix covers all 4 commands.

### Finding 2-3 — LOW: Residual `force?: boolean` dead fields
- `packages/cli/src/commands/config.ts:40` — `InstallMcpClientsOptions.force?: boolean` (never read after TASK-001)
- `packages/cli/src/install/skills-and-hooks.ts:49` — `InstallOptions.force?: boolean` (commented "Currently unused")
- **Fix**: Delete both fields. Dead code from rc.15 contraction.

### Finding 4 — LOW: citty args not alphabetized
- `packages/cli/src/commands/install.ts:133` — order `target, debug, yes, dry-run` should be alphabetical `debug, dry-run, target, yes`
- `packages/cli/src/commands/uninstall.ts:139` — same
- `packages/cli/src/commands/doctor.ts:62` — same (`fix, fix-knowledge, json, rescan, strict, target, yes`)
- `packages/cli/src/commands/serve.ts:32` — same (`debug, host, port, target`)
- **Note**: Doctor + serve are actually already correct (verified alphabetical per TASK-003 acceptance). Gemini may have misread doctor/serve. Install/uninstall ordering is genuinely non-alphabetical.
- **Fix**: Reorder where genuinely off. Cosmetic — citty doesn't require ordering, but `--help` is more scannable alphabetized.

### Finding 5 — LOW: `AcquireOptions.force` retained on engine-side
- `packages/server/src/services/serve-lock.ts:24` — `force?: boolean` param survives in `AcquireOptions`
- **Status**: **INTENTIONAL per TASK-003 clarification 3** — kept for engine-side internal tests (serve-lint.test.ts:170). CLI stops passing it. Gemini's flag is a false positive against explicit design decision.
- **Action**: NO FIX. Document in CHANGELOG if not already.

## Summary

| Severity | Count | Disposition |
|---|---|---|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 1 | UX-impact — recommend fix |
| Low | 5 | 4 real (cosmetic) + 1 false positive (intentional design) |

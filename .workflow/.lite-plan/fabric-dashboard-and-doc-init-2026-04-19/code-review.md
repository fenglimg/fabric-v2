# Code Review — Fabric v1.1 Feature #5 Unified Rollout

**Date**: 2026-04-19
**Reviewed**: 15 tasks (Dashboard D1-D5 + E1-E3, Doc-Init Rec#1-6)
**Build status**: pnpm -r build ✅ passing
**Test status**: 7/7 passing (`packages/cli/__tests__`: init-forensic × 1, init-nondestructive × 4, init-claude-install × 2); `packages/server` rehydrate-state tests were not run in scope

## Verdict: WARN

## Summary

The rollout is architecturally solid: shared-schema consolidation is clean, services layer is pure, MCP per-session factory is correctly implemented, and the doc-init extension follows existing non-destructive patterns. Two medium-severity correctness issues warrant a fix before shipping: a hardcoded `"1-30"` literal in `ForensicReport.code_samples` that contradicts the actual snippet length, and a missing path-traversal guard on `entry.file` inside `read-human-lock.ts`. No critical issues were found.

---

## Findings by severity

### Critical (0 issues)

None.

---

### High (1 issue)

**H1** — `packages/server/src/services/read-human-lock.ts:71` — `entry.file` is used directly in `join(projectRoot, entry.file)` with no check that the resulting absolute path is still inside `projectRoot`. A crafted `human-lock.json` containing `file: "../../etc/passwd"` would allow reading arbitrary files from the host. The `humanLockApproveRequestSchema` in `api-contracts.ts` only validates `file: z.string().min(1)`, and the `/api/human-lock/approve` route writes the user-supplied `file` field straight into this call path. Fix: add `assertWithinRoot(projectRoot, join(projectRoot, entry.file))` using a simple `resolve + startsWith` check, and add the same guard in `approve-human-lock.ts:26` before the index lookup.

---

### Medium (3 issues)

**M1** — `packages/cli/src/scanner/forensic.ts:222` — `lines: "1-30"` is hardcoded for every code sample regardless of actual file length. If a file has fewer than 30 lines the label is misleading; if `SAMPLE_LINE_LIMIT` is ever changed the label will silently lie. The test at `init-forensic.test.ts:38` asserts the string `"1-30"` directly, cementing the bug. Fix: derive the label dynamically from `Math.min(lineCount, SAMPLE_LINE_LIMIT)`.

**M2** — `packages/server/src/api/scan.ts` and `packages/server/src/services/doctor.ts` both contain a private copy of `detectFramework`, `inferCocosSubkind`, `inferPackageSubkind`, `collectDependencyVersions`, and `readCreatorVersion` (approximately 150 lines duplicated). This violates the single-source principle already established in `packages/cli/src/scanner/detector.ts`. Any divergence will cause `fab scan` and Doctor to disagree on framework identification. Migrate both to a shared service, or at minimum import from detector.ts via a thin adapter.

**M3** — `packages/server/src/http.ts:128` — `process.env.FABRIC_PROJECT_ROOT = projectRoot` is set as a side-effect inside `createFabricHttpApp`. This is a global mutation that breaks test isolation and prevents running two HTTP servers in the same process (e.g., test helpers). The MCP tools already receive `projectRoot` through `resolveProjectRoot()` which reads this env var; a proper fix would thread `projectRoot` through the call chain or close over it, removing the env-var side channel entirely. For now it is an architectural debt item.

---

### Low (4 issues)

**L1** — `packages/server/src/services/get-rules.ts:81` — `readHumanLock` returns `HumanLockStatus[]` (with `drift` and `current_hash` fields), but the service maps each entry to `{ file, excerpt: JSON.stringify(entry) }`, leaking `drift` and `current_hash` into `human_locked_nearby` excerpts that the MCP tool exposes to AI clients. These fields are internal dashboard state and should not appear in the rules tool response. The `excerpt` should use only the original `HumanLockEntry` fields.

**L2** — `packages/dashboard/src/hooks/use-events.ts:1` — `@preact/signals-core` is imported and three module-level signals (`fabricEventsSignal`, `fabricConnectedSignal`, `fabricEventVersionSignal`) are instantiated but only `fabricConnectedSignal` is exported; `fabricEventsSignal` and `fabricEventVersionSignal` are exported but never imported by any view or component (all views receive `lastEvent` as a prop). The signals are dead exports at this point. Either remove them or wire them into a signals-based reactive path.

**L3** — `packages/cli/src/commands/init.ts` — `writeStderr` is defined as a module-level helper that calls `process.stderr.write` directly. This pattern differs from `console.log` used for stdout lines in the same function, which is fine, but the function is duplicated conceptually with the pattern in `serve.ts` and `dev-mode.ts`. No impact, but flagged for consistency.

**L4** — `packages/shared/src/schemas/api-contracts.ts:37` — `historyStateQuerySchema` uses `.superRefine` to require exactly one of `ledger_id` or `ts`, but the error is attached to `path: ["ledger_id"]` regardless of which field is missing. The error path should be `[]` (root) or list both field names so error messages make sense when `ts` is the problem field.

---

## Coverage table

| Dimension | Status | Notes |
|-----------|--------|-------|
| Correctness | ⚠ | H1 path-traversal; M1 hardcoded "1-30" label; M3 env-var global mutation |
| Pattern compliance | ✅ | `writeNewFile`/`assertNewFile` guards in place; bootstrap merge-insert pattern followed; `@fabric/shared` import consolidation complete; no local type duplication in modified files |
| Security | ⚠ | `timingSafeEqual` bearer auth ✅; localhost-only default ✅; H1 path traversal on `entry.file` in `read-human-lock.ts` — moderate risk on localhost-only default |
| Architecture | ✅ | Services are pure (no Express/MCP coupling); REST routes are thin adapters; MCP factory correctly per-session; `JsonlEventStore` isolated from `ledger-entry` records; SSE filters `kind:mcp-event` correctly |
| Frontend | ✅ | No Preact types in `@fabric/shared`; CSS custom properties only (no CSS-in-JS); `prefers-reduced-motion` media queries at `app.css:1165,1173`; ARIA roles and `aria-live` region in App shell; focus ring via `--shadow-focus-ring` token |
| Tests | ✅ | 7/7 passing; forensic schema round-trip tested; hook exit codes (block/quiet) tested; settings merge tested; SKILL byte-identical test passes |
| Docs | ✅ | `docs/initialization.md` covers all 7 stages, 4-scenario compatibility table, and 4 troubleshooting scenarios; README link placeholder noted but not broken |
| Leftover debt | ✅ | No `@ts-ignore`, `as any`, `// TODO` in new/changed files; no debug `console.log`; L2 dead signal exports noted |

---

## Recommendations

1. **Fix H1 immediately**: add `assertWithinRoot` guard in `packages/server/src/services/read-human-lock.ts:71` (and `approve-human-lock.ts:26`) before shipping to any non-localhost binding. The guard is two lines and is already needed to satisfy the review constraint "no path traversal."

2. **Fix M1 before v1.1 release**: change `lines: "1-30"` in `packages/cli/src/scanner/forensic.ts:222` to a computed value (e.g., `"1-${Math.min(lineCount, SAMPLE_LINE_LIMIT)}"`) and update the test assertion in `init-forensic.test.ts:38` to `toMatch(/^1-\d+$/)`.

3. **Resolve M2 in a follow-up**: extract `detectFramework` into a shared server utility (e.g., `packages/server/src/services/detect-framework.ts`) and delete the duplicate copies in `scan.ts` and `doctor.ts`. This prevents future framework detection divergence between the scan API and the Doctor report.

4. **Fix L4 (low effort)**: change the `.superRefine` error path in `api-contracts.ts:47` from `["ledger_id"]` to `[]` so the validation error message is not misleading when `ts` is the bad field.

5. **Consider removing L2 dead signals** or wiring them to views; exported but unused signals add confusion when reading `use-events.ts`.

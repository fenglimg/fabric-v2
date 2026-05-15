# rc.14 Test Review

**Session**: `rc14-stop-the-bleeding-2026-05-14`
**Timestamp**: 2026-05-14T17:45:00+08:00
**Framework**: vitest (pnpm monorepo)
**Summary**: rc.14 「Stop the bleeding」 — 4 atomic commits (3 planned + 1 hotfix), all P0 fixes shipped.

## Task Verdicts

| Task ID | Status | Convergence (met/total) | Commit |
|---|---|---|---|
| TASK-001 | **PASS** | 9/9 | `74e142b` |
| TASK-002 | **PASS** | 13/13 | `bcb5991` |
| TASK-003 | **PASS** | 10/10 | `89c7327` |
| TASK-004 | **PASS** | 7/7 (hotfix) | `bab4124` |

**Overall convergence**: 39/39 MET. **No unmet criteria. No test coverage gaps.**

## Test Execution

| Package | Tests | Coverage | Verdict |
|---|---|---|---|
| `@fenglimg/fabric-cli` | 491 passing / 37 files | 83.15% | PASS |
| `@fenglimg/fabric-shared` | 307 passing | (within threshold) | PASS |
| `@fenglimg/fabric-server` | 408 passing + 1 skipped | (within threshold) | PASS |

**Gates**:
- `pnpm -r --if-present test:typecheck` → clean (0 errors)
- `pnpm -r --if-present lint` → clean (knip --strict)
- `pnpm -r --if-present test` → all green

## Convergence Highlights

### TASK-002 (largest surface)
- `DiffFileState` 4-state classifier (`missing | present-canonical | drifted | user-modified`) — `install.ts:50-53`
- State detection split from state transition — `executeInitFabricPlan` non-throwing classifier
- `--dry-run` works on any workspace state (Bug Z fixed via this split)
- Drift detection per file type: structural (agents.meta.json), byte (hook scripts), deep-merge-aware (MCP configs)
- Friendly drift abort message points to `fab doctor` + `fab uninstall && fab install` — `install.ts:474-478`
- Canonical no-op output: `Workspace already canonical (N files verified)` — `install.ts:515-520`
- `install_diff_applied` ledger event for diff-mode runs — `install.ts:635-648`
- Test helpers `runInit` + `snapshotTree` hoisted into `init-test-utils.ts:79-111`
- 7 scenarios in `install-diff-mode.test.ts` (5 planned + 2 hotfix from TASK-004)

### TASK-004 (review-driven hotfix)
- HIGH: `.fabric` as regular file → pre-check via `statSync(...).isDirectory()` before drift gate (`install.ts:464-469`)
- MEDIUM: `events.jsonl` as directory + `--force` → `preparePlannedPath` recursive cleanup parallel to `agents.meta.json` pattern (`install.ts:588-592`)
- LOW: uninstall T1 extended to snapshot `.cursor` tree alongside `.claude` + `.codex` (`uninstall-skills-and-hooks.test.ts:101-105`)
- Both new edge cases backed by tests (Scenario 6 + Scenario 7 in `install-diff-mode.test.ts`)

## Code Review Cross-Reference

Gemini batch code review (`code-review.md`):
- Initial verdict: **FAIL** (1 High + 1 Medium + 1 Low)
- After TASK-004 hotfix: all 3 findings closed
- This convergence review (separate gate) re-verified the closures via file:line evidence
- No new issues surfaced during convergence pass

## Release Readiness

**Verdict: rc.14 IS RELEASE-READY**

- ✅ All 4 tasks reach 100% convergence
- ✅ 491 tests + 307 + 408 = 1206 tests passing across the monorepo
- ✅ Type-check + lint + coverage all green
- ✅ Code review FAIL → hotfix → all findings closed
- ✅ Convergence review independent PASS
- ✅ 4 atomic commits ready for tag + push

**Recommended next steps**:
1. Tag `v2.0.0-rc.14` at `bab4124`
2. Push to remote (per user's release workflow)
3. Begin Phase 2 (rc.15) planning per `memory/project_grill_deferred_items.md` — CLI surface contraction (install 12→4, uninstall 11→4, kill `fab hooks` etc.)
4. Bug Y (Codex MCP) remains parked until end of Phase 4 per design decision

## Artifacts in This Session

```
.workflow/.lite-plan/rc14-stop-the-bleeding-2026-05-14/
├── exploration-cursor-hooks-schema.json
├── exploration-install-diff-state.json
├── exploration-test-surface.json
├── explorations-manifest.json
├── planning-context.md
├── plan.json
├── code-review.md                  ← Gemini batch code review
├── test-checklist.json             ← structured convergence + test results
├── test-review.md                  ← this file
└── .task/
    ├── TASK-001.json
    ├── TASK-002.json
    └── TASK-003.json
```

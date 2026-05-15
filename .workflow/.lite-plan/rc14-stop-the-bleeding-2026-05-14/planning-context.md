# Planning Context: rc.14 「Stop the bleeding」

## Source Evidence

### From `exploration-cursor-hooks-schema.json`
- `packages/cli/templates/hooks/configs/cursor-hooks.json` — THE bug source: ships `{events:{...}}` envelope; Cursor rejects with "Config version must be a number; Config hooks must be an object"
- `packages/cli/src/install/skills-and-hooks.ts:138` — `HOOK_CONFIG_ARRAY_PATHS.cursor = ['events.Stop', 'events.SessionStart', 'events.PreToolUse']`; MUST flip in lockstep with template to `['hooks.stop', 'hooks.sessionStart', 'hooks.preToolUse']` (camelCase per resolved clarification)
- `packages/cli/src/install/uninstall-skills-and-hooks.ts:232` — `extractFlatCommands` is the correct extractor; Cursor entries are/were always flat per-entry; only top-level was wrong
- `packages/cli/__tests__/integration/install-skills-and-hooks.test.ts:207-221` — encodes the buggy shape in test form; rewrite to assert `version:1` + `hooks.stop/sessionStart/preToolUse`
- `packages/cli/templates/hooks/configs/README.md:28-34` — admits "Mirrors the Codex events.Stop[] envelope shape" assumed-not-verified; replace with citation to https://cursor.com/cn/docs/hooks
- `packages/cli/src/config/json.ts:35-81` — deepMerge engine handles top-level primitive `version:1` via L58-L67 REPLACE branch; NO engine changes needed

### From `exploration-install-diff-state.json`
- `packages/cli/src/commands/install.ts:1020` — `planFreshPath`: throws on existing path unless `--force`; called 3× at L641-L643 inside `buildInitFabricPlan` BEFORE `executeInitExecutionPlan` reaches its `planOnly` branch (L571). Root cause of Bug V (idempotency) AND Bug Z (dry-run on existing workspace fails)
- `packages/cli/src/install/skills-and-hooks.ts:586` — `copyTextIdempotent` (byte-compare-then-skip): reference pattern for hook scripts
- `packages/cli/src/install/skills-and-hooks.ts:606` — `mergeJsonIdempotent` (deep-merge + jsonEqual): reference pattern for MCP configs
- `packages/cli/src/install/skills-and-hooks.ts:513` — `addFabricKnowledgeBaseSection` (managed-region byte-compare): reference for marker-bounded regions
- `packages/cli/src/commands/install.ts:485` — `resolveInitCliIntent`: maps `args.reapply=true => options.force=true`; legacy escape hatches stay in rc.14, killed in rc.15
- `packages/cli/src/commands/install.ts:571-579` — `planOnly` branch unreachable on existing workspace today; refactor must split classification (non-throwing) from transition (writing/throwing)
- `packages/cli/src/commands/install.ts:722-738` — `agents.meta.json` + `forensic.json` unconditionally overwritten via `atomicWriteJson`; events.jsonl already preserved under --reapply branch (L726-L735)
- `packages/cli/src/commands/install.ts:1326-1340` — `appendReapplyLedgerEvent`: extend with new event_type `install_diff_applied` for diff-mode runs; keep `reapply_completed` distinct in rc.14

### From `exploration-test-surface.json`
- `packages/cli/__tests__/integration/install-skills-and-hooks.test.ts:228-244` — idempotency test snapshots .claude + .codex only, OMITS .cursor (parity gap to fill in rc.14)
- `packages/cli/__tests__/hooks-install-validate.test.ts:114-131` — exact triple-count assertions (`filter().length === 3`); brittle against schema/count changes
- `packages/cli/__tests__/helpers/init-test-utils.ts` — `createWerewolfFixtureRoot`, `writeFixtureFile`, `readFixtureFile` already hoisted; `snapshotTree` + `runInit` duplicated across `install-skills-and-hooks.test.ts` and `uninstall-skills-and-hooks.test.ts` (hoist opportunity)
- `packages/cli/vitest.config.ts` — coverage thresholds lines:70, statements:70
- `packages/cli/__tests__/fixtures/cocos-stub/` — baseline workspace fixture cloned per-test; rc.14 diff-mode tests run actual `runInit()` then mutate (per resolved clarification)

## Understanding

### Current State
- rc.13 ships **broken Cursor hooks.json schema** (top-level `events:{}` envelope) — Cursor app rejects the config outright. Symptom: user reports "Config version must be a number; Config hooks must be an object" in werewolf-minigame project.
- rc.13 `fab install` is **non-idempotent on existing workspaces**: `planFreshPath` throws when any of `agents.meta.json` / `events.jsonl` / `forensic.json` already exists. `--reapply` is the only way to re-run, but it conflates with `--force` and requires explicit flag.
- rc.13 `fab install --dry-run` fails on already-init workspaces: throw fires during plan-construction before the `planOnly` branch can render the preview.
- Test surface encodes the buggy Cursor schema in `install-skills-and-hooks.test.ts:207-221`, blocking a clean test-first fix.

### Problem (Three P0 bleeds)
- **Bug X**: Cursor hooks schema is wrong on every install — Cursor users get a broken config and a confusing error.
- **Bug V**: `fab install` on already-init workspace fails (no auto-detection of canonical-vs-missing-vs-drifted state).
- **Bug Z**: `fab install --dry-run` fails on already-init workspace (same root cause as Bug V — throw fires too early in pipeline).

### Approach
Three atomic commits, each = one task = one commit. Sequential dependency chain.

1. **TASK-001 (Bug X — Cursor schema fix)**: Rewrite `cursor-hooks.json` template to `{version: 1, hooks: {stop, sessionStart, preToolUse}}` per resolved clarification (camelCase event names verified against https://cursor.com/cn/docs/hooks). Flip `HOOK_CONFIG_ARRAY_PATHS.cursor` in lockstep. Update integration test assertions. Update README citation. Zero migration shim (clean-slate per memory `feedback_clean_slate.md`).
2. **TASK-002 (Bug V + Z — diff-mode idempotency)**: Refactor `planFreshPath` from throw-on-existing to a `DiffFileState` classifier (`missing | present-canonical | drifted | user-modified`). Split classification (always runs, never throws) from transition (only throws when actually mutating + drift detected). Existing `--force` / `--reapply` flags stay as legacy escape hatches with deprecation warning. Auto-apply on `missing`; abort with helpful message on `drifted`/`user-modified`; one-line confirmation on all-canonical. Hoist `snapshotTree` + `runInit` helpers. Create new `install-diff-mode.test.ts` with 5 scenarios. Fill .cursor snapshot parity gap.
3. **TASK-003 (Release prep)**: Bump root + 3 workspace packages to `v2.0.0-rc.14`. Update CHANGELOG with rc.14 section (Bug X, Bug V+Z fixes; Bug Y deferred to end of Phase 4; preview Phase 2 CLI surface contraction). Verify no lingering rc.13 references.

### Sequencing Rationale
- TASK-001 first because it's the smallest surface (template + one constant + few tests + README). Lands fast, unblocks Cursor users immediately on rc.14.
- TASK-002 second because it includes the test helper hoist (`snapshotTree` + `runInit` into `init-test-utils.ts`). Doing TASK-001's test edits first means TASK-001 uses the OLD non-hoisted helpers; TASK-002 then hoists in one focused refactor without colliding edits.
- TASK-003 last (version bump + CHANGELOG) so the release notes reference both fixes that just landed.

## Key Decisions

- **Decision**: Cursor schema = `{version: 1 (number), hooks: {stop, sessionStart, preToolUse}}` with camelCase event names and FLAT per-entry shape (`{command, matcher?, type?, timeout?, loop_limit?, failClosed?}`).
  **Rationale**: Verified against https://cursor.com/cn/docs/hooks per resolved clarification. Picks Codex-style flat entry shape (NOT Claude-Code nested envelope) — confirmed by official docs example.
  **Evidence**: Resolved clarification block in input prompt; exploration-cursor-hooks-schema.json `clarification_needs[0]` original recommendation revised post-docs-fetch.

- **Decision**: Introduce `DiffFileState` type alongside existing `InitWriteAction` and translate at rendering boundary.
  **Rationale**: Clean separation, no breaking changes to `formatInitPathAction` consumers. Avoids extending the formatter switch and keeps the classification semantics self-contained.
  **Evidence**: exploration-install-diff-state.json `clarification_needs[3]` recommendation; resolved clarification block confirms.

- **Decision**: Drift → abort with helpful message; NO `--force-override` path. Existing `--force` / `--reapply` stay as legacy escape hatches with deprecation warning, slated for removal in rc.15 Phase 2.
  **Rationale**: Per design principle stated in resolved clarification. Keeps the diff-mode happy path simple while preserving backward compat for one release.
  **Evidence**: Resolved clarification block (Install diff-mode section).

- **Decision**: One-line confirmation `Workspace already canonical (N files verified)` on all-canonical no-op.
  **Rationale**: Better discovery UX than silent success for a tool whose users are still learning the workflow. Plan-text explicit: "canonical workspace UX: one-line confirmation".
  **Evidence**: Resolved clarification block + exploration-install-diff-state.json `clarification_needs[1]` recommendation.

- **Decision**: Run actual `runInit()` at start of each diff-mode test then mutate fixture from there.
  **Rationale**: Always faithful to real install output; avoids fixture-vs-template drift. Per resolved clarification.
  **Evidence**: Resolved clarification block + exploration-test-surface.json `clarification_needs[2]` recommendation.

- **Decision**: Extend `InstallStepResult` status enum with new variants (`drift`, `missing-managed`) — accept breaking existing test count assertions.
  **Rationale**: Typed and discoverable; we're already refactoring tests as part of TASK-002. Per resolved clarification.
  **Evidence**: Resolved clarification block + exploration-test-surface.json `clarification_needs[0]` recommendation.

- **Decision**: Diff-mode emits `install_diff_applied` ledger event for diff-mode runs; `reapply_completed` stays distinct in rc.14 (slated for removal with `--reapply` in rc.15).
  **Rationale**: Per resolved clarification — keeps ledger event semantics clear during transition window.
  **Evidence**: Resolved clarification block + exploration-install-diff-state.json `clarification_needs[2]` option 1.

- **Decision**: Fill .cursor snapshot parity gap (currently only .claude + .codex are snapshotted in idempotency test).
  **Rationale**: Symmetric coverage prevents future Cursor-side regressions from sneaking past CI.
  **Evidence**: exploration-test-surface.json constraints + resolved clarification block.

- **Decision**: End-of-rc.14 review batching — Gemini code review + coverage report ONCE after all 3 tasks land, not per-task.
  **Rationale**: Per memory `feedback_review_batching.md` for multi-task lite-plan chains.
  **Evidence**: Memory `feedback_review_batching.md` + acceptance gates block in prompt.

## Dependencies

- **Depends on**: rc.13 baseline (already shipped locally per memory `project_v2_rc_continuation.md`)
- **Provides for**: rc.15 Phase 2 (CLI surface contraction — `--force`/`--reapply` removal, install flag count 12→4, uninstall flag count 11→4)
- **Parked**: Bug Y (Codex MCP) — deferred to end of Phase 4 per resolved clarification scope

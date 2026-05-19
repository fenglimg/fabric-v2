# TASK-13 (Gemini review remediation): rc.25 archive-skill 4 fixes

## Verdict context

Gemini batch review on rc.25 lite-plan returned **NO-GO** with:
- 1 Critical finding (post-verification: **FALSE alarm** — see "Critical dispute" below)
- 3 verified High findings (Fix 1 / Fix 2 / Fix 3)
- 1 Medium finding (Fix 4)

Per project memory `feedback_review_batching`, all 4 fixes batched into a single commit.

## Critical dispute — verified FALSE alarm

Gemini flagged `EventLedgerEventInputFor<T>`'s `Omit<T, "id" | "ts" | "kind" | "schema_version">` as breaking the type contract for default-having fields (e.g. `candidates_proposed`, `knowledge_proposed_ids`).

**Reality**: `Omit<T, …>` operates on the **output type** `T`. Zod's `z.input<schema>` infers default-having fields as **optional** on the input branch (because the default supplies the value when caller omits it). The two layers are independent — `Omit<>` doesn't promote `candidates_proposed: number` from "required-on-output" to "required-on-input". Verified empirically:

```
$ pnpm typecheck
> fabric-monorepo@2.0.0-rc.24 typecheck
> pnpm -r exec tsc --noEmit
# EXIT=0, no diagnostics
```

The 2 existing `EventLedgerEventInputFor<SessionArchiveAttemptedEvent>` callers (server + cli emitters) compile clean **without** supplying `candidates_proposed` or `knowledge_proposed_ids` — exactly the Zod default semantics. No code change needed; finding dismissed.

## Fix 1 — Phase 0.5 user-active gate-FAIL outcome contradiction (High)

**File**: `packages/cli/templates/skills/fabric-archive/SKILL.md` (~line 727-748)

**Problem**: The ELSE branch (E2/E4 user-active) of the gate-FAIL handler told the LLM to write outcome `'skipped_no_signal'`, but the Phase 2.5 Outcome Decision Matrix (row 2) reserves `viability_failed` for exactly this case. The SILENT-SKIP branch (E1/E3/E5) correctly uses `skipped_no_signal` (matrix row 4).

**Fix**: Changed the E2/E4 branch outcome from `skipped_no_signal` to `viability_failed`, with a verbatim cross-ref to "Phase 2.5 Outcome Decision Matrix row 2" so the LLM cannot drift on re-read. SILENT-SKIP branch left intact at `skipped_no_signal` (correct per matrix row 4).

## Fix 2 — E3 marker missing from AGENTS.md presentation template (High)

**Files**:
- `.fabric/AGENTS.md` (`## Self-archive policy` → `呈现模板`)
- `packages/shared/src/templates/bootstrap-canonical.ts` (`BOOTSTRAP_CANONICAL` body — managed-block source of truth synced to all 3 clients by `fab install`)
- `packages/cli/templates/skills/fabric-archive/SKILL.md` (Phase 0.4 detection rule row, ~line 482)

**Problem**: Phase 0.4 Trigger Gate row for E3 detected the marker string `self-archive policy triggered by signal X`, but the AGENTS.md `呈现模板` only emitted `顺手归档: 注意到你说 …`. The LLM was never told to emit the detection marker, so E3 routing would silently miss every time the LLM followed the template literally.

**Fix**: 
- Two-line presentation template in BOTH `.fabric/AGENTS.md` and `bootstrap-canonical.ts` — line 1 is the structured marker `self-archive policy triggered by signal: <Normative|Wrong-turn-and-revert|Decision confirmation|Explicit dismissal>`, line 2 is the existing user-facing 顺手归档 prompt. Added a one-sentence note immediately under the code fence explaining why both lines must appear.
- Aligned SKILL.md Phase 0.4 detection row to specify "substring match on the verbatim prefix `self-archive policy triggered by signal`" plus the enumerated signal vocabulary, so the detector and emitter share identical contract.
- Bootstrap-canonical.ts byte-locked invariants preserved: still starts with `# Fabric Bootstrap\n\n本项目`, still contains all required H2 sections (`行为规则` / `知识库(KB)` / `Cite policy`), still ≥ 800 bytes (grew further to ~3.6KB), still contains all cite-contract operator/skip-reason/sentinel anchors. All 41 existing tests in `packages/shared/test/templates/bootstrap-canonical.test.ts` stay green.
- `.fabric/AGENTS.md` and `BOOTSTRAP_CANONICAL` updated **byte-identically** so the `bootstrap_snapshot_drift` doctor check (`inspectL1BootstrapSnapshotDrift`) stays at `status:'ok'`. No `agents.meta.json` touched (per project rule).

## Fix 3 — Phase 0.0 step 4.5 missing `knowledge_proposed_ids` dedupe rule (High)

**File**: `packages/cli/templates/skills/fabric-archive/SKILL.md` Phase 0.0 step 4.5

**Problem**: Phase 2.5 line 1112 claimed `proposed` populates `knowledge_proposed_ids` "so the cross-session digest in Phase 0.0 can dedupe future runs against already-proposed entries", but Phase 0.0 step 4.5 (the dedupe consumer) had no rule using that field. The state machine populated a write-only key.

**Fix**: Appended a NEW rule **(f)** under existing rules (a)-(e), explicitly:
1. Gathering ALL `knowledge_proposed_ids` from `session_archive_attempted` events with `outcome === "proposed"` across the recent window (cross-session, not just current candidate session).
2. Building a global set of idempotency keys already proposed but not yet reviewed (pending entries still on disk).
3. Dropping any new candidate whose `idempotency_key` matches an id in that set during Phase 1 classification, with a verbatim cross-ref to "Phase 2.5 line 1112" so the closed-loop is auditable.

Note: rule (f) operates on candidate **observations** during Phase 1, not on the `session_id[]` filter that rules (a)-(e) produce. The placement at the end of step 4.5 is correct because (a)-(e) and (f) both belong to the "filter before scanning" pre-phase, but they filter on different axes. The closing sentence ("The resulting filtered `session_id[]` proceeds into step 5's digest concatenation") was kept intact and follows (f) — rule (f) is a Phase 1 contract that step 4.5 sets up, parallel to how (a)-(e) set up the session-level filter.

## Fix 4 — watermark suffix wording on truly fresh ledger (Medium)

**Files**:
- `packages/cli/templates/hooks/archive-hint.cjs` — `decide()` + `CONSTANTS` export
- `packages/cli/__tests__/archive-hint.test.ts` — case 3 fixture + new "truly-fresh" case
- `packages/cli/__tests__/integration/archive-hint-copy.test.ts` — case 3 fixture + new "truly-fresh" snapshot
- `packages/cli/__tests__/integration/__snapshots__/archive-hint-copy.test.ts.snap` — refreshed

**Problem**: When `lastProposedTs === null` because the project is BRAND NEW (zero archives ever, no rotation), the hook still appended `(watermark 已被 rotation 清理)`. First-time users saw a confusing message blaming "rotation" for a state that has no rotation history.

**Fix**: Introduced `rotationLikely` decision in `decide()`. Suffix only renders when the fallback fires AND there is **evidence** of rotation:
- `events.length > ROTATION_HINT_EVENTS_THRESHOLD` (= 50), OR
- An explicit `events_rotated` event appears anywhere in the ledger.

Added constants `EVENT_TYPE_ROTATED` and `ROTATION_HINT_EVENTS_THRESHOLD`, exported in the `CONSTANTS` block alongside the existing constants.

**Test fixture updates**:
- **Unit (archive-hint.test.ts) case 3**: injected a synthetic `events_rotated` event so the rotation branch still triggers; existing assertions (`watermark 已被 rotation 清理` + `40.0h`) stay green.
- **Unit, NEW test**: "omits the rotation suffix when ledger is truly fresh (no proposed event + no rotation marker + few events)" asserts (a) hours still render via fallback, (b) neither zh-CN nor en rotation suffix appears.
- **Integration (archive-hint-copy.test.ts) case 3**: injected synthetic `events_rotated` event in fixture; renamed test description to "+ rotation marker" to disambiguate from the new "truly fresh" case.
- **Integration, NEW test**: "omits the rotation suffix when ledger is truly fresh" with its own snapshot pinning the fresh-ledger wording.
- **Snapshot file**: refreshed — added 1 new snapshot entry for the fresh-ledger case, removed the 1 obsolete entry from the renamed test description. Existing snapshots for cases 1/2/4/5/6 unchanged (they don't exercise the fallback path).

## Tests + typecheck

```
$ pnpm typecheck
# EXIT=0 — packages/shared, packages/server, packages/cli all clean.

$ pnpm test
# packages/shared:  Test Files 26 passed (26) · Tests 399 passed (399)
# packages/server:  Test Files 34 passed (34) · Tests 561 passed | 1 skipped (562)
# packages/cli:     Test Files 48 passed (48) · Tests 646 passed (646)
# TOTAL: 1606 passed + 1 skipped = 1607 tests (baseline 1604 pass + 1 skip + 2 new = matches)
```

Net delta: +2 tests (1 unit `omits the rotation suffix when ledger is truly fresh`, 1 integration counterpart with snapshot). +1 unit case 3 rename for clarity.

## Verification grep checklist

| Fix | Anchor verified |
|-----|------------------|
| 1   | `SKILL.md:744` contains `outcome='viability_failed'` + cross-ref to "Phase 2.5 Outcome Decision Matrix" |
| 2   | `self-archive policy triggered` present in `.fabric/AGENTS.md`, `bootstrap-canonical.ts`, `SKILL.md` (3 files, 5 occurrences total — emitter + emitter + detector) |
| 3   | `SKILL.md:387` contains `**(f) Cross-session pending dedupe**` |
| 4   | `archive-hint.cjs` contains `EVENT_TYPE_ROTATED`, `ROTATION_HINT_EVENTS_THRESHOLD = 50`, `rotationLikely` decision; new fresh-ledger snapshot in `.snap` |

## Files changed (8 total)

- `packages/cli/templates/skills/fabric-archive/SKILL.md` — Fix 1 + Fix 2 detector + Fix 3
- `.fabric/AGENTS.md` — Fix 2 emitter
- `packages/shared/src/templates/bootstrap-canonical.ts` — Fix 2 emitter (canonical mirror)
- `packages/cli/templates/hooks/archive-hint.cjs` — Fix 4 logic
- `packages/cli/__tests__/archive-hint.test.ts` — Fix 4 fixture + new test
- `packages/cli/__tests__/integration/archive-hint-copy.test.ts` — Fix 4 fixture + new test
- `packages/cli/__tests__/integration/__snapshots__/archive-hint-copy.test.ts.snap` — Fix 4 snapshot refresh
- `.workflow/.lite-plan/rc25-archive-skill-redesign-2026-05-19/.summaries/TASK-13-remediation-summary.md` — this file

## Deviations

None. All 4 fixes applied within scope; production hook logic only changed for Fix 4 copy heuristic (no behavior change for archived projects — only suffix wording for brand-new projects). All other changes are LLM-prose template coherence fixes (no runtime code path affected).

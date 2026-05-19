# rc.25 Code Review — Gemini Batch Review (TASK-13)

**Run**: 2026-05-19 · gemini-3.1-pro-preview · exec_id `rc25-task13-gemini-review`
**Scope**: 12 rc.25 commits (`90c67ea..e234f68`) — schema + skill + hook + AGENTS.md + doctor + tests + CHANGELOG
**Initial verdict**: NO-GO (1 Critical + 3 High + 1 Medium + 1 Low)
**Final verdict (after remediation `1d98ffd`)**: **SHIP IT** ✅

---

## Critical findings (must fix before ship)

### 1. ~~Strict-typecheck regression in `archive-attempt-outcomes.test.ts:70`~~ — **FALSE ALARM**

Gemini claim: `EventLedgerEventInputFor<T>` does `Omit<T, …>` on the inferred output type, so default-having fields (`candidates_proposed`, `knowledge_proposed_ids`) remain required in the TypeScript input signature; cases 2/3 omitting them must fail typecheck.

**Verification**: `pnpm typecheck` exits 0 across all 3 packages (shared / server / cli). The reasoning misses that the `EventLedgerEvent` union is inferred via Zod's input branch where `.default(…)` makes fields optional. `Omit<T, …>` then strips envelope fields only — it does NOT promote default-having fields from optional-in-input to required-in-input. Both cases 2 and 3 compile clean.

**Status**: No code change needed. Disputed in `.summaries/TASK-13-remediation-summary.md`.

---

## High findings (should fix) — ALL FIXED

### 1. Phase 0.5 vs Phase 2.5 `outcome` contradiction for E2/E4 gate failure
- **File**: `packages/cli/templates/skills/fabric-archive/SKILL.md` line ~731
- **Issue**: Phase 0.5 ELSE branch (E2/E4 user-active gate fail) wrote `outcome='skipped_no_signal'`; Phase 2.5 Outcome Decision Matrix row 2 says it must be `viability_failed`. Contradictory LLM instructions.
- **Fix** (commit `1d98ffd`): Phase 0.5 line 744 now emits `viability_failed` with verbatim cross-ref to matrix row 2. SILENT-SKIP branch (E1/E3/E5) untouched — still `skipped_no_signal` per matrix row 4.

### 2. E3 marker instruction missing from AGENTS.md `呈现模板`
- **Files**: `.fabric/AGENTS.md` + `packages/shared/src/templates/bootstrap-canonical.ts` (managed-block source)
- **Issue**: Phase 0.4 Trigger Gate in SKILL.md detects E3 by literal `self-archive policy triggered by signal X`, but AGENTS.md template only showed the user-facing `顺手归档:` line. AI never told to emit the detection marker → Phase 0.4 gate breaks for E3.
- **Fix** (commit `1d98ffd`): two-line 呈现模板 — first line is the E3 marker `self-archive policy triggered by signal: <type>`, second line the user-facing `顺手归档:` notice. SKILL.md Phase 0.4 detector row aligned to match verbatim prefix. AGENTS.md ↔ BOOTSTRAP_CANONICAL byte-identical (drift detector stays `ok`).

### 3. Phase 0.0 step 4.5 missing `knowledge_proposed_ids` dedupe instruction
- **File**: `packages/cli/templates/skills/fabric-archive/SKILL.md` Phase 0.0 step 4.5
- **Issue**: Phase 2.5 advertised `knowledge_proposed_ids` would let Phase 0.0 dedupe future runs against already-proposed entries, but step 4.5 had no rule using the field. Dead-weight field.
- **Fix** (commit `1d98ffd`): new rule **(f) Cross-session pending dedupe** appended after rule (e) — gather ids from all `outcome='proposed'` events across window, drop candidates whose idempotency_key matches.

---

## Medium findings (recommend fix) — FIXED

### 1. Misleading `watermark 已被 rotation 清理` suffix on truly fresh ledger
- **File**: `packages/cli/templates/hooks/archive-hint.cjs`
- **Issue**: When `lastProposedTs=null` because the project is brand-new (not because of rotation), the hook still appended `(watermark 已被 rotation 清理)`. Confusing for new users.
- **Fix** (commit `1d98ffd`): added `EVENT_TYPE_ROTATED='events_rotated'` + `ROTATION_HINT_EVENTS_THRESHOLD=50` constants; `rotationLikely` decision gates the suffix. Test fixture case 3 now injects an `events_rotated` event to retain the original assertion; new "truly fresh" test asserts suffix absence.

---

## Low / style (optional) — NOT FIXED (cosmetic)

### 1. Redundant `距上次归档 尚未归档` phrasing
- **File**: `packages/cli/templates/hooks/archive-hint.cjs`
- **Issue**: when `hoursElapsed=null`, sentence reads `距上次归档 尚未归档` — grammatically awkward.
- **Status**: Deferred. Cosmetic copy issue, no functional impact. Can roll into rc.26 polish.

---

## Verdict

**SHIP IT** ✅

**Reasoning**: All 3 verified High findings are fixed in remediation commit `1d98ffd` (single batched commit per project memory `feedback_review_batching`). The Critical finding was a false-alarm based on an incorrect prediction of Zod input-type inference behavior — empirically disproven by `pnpm typecheck` EXIT=0. Medium copy issue addressed. Low cosmetic deferred to rc.26.

**Quality gates**:
- `pnpm typecheck`: 0 errors across shared/server/cli
- `pnpm test`: 1606 pass + 1 skip (0 fail)
- `pnpm lint`: clean
- Pre-commit hooks: passing
- Cite contract: drift detector `ok` (bootstrap-canonical ↔ .fabric/AGENTS.md byte-identical)

**Commit chain (13 rc.25 commits)**:
- TASK-01 `151fe30` event-ledger schema variant
- TASK-02 `90c67ea` session_id propagation
- TASK-03 `1b9f8b2` archive-hint copy
- TASK-09 `a1adfa1` AGENTS.md E3 policy (initial)
- TASK-04 `545f3a4` Phase -0.5 Range Resolution
- TASK-05 `d458a6c` Phase 0.0 outcome filter
- TASK-06 `d03eefe` Phase 0.4 Trigger Gate
- TASK-07 `355c085` Phase 0.5 silent-skip + Phase 2.5 persistence
- TASK-08 `5eb13c7` E5 周期触发 appendix
- TASK-10 `6d0bd23` doctor --archive-history
- TASK-11 `1589071` integration tests
- TASK-12 `e234f68` CHANGELOG + dogfood-evidence
- **TASK-13 remediation `1d98ffd`** review fixes

**Needs reopen**: None.

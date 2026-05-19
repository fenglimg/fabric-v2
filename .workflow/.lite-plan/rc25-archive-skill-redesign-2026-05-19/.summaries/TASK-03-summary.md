# TASK-03: archive-hint.cjs 文案改造 — 跨会话计数 + 项目级欠债 wording

## Changes

- `packages/cli/templates/hooks/archive-hint.cjs` (new file, 348 lines): Created
  the rc.25-redesigned archive-hint hook script. Notes:
  - The plan referenced this path as if it already existed, but in the current
    tree the rc.2 archive-hint had been merged into `fabric-hint.cjs` (rc.5
    TASK-010 rename). I re-established it as a standalone hook script seeded
    from the rc.2 design (preserved in `.claude/hooks/archive-hint.cjs`), then
    applied all four TASK-03 deltas. This keeps the scope discipline the user
    requested (Wave 1 parallel tasks on different files) — fabric-hint.cjs
    remains untouched.
  - Added bilingual two-line reason copy. zh-CN includes the literal substring
    `项目级长期欠债, 不一定来自本会话`; en mirror references
    `project-level long-term debt, not necessarily from the current session`.
  - Added `countDistinctSessions(events, lastProposedTs)` returning
    `{count, coverage_ratio, total}`. coverage_ratio = events_with_session_id /
    total plan_context events since watermark. Threshold 0.5 gates the
    "跨 N 个会话" wording vs the degraded "跨多个会话累计" / "Across multiple
    sessions" phrasing.
  - Added `readFabricLanguage(projectRoot)` mirroring lib/banner-i18n.cjs's
    never-throw contract. Folds zh-CN-hybrid → zh-CN and match-existing → en.
    Default `en` per TASK-03 spec.
  - Watermark fallback: when `lastProposedTs === null`, decide() substitutes
    `events[0]?.ts` as a virtual watermark so hoursElapsed is meaningful
    instead of `null` forever (Q3.8 gap fix). The reason appends
    `(watermark 已被 rotation 清理)` / `(watermark cleaned by rotation)` so
    operators understand the approximation.
  - stdout JSON shape unchanged: `{decision: "block", reason, signal: "archive"}`.
  - Trigger logic unchanged: still `count >= 5 OR hours >= 24`.
  - Fail-silent invariant preserved: any error → silent exit 0.
- `packages/cli/__tests__/archive-hint.test.ts` (new file, 10 test cases):
  Covers all 6 enumerated unit cases plus 4 supplementary checks (separate
  readFabricLanguage assertions for en/zh-CN/missing-config; stdout JSON
  shape regression). Uses createRequire(.cjs) pattern matching fabric-hint.test.ts:1-29.

## Verification

- [x] `archive-hint.cjs contains string '项目级长期欠债'` — verified via Grep
  (line 13, 208).
- [x] `archive-hint.cjs contains string 'project-level' OR 'long-term debt'`
  — line 212, 218 (`project-level long-term debt` literal).
- [x] `archive-hint.cjs reads .fabric/fabric-config.json for fabric_language`
  — `readFabricLanguage()` at line 147; `FABRIC_LANGUAGE_FIELD = "fabric_language"`
  at line 63.
- [x] `archive-hint.cjs has fallback path when lastProposedTs is null using
  events[0].ts` — decide() lines 268-275 implement the `watermarkFallbackFired`
  branch using `events[0]?.ts`.
- [x] `archive-hint.test.ts contains ≥6 test cases` — 10 `it()` blocks.
- [x] `pnpm --filter @fenglimg/fabric-cli test archive-hint exits 0` —
  10/10 tests pass (262ms total).
- [x] Commit msg format `feat(rc25): archive-hint copy + cross-session count
  + watermark fallback (TASK-03)` — applied at commit time.

## Tests

- [x] `pnpm --filter @fenglimg/fabric-cli test archive-hint`:
  10 tests passed. Cases covered:
  1. session_id present → `跨 3 个会话累计` rendered
  2. session_id missing (coverage <50%) → `跨多个会话累计` rendered
  3. lastProposedTs null → reason contains `watermark 已被 rotation 清理`
     + computes hoursElapsed from events[0].ts
  4. en variant → English copy + `project-level long-term debt`
  5. zh-CN variant → Chinese copy + `项目级长期欠债`
  6. Cooldown regression: emit at t=0, suppress at t+1h, re-emit at t+13h
  + readFabricLanguage helper tests (en/zh-CN/missing-config defaults)
  + stdout JSON shape contract test (3-key payload)
- [x] `pnpm --filter @fenglimg/fabric-cli test fabric-hint`:
  155/155 existing fabric-hint tests still pass (no regression).
- [x] `pnpm exec tsc --noEmit` in packages/cli: 0 errors.

## Deviations

- **Scope reinterpretation**: The plan refers to
  `packages/cli/templates/hooks/archive-hint.cjs` as if it existed, but the
  current tree has consolidated archive/review/import signals into
  `fabric-hint.cjs` (rc.5 TASK-010 rename). I created `archive-hint.cjs` as
  a NEW standalone hook script seeded from the rc.2 design (still preserved
  at `.claude/hooks/archive-hint.cjs`). This:
  - Honors the convergence criteria literally (they check `archive-hint.cjs`
    strings, not `fabric-hint.cjs`).
  - Respects the user's "DO NOT touch other rc.25 files; Wave 1 has 3
    parallel tasks on different files" constraint — fabric-hint.cjs stays
    completely untouched and its 155 tests still pass.
  - Establishes the file TASK-11 expects to snapshot in integration tests.
  - Wiring into the install pipeline (so the new template ships to user
    workspaces) is OUT OF SCOPE for TASK-03 — that's a wiring concern likely
    addressed by a downstream task (TASK-04..TASK-10 install/skill changes
    or TASK-11 integration test).
- **Default language = 'en'**: Per TASK-03 spec ("default 'en' when missing").
  Note this differs from `lib/banner-i18n.cjs#DEFAULT_LANGUAGE = "zh-CN"`
  (which encodes the rc.7+ user-visible contract for fabric-hint's pre-i18n
  byte-for-byte Chinese output). archive-hint is a NEW surface — no pre-i18n
  contract to preserve, so 'en' is the safer default for non-Chinese users.

## Notes

- Downstream tasks should be aware: archive-hint.cjs is NOT YET wired into
  the install pipeline. `installHookLibs` / hooks-orchestrator currently only
  copies `fabric-hint.cjs` + its lib/. A subsequent task (likely TASK-04+
  install wiring or TASK-12 release prep) must add archive-hint.cjs to the
  install manifest if the rc.25 design intends it to replace the Signal A
  half of fabric-hint.cjs on user installs. If instead the new file is meant
  to be referenced ONLY by docs/tests (and fabric-hint.cjs's Signal A stays
  the runtime surface), the wiring need is N/A.
- TASK-02 will improve session_id coverage; until then, real-world events
  will exercise the "跨多个会话累计" degraded branch — which is the entire
  point of the coverage_ratio >= 0.5 threshold (graceful degrade).
- TASK-11 integration test (`archive-hint-copy.test.ts`) will spawn this
  hook with hand-crafted events.jsonl fixtures and snapshot stdout JSON;
  the in-process unit tests in this PR already exercise the same shapes
  but TASK-11 adds child-process snapshot coverage for full confidence.

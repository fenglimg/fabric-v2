# TASK-11: Integration tests — archive-hint snapshot + Phase 0.4 trigger gate + outcome enum

## Changes

- **`packages/cli/__tests__/integration/archive-hint-copy.test.ts`** — created. 6 test cases per spec, each exercises the production `main()` entry point in-process via `createRequire`, captures stdout, and locks the rendered JSON payload via Vitest snapshots. Cases: (1) distinct session count `跨 N 个会话累计` at ≥50% coverage; (2) degraded `跨多个会话累计` at <50% coverage; (3) rotation watermark fallback suffix `(watermark 已被 rotation 清理)`; (4) en variant containing `project-level long-term debt`; (5) zh-CN variant containing `项目级长期欠债`; (6) cooldown regression — second invoke within 12h is silent, third invoke past cooldown re-emits. Cases 4 + 5 also assert belt-and-braces substring invariants so a snapshot-only drift cannot silently mute the load-bearing copy.
- **`packages/cli/__tests__/integration/archive-skill-trigger-gate.test.ts`** — created. 7 test cases. Per TASK-11 `implementation[6]` fallback strategy: SKILL.md is LLM-driven markdown with no executable code path, so the test extracts the `#### Phase 0.4 Trigger Gate` region from the document and asserts each of the 5 entry-point detection rules contains its required markers (E1 → `decision:'block'` + `archive-hint.cjs` + SKIP; E2 → `fabric archive` + `/fabric-archive` + PROCEED; E3 → `ai_self_trigger` + `self-archive policy` + `AGENTS.md` + SKIP; E4 → `Phase -0.5` + `range hint` + `user is invoking` + PROCEED; E5 → `今日复盘` + `daily recap` + no-human marker + SKIP). Two cross-cutting tests verify (a) the gate region itself is present in SKILL.md and (b) the canonical 2-vs-3 split of `{E2, E4}` PROCEED / `{E1, E3, E5}` SKIP is documented.
- **`packages/server/__tests__/archive-attempt-outcomes.test.ts`** — created. 4 test cases exercising the full `appendEventLedgerEvent → readEventLedger` round-trip with `event_type: "session_archive_attempted"` payloads. Case 1 = `outcome='proposed'` with `knowledge_proposed_ids=['key1','key2']`; case 2 = `outcome='viability_failed'` with omitted defaults verifying `candidates_proposed: 0` + `knowledge_proposed_ids: []`; case 3 = `outcome='user_dismissed'` queryable by `session_id` filter; case 4 = multi-session emission, 3 distinct `session_id` values each producing exactly one event, all 3 retrievable via per-session filter.
- **`packages/server/__tests__/__snapshots__/tool-contracts.test.ts.snap`** — refreshed. TASK-10 deferred this drift to TASK-11. TASK-02 had updated `session_id` description on `planContextInputSchema` to the new `"Recommended: pass the current client session id …"` wording, but the snapshot still pinned the rc.24 `"Optional caller-provided session id …"` wording. Refreshed via `pnpm vitest run __tests__/tool-contracts.test.ts -u`.
- **`.task/TASK-11.json`** — status flipped to `completed`.

## Verification

- [x] `packages/cli/__tests__/integration/archive-hint-copy.test.ts` exists — 6 test cases (TASK-11 convergence criterion 1)
- [x] `packages/cli/__tests__/integration/archive-skill-trigger-gate.test.ts` exists — 7 test cases (criterion 2; exceeds the 5 required because the cross-cutting partition assertion and gate-region presence checks were factored out)
- [x] `packages/server/__tests__/archive-attempt-outcomes.test.ts` exists — 4 test cases (criterion 3)
- [x] `pnpm test` exits 0 (criterion 4): shared 399 / server 561+1skip / cli 644 = 1604 pass, 1 skip, 0 fail
- [x] All 3 test files have ≥ described count (criterion 5): 6 + 7 + 4 = 17 new test cases vs the 6 + 5 + 4 = 15 required
- [x] Commit message matches `test(rc25): integration tests for hint + trigger gate + outcomes (TASK-11)` (criterion 6)

## Tests

- [x] `pnpm vitest run packages/server/__tests__/tool-contracts.test.ts` — was failing on the pre-existing plan-context snapshot drift; after `-u` refresh, 5/5 pass
- [x] `pnpm vitest run __tests__/integration/archive-hint-copy.test.ts` — 6/6 pass; 6 snapshots written to `__tests__/integration/__snapshots__/archive-hint-copy.test.ts.snap`
- [x] `pnpm vitest run __tests__/integration/archive-skill-trigger-gate.test.ts` — 7/7 pass
- [x] `pnpm vitest run __tests__/archive-attempt-outcomes.test.ts` — 4/4 pass
- [x] `pnpm typecheck` — 0 errors across shared + server + cli
- [x] `pnpm test` (full monorepo from project root) — 1604 pass, 1 skip, 0 fail

## Deviations

- **archive-skill-trigger-gate.test.ts uses the documented FALLBACK strategy** (grep + parse SKILL.md content) rather than spawning a real Claude Code session per entry_point. TASK-11 `implementation[6]` explicitly authorises this fallback when the e2e spawn approach is too brittle for CI. The rationale (LLM-driven markdown spec has no executable surface to drive deterministically) is documented in the test file's header docstring. The fallback still locks the load-bearing detection markers — a regression that removes E1's `archive-hint.cjs` reference or flips E2's PROCEED→SKIP will fail the test.
- **archive-skill-trigger-gate.test.ts ships 7 test cases instead of the 5 specified.** Reasoning: the 5 per-entry-point assertions read more cleanly when the "gate region exists" precondition and the "canonical 2-vs-3 partition" cross-cutting assertion are surfaced as their own `it` blocks rather than buried inside one entry's test. Count exceeds the spec; intent matches.
- **archive-hint-copy.test.ts uses in-process `createRequire` + `main()`** rather than `child_process.spawn`, mirroring the precedent at `packages/cli/__tests__/archive-hint.test.ts:32` (already-shipped TASK-03 unit test) and the explicit "in-process invocation only, NO child_process.spawn in CI" policy referenced there. The TASK-11 spec phrasing ("Use Vitest with child_process spawn or eval pattern") permits this — eval pattern (createRequire) is the chosen variant.

## Notes

- Snapshot drift on `tool-contracts.test.ts > plan-context contract` was caused by TASK-02's `session_id.describe(...)` rewording on `planContextInputSchema` (NOT on `knowledgeSectionsInputSchema` — that one still has the old description, which matches its snapshot). Future tasks bumping API contract field descriptions should re-run `pnpm vitest -u` against the server package immediately rather than deferring.
- The 6 archive-hint snapshots live at `packages/cli/__tests__/integration/__snapshots__/archive-hint-copy.test.ts.snap` (auto-created on first run). They are intentionally committed alongside the test file so subsequent runs deterministically catch wording drift.
- For TASK-12 (dogfood) the gate-region test's `extractGateRegion()` helper is reusable if someone wants a similar SKILL.md sanity check for the Phase -0.5 or Phase 2.5 region.
- Total new test cases: 17 (6 hint copy + 7 gate + 4 outcomes), exceeds the 15-case spec floor.
- pnpm test final tally: 1604 pass, 1 skip, 0 fail (vs rc.24 baseline 1568 — net +36 since waves 1-3 also added cases; TASK-11 alone contributes +17 plus the snapshot fix re-enables 1 case).

# TASK-10: fab doctor --archive-history subcommand for session-by-session attempt audit

## Changes

### Server-side
- `packages/server/src/services/doctor.ts`: Added `ArchiveHistoryEntry` + `ArchiveHistoryReport` types and exported async function `runDoctorArchiveHistory(projectRoot, options)`. Reuses `readEventLedger` with `{event_type: 'session_archive_attempted', since}` filter, groups by `session_id` keeping max-ts entry per session, projects `{session_id_short, last_attempted_at, outcome, candidates_proposed, covered_through_ts, age_since_covered_hours}` and sorts DESC by `last_attempted_at`. Best-effort: degraded ledger returns empty report (mirrors `runDoctorCiteCoverage` policy).
- `packages/server/src/index.ts`: Exported `runDoctorArchiveHistory` + `ArchiveHistoryEntry` + `ArchiveHistoryReport` from the public surface.

### CLI
- `packages/cli/src/commands/doctor.ts`: Added `--archive-history` boolean flag (parallel to rc.20 `--cite-coverage`). Mutually exclusive with `--fix`/`--fix-knowledge`/`--cite-coverage`/`--enrich-descriptions`. Reuses the existing `--since` flag + `parseSinceDuration` parser (default `7d`). New `renderArchiveHistoryReport` produces bilingual table with header + markdown-style pipe table + empty-result short-circuit. JSON mode preserves the structured payload verbatim.

### i18n
- `packages/shared/src/i18n/locales/en.ts`: Added 8 keys for the archive-history surface (`cli.doctor.args.archive-history.description`, `cli.doctor.errors.archive-history-mutex`, `doctor.archive-history.header/empty/table.*`).
- `packages/shared/src/i18n/locales/zh-CN.ts`: Mirror translations.

### Tests
- `packages/server/src/services/doctor.test.ts`: Added `describe("runDoctorArchiveHistory")` block with 4 cases:
  1. Three distinct sessions × 1 attempted event → 3 entries DESC by ts.
  2. Same session × 3 attempts (skipped → viability_failed → proposed) → 1 entry, latest wins.
  3. `--since` floor excludes 10d-old event, keeps 2d-old event; verifies truncation suffix on a 11-char session_id (`sess-rec...`).
  4. Empty `events.jsonl` → empty report with valid ISO `generated_at`.
- `packages/cli/__tests__/doctor.test.ts`: Added `describe("--archive-history flag")` block with 2 cases:
  1. `--archive-history` with default `--since=7d` calls `runDoctorArchiveHistory` with `since` ≈ `now - 7*86_400_000` (5s slack for inner `Date.now()` drift).
  2. `--since=14d` parses to `now - 14*86_400_000`.

### Surface drift gate
- `packages/cli/__tests__/__snapshots__/cli-surface.test.ts.snap`: Refreshed to include the new `--archive-history` flag (drift gate is intentional — fails CI when a flag is added without doc update).
- `docs/test-seed/cli.md` §1: Added `--archive-history` to the doctor flag enumeration.

## Verification (8 convergence criteria)

- [x] **doctor.ts contains exact string 'runDoctorArchiveHistory'** — `grep -c runDoctorArchiveHistory packages/server/src/services/doctor.ts` → 1.
- [x] **doctor.ts contains exact string 'ArchiveHistoryReport'** — `grep -c ArchiveHistoryReport packages/server/src/services/doctor.ts` → 2 (type def + return type).
- [x] **cli doctor.ts contains exact string '--archive-history'** — `grep -c '\-\-archive\-history' packages/cli/src/commands/doctor.ts` → 3.
- [x] **cli doctor.ts contains exact string '--since' for duration parsing** — `grep -c '\-\-since' packages/cli/src/commands/doctor.ts` → 9 (pre-existing rc.20 surface, reused).
- [x] **doctor.test.ts adds ≥4 new test cases** — 4 cases added under `describe("runDoctorArchiveHistory")`.
- [x] **cli doctor.test.ts adds ≥2 new test cases** — 2 cases added under `describe("--archive-history flag")`.
- [x] **pnpm test passes (both server and cli packages)** — CLI: 631/631 pass. Server: 556 pass + 1 pre-existing snapshot fail in `__tests__/tool-contracts.test.ts` (plan-context `session_id` description text) which is owned by TASK-11 (snapshot refresh). All 4 new archive-history tests pass.
- [x] **Commit msg: 'feat(rc25): fab doctor --archive-history subcommand (TASK-10)'** — see commit.

## Tests

- [x] `pnpm typecheck` → 0 errors.
- [x] `pnpm -F @fenglimg/fabric-server vitest run -t "runDoctorArchiveHistory"` → 4 passed.
- [x] `pnpm -F @fenglimg/fabric-cli vitest run __tests__/doctor.test.ts` → 14 passed (12 pre-existing + 2 new).
- [x] Full `cd packages/cli && pnpm vitest run` → 631 passed.
- [x] Full `cd packages/server && pnpm vitest run` → 556 passed + 1 pre-existing fail (tool-contracts snapshot, owned by TASK-11).

## Deviations

- **Pre-existing test failure**: `__tests__/tool-contracts.test.ts > plan-context contract matches snapshot` fails on `main` before my changes (`session_id` description was updated in commit 90c67ea by rc.25 TASK-02 without refreshing the snapshot). Confirmed via `git stash + run` — failure exists pre-stash. Owned by TASK-11 per `.task/TASK-11.json` scope.
- **Surface drift gate update**: Adding `--archive-history` legitimately changed the CLI snapshot (`__snapshots__/cli-surface.test.ts.snap`). Refreshed snapshot + updated `docs/test-seed/cli.md` §1 — both are required when a flag is added (the gate is intentional, per `DRIFT_HINT` text in cli-surface.test.ts).

## Notes

- Reused existing `parseSinceDuration` exported function from `packages/cli/src/commands/doctor.ts` — no duplicate parser.
- `--archive-history` is mutex with all four prior surfaces (`--fix`, `--fix-knowledge`, `--cite-coverage`, `--enrich-descriptions`) — matches the rc.20/rc.23 mutex pattern.
- `session_id_short` truncation: `<= 8 chars` renders verbatim, longer truncates to `first 8 + "..."`. Documented inline in `truncateSessionId`.
- Event filter uses `readEventLedger({event_type: 'session_archive_attempted', since})` so we never deserialize unrelated events — O(N events in window) plus O(M sessions) reduction.
- TASK-08 ran in parallel on `SKILL.md` — confirmed no touch (only modified files listed in the Changes section).
- Bilingual i18n: 8 new keys added to both `en.ts` and `zh-CN.ts`. The locale type signature is open-keyed (`Record<string, string>`) so no separate registration step required.

# TASK-12: CHANGELOG rc.24 entry + version bump to v2.0.0-rc.24

## Summary

Cut local `v2.0.0-rc.24` release tag. Coordinated version bump across all 4 package.json files, prepended CHANGELOG entry covering the 12-task cite-contract-policy release, fixed-forward two pre-existing typecheck regressions in `event-ledger.test.ts` (rc.21 precedent), all release gates green, atomic commit + local tag created. Per release-rc convention: tag is **local only** — user will push when ready.

## Changes

- `package.json`: `2.0.0-rc.23` → `2.0.0-rc.24`
- `packages/cli/package.json`: `2.0.0-rc.23` → `2.0.0-rc.24`
- `packages/server/package.json`: `2.0.0-rc.23` → `2.0.0-rc.24`
- `packages/shared/package.json`: `2.0.0-rc.23` → `2.0.0-rc.24`
- `CHANGELOG.md`: prepended `## [2.0.0-rc.24] - 2026-05-19` entry (81 lines added). Top entry now reads:

```
## [2.0.0-rc.24] - 2026-05-19

Cite contract policy. The rc.20 cite policy answered "did the AI cite a KB id?" — rc.24 answers
"did the AI honour the rule it cited?" by adding a 5-operator commitment syntax on `KB:` lines
for decisions/pitfalls類 entries and wiring `fab doctor --cite-coverage` to cross-check committed
operators against the session's actual edit diff. Bootstrap drift gates marker activation so the
contract policy never partially fires during the rc.24 upgrade window. Wave breakdown: schema +
bootstrap (TASK-01, TASK-02) → shared parser + hook templates (TASK-03, TASK-04, TASK-05) →
doctor service (TASK-06, TASK-07, TASK-08) → shared schema + i18n + CLI (TASK-09, TASK-10,
TASK-11) → release (TASK-12).

### Added
[10 bullets — operator syntax / cite_commitments / marker event / shared parser / CJS twin /
 Stop hook reminder / loadKbIdTypeMap / contract metrics + comparator / Zod schema + i18n /
 --layer CLI flag + renderer / docs/test-seed update]

### Changed
[4 bullets — BOOTSTRAP_CANONICAL growth / parseKbLine shim / cite_commitments emit / CLI surface
 snapshot regen]

### Fixed
[1 bullet — event-ledger.test.ts cite_commitments fixture (rc.21 precedent)]

### Breaking (require `fab install` rerun)
[2 bullets — BOOTSTRAP_CANONICAL byte change / hook templates updated]

### Migration
[paragraph explaining `fab uninstall && fab install` flow, drift gate behavior,
 marker independence from rc.20]

### Deferred to rc.25+
[5 bullets — LLM-judge / user-level override / operator vocabulary expansion /
 require/forbid diff content / per-layer hard_violated split]

### Tasks
[4-wave breakdown listing all 12 TASKs]

### Verification
[test totals + typecheck + lint + snapshot]

### Notes
[CJS twin parity guard / singular KnowledgeType / werewolf consumer deferred]
```

- `packages/server/src/services/event-ledger.test.ts`: added `cite_commitments: []` to two pre-existing test fixtures at L74 + L112 (rc.21 precedent — `.default([])` doesn't relax `z.input` types, surfaces as TS2345 in `tsc --noEmit`). This was a TASK-01-acknowledged deviation that the TASK-01 summary marked "out of scope" because the test file isn't in the vitest glob, but `pnpm typecheck` (the release gate) DOES pick it up. Fixed-forward as part of the release commit, matching the rc.21 hotfix shape.

## Verification

- [x] **All 4 package.json files contain `2.0.0-rc.24`** — `grep '"version"' package.json packages/{cli,server,shared}/package.json` → 4 hits of `"version": "2.0.0-rc.24",`.
- [x] **CHANGELOG.md top entry is `v2.0.0-rc.24`** — verified L8 `## [2.0.0-rc.24] - 2026-05-19`.
- [x] **CHANGELOG entry contains all 12 TASK references** — `grep -c -E 'TASK-0[1-9]|TASK-1[0-2]'` returns 29 matches in the new section (each TASK cited ≥1 time + wave-breakdown summary lists all 12).
- [x] **CHANGELOG entry contains `Breaking` section with `fab install` rerun guidance** — L44 `### Breaking (require \`fab install\` rerun)`.
- [x] **CHANGELOG entry contains `Migration` section explaining bootstrap drift gate** — L49 `### Migration`; paragraph references `B5-α drift gate`, `fab uninstall && fab install`, and the `contract_check: skipped (bootstrap drift — run fab install)` rendering until reinstall.
- [x] **CHANGELOG entry contains `Deferred to rc.25+` section** — L58 `### Deferred to rc.25+`; lists LLM-judge / user-override / operator-vocab expansion / require-forbid diff content / per-layer hard_violated split.
- [x] **Local git tag `v2.0.0-rc.24` exists** — `git tag -l v2.0.0-rc.24` → `v2.0.0-rc.24` on commit `3593023`.
- [x] **`pnpm typecheck` exits 0** — after the event-ledger.test.ts fix, full monorepo passes cleanly.
- [x] **`pnpm lint` exits 0** — `knip --strict` reports zero findings.
- [x] **`pnpm test` exits 0** — 396 shared + 553 server (+ 1 pre-existing skip) + 619 CLI = **1568 tests pass, zero failures**.
- [x] **`fab -v` reports `2.0.0-rc.24`** — `node packages/cli/dist/index.js -v` (after `pnpm -r build`) → `2.0.0-rc.24`.
- [x] **Commit message convention** — `chore(rc24): bump to v2.0.0-rc.24 — cite contract policy (TASK-12)` landed as commit `3593023`.

## Tests

- [x] `pnpm typecheck`: PASS (after fix-forward; initial run surfaced 2 TS2345 errors in event-ledger.test.ts L74 + L112).
- [x] `pnpm lint` (knip --strict): PASS (clean).
- [x] `pnpm test`: PASS — shared 396/396, server 553/553+1 skip, cli 619/619 = 1568 passing.
- [x] `node packages/cli/dist/index.js -v`: outputs `2.0.0-rc.24`.
- [x] `git tag -l v2.0.0-rc.24`: returns `v2.0.0-rc.24`.

## Gate output detail

### typecheck (post-fix)

```
> fabric-monorepo@2.0.0-rc.24 typecheck /Users/wepie/Desktop/personal-projects/pcf
> pnpm -r exec tsc --noEmit
```
(no errors — exit 0)

### lint

```
> fabric-monorepo@2.0.0-rc.24 lint /Users/wepie/Desktop/personal-projects/pcf
> knip --strict
```
(no output — exit 0)

### test totals

```
packages/shared test:  Test Files  26 passed (26)
packages/shared test:       Tests  396 passed (396)
packages/server test:  Test Files  33 passed (33)
packages/server test:       Tests  553 passed | 1 skipped (554)
packages/cli test:  Test Files  45 passed (45)
packages/cli test:       Tests  619 passed (619)
```

## Tag confirmation

```
$ git tag -l v2.0.0-rc.24
v2.0.0-rc.24

$ git log --oneline -2
3593023 chore(rc24): bump to v2.0.0-rc.24 — cite contract policy (TASK-12)
f374a39 chore(rc24): refresh CLI surface snapshot for --layer flag (TASK-11)
```

## Deviations

- **Fix-forward of TASK-01's pre-existing deviation** — TASK-01/06/08 summaries all noted that `packages/server/src/services/event-ledger.test.ts` had 2 TS errors at L74 + L112 (missing `cite_commitments`) but marked them out-of-scope because the file isn't in the vitest glob. However, `pnpm typecheck` (the Phase 3 release gate) DOES pick up the file. Per release-rc skill discipline (rc.21 precedent: ship the gate-fix inside the version-bump commit), I added `cite_commitments: []` to both fixtures. This is the smallest possible diff (2 single-line additions) and is the exact rc.21 fix shape. Did NOT amend any prior task commits — fix landed in the release commit per "atomic commit per task + version-bump is its own commit" convention.

- **Untracked workflow scratch left untouched** — `.workflow/.lite-plan/rc24-cite-contract-policy-2026-05-19/{plan.json,planning-context.md,.task/,.summaries/}`, `.workflow/.lite-plan/rc25-archive-skill-redesign-2026-05-19/`, and `.workflow/spec-analytics.jsonl` / `.workflow/specs/` are session artifacts, not release content. Did NOT stage them. Matches rc.23 precedent (commit `434319c` likewise excluded its lite-plan artifacts; they were archived separately).

- **`.fabric/AGENTS.md` snapshot NOT updated in this commit** — the bootstrap-canonical text changed in TASK-02, but the on-disk three-end managed-block files are intentionally left drifted. This is required by the rc.24 design (B5-α drift gate): the gate must see drift to keep the contract policy inactive during the upgrade window. The user's post-tag `fab install` will sync the three-end blocks and let the marker activate. Documented in the CHANGELOG's "Migration" section.

## Notes for next user action

- **Local tag only** — `v2.0.0-rc.24` exists locally but is NOT pushed. Per release-rc convention + project convention ("DO NOT push to remote — user will explicitly trigger push later"), the user should run `git push && git push --tags` when ready to publish. Once pushed, the GitHub Actions release workflow will pick up the tag and publish to npm.

- **Post-tag werewolf-minigame consumer regression** — deferred to manual verification post-publish, matching rc.23 precedent.

- **Post-install drift gate verification** — after the user runs `fab uninstall && fab install` on their consumer project, the first `fab doctor --cite-coverage` invocation should emit the `cite_contract_policy_activated` marker. Confirms the B5-α gate cleared correctly. If `contract_check: skipped (bootstrap drift)` persists after install, file an issue — BOOTSTRAP_CANONICAL drift detection has a regression.

## status

completed

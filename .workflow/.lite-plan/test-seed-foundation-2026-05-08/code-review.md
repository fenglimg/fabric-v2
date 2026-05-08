# Code Review Report

## Summary
- Files reviewed: 5 (1 cli test + 1 snapshot + 3 property tests; package.json/lockfile diff inspected)
- Issues: Critical=0 High=0 Medium=2 Low=4
- Verdict: PASS

## Scope
- packages/cli/__tests__/cli-surface.test.ts (+ __snapshots__/cli-surface.test.ts.snap)
- packages/shared/test/property-based/{zod-roundtrip,atomic-write,payload-guard}.test.ts
- packages/shared/package.json + pnpm-lock.yaml

## Verification done
- All 9 cli-surface tests pass; all 9 shared property tests pass (locally executed in this review).
- @fast-check/vitest@0.3.0 confirmed real on npm (`pnpm view @fast-check/vitest versions` lists 0.3.0; pnpm-lock pins fast-check 4.7.0 as its dep; peer is satisfied by vitest 3.2.4 in workspace). 0.4.x bumps the vitest peer to ^4 — the chosen 0.3.0 is correct.
- Confirmed `vi.hoisted` semantics: `detectNodeLocale()` (packages/shared/src/i18n/detect-node-locale.ts) reads `process.env.FAB_LANG` at function-invocation time, and packages/cli/src/i18n.ts captures `t` at module load. `vi.hoisted` runs before any `import`, so env is set in time. No race.
- atomic-write impl uses `${path}.${pid}.${ts}.${rand}.tmp` — the property test's `endsWith(".tmp")` filter is correct.
- Schemas: fabricConfigSchema makes every field `.optional()`; aiLedgerEntrySchema is non-passthrough; structuredWarningSchema treats `line` as optional — arbitraries match.

## Issues

### [Medium] zod-roundtrip.test.ts:25-33 — clientPaths property is narrower than I1 claim
The `clientPathsArbitrary` generates only the four documented keys, but `clientPathsSchema` uses `.passthrough()` (packages/shared/src/schemas/fabric-config.ts:15) explicitly to preserve legacy keys (windsurf, rooCode, geminiCLI per TASK-012). The round-trip property therefore does not exercise the passthrough path — a bug that drops unknown keys on parse would not be caught here even though I1 implies it should.
Suggested fix: extend the arbitrary with an optional `fc.dictionary(fc.string(), fc.string())` merged in, or add an explicit additional case generating one or two unknown keys (e.g. `windsurf`, `rooCode`) to lock the passthrough invariant. Cheap and high-signal.

### [Medium] zod-roundtrip.test.ts:43-61 — `audit_mode` and `auditMode` may both be present, no shape canonicalization assertion
The arbitrary lets both `auditMode` and `audit_mode` appear simultaneously (each independently optional). The schema accepts both side-by-side (no `.refine`), so round-trip technically holds — but this hides whether downstream consumers expect a single canonical form. Not a defect of the test as written, but the test passes for shapes that may indicate misuse. Either drop one of the two keys from the arbitrary, or use `fc.oneof` so only one is set per sample. Marking Medium because it weakens the test's signal even though it does not break it.

### [Low] atomic-write.test.ts:54-69 — second property duplicates idempotent property's `.tmp` check
The "no `.tmp` residue" property is already covered as a side-claim in the idempotent property (which writes twice but never checks the residue). Conversely the residue test only writes once. The two properties together cover I2 + I3, but the second property's "Sanity" assertion (`entries).toContain("out.txt")`) is a weak invariant given a directory created by `mkdtemp` is empty before the write. Consider tightening: assert `entries.length === 1`. That makes "no temp residue" total rather than relying on filename suffix.

### [Low] atomic-write.test.ts:18-25 — afterEach pop while-loop is fine but underspecified for concurrency
fast-check runs property samples sequentially in async mode by default, so the shared `createdDirs` array is safe. If a future maintainer enables concurrency (`fc.assert({ concurrent: true })` or similar), the array becomes a shared mutable state hazard. Low risk now; consider per-test-local arrays or scope the dir to the property body and `try/finally` clean inside the property predicate to make the test concurrent-safe by construction.

### [Low] payload-guard.test.ts:30-37 — naming/comment mismatch ("size in [0, warnBytes]" vs ">=" semantics)
Comment says "size in [0, warnBytes] (≤ 16KB): no warning, no throw" — and the impl does use strict `>` for both thresholds, so `size === warnBytes` is genuinely no-warn. Correct, but the title text says `≤ 16KB` while the prose for the second test says `(warnBytes, hardBytes]` which correctly excludes the boundary. Minor — could spell out "≤" vs "<" both places. The boundary at WARN_BYTES (no warn) and HARD_BYTES (warn but no throw) is asserted by the upper-half property which requires `size <= HARD_BYTES`, so the boundary is exercised. Good.

### [Low] cli-surface.test.ts:85 — toMatchSnapshot hint embedded in snapshot key inflates snapshot file
The DRIFT_HINT (3 lines, ~150 chars) is concatenated into each snapshot key, so it appears 4× in the .snap file (~600 chars of pure guidance). Functionally fine — it does what was intended (developers see the hint when a snapshot fails). But it makes the snapshot file noisier and renaming the hint becomes a snapshot-update event. Alternatives: emit the hint via a Vitest `onTestFailed` hook, or move it to a top-level comment in the snap file. Not blocking.

## Notes

- `fc.record(..., { requiredKeys: [] })` is the correct pattern to avoid the undefined-vs-missing-key trap with zod `.optional()` fields. Verified against zod parsed-output behavior. Good design choice.
- Snapshot covers: name change, description change, args add/remove/rename, type change, default change, alias change, negativeDescription change, required change. This is comprehensive — a 5th public command would also fail the public-command-set assertion at line 92. Excellent surface-as-data design; avoids subprocess/colors/locale flakiness as claimed.
- Snapshot defaults like `default: "7373"` are stringified ports — citty stores raw default values, so the snapshot correctly captures string-typed defaults. Pinning these in the dedicated test (line 131-132) is appropriate belt-and-suspenders.
- Atomic-write property uses `mkdtemp(tmpdir() + prefix)` for isolation; cleanup in afterEach with `rm -rf` is sufficient and correct.
- payload-guard test uses the real defaults (16384 / 65536). It hard-codes them rather than importing constants from the module under test — a refactor that changes defaults would silently desync. Could import the constants if exported, but currently they aren't, and the seed I4 documents these as fixed defaults. Acceptable.
- @fast-check/vitest 0.3.0 → fast-check 4.7.0 → vitest 3.2.4 dep chain confirmed in pnpm-lock.yaml lines 144, 426, 2376. Choice is correct for vitest 3 compatibility.
- Project root `package.json` has `"type": "3d"` (esbuild warning surfaced in test output) — unrelated to this review but worth noting elsewhere.

## Verdict
PASS. The two Medium issues are recommendations to strengthen test signal (passthrough coverage, mutually-exclusive audit_mode keys), not defects. No flaky factors introduced. Dependency choice is correct. Convention matches surrounding tests.

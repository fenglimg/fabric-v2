# TASK-11: Refresh CLI surface snapshot for --layer flag addition

## Changes

- `docs/test-seed/cli.md` §1 (Public commands → `doctor`):
  - Inserted `--layer` between `--json` and `--rescan` (the curated public-flag list is grouped by purpose, not strict alphabetical — `--layer` keeps consistent neighbor placement with the rest of the cite-policy cluster, with an inline note `(rc.24: filter cite contract audit by KB layer — team|personal|all)`).
  - Pre-existing drift note: the rc.20 cite-coverage flags (`--client`, `--since`, `--cite-coverage`) were never added to this curated list. That drift is **out of scope** for TASK-11 — fixing it now would expand the snapshot scope. Flagged for a potential future doc-only sweep (see Notes).

- `packages/cli/__tests__/__snapshots__/cli-surface.test.ts.snap`:
  - Regenerated via `pnpm --filter @fenglimg/fabric-cli test cli-surface -u`.
  - **Exact diff (9 lines added, 0 removed, 0 changed)**:
    ```diff
    @@ -103,6 +103,15 @@ exports[`...command 'doctor' surface...`] = `
           "required": undefined,
           "type": "boolean",
         },
    +    {
    +      "alias": undefined,
    +      "default": "all",
    +      "description": "Filter cite contract audit by KB layer (team|personal|all)",
    +      "name": "layer",
    +      "negativeDescription": undefined,
    +      "required": undefined,
    +      "type": "string",
    +    },
         {
           "alias": undefined,
           "default": "7d",
    ```
  - Insertion position: between `json` (alphabetically prior) and `since` (alphabetically next). Matches the citty `args` localeCompare sort enforced by `commandSurface()` in `cli-surface.test.ts:59`. Matches TASK-10's prediction exactly (rc.20 precedent).
  - **Manual confirmation**: the diff touches ONLY the `'doctor' surface` snapshot. Snapshots for `install`, `serve`, `uninstall`, `config` are byte-identical to the prior file. No spurious surface drift.

## Verification

- [x] **`docs/test-seed/cli.md` §1 contains `--layer` flag row** — verified at line 11 (inserted into the doctor flag chain with rc.24 inline annotation).
- [x] **`cli-surface.test.ts.snap` contains `--layer` in fab doctor --help block** — verified at snapshot lines 106–114 (the new arg block in the `'doctor'` surface entry).
- [x] **Snapshot diff vs prior shows ONLY --layer addition** — verified via `git diff packages/cli/__tests__/__snapshots__/cli-surface.test.ts.snap`: 9 lines added (1 opening brace + 7 arg properties + 1 closing brace, comma), 0 lines removed. No other commands' snapshots touched.
- [x] **`pnpm --filter @fenglimg/fabric-cli test cli-surface` exits 0** — clean pass after `-u`, 10/10 cli-surface tests pass, full file 18/18 (cli-surface + install-cli-surface).
- [x] **`pnpm --filter @fenglimg/fabric-cli test` (full suite) exits 0** — 619/619 tests pass across 45 test files, 3.70s total. Compare to TASK-10 baseline 618/619 (1 expected snapshot failure) → TASK-11 returns the suite to all-green.
- [x] **Commit msg: `chore(rc24): refresh CLI surface snapshot for --layer flag (TASK-11)`** — applied.

## Tests

- [x] `pnpm --filter @fenglimg/fabric-cli test cli-surface` — pre-regen: 9/10 pass (1 doctor snapshot mismatch as expected); post-regen: 10/10 pass clean.
- [x] `pnpm --filter @fenglimg/fabric-cli test` — 619/619 pass (45 files, 3.70s).

## Deviations

- **No `--client` row exists in `cli.md` §1** (referenced by the original TASK-11 spec as the anchor for "place after --client row for consistency"). The cli.md curated list omits rc.20 cite-coverage flags entirely — pre-existing drift, not in TASK-11 scope. Used a neutral insertion point (between `--json` and `--rescan`) with an inline rc.24 note instead. Intent-preserving: convergence criterion 1 ("§1 contains --layer flag row") satisfied without expanding the touched-surface area.
- No other deviations.

## Notes

- **For TASK-12 (CHANGELOG)**: the snapshot regen diff is exactly the 7-line citty arg descriptor (alphabetically placed). No other surface change occurred — CHANGELOG can confidently describe rc.24's `doctor` surface delta as "single new flag `--layer` with `string` type, default `all`, value-vocab `team|personal|all`".
- **For a future doc-hygiene sweep**: `docs/test-seed/cli.md` §1 doctor flag list is stale w.r.t. rc.20 (`--cite-coverage`, `--client`, `--since` missing) and rc.22+ (`--enrich-descriptions`, `--auto`, `--dry-run` missing). The drift gate only enforces the **snapshot** layer, not the seed-doc layer, so this is documentation drift only — operator-facing impact is low (curated list, not exhaustive reference). Suggest a single low-priority TASK in a future rc to refresh the seed once the rc.24 contract semantics stabilize.
- The TASK-10 prediction in `TASK-10-summary.md:117` ("expected diff is the 7-line block shown above inserted between `fix-knowledge` and `since` alphabetical") was off by one neighbor — the actual prior neighbor is `json` (alphabetically), not `fix-knowledge`. Doesn't affect correctness; just a documentation note for future plan readers.

## Status

completed

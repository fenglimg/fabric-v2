# TASK-03: Create shared cite-line parser lib (parseCiteLine → cite_ids + cite_tags + cite_commitments)

## Changes

- `packages/shared/src/cite-line-parser.ts` (NEW, 4411 bytes):
  - Zero-dep TypeScript module exporting `parseCiteLine(raw: string): ParseCiteLineResult`.
  - Exports types: `CiteTag`, `CiteCommitmentOperatorKind`, `CiteCommitmentOperator`, `CiteCommitment`, `ParseCiteLineResult`.
  - Internals: `SENTINEL_RE` (KB: none [reason?]), `FULL_RE` (KB: ID (anchor) [tag] → contract), `parseTag`, `parseContractTail`, `parseLine`.
  - Operator vocabulary mirrors `cite_commitments.operators.kind` enum from event-ledger schema: `edit | not_edit | require | forbid` — source token `!edit:` maps to schema kind `not_edit`.
  - Skip form `skip:<reason>` captures everything after the first `skip:`, so `skip:other:non-codifiable` correctly yields `skip_reason: "other:non-codifiable"`.
  - Index-alignment contract: `cite_commitments[i] ↔ cite_ids[i]`. Sentinel `KB: none` emits a `"none"` cite_tag but no id and no commitment (bracket reason stays in `kb_line_raw` upstream per rc.23 T8 precedent).
  - Forward-compat: unknown contract tokens silently dropped so rc.25+ operator additions degrade gracefully on rc.24-installed hooks.

- `packages/shared/test/cite-line-parser.test.ts` (NEW, 27 test cases in 6 describe blocks):
  - Sentinel forms (4): bare `none`, `[no-relevant]`, `[not-applicable]`, case-insensitive.
  - Anchored cite without contract (4): with anchor + planned, without anchor, `chained-from <id>` tail normalized, `dismissed:<reason>` normalized.
  - Full form with contract (4): single edit, edit+!edit, all 4 operator kinds, glob target `src/auth/**/*.ts`.
  - Skip form (3): `skip:sequencing`, `skip:other:<text>` (colon in reason), all 6 documented skip-reason values.
  - Forward-compat / malformed (5): unknown tokens dropped, interleaved unknowns, unrelated lines, empty/null/undefined input, lowercase id rejected.
  - Whitespace/CR-LF (4): leading whitespace, trailing CR, CRLF multi-line, blank-line skipping.
  - Multi-line index alignment (3): 3-cite alignment, sentinel+full mixed (cite_commitments=1 with cite_tags=2), prose interleaving.

- `packages/shared/src/index.ts`:
  - Added `export { parseCiteLine }` and `export type { CiteTag, CiteCommitment, CiteCommitmentOperator, CiteCommitmentOperatorKind, ParseCiteLineResult }` from `./cite-line-parser.js`.

## Verification

- [x] `packages/shared/src/cite-line-parser.ts exists and exports parseCiteLine`: verified — `export function parseCiteLine` present.
- [x] Zero non-type imports: `grep '^import' packages/shared/src/cite-line-parser.ts` → no matches.
- [x] `cite-line-parser.test.ts contains ≥15 test cases`: 27 `it()` blocks in 6 describe blocks.
- [x] `packages/shared/src/index.ts exports parseCiteLine and types`: verified — `export { parseCiteLine }` + 5 type re-exports.
- [x] `pnpm --filter @fenglimg/fabric-shared test exits 0`: 26 files / 386 tests passed (base 359 + 27 new).
- [x] Module bytes <5KB: `wc -c` → 4411 bytes.
- [x] Commit message convention: `feat(rc24): shared cite-line parser with contract syntax support (TASK-03)`.

## Tests

- [x] `pnpm --filter @fenglimg/fabric-shared test cite-line-parser`: 27/27 pass in 3ms.
- [x] `pnpm --filter @fenglimg/fabric-shared test` (full suite): 386/386 pass (26 files, 1.02s) — zero regression from base 359.

## Deviations

- **Index alignment interpretation**: TASK-01 schema doc states `cite_commitments[i] belongs to cite_ids[i]` (strict id-alignment), but the rc.20 cite_tags vocab has `none` → ids=[], tags=["none"] (looser tag-per-line alignment). Resolved by making `cite_commitments` strictly parallel to `cite_ids` (sentinel contributes neither id nor commitment), keeping `cite_tags` parallel to ALL parsed lines (including sentinels). This means in `KB: none\nKB: KT-DEC-0001 [recalled] → edit:foo.ts`, the result is `cite_ids=["KT-DEC-0001"]`, `cite_tags=["none","recalled"]`, `cite_commitments=[{edit:foo.ts}]`. Documented in JSDoc; covered by the dedicated "mixes sentinel and full forms" test. TASK-08 (doctor extension) must use cite_ids length to iterate commitments, not cite_tags length — flagged in notes below.
- **Module size aggressive trim**: initial draft was 7253 bytes (heavy JSDoc); final 4411 bytes under the 5KB hook-bundle constraint. No code paths trimmed — only prose/example comments shortened.

## Notes for next tasks

- **TASK-04** (hook templates inline-bundle parser): the parser is pure TS, ESM-only via `import type` rules. To inline into `fabric-hint.cjs` (CJS, no node_modules), TASK-04 must either (a) ship a manually-transpiled CJS twin alongside the TS source and assert byte-equivalence in CI, or (b) generate the CJS at install time via `fab install`. Recommend option (a) — simpler, deterministic, no install-time toolchain dep. Source file is already comment-light + has no exotic TS (only literal types + interfaces erased at strip).
- **TASK-08** (doctor cite-coverage extension): iterate `cite_commitments` parallel to `cite_ids` (both length-N for non-sentinel cites). The `cite_tags` array can exceed both arrays when sentinels are interleaved. Use the rc.20 pattern of "ignore tags=='none' entries when correlating with ids".
- **Skip-reason vocabulary surfaced as opaque string**: parser does not validate skip_reason against the 6-value dictionary (sequencing/conditional/semantic/aesthetic/architectural/other:<text>) — that's deferred to doctor histogram-bucketing (TASK-08). Rationale: keeps parser zero-dep + forward-compat; doctor already owns the i18n/reporting layer where dictionary drift matters.
- **`KP-*` personal-layer ids supported by regex**: `K[TP]-[A-Z]+-\d+` accepts both KT-* (team) and KP-* (personal) — verified by the `KP-PAT-0042` test case. TASK-09 (--layer filter) can rely on parser output directly without re-parsing prefixes.
- **`status` field on TASK-03.json**: appended at end-of-file (was missing in initial JSON per task schema gap noted in TASK-01/02 summaries).

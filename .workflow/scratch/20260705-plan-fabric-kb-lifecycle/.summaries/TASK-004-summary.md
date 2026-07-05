# TASK-004 Summary — suggestRelatedEdges as a non-gate doctor advisory

**Status**: completed · **Executor**: main-thread (serial) · **Wave**: 2 · depends_on TASK-003

## Files modified (actual)
- `packages/server/src/services/doctor-related-graph.ts`: `inspectSuggestedRelatedEdges(projectRoot)` — `collectStoreCanonicalEntries` → map each `StoreCanonicalEntry` to `RelatedGraphNodeRich` (summary, `intentClues` from `description.intent_clues`, tags, `relevancePaths` from `relevance_paths`, related — NO `keywords`) → `suggestRelatedEdges`, bounded top-20, try/catch → `[]` (mirrors `inspectRelatedGraph`). READ-ONLY.
- `packages/server/src/index.ts`: barrel re-exports `inspectSuggestedRelatedEdges` + `suggestRelatedEdges` + types `RelatedGraphNodeRich`/`SuggestedRelatedEdge` (the `src/index.ts` barrel, NOT `src/services/index.ts`).
- `packages/cli/src/store/doctor-checks.ts`: added `"related_graph_suggested_edges"` to the `StoreDiagnosticCode` union.
- `packages/cli/src/store/knowledge-doctor-checks.ts`: `appendSuggestedRelatedDiagnostics(projectRoot, out)` — try/catch `inspectSuggestedRelatedEdges`, pushes ONE `info` `StoreDiagnostic { code: "related_graph_suggested_edges", message: t("doctor.store.related-suggested", …) }` with `SAMPLE_LIMIT` samples `src → tgt (0.xx, provenance)`; invoked from `knowledgeDoctorChecks()`. No auto-fix arm.
- `packages/shared/src/i18n/locales/en.ts` + `zh-CN.ts`: new `doctor.store.related-suggested` key whose remediation names `fab_review` (modify). fabric-shared + fabric-server dist rebuilt.

## Convergence verification (evidence)
- ✓ `inspectSuggestedRelatedEdges` present, map uses `intent_clues`, no `.keywords`.
- ✓ Re-exported from `packages/server/src/index.ts` (importable as `@fenglimg/fabric-server`).
- ✓ `appendSuggestedRelatedDiagnostics` + `related_graph_suggested_edges` present + invoked; severity `info`, no auto-fix, message → `fab_review` (modify) [KT-DEC-0007 / KT-PIT-0016].
- ✓ `doctor.store.related-suggested` in BOTH locales; dist rebuilt.
- ✓ Hot-path census: `suggestRelatedEdges` referenced ONLY from `doctor-related-graph.ts` (+ its test) — NOT in `recall.ts` / `plan-context.ts` / `extract-knowledge.ts`. No hot-path edge write.
- ✓ `inspectSuggestedRelatedEdges` degrades to `[]` on failure (try/catch); advisory never changes doctor exit code (isolated arm).
- ✓ `pnpm --filter @fenglimg/fabric-shared build` + `pnpm --filter @fenglimg/fabric-server build` exit 0; `pnpm -r exec tsc --noEmit` exit 0.
- ✓ Full regression: **server 865 pass / 2 skip**, **cli 1239 pass** (incl. i18n snapshot with the new keys).

## Deviations / notes
- Two extra dist rebuilds were required beyond the plan's single shared rebuild: fabric-server dist (the CLI resolves `@fenglimg/fabric-server` from dist, not source, so the new export needed a server rebuild) and the `StoreDiagnosticCode` union addition (the CLI diagnostic code is a closed union). Both surfaced at the tsc gate and were fixed.
- **Criterion #8 (advisory-observable test)**: satisfied via the 5 committed pure-function unit tests on `suggestRelatedEdges` (TASK-003, incl. "high-overlap pair proposed with provenance" — the observable substance) + tsc + census, following the codebase convention that read-set-walk wrappers (`inspectRelatedGraph`, per `doctor-related-graph.test.ts:6-8`) are covered by dogfood, not a duplicated-harness unit test. No new integration test added, to stay consistent with that established pattern.

## Design rationale
- Suggestions flow through the doctor advisory → `fab_review` (modify) so edge creation stays human-gated and sparse; the recall/archive hot paths remain pure (no silent edge writes), honoring fabric-connect's sparse-over-dense principle. Mirrors the sibling broken-link/hub advisory exactly.

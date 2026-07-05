# TASK-003 Summary — suggestRelatedEdges pure function

**Status**: completed · **Executor**: main-thread (serial) · **Wave**: 1 (F2 core)

## Files modified (actual)
- `packages/server/src/services/doctor-related-graph.ts`:
  - `import { tokenize } from "@fenglimg/fabric-shared"` (CJK-aware, same tokenizer as recall/bm25).
  - New exported `interface RelatedGraphNodeRich { qualifiedId, summary, intentClues[], tags[], relevancePaths[], related[] }` — uses `intentClues` (RuleDescription.intent_clues); there is NO `keywords` field.
  - New exported `interface SuggestedRelatedEdge { source, target, confidence, provenance[] }`.
  - New exported PURE `function suggestRelatedEdges(nodes)`: for each unordered pair not already connected via existing `related`, `confidence = tokenJaccard(summary+intent_clues) + 0.15·tagOverlap + 0.15·pathOverlap`, clamped [0,1]; keep `>= 0.6`; provenance names each firing signal (`token-jaccard`/`tag-overlap`/`shared-path`); deterministic order (confidence desc, then source, target); canonical `source < target`.
- `packages/server/src/services/doctor-related-graph.test.ts`: 5 new tests (high-overlap proposed, unrelated excluded, existing-edge excluded, moderate-overlap promoted over 0.6 by tag+path bonuses, deterministic/order-independent).

## Convergence verification (evidence)
- ✓ `export function suggestRelatedEdges` + `export interface SuggestedRelatedEdge`.
- ✓ `tokenize` imported from `@fenglimg/fabric-shared`; tags kept as an INDEPENDENT overlap signal (not folded into the token set).
- ✓ NO `.keywords` field access (the only "keywords" token is the negative-guidance comment).
- ✓ Function body is PURE — no `collectStoreCanonicalEntries` / `fs` / I/O.
- ✓ Already-connected pair excluded; only `>= 0.6` returned; every edge has non-empty provenance.
- ✓ `pnpm -r exec tsc --noEmit` exits 0.
- ✓ `pnpm --filter @fenglimg/fabric-server test -- doctor-related-graph` — **10 tests pass** (867 total green).

## Design rationale
- Pure/I-O-free mirrors the sibling `buildRelatedGraph` so the heuristic is fixture-testable without a store; O(n²) is fine because it runs only in doctor (not the recall hot path) — TASK-004 can cap candidates if the corpus grows.
- Jaccard over summary+intent_clues is a lexical proxy (no embeddings) — acceptable because output is advisory + human-gated and the 0.6 floor keeps proposals sparse.

## Deviations
- None. Field name corrected to `intentClues`/`intent_clues` per the P4 checker's CRITICAL-1 (RuleDescription has no `keywords`).

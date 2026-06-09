# Grill Report: Knowledge Search Closeout

**Session**: GRL-20260609-knowledge-search-closeout
**Depth**: standard (closeout branches)
**Date**: 2026-06-09T15:15:09+08:00
**Upstream**: `GRL-20260609-knowledge-search`

## Discovery Summary

### Project Context

This grill continues the previous Knowledge Search grill and turns the open questions into a closeout recommendation list. `maestro wiki search` surfaced matching issues for explicit id truncation, `fab_review search` rejected visibility, related-edge mismatch, hook/template store-only residue, duplicate semantic-search install guidance, and MCP schema stale root descriptions.

### Codebase Surface

- Runtime recall: `packages/server/src/services/recall.ts`
- Candidate planning: `packages/server/src/services/plan-context.ts`
- Body fetch: `packages/server/src/services/knowledge-sections.ts`
- Related parsing: `packages/server/src/services/knowledge-meta-builder.ts`
- Review search: `packages/server/src/services/review.ts`
- Install semantic search: `packages/cli/src/install/pipeline/guidance.stage.ts` and `packages/cli/src/commands/install.ts`
- Public schemas: `packages/shared/src/schemas/api-contracts.ts`
- Doctor/hook/template residue: `packages/server/src/services/doctor.ts`, `packages/cli/templates/hooks/*.cjs`, skill templates

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | P0 Correctness Closeout | Completed | 4 | 0 |
| 2 | P1 Store-Only Surface Closeout | Completed | 4 | 1 |
| 3 | P1 Observability Closeout | Completed | 3 | 0 |
| 4 | P2 Scale Closeout | Completed | 2 | 1 |
| 5 | Sequencing & Non-Goals | Completed | 4 | 0 |

---

## Branch 1: P0 Correctness Closeout

### C1: Explicit `ids` are still not direct lookup

**Evidence**: `recall()` builds `candidateIds` from `planResult.candidates`, rewrites requested ids, then intersects through `candidateIdSet`; ids outside top_k/payload-surfaced candidates are dropped. See `packages/server/src/services/recall.ts:89`, `packages/server/src/services/recall.ts:104`, `packages/server/src/services/recall.ts:107`. The test currently locks intersection semantics at `packages/server/src/services/recall.test.ts:162`.

**Grill question**: If a caller already knows `team:KT-DEC-0007`, why should retrieval quality depend on whether BM25/vector/top_k happened to surface it?

**Recommendation**: Fix. `ids` should be a direct body lookup path, with candidate planning used for context envelope/telemetry but not as a hard gate. Preserve validation by resolving ids through the same read-set body index and returning unresolved diagnostics for ids not in the read-set.

**Priority**: P0.

**Acceptance tests**:

- Seed 3 entries with `plan_context_top_k: 1`; call `fab_recall({ ids: [dropped_id] })`; assert dropped id body is returned.
- Stale id redirect still works before direct lookup.
- Unknown id returns `unresolved_selected_id` diagnostic, not a throw.

### C2: `include_related` only works with store-qualified related ids

**Evidence**: Related frontmatter is documented as bare stable ids in `knowledge-meta-builder.ts:1070`, but current tests seed `related: [team:KT-GLD-0001]` and matching compares raw related ids to store-qualified candidate ids. See `packages/server/src/services/recall.ts:129`, `packages/server/src/services/plan-context.ts:418`, `packages/server/src/services/recall.test.ts:196`, `packages/server/src/services/plan-context.test.ts:1029`.

**Grill question**: If the parser contract says `related: [KT-DEC-0001]`, why are tests proving only `team:KT-DEC-0001`?

**Recommendation**: Fix. Normalize related ids at candidate-build time or expansion time. The matching rule should accept:

- exact store-qualified `alias:id`;
- bare local id that resolves uniquely inside the current candidate corpus;
- ambiguous bare id across stores should not auto-pick; emit a diagnostic or skip with trace.

**Priority**: P0.

**Acceptance tests**:

- Bare `related: [KT-GLD-0001]` pulls `team:KT-GLD-0001`.
- Store-qualified related still works.
- Two stores with same local id make a bare edge ambiguous and do not silently choose.

### C3: Related-edge redirect is incomplete

**Evidence**: `loadIdRedirectMap()` exists and direct input ids are rewritten in `recall.ts:98`, while related expansion reads `candidate.description.related` raw in `recall.ts:132` and `plan-context.ts:418`. Plan-context surfaces redirect maps later, but related expansion has already happened.

**Grill question**: If an entry was layer-flipped and old id redirects to new id, why should direct id fetch work while a related edge to that old id fails?

**Recommendation**: Fix together with C2. Related normalization must apply `resolveRedirectedId()` before corpus matching.

**Priority**: P0.

**Acceptance tests**:

- Related edge points to old id; ledger contains `knowledge_id_redirect old -> new`; `include_related` fetches/appends new id.
- `related_appended` provenance reports final id and source id; optional redirect info remains surfaced.

### C4: Store-qualified personal related ids can bypass KT -> KP leak guard

**Evidence**: `isForbiddenCrossLayerEdge()` uses `parseKnowledgeId(targetId)`. A store-qualified id like `personal:KP-DEC-0001` is not a plain stable id and can parse as null, so the guard may allow it. See `packages/server/src/services/knowledge-meta-builder.ts:1097`, `packages/server/src/services/knowledge-meta-builder.ts:1107`.

**Grill question**: If store-qualified ids are first-class in runtime, can a team entry express `related: [personal:KP-...]` and leak a personal topology edge?

**Recommendation**: Fix. Strip optional store alias before stable-id layer decoding, or reject store-qualified KP targets from team-sourced entries.

**Priority**: P0.

**Acceptance tests**:

- Team entry with `related: [personal:KP-DEC-0001]` strips edge.
- Personal entry with `related: [team:KT-DEC-0001]` remains allowed.
- Bare KT/KP behavior remains unchanged.

## Branch 2: P1 Store-Only Surface Closeout

### C5: MCP schemas still teach retired dual roots

**Evidence**: `api-contracts.ts` still says extract persists under `.fabric/knowledge/pending/` at line 600, layer writes to `~/.fabric/knowledge/pending` at lines 662-664, review list origin says workspace/home pending roots at lines 1047-1049, and search item comments describe `.fabric/knowledge` / personal mirror at lines 1074-1076.

**Grill question**: If MCP schema descriptions are what clients and LLMs read, is this only comment debt, or contract drift?

**Recommendation**: Fix. Update schema comments/descriptions to store-backed pending/canonical language. This is low implementation risk and high alignment value.

**Priority**: P1 quick win.

**Acceptance tests**:

- Snapshot/schema tests updated.
- `rg ".fabric/knowledge|~/.fabric/knowledge" packages/shared/src/schemas/api-contracts.ts` leaves only explicit legacy/migration references.

### C6: Packaged skills/templates may still point agents at retired roots

**Evidence**: Wiki issue `ISS-20260609-058` says packaged `fabric-review` and `fabric-import` templates still describe project-local trees. The root AGENTS policy says store-only and skill templates are installed into client-facing behavior.

**Grill question**: If the runtime is store-only but skills still tell agents to glob `.fabric/knowledge`, which behavior wins in a real session?

**Recommendation**: Fix. Audit skill templates and hook-installed text. Replace physical path instructions with MCP/store commands and store-backed paths returned by tools.

**Priority**: P1.

**Acceptance tests**:

- Template snapshot tests assert no instruction asks agents to inspect project-local `.fabric/knowledge` as runtime source.
- Migration/import-only references are explicitly labelled as legacy input.

### C7: Runtime hooks store-only residue needs a targeted audit

**Evidence**: Wiki issue `ISS-20260609-001` points to runtime hooks scanning project-local `.fabric/knowledge`; current hook template comments still mention `.fabric/agents.meta.json` at `packages/cli/templates/hooks/fabric-hint.cjs:49`, while doctor now uses store-backed walkers in several places. This area is mixed and should be audited by actual hook behavior, not just comments.

**Grill question**: Are hooks reading generated binding snapshots and store counters, or are they still computing review/import hints from retired local roots?

**Recommendation**: Audit then fix. Treat this as P1 because wrong hook hints directly degrade AI behavior, but do not batch with schema comment cleanup; it needs behavior tests.

**Priority**: P1.

**Acceptance tests**:

- Hook unit/integration test with store-backed pending count and no `.fabric/knowledge` local tree still produces correct review nudge.
- Hook test with stale local `.fabric/knowledge` and empty store does not produce false positives.

### C8: `fab_review search` cannot include rejected entries

**Evidence**: `listPending()` adds a sibling rejected root when `include_rejected` is true (`review.ts:382`). `searchEntries()` only adds pending and canonical roots (`review.ts:1115`, `review.ts:1120`) and never adds rejected, although lifecycle filter allows rejected when included.

**Grill question**: If rejected entries are moved out of pending, how can search ever find them without scanning `rejected/`?

**Recommendation**: Fix. Add rejected roots to `searchEntries()` when `include_rejected` is true, mirroring `listPending()`. Keep `area` as `pending` or add `area: "rejected"` only if changing contract intentionally; for quick fix, report as pending-like review area with `status: rejected`.

**Priority**: P1 quick win.

**Acceptance tests**:

- Reject pending entry, then `fab_review search` without include flag excludes it.
- Same query with `filters.include_rejected=true` includes it.

## Branch 3: P1 Observability Closeout

### C9: Embedder health is invisible

**Evidence**: `readEmbedConfig()` can return enabled/model, but `loadEmbedder()` swallows import/init failures and returns null. In this checkout `fabric.config.json` enables `fast-bge-small-zh-v1.5`, but `node require.resolve('fastembed')` from project cwd fails. Runtime importability depends on the MCP server module location.

**Grill question**: If config says semantic search is on and runtime silently falls back, how does an operator prove which ranking path was used?

**Recommendation**: Add a doctor/info check or a small CLI diagnostic that reports:

- `embed_enabled`;
- configured model;
- optional package importable from server runtime;
- cache dir;
- last init error class/message, sanitized;
- effective mode: `vector-active` or `text-only-fallback`.

**Priority**: P1.

**Acceptance tests**:

- Missing `fastembed` yields a warning status, not failure.
- Inject fake embedder or mock import to show active status.

### C10: Model switching is process-cached

**Evidence**: `embedderLoad` is a single process-level promise in `vector-retrieval.ts:35`; comments say first model wins and config changes need restart. Doc vector cache is keyed by text only (`vector-retrieval.ts:172`).

**Grill question**: If `embed_model` changes from small zh to multilingual E5 inside a long-lived server, what prevents stale vectors/model from being reused?

**Recommendation**: Fix after health check. Key embedder and doc-vector cache by model name, or explicitly report `restart_required` when config model differs from loaded model. The minimal closeout is observability plus restart guidance; deeper fix can follow.

**Priority**: P1/P2 depending on whether model switching is expected during sessions.

**Acceptance tests**:

- Change model in config in the same process; diagnostic reports first-loaded model vs configured model.
- If implementing cache keying, vectors for different models are stored separately.

### C11: Install semantic-search guidance runs in two places

**Evidence**: New pipeline `GuidanceStage` handles semantic search at `guidance.stage.ts:52`; old post-pipeline `runInitCommand` path still handles `--enable-embed` / wizard at `install.ts:458`.

**Grill question**: When install succeeds through the pipeline, why should semantic guidance be emitted again by legacy post-install code?

**Recommendation**: Fix. Ensure only the pipeline guidance stage owns semantic-search prompting/reporting for pipeline installs. Keep old helper only for legacy path if it still exists, guarded so it cannot run after `runInstallPipeline`.

**Priority**: P1 quick win.

**Acceptance tests**:

- `install-v2-pipeline.test` asserts semantic guidance appears exactly once with `--enable-embed`.
- Interactive wizard path also prompts once.

## Branch 4: P2 Scale Closeout

### C12: Store scan/read remains the main runtime scaling bottleneck

**Evidence**: `planContext()` calls `computeReadSetRevision()` and `buildCrossStoreRawItems()`; both walk/read store files. BM25 and doc vectors have in-process caches, but the corpus is still enumerated.

**Grill question**: At 10x KB size, do we want to optimize cosine math first, or stop reading every markdown file twice?

**Recommendation**: Do not start here unless the P0/P1 correctness/surface work is done. The right design is a store-local derived metadata index plus binding-level filtered view, keyed by store revision/content hash. Markdown remains source of truth.

**Priority**: P2.

**Acceptance tests**:

- No stale index after store file change.
- Recall output parity between live-scan and indexed mode.
- Large corpus benchmark shows reduced IO/read count.

### C13: `fab_review search` O(N) scan is acceptable only short-term

**Evidence**: `searchEntries()` comment explicitly says O(N) full scan is acceptable for current corpus sizes (`review.ts:1093`). It reads every matching markdown file and parses frontmatter.

**Grill question**: Should admin search use the same derived metadata index as runtime recall, or remain a separate scan?

**Recommendation**: P2. First fix rejected search correctness. Later reuse the derived metadata index for title/summary/tags search and only read bodies when `include_body=true`.

**Priority**: P2.

**Acceptance tests**:

- Body search still reads body only when requested.
- Metadata search returns same results as old scanner.

## Branch 5: Sequencing & Non-Goals

### Recommended Closeout Order

1. P0: Fix explicit `ids` direct lookup.
2. P0: Normalize related edges: bare/store-qualified/redirect-aware/KT->KP guard.
3. P1 quick wins: schema descriptions, review rejected search, install duplicate semantic guidance.
4. P1: embedder health/doctor check.
5. P1: hook/template store-only audit and fixes.
6. P1/P2: model cache key/restart diagnostic.
7. P2: derived index for runtime recall and review search.

### What Not To Do

- Do not disable semantic search as a substitute for fixing observability; the repo is Chinese-heavy and the selected model is reasonable.
- Do not build a vector database before fixing direct-id and related-edge correctness.
- Do not make pending entries part of normal `fab_recall`; keep review-only boundary.
- Do not clean stale comments randomly across the whole repo without separating public contract text from historical compatibility comments.

## Final Recommendation

There are 6 real closeout items before calling Knowledge Search "done":

| Rank | Item | Priority | Why |
|---|---|---|---|
| 1 | Explicit `ids` direct lookup | P0 | Known id retrieval must not depend on ranking/top_k |
| 2 | Related-edge normalization + redirect + privacy guard | P0 | Current implementation contradicts bare-id contract and can miss/flub graph edges |
| 3 | Embedder health diagnostic | P1 | Current config can say enabled while runtime is text-only |
| 4 | Store-only public surface cleanup | P1 | Schema/skill/hook text still teaches retired roots |
| 5 | Review search rejected entries + install duplicate guidance | P1 | Low-risk correctness/UX fixes |
| 6 | Derived index for scan/search scale | P2 | Important, but should follow correctness and contract cleanup |

## Risk Register

| # | Risk | Severity | Recommendation |
|---|------|----------|----------------|
| R1 | Direct id recall silently under-delivers outside top_k | High | P0 direct lookup |
| R2 | Related graph only works with store-qualified ids despite bare-id parser docs | High | P0 normalize related refs |
| R3 | Team -> store-qualified personal related edge may bypass privacy guard | High | P0 strip alias before layer decode |
| R4 | Operators cannot tell if vectors are active | Medium | P1 embed health |
| R5 | Public schema/templates still advertise retired roots | Medium | P1 surface cleanup |
| R6 | Review search cannot find rejected audit entries | Medium | P1 search source fix |
| R7 | Runtime scans every store file on each plan-context call | Medium | P2 derived index |


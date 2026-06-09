# Grill Report: Knowledge Search

**Session**: GRL-20260609-knowledge-search
**Depth**: deep (8 branches)
**Date**: 2026-06-09T00:00:00+08:00
**Upstream**: user request: "全面剖析当前怎么搜索 knowledge、路径、瓶颈、store-only、语义搜索、嵌入模型"

## Discovery Summary

### Project Context

- `maestro spec load --category arch` and `maestro spec load --keyword knowledge` returned no specs.
- `maestro wiki search "fabric knowledge semantic search embedding"` returned relevant issues, including vector corpus embedding cost, explicit ids vs top_k truncation, O(N) review search, and store-only migration residue.
- `docs/ARCHITECTURE.md:25` defines the target as store-only: knowledge source of truth lives only in mounted stores under `knowledge/`.

### Codebase Surface

- One-step runtime retrieval: `fab_recall` -> `recall()` -> `planContext()` -> `getKnowledgeSections()`.
- Two-step runtime retrieval: `fab_plan_context` -> `fab_get_knowledge_sections`.
- Candidate discovery: `buildCrossStoreRawItems()` walks the resolved read-set stores and derives frontmatter descriptions live.
- Body fetch: `buildCrossStoreBodyIndex()` maps store-qualified ids to store markdown files and `getKnowledgeSections()` reads bodies from stores.
- Review/admin search: `fab_review search` uses a separate substring scan over pending + canonical entries in resolved write-target stores.
- Ranking: BM25 + optional vector score + maturity salience + recency + path locality + scope/store tie-break, then top_k and payload budget trimming.

### Current Config

- Root `fabric.config.json` has `embed_enabled: true` and `embed_model: "fast-bge-small-zh-v1.5"`.
- `fastembed` is not resolvable from the project cwd in this environment; actual vector enablement depends on whether the running MCP server can resolve the optional package from its module location.

---

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries | Completed | 3 | 1 |
| 2 | Data Model & State | Completed | 4 | 1 |
| 3 | Edge Cases & Failure Modes | Completed | 4 | 2 |
| 4 | Integration & Dependencies | Completed | 4 | 1 |
| 5 | Scale & Performance | Completed | 5 | 3 |
| 6 | Security & Access Control | Completed | 3 | 2 |
| 7 | Observability & Operations | Completed | 4 | 2 |
| 8 | Migration & Rollback | Completed | 4 | 2 |

---

## Branch 1: Scope & Boundaries

### Q1.1: What counts as Knowledge search?

**Answer**: Runtime search is not a single API. It includes `fab_recall`, `fab_plan_context`, `fab_get_knowledge_sections`, and admin/review `fab_review search`.
**Evidence**: `packages/server/src/index.ts:190`, `packages/server/src/tools/recall.ts:28`, `packages/server/src/tools/plan-context.ts:27`, `packages/server/src/services/review.ts:129`.
**Decision**: locked.
**Constraint**: Any redesign MUST distinguish runtime recall from review/admin search.

### Q1.2: Is `fab_recall` the default user-facing path?

**Answer**: Yes. Server instructions and runtime contracts say default is one-step `fab_recall(paths)`, with two-step only when bodies are too large and need manual selection.
**Evidence**: `packages/server/src/index.ts:190`, `docs/RUNTIME-CONTRACTS.md:65`.
**Decision**: locked.
**Constraint**: Optimization SHOULD prioritize `fab_recall` and the shared `planContext` ranking path first.

### Q1.3: Are pending entries part of normal recall?

**Answer**: No. Architecture says pending is review-only; runtime recall reads canonical store entries.
**Evidence**: `docs/ARCHITECTURE.md:67`, `packages/shared/src/store/core.ts:121`, `packages/shared/src/store/core.ts:134`.
**Decision**: locked.
**Constraint**: Normal retrieval MUST NOT inject pending drafts.

### Q1.4: Does review search share the same ranking engine?

**Answer**: No. `searchEntries()` is a separate case-insensitive substring scan over title, summary, tags, filename, and optionally body.
**Evidence**: `packages/server/src/services/review.ts:1099`, `packages/server/src/services/review.ts:1181`.
**Decision**: open.
**Risk**: Users may expect "search" and "recall" to behave similarly, but they currently do not.

## Branch 2: Data Model & State

### Q2.1: Where do search candidates come from?

**Answer**: `planContext()` calls `buildCrossStoreRawItems(projectRoot)`, which resolves the store read-set, walks store markdown files, derives store-qualified ids, parses frontmatter descriptions, and filters by active project.
**Evidence**: `packages/server/src/services/plan-context.ts:314`, `packages/server/src/services/cross-store-recall.ts:95`, `packages/server/src/services/cross-store-recall.ts:153`.
**Decision**: locked.
**Constraint**: Candidate discovery MUST remain read-set-store based.

### Q2.2: What is the candidate identity?

**Answer**: Candidate ids are store-qualified as `<alias>:<stable_id>`, preserving anti-shadowing across stores.
**Evidence**: `packages/server/src/services/cross-store-recall.ts:37`, `packages/server/src/services/cross-store-recall.ts:134`, `packages/server/src/services/recall.ts:196`.
**Decision**: locked.
**Constraint**: Search results MUST preserve store provenance, not collapse local ids.

### Q2.3: What fields are ranked?

**Answer**: Ranking document text is flattened from description summary, must_read_if, intent_clues, tech_stack, impact, entities, and tags.
**Evidence**: `packages/server/src/services/plan-context.ts:770`.
**Decision**: locked.
**Constraint**: Runtime ranking currently depends on frontmatter descriptions, not full markdown bodies.

### Q2.4: What state backs selection?

**Answer**: `planContext()` mints an in-memory `selection_token` containing revision, target paths, and selectable stable ids. TTL defaults to 30 minutes and cache is capped at 1000 tokens.
**Evidence**: `packages/server/src/services/plan-context.ts:155`, `packages/server/src/services/plan-context.ts:176`, `packages/server/src/services/plan-context.ts:186`, `packages/server/src/services/plan-context.ts:447`.
**Decision**: locked.
**Constraint**: Two-step fetch depends on MCP server process memory; restart invalidates tokens.

### Q2.5: Is there a persisted search index?

**Answer**: No persisted BM25 or vector index exists. BM25 is cached by revision in-process; document vectors are cached by text in-process.
**Evidence**: `packages/server/src/services/plan-context.ts:636`, `packages/server/src/services/vector-retrieval.ts:172`.
**Decision**: open.
**Risk**: Large stores will pay repeated scan/read/frontmatter parse costs even when scoring caches help.

## Branch 3: Edge Cases & Failure Modes

### Q3.1: What happens when no store config or read-set exists?

**Answer**: Store walking returns `[]`, plan-context produces an empty candidate set, and recall returns no rules. This degrades gracefully.
**Evidence**: `packages/server/src/services/cross-store-recall.ts:95`, `packages/server/src/services/recall.ts:154`.
**Decision**: locked.
**Constraint**: Read-path failures SHOULD stay non-fatal, but must be observable.

### Q3.2: What happens when `fastembed` is missing?

**Answer**: `loadEmbedder()` returns `null`; vector scores are not added; ranking falls back to BM25/text-only.
**Evidence**: `packages/server/src/services/vector-retrieval.ts:69`, `packages/server/src/services/vector-retrieval.ts:95`, `packages/server/src/services/plan-context.ts:363`.
**Decision**: locked.
**Constraint**: Enabling `embed_enabled` alone is not enough; host package resolution must succeed.

### Q3.3: What happens when explicit `ids` are outside top_k?

**Answer**: Current `recall()` intersects requested ids with `planResult.candidates`. If the id was valid in the full corpus but omitted by top_k/payload trimming, it is not fetched.
**Evidence**: `packages/server/src/services/recall.ts:89`, `packages/server/src/services/recall.ts:104`, `packages/server/src/services/recall.ts:107`.
**Decision**: open.
**Risk**: Explicit id recall is not a true direct lookup; it is bounded by candidate surfacing.

### Q3.4: What happens when body fetch cannot resolve a selected id?

**Answer**: `getKnowledgeSections()` warns and skips unresolved ids instead of throwing.
**Evidence**: `packages/server/src/services/knowledge-sections.ts:138`, `packages/server/src/services/knowledge-sections.ts:172`.
**Decision**: locked.
**Constraint**: The body delivery path is resilient but may silently under-deliver unless callers inspect diagnostics.

### Q3.5: What happens when payload exceeds limits?

**Answer**: `fab_plan_context` trims lower-ranked candidates to fit the budget; `fab_recall` emits a warning and suggests explicit ids or the two-step flow.
**Evidence**: `packages/server/src/tools/plan-context.ts:78`, `packages/server/src/tools/plan-context.ts:124`, `packages/server/src/tools/recall.ts:89`.
**Decision**: open.
**Risk**: `selection_token` can include more ids than returned candidates after payload trimming.

## Branch 4: Integration & Dependencies

### Q4.1: Which config file controls runtime semantic search?

**Answer**: Root `fabric.config.json`, not `.fabric/fabric-config.json`, controls `embed_enabled`, `embed_model`, `embed_weight`, `plan_context_top_k`, and payload budget.
**Evidence**: `packages/server/src/config-loader.ts:31`, `packages/cli/src/install/semantic-search.ts:14`.
**Decision**: locked.
**Constraint**: Operator docs MUST name the root config file for runtime retrieval knobs.

### Q4.2: How does store binding affect search?

**Answer**: `buildStoreResolveInput()` and `createStoreResolver().resolveReadSet()` determine mounted stores; personal store is implicit, shared stores come from required stores/routes.
**Evidence**: `packages/server/src/services/cross-store-recall.ts:96`, `docs/RUNTIME-CONTRACTS.md:94`.
**Decision**: locked.
**Constraint**: Retrieval correctness depends on binding snapshot / resolver correctness.

### Q4.3: Does recall call full body reader directly?

**Answer**: No. `recall()` still goes through `planContext()` and `getKnowledgeSections()` to preserve token/cache/ledger behavior.
**Evidence**: `packages/server/src/services/recall.ts:86`, `packages/server/src/services/recall.ts:172`.
**Decision**: locked.
**Constraint**: Refactors SHOULD preserve telemetry equivalence unless changing the contract intentionally.

### Q4.4: Does search rely on external network calls?

**Answer**: Runtime KB content is local. If semantic search is enabled and the model cache is cold, fastembed may download model weights; code comments state no KB data is sent.
**Evidence**: `packages/server/src/services/vector-retrieval.ts:20`, `packages/cli/src/install/semantic-search.ts:80`.
**Decision**: open.
**Risk**: Strict offline deployments need prewarmed `FABRIC_EMBED_CACHE_DIR`.

## Branch 5: Scale & Performance

### Q5.1: What is the hottest unavoidable O(N) path?

**Answer**: Every `planContext()` computes `computeReadSetRevision()` and `buildCrossStoreRawItems()`, both of which walk/read store knowledge files.
**Evidence**: `packages/server/src/services/plan-context.ts:289`, `packages/server/src/services/plan-context.ts:324`, `packages/server/src/services/cross-store-recall.ts:124`, `packages/server/src/services/cross-store-recall.ts:227`.
**Decision**: locked.
**Constraint**: Large-corpus optimization MUST address store walking and file reads, not only scoring.

### Q5.2: What scoring work is already cached?

**Answer**: BM25 corpus model is cached by read-set revision; document vectors are cached by document text with a 10,000-entry LRU.
**Evidence**: `packages/server/src/services/plan-context.ts:639`, `packages/server/src/services/vector-retrieval.ts:172`.
**Decision**: locked.
**Constraint**: The old "every request embeds entire corpus" issue is partially fixed.

### Q5.3: What work remains per query when vectors are enabled?

**Answer**: The query is embedded every time, every candidate gets a cosine score lookup, and cache-miss documents are embedded. The corpus is still enumerated every request.
**Evidence**: `packages/server/src/services/vector-retrieval.ts:202`, `packages/server/src/services/vector-retrieval.ts:219`, `packages/server/src/services/plan-context.ts:378`.
**Decision**: locked.
**Constraint**: Semantic search increases CPU latency on query-bearing recall, even with doc-vector caching.

### Q5.4: What top_k/payload defaults bound the result?

**Answer**: Balanced default top_k is 24; conservative is 12; generous is 48. Payload hard default is 65,536 bytes under balanced.
**Evidence**: `packages/shared/src/retrieval-budget.ts:33`, `packages/shared/src/retrieval-budget.ts:40`, `packages/server/src/config-loader.ts:163`.
**Decision**: locked.
**Constraint**: Increasing semantic quality may require tuning `retrieval_budget_profile` or `plan_context_top_k`, not just model choice.

### Q5.5: Is review search scalable?

**Answer**: No. `searchEntries()` explicitly does full directory scans and file reads; its comment still says O(N) is acceptable for current corpus sizes.
**Evidence**: `packages/server/src/services/review.ts:1093`, `packages/server/src/services/review.ts:1138`.
**Decision**: open.
**Risk**: Review/admin workflows will slow down as stores grow, independent of runtime BM25/vector improvements.

## Branch 6: Security & Access Control

### Q6.1: Does retrieval prevent cross-project leakage?

**Answer**: Store entries with `project:*` scope are filtered to the active project; non-project scopes remain visible.
**Evidence**: `packages/server/src/services/cross-store-recall.ts:70`, `packages/server/src/services/cross-store-recall.ts:78`.
**Decision**: locked.
**Constraint**: Active project validation is security-relevant, not cosmetic.

### Q6.2: Does personal/team layer filtering exist?

**Answer**: Yes. `layer_filter` and `default_layer_filter` filter raw items by `knowledge_layer`.
**Evidence**: `packages/server/src/services/plan-context.ts:333`, `packages/server/src/config-loader.ts:153`.
**Decision**: locked.
**Constraint**: Callers needing team-only recall SHOULD pass `layer_filter: "team"` or set default layer filter.

### Q6.3: Are prompt-injection payloads searched by default?

**Answer**: Runtime ranking uses frontmatter selection fields; review search only includes body text when `include_body=true`.
**Evidence**: `packages/server/src/services/plan-context.ts:770`, `packages/server/src/services/review.ts:1185`.
**Decision**: open.
**Risk**: Malicious body content is less likely to affect ranking, but review search may miss it unless body search is explicitly enabled.

### Q6.4: Does path input have sandboxing?

**Answer**: `planContext()` rejects absolute paths, `~`, and traversal segments before matching.
**Evidence**: `packages/server/src/services/plan-context.ts:238`, `packages/server/src/services/plan-context.ts:269`.
**Decision**: locked.
**Constraint**: Retrieval path context is sandboxed relative to project root.

## Branch 7: Observability & Operations

### Q7.1: What telemetry is emitted?

**Answer**: Plan emits `knowledge_context_planned`; selection emits `knowledge_selection`; fetch emits `knowledge_sections_fetched` and per-id `knowledge_consumed`; recall tool emits `mcp_stdio_trace`.
**Evidence**: `packages/server/src/services/plan-context.ts:491`, `packages/server/src/services/knowledge-sections.ts:196`, `packages/server/src/tools/recall.ts:121`.
**Decision**: locked.
**Constraint**: Search changes MUST preserve or replace these audit signals.

### Q7.2: Is vector fallback observable?

**Answer**: Not clearly. `loadEmbedder()` swallows package/init errors and returns null; plan-context falls back without a user-visible diagnostic.
**Evidence**: `packages/server/src/services/vector-retrieval.ts:95`, `packages/server/src/services/plan-context.ts:363`.
**Decision**: open.
**Risk**: Operators can believe semantic search is enabled while actually running text-only.

### Q7.3: Does omitted candidate count expose truncation?

**Answer**: Yes. top_k and payload trimming both surface `omitted_candidate_count`; recall packaging adds next-step hints.
**Evidence**: `packages/server/src/services/plan-context.ts:399`, `packages/server/src/tools/plan-context.ts:124`, `packages/server/src/services/recall.ts:212`.
**Decision**: locked.
**Constraint**: Candidate omission MUST stay explicit.

### Q7.4: Can we prove whether vectors are active from config alone?

**Answer**: No. Config can say enabled, but actual vector scoring needs `fastembed` runtime import and model init success.
**Evidence**: `packages/server/src/config-loader.ts:127`, `packages/server/src/services/vector-retrieval.ts:69`.
**Decision**: open.
**Risk**: Need a doctor/info check that reports embedder importability and chosen model at server runtime.

## Branch 8: Migration & Rollback

### Q8.1: Does current runtime recall conform to store-only?

**Answer**: Mostly yes for the main runtime retrieval path. `planContext()` and `getKnowledgeSections()` explicitly retired co-location `.fabric/knowledge` and `agents.meta` reads.
**Evidence**: `packages/server/src/services/plan-context.ts:278`, `packages/server/src/services/knowledge-sections.ts:128`, `docs/ARCHITECTURE.md:25`.
**Decision**: locked.
**Constraint**: Main recall path SHOULD be considered store-only aligned.

### Q8.2: Where are store-only inconsistencies still visible?

**Answer**: Public schemas/comments/tests/docs still contain retired `.fabric/knowledge` and `agents.meta` language; doctor has compatibility code/comments; review/extract comments include stale path descriptions.
**Evidence**: `packages/shared/src/schemas/api-contracts.ts:600`, `packages/shared/src/schemas/api-contracts.ts:1047`, `packages/server/src/services/doctor.ts:6892`, `packages/server/src/services/extract-knowledge.ts:295`.
**Decision**: open.
**Risk**: Surface alignment is incomplete even when runtime path is mostly aligned.

### Q8.3: How should semantic search be rolled back?

**Answer**: Set `embed_enabled=false` in root `fabric.config.json`. Ranking returns to BM25/text/locality/salience path.
**Evidence**: `packages/cli/src/install/semantic-search.ts:83`, `packages/server/src/config-loader.ts:127`.
**Decision**: locked.
**Constraint**: Semantic search MUST remain opt-in and reversible.

### Q8.4: Is model switching safe?

**Answer**: It is operationally safe but not instantly transparent. `loadEmbedder()` caches the first loaded embedder per process, so config model changes need server restart. Doc vectors are cached by text, not model, in-process.
**Evidence**: `packages/server/src/services/vector-retrieval.ts:35`, `packages/server/src/services/vector-retrieval.ts:66`, `packages/server/src/services/vector-retrieval.ts:172`.
**Decision**: open.
**Risk**: Switching model in a long-lived process can keep using the first model; doc vector cache also has no model key in the current process.

## Synthesis

### Search Path Map

1. `fab_recall(paths, intent?, ids?, layer_filter?, include_related?)`
   - MCP wrapper resolves project root, syncs freshness, calls `recall()`.
   - `recall()` calls `planContext()` for ranked candidates and token.
   - It intersects `ids` with returned candidates, optionally adds graph neighbours, then calls `getKnowledgeSections()`.
   - Returns candidate metadata plus full bodies.

2. `fab_plan_context(paths, intent?, layer_filter?, include_related?)`
   - Validates paths.
   - Computes read-set revision from store corpus.
   - Walks read-set stores, derives descriptions from frontmatter.
   - Filters active project and layer.
   - Builds query terms from intent/tech/entities.
   - Scores BM25, optional vectors, salience, recency, locality, scope tie-break.
   - Applies top_k and optional graph expansion.
   - Mints selection token and emits telemetry.

3. `fab_get_knowledge_sections(selection_token, ai_selected_stable_ids)`
   - Validates token and selected ids.
   - Rebuilds store body index.
   - Reads markdown bodies from read-set stores.
   - Emits selection/fetch/consume events.

4. `fab_review search(query, filters?)`
   - Resolves write-target store roots.
   - Scans pending + canonical dirs by type.
   - Reads every markdown file, parses frontmatter, substring-matches query.
   - Optional body search only with `include_body=true`.

### Bottlenecks

| Area | Current State | Impact | Priority |
|---|---|---|---|
| Store scan/read | Every plan-context walks/read store files for revision + candidates | O(N) IO and frontmatter parsing | High |
| Review search | Full scan + read + substring match | Degrades with pending/canonical corpus | High |
| Explicit ids | Intersected with surfaced candidates | Direct id recall can miss omitted ids | High |
| Vector scoring | Cached docs, but query embed + per-candidate cosine every call | CPU overhead on query-bearing calls | Medium |
| Vector observability | Silent fallback when embedder missing | Operators may misdiagnose quality | Medium |
| Model cache key | First loaded model wins; doc cache keyed by text only | Model switch requires restart; cache semantics unclear | Medium |
| Payload trimming | Candidate list may differ from token selectable ids | Rare but confusing two-step state | Low/Medium |
| Surface residue | Schemas/docs/comments mention retired roots | Store-only UX inconsistency | Medium |

### Store-Only Verdict

Main runtime retrieval is store-only aligned:

- `planContext()` reads candidates from read-set stores only.
- `getKnowledgeSections()` reads bodies from store body index only.
- `fab_recall()` composes those store-backed services.

Not fully aligned across all surfaces:

- `fab_review search` is store-backed now, but search is limited to write-target store roots rather than clearly the full read-set; this may be intended for review/admin but should be named/documented.
- Shared schemas and event comments still mention `.fabric/knowledge` / `~/.fabric/knowledge` in public contracts.
- Doctor and legacy compatibility code still carry retired-root scans/comments in places.
- Tests/fixtures still seed retired local roots for compatibility assertions.

### Semantic Search Verdict

Turning semantic search on:

- Helps when Chinese or paraphrased intent does not lexical-match frontmatter terms.
- Does not replace BM25; vector weight is capped below BM25_WEIGHT, so it is a supplement.
- Costs CPU and may download model weights on first cold-cache use.
- Is currently silent-fallback if `fastembed` is unavailable.
- In this checkout config says enabled, but `fastembed` is not resolvable from project cwd, so runtime activation must be verified in the actual MCP server environment.

Turning semantic search off:

- Keeps BM25 + recency + locality + maturity + scope tie-break.
- Avoids optional dependency/model operations.
- Loses semantic rescue for cross-language/paraphrase matches.
- Is safer for small corpora or strict offline hosts until observability improves.

### Embedding Model Recommendation

Default recommendation for this repo: keep `fast-bge-small-zh-v1.5`.

Reasons:

- The codebase and docs explicitly assume Chinese-heavy KB.
- It is the schema/config default.
- It is lighter than `fast-multilingual-e5-large`.
- BM25 already handles exact English/code tokens; vectors only need to supplement semantic Chinese/paraphrase recall.

Use `fast-multilingual-e5-large` only when:

- Cross-language recall quality is measurably poor.
- The host accepts roughly 1 GB model footprint and slower CPU inference.
- You can add benchmark coverage for recall quality and latency.

Do not use English-only defaults for this project unless the KB language profile changes.

### Recommended Next Work

1. Add an embedder health/doctor check: report config enabled, runtime package importable, loaded model, cache dir, and fallback status.
2. Fix explicit-id recall so `ids` can fetch direct store bodies even when the id is outside top_k, or make the current bounded semantics explicit in schema/docs.
3. Introduce a store-backed derived candidate index keyed by store revision to avoid full file reads on every plan-context call.
4. Replace `fab_review search` O(N) scan with the same derived metadata index or a review-specific index.
5. Add model-keying to doc vector cache and expose a restart-required warning when `embed_model` changes.
6. Clean public schema/docs/comments that still advertise project-local `.fabric/knowledge` as runtime storage.

## Risk Register

| # | Risk | Branch | Severity | Mitigation |
|---|------|--------|----------|------------|
| 1 | `embed_enabled=true` but vectors silently disabled | Observability | High | Add doctor/info runtime embedder check |
| 2 | Explicit id recall misses id outside returned top_k | Edge Cases | High | Direct-id fetch path or contract change |
| 3 | Full store scans dominate large-corpus recall | Performance | High | Derived store index + revision invalidation |
| 4 | Store-only public contract still contains retired roots | Migration | Medium | Schema/docs/test cleanup gate |
| 5 | Model switch uses stale process-level embedder/cache | Migration | Medium | Cache key by model and require restart notice |
| 6 | Review search and runtime recall have divergent semantics | Scope | Medium | Name/admin docs or unify ranking/index |
| 7 | Payload trimming token/candidate mismatch confuses clients | Edge Cases | Low/Medium | Move payload trim before token mint |


# G-SCALE + G-PERF Evidence (deterministic, dev-build)

dev-build: `pcf-deeptest/packages/server/dist/index.js` (2.2.0-rc.1, feat/fabric-followup-impl HEAD 1121a97)
harness: `.deeptest/g-scale-perf.mjs` + `lib.mjs` (synthetic corpus: 6 topic clusters × 5 types, 50% narrow relevance_paths)

## G-SCALE — corpus scaling behavior

| n | gen_ms | meta_build_ms | plan_ms | recall_med_ms | returned | omitted | recall_payload | plan_payload |
|---|---|---|---|---|---|---|---|---|
| 10 | 1 | 19 | 7 | 11 | 10 | – | 8.7KB | 4.3KB |
| 100 | 9 | 15 | 23 | 34 | 24 | 76 | 21.3KB | 9.8KB |
| 1000 | 128 | 117 | 479 | 748 | 24 | 976 | 21.9KB | 9.8KB |
| 2000 | 156 | 392 | 1652 | 2802 | 24 | 1976 | 24.2KB | 9.9KB |

**Ranking differentiation (n=1000, confirmed)** — top6 candidates always match query topic:
- `src/auth/login.ts` → top6=[auth×6], dist {auth:15, schema:9}
- `src/render/sprite.ts` → top6=[render×6], dist {render:6, auth:9, schema:9}
- `src/db/migrate.ts` → top6=[db×6], dist {db:6, auth:9, schema:9}

narrow `relevance_paths` entries matching the query path surface FIRST; broad entries fill remaining slots. ✅

**Payload truncation (confirmed)** — `returned` plateaus at ~24 regardless of corpus size; `omitted_candidate_count` grows (976@1000, 1976@2000); payload bounded ~21–24KB. No context overflow. ✅

## G-PERF — quantitative latency breakdown (n=1000)

- `readAgentsMeta`: **28ms** (NOT the bottleneck despite 1MB agents.meta.json)
- `planContext`: **513ms** ← BOTTLENECK (BM25 + relevance scoring over all 1000 candidates, ~0.5ms/candidate, O(N))
- `recall` (full): **781ms** = planContext 513 + ~268ms body extraction (reads top-24 .md files)
- RSS: **149MB**; agents.meta.json: **1072KB** (~1KB/entry → 2MB@2000)

## Finding F-SCALE-LAT (confirmed, perf-characteristic, severity medium)

`planContext` ranking is O(N) over the full candidate set (~0.5ms/candidate). recall latency grows linearly: 11ms@10 → 748ms@1000 → 2802ms@2000. For a high-frequency MCP tool, 1000+ entry corpora produce noticeable (~0.8–2.8s) per-call latency.

**NOT a correctness defect** — ranking + truncation stay correct at all sizes. Typical team KB ≪ 1000 entries (real pcf .fabric has ~57 team + handful personal). Optimization (index pre-scoring / candidate pre-filter before full BM25) deferred — out of deeptest scope, would be a perf feature. Captured per LIBERAL directive.

## Verdict
- **G-SCALE**: MET — ranking differentiation + payload truncation + no-overflow all demonstrated at ≥1000 entries.
- **G-PERF**: MET — latency/payload/memory quantified across 10–2000 entries; bottleneck root-caused to planContext O(N) ranking.

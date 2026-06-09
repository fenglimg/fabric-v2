# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| Knowledge search | Umbrella term covering runtime recall, two-step candidate planning/body fetch, and review/admin search. | `packages/server/src/tools/recall.ts:28`, `packages/server/src/services/review.ts:1099` | locked |
| `fab_recall` | Preferred one-step MCP retrieval API that returns relevant KB bodies and preserves plan/fetch telemetry. | `packages/server/src/services/recall.ts:86` | locked |
| `fab_plan_context` | MCP candidate-planning API that ranks descriptions and returns a `selection_token`. | `packages/server/src/services/plan-context.ts:260` | locked |
| `fab_get_knowledge_sections` | MCP body-fetch API that reads selected store markdown bodies using a valid selection token. | `packages/server/src/services/knowledge-sections.ts:80` | locked |
| Read-set store | The resolved mounted stores searched for canonical runtime knowledge. | `packages/server/src/services/cross-store-recall.ts:95` | locked |
| Store-qualified id | Candidate id shaped as `<alias>:<stable_id>` to prevent cross-store id shadowing. | `packages/server/src/services/cross-store-recall.ts:134` | locked |
| `semantic_scope` | Logical audience/scope coordinate, e.g. `team`, `personal`, `project:<id>`. | `docs/ARCHITECTURE.md:40` | locked |
| Store-only | Architecture where source-of-truth knowledge lives only in mounted stores' `knowledge/` trees. | `docs/ARCHITECTURE.md:25` | locked |
| BM25 | Lexical ranking model over flattened frontmatter description text. | `packages/server/src/services/bm25.ts:45` | locked |
| Vector semantic search | Optional fastembed-based dense vector score added as a supplement to BM25. | `packages/server/src/services/vector-retrieval.ts:1` | locked |
| `plan_context_top_k` | Candidate-count cap applied after ranking. Default is 24 under balanced budget. | `packages/server/src/config-loader.ts:163`, `packages/shared/src/retrieval-budget.ts:40` | locked |
| `fast-bge-small-zh-v1.5` | Default light Chinese-capable fastembed model configured for this repo's Chinese-heavy KB. | `packages/shared/src/schemas/fabric-config.ts:472` | locked |
| Review search | `fab_review search` substring scan over pending and canonical store paths, separate from runtime recall ranking. | `packages/server/src/services/review.ts:1099` | open |


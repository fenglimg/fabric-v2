# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| Direct id recall | Fetching a known stable id body from the read-set store without requiring it to survive ranked top_k candidate surfacing. | `packages/server/src/services/recall.ts:104` | locked |
| Related-edge normalization | Converting `related` refs into matchable candidate ids, supporting bare ids, store-qualified ids, and redirect resolution. | `packages/server/src/services/recall.ts:129`, `packages/server/src/services/plan-context.ts:418` | locked |
| Store-qualified id | Runtime id with `<alias>:<stable_id>` provenance. | `packages/server/src/services/cross-store-recall.ts:134` | locked |
| Bare stable id | Local knowledge id such as `KT-DEC-0001` or `KP-DEC-0001`, without store alias. | `packages/server/src/services/knowledge-meta-builder.ts:1070` | locked |
| Embedder health | Operational signal showing whether semantic config actually loaded a vector embedder at runtime. | `packages/server/src/services/vector-retrieval.ts:69` | locked |
| Store-only surface cleanup | Removing retired project-local `.fabric/knowledge` runtime language from public schemas, templates, and hooks. | `packages/shared/src/schemas/api-contracts.ts:600` | locked |
| Derived metadata index | Future store-backed index of frontmatter/search metadata that avoids full markdown reads on each recall/search. | `packages/server/src/services/cross-store-recall.ts:124` | open |


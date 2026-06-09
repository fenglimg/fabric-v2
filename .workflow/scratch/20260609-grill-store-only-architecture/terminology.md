# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| store | Git-backed data-only knowledge repository with intrinsic `store_uuid`. | `packages/shared/src/schemas/store.ts` | open |
| personal store | Implicit private layer selected by `personal: true`; always user-owned, never a project `required_stores` dependency; personal-scope write target. | `packages/shared/src/resolver/store-resolver.ts` | locked |
| team store | Shared non-personal store mounted globally and required by a project; may hold project-scoped or team-scoped entries. | `packages/shared/src/resolver/store-resolver.ts` | open |
| read-set | Stores searched for discovery/recall. Current code: explicit required shared stores plus implicit personal. | `packages/shared/src/resolver/store-resolver.ts` | open |
| readable write target | A write destination that is also present in the current project's read-set; required so newly written pending is discoverable for review. | `packages/shared/src/resolver/store-resolver.ts` | locked |
| write-target | Store selected by resolver for a proposed `semantic_scope`; physical destination recorded as `visibility_store`. | `packages/server/src/services/cross-store-write.ts` | open |
| scope routing | Resolver maps "who this knowledge is for" (`semantic_scope`) to "where it is stored" (`visibility_store`) via routes/defaults, with personal as a special private route. | `packages/shared/src/resolver/store-resolver.ts` | locked |
| scope classifier | Skill-side judgment that proposes `semantic_scope`; server validates the proposal before writing pending. | `packages/shared/src/schemas/api-contracts.ts` | locked |
| semantic_scope | Frontmatter coordinate describing who an entry applies to, e.g. `personal`, `project:fabric-v2`, `team`, future `org:*`. | `packages/shared/src/schemas/scope.ts` | open |
| visibility_store | Frontmatter provenance for the store physically holding an entry. | `packages/shared/src/schemas/scope.ts` | open |
| pending | Review queue under `knowledge/pending/<type>` inside the selected store. | `packages/server/src/services/extract-knowledge.ts` | open |
| project doctor scope | Default doctor/audit boundary is the current project's read-set; global store health is an explicit separate mode. | `packages/server/src/services/doctor.ts` | locked |
| store-qualified id | Human-facing reference form `<alias>:<local_id>` used by MCP/cites to disambiguate same local IDs across stores. Bare local IDs are valid only when unique in the read-set. | `packages/shared/src/resolver/store-qualified-id.ts` | locked |
| provenance | Structured identity envelope attached to surfaced knowledge: authoritative `store_uuid`, local alias, local ID, global reference, and optional scope metadata. | `packages/shared/src/schemas/provenance.ts` | locked |
| org scope | Future shared organization coordinate prefix such as `org:acme`; selected instead of `origin` to avoid Git remote and pending-source ambiguity. Not fully designed in this pass. | `packages/shared/src/schemas/scope.ts` | locked |
| origin | Reserved/non-scope term in this architecture; current code uses it for pending source and Git remote language, so it should not name an organization layer. | `packages/server/src/services/review.ts` | locked |
| project_id | Stable codebase/workspace identity in `.fabric/fabric-config.json`; worktrees of the same repo may share it. It is not the same as `active_project`. | `packages/shared/src/resolver/project-root-resolver.ts` | locked |
| active_project | Single current knowledge project scope segment used to form `project:<id>` for recall filtering and project-scoped writes. | `packages/shared/src/schemas/fabric-config.ts` | locked |
| workspace_binding_id | Local runtime binding key under a `project_id`; defaults shared, but can be explicit per worktree to isolate `active_project`, write routes, and hook snapshot state. | `packages/shared/src/store/bindings.ts` | locked |
| write_routes | Scope-to-store routing table, e.g. `project:fabric-v2 -> team`; replaces generic default-write selection as the final multi-team write model. | `packages/shared/src/schemas/fabric-config.ts` | locked |
| active_write_store | Legacy/default mailbox model for non-personal writes; final architecture should remove it or make `switch-write` a compatibility alias that writes routes. | `packages/cli/src/store/store-ops.ts` | locked |
| surface alignment matrix | Release gate listing every affected surface (CLI/server/MCP/hooks/skills/doctor/sync/tests) with required change, old behavior to delete, and acceptance check. | `.workflow/scratch/20260609-grill-store-only-architecture/grill-report.md` | locked |

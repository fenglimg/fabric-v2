# Terminology: Global Store Architecture

## Terms

- **store_uuid**: Immutable store identity stored in `store.json`. It should be used for identity, sync safety, and collision prevention, not as the primary human-facing path.
- **alias**: Local human-facing store handle. Current schema already supports this in `mountedStoreSchema.alias`.
- **personal store**: The implicit personal store marked by `personal: true`. Personal-scope writes must route here.
- **shared/org store**: Non-personal store that may hold org/team/project scoped knowledge.
- **semantic_scope**: Knowledge applicability coordinate, such as `team`, `project:fabric-v2`, or future `org:<id>:team:<id>`.
- **visibility_store**: Physical store alias where an entry lives.
- **active_project**: Project coordinate segment used to write team-layer entries as `project:<id>` when bound.
- **required_stores**: Project-declared read-set inputs; the resolver reads only these plus implicit personal.
- **active_write_store**: Current single write target alias for non-personal scopes.

## Naming Tension

Current code often uses `team` as the default shared alias and as a semantic scope. For the target architecture, `team` should be treated as one possible scope inside a shared/org store, not the physical store type itself.

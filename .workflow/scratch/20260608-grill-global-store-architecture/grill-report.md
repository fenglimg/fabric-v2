# Grill Report: Global Store Architecture

**Session**: GRL-global-store-architecture
**Depth**: standard
**Date**: 2026-06-08
**Upstream**: user clarification in current session

## Discovery Summary

User expectation:

- `~/.fabric/stores/` should expose human-defined names such as repo name or custom alias, not UUID as the primary human path.
- There are two core store classes:
  - implicit personal store;
  - shared organization/team/project store.
- Shared store should hold team-common knowledge and project-specific knowledge, with room to evolve toward org / multiple teams / multiple projects.

Code evidence:

- `mountedStoreSchema` already treats `alias` as the local per-machine handle and `store_uuid` as intrinsic identity.
- `storeRelativePath(storeUuid)` still maps physical path to `stores/<uuid>`, so UUID remains the primary disk layout.
- resolver contract defines read set as `required_stores` union implicit personal.
- write target is deterministic: personal scope routes to personal store; non-personal scope routes to active write store.
- `write-scope-meta.test.ts` already verifies `active_project` changes team writes into `semantic_scope: project:<id>`.
- `storeBind(..., --project)` validates project id against store `projects.json`, so project registry support exists but is not yet the dominant user-facing model.

## Preliminary Verdict

The proposed architecture is directionally sound and more extensible than treating `team` as a single global bucket.

The strongest version is:

- physical store ownership: personal vs shared/org store;
- semantic scope inside shared store: `team`, `org:<id>`, `team:<id>`, `project:<id>`;
- human-facing path and CLI identity: alias/repo-name first;
- immutable identity: UUID in `store.json`, not the default visible directory.

## Branch Log

| Branch | Status | Finding |
| --- | --- | --- |
| Scope & Boundaries | in_progress | Need to decide whether one repo can bind multiple shared stores at once. |
| Data Model & State | pending | Alias/path/UUID split needs stronger contract. |
| Edge Cases & Failure Modes | pending | Duplicate alias, renamed repo, orphan UUID dirs, project moved across org. |
| Integration & Dependencies | pending | Install/info/store/sync need one common explanation model. |
| Scale & Operations | pending | Large org with many teams/projects needs indexed scope filtering. |

## Q&A Log

### Q1 — Multi Shared Store Boundary

Question: Does one project need to read from multiple shared/org stores at the same time, or should it have exactly one shared store plus personal?

Answer: Multiple shared/org stores.

Decision: A project read-set must support `personal + N shared stores`, not just `personal + one team store`.

Evidence:

- Existing resolver already models read-set as an array, not a single store.
- `required_stores` is an array in project config.
- The chosen direction requires keeping that multiplicity as a first-class UX and routing concept.

Consequence:

- `active_write_store` as a single alias is too coarse for future write routing if scopes span multiple shared stores.
- CLI must explain read-set and write target per scope, not only show one project-level active write alias.

### Q2 — Write Routing Model

Question: With multiple shared/org stores, should non-personal writes still use one global `active_write_store`, or should write routing be keyed by semantic scope?

Answer: Route writes by semantic scope.

Decision: Replace or supersede single `active_write_store` with scope-aware write routing.

Evidence:

- Current `StoreResolver.resolveWriteTarget(input, scope)` already receives a `scope` parameter, so the resolver API shape can support scope-aware routing.
- Current `StoreResolveInput.activeWriteAlias` is a single optional alias, which is the limiting field.
- Multi shared-store read-set makes a single non-personal write target ambiguous.

Candidate model:

```json
{
  "write_routes": [
    { "scope": "project:fabric-v2", "store": "fabric-team-knowledge" },
    { "scope": "team:platform", "store": "platform-kb" },
    { "scope": "org:external", "store": "vendor-kb" }
  ],
  "default_write_store": "fabric-team-knowledge"
}
```

Compatibility:

- Existing `active_write_store` can be treated as `default_write_store` during migration.
- Personal scope still ignores write routes and always routes to personal store.

### Q3 — Alias Directory Rename

Question: If `stores/` uses human-readable names as the primary directories, should alias rename move the directory on disk, or should directory name be a stable mount name that can differ from the display alias?

Answer: Stable mount name.

Decision: Use a stable, human-readable `mount_name` as the physical directory; allow display alias to change without moving the directory.

Evidence:

- Current UUID path avoided rename hazards, but was poor as a human-facing path.
- Stable mount names preserve human readability without making alias changes destructive.
- `store_uuid` remains the identity inside `store.json`; mount name is only local path identity.

Candidate layout:

```text
~/.fabric/
  stores/
    personal/
    fabric-team-knowledge/
    platform-kb/
```

Candidate registry:

```json
{
  "stores": [
    {
      "store_uuid": "...",
      "mount_name": "fabric-team-knowledge",
      "alias": "team",
      "display_name": "Fabric Team Knowledge",
      "remote": "git@github.com:fenglimg/fabric-team-knowledge.git"
    }
  ]
}
```

Compatibility:

- Existing `stores/<uuid>` can migrate to `stores/<mount_name>` with `store_uuid` validation.
- `by-alias/` becomes unnecessary or only a compatibility shim.

### Q4 — Personal Physical Boundary

Question: Should personal-scope knowledge ever be allowed inside a shared/org store if the user explicitly opts in, or should personal scope always be physically isolated in the personal store?

Answer: Always physically isolated.

Decision: Personal scope must always live in the personal store. Shared/org stores must reject personal scope.

Evidence:

- Current resolver routes personal scope directly to the personal store.
- Current write-scope tests assert personal scope never lands in shared team store.
- Current `isPersonalLeakIntoSharedStore` guard already encodes this boundary.

Consequence:

- The older pending direction "single git KB all scopes" should be superseded or rejected.
- Shared/org stores can hold `team`, `org:*`, `team:*`, `project:*`, but not `personal`.

## Current Risk Register

- If `team` remains both alias and semantic scope, future org/team hierarchy will be confusing.
- If scope route matching is fuzzy or implicit, writes may land in the wrong organization store.
- If mount-name collision handling is weak, two stores from similarly named repos may conflict on disk.
- Migration from UUID directories to mount-name directories must handle orphan dirs, duplicate clones, and internal `store_uuid` mismatch.
- `active_write_store` backward compatibility must not hide scope-route misconfiguration.

## Synthesis

The architecture is suitable and extensible if it is tightened into the following model:

1. `~/.fabric` is a local control plane, not a knowledge store itself.
2. `stores/<mount_name>` is the primary human-readable physical path.
3. `store_uuid` remains immutable identity inside `store.json`.
4. Store classes are:
   - `personal`: implicit personal store, personal scope only;
   - `shared/org`: non-personal knowledge store, holding org/team/project scopes.
5. Projects may read from multiple shared/org stores plus implicit personal.
6. Non-personal writes must resolve by semantic scope, with a fallback default only for migration/simple cases.
7. Personal scope is physically isolated forever.

Recommended data model direction:

```json
{
  "uid": "u-...",
  "stores": [
    {
      "store_uuid": "...",
      "mount_name": "personal",
      "alias": "personal",
      "kind": "personal",
      "personal": true
    },
    {
      "store_uuid": "...",
      "mount_name": "fabric-team-knowledge",
      "alias": "fabric-team",
      "kind": "shared",
      "remote": "git@github.com:fenglimg/fabric-team-knowledge.git"
    }
  ]
}
```

Project config direction:

```json
{
  "required_stores": [
    { "id": "fabric-team" },
    { "id": "platform-kb" }
  ],
  "active_project": "fabric-v2",
  "write_routes": [
    { "scope": "project:fabric-v2", "store": "fabric-team" },
    { "scope": "team:platform", "store": "platform-kb" }
  ],
  "default_write_store": "fabric-team"
}
```

## Final Verdict

Yes, this is a good strategy and stronger than the current "personal + team alias" model. It keeps future extensibility because physical store ownership and semantic applicability are separated:

- ownership: which git repo holds the data;
- applicability: which org/team/project scope the knowledge applies to;
- identity: immutable UUID;
- UX: stable human-readable mount names.

The main required change is to stop treating `team` as a physical architecture primitive. `team` should become one semantic scope among many inside shared/org stores.

## First Socratic Question

Does one project need to read from multiple shared/org stores at the same time, or should it have exactly one shared store plus personal?

Resolved: Multiple shared/org stores.

## Second Socratic Question

With multiple shared/org stores, should non-personal writes still use one global `active_write_store`, or should write routing be keyed by semantic scope, for example `project:fabric-v2 -> fabric-team-knowledge` and `org:external -> vendor-kb`?

Resolved: Write routing should be keyed by semantic scope.

## Third Socratic Question

If `stores/` uses human-readable names as the primary directories, should alias rename move the directory on disk, or should directory name be a stable mount name that can differ from the display alias?

Resolved: Directory should be a stable human-readable mount name, not a mutable display alias and not UUID.

## Fourth Socratic Question

Should personal-scope knowledge ever be allowed inside a shared/org store if the user explicitly opts in, or should personal scope always be physically isolated in the personal store?

Resolved: Personal scope is always physically isolated in personal store.

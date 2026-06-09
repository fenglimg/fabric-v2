# Grill Report: store-only knowledge and store architecture

**Session**: GRL-20260609-store-only-architecture
**Depth**: deep (8 branches)
**Date**: 2026-06-09T00:00:00+08:00
**Upstream**: user request in current session

## Discovery Summary

### Project Context

User wants to settle the final store-only architecture while Fabric is still at
0 users, avoiding a long-lived new/old hybrid. Scope covers personal/team
stores, pending, discovery, priority/override, MCP references, multi-team,
multi-project, worktree handling, doctor/audit, sync, and migration.

### Codebase Surface

- Store identity is intrinsic in `store.json`; Git remote/origin is a locator,
  not identity. Reference: `packages/shared/src/schemas/store.ts`.
- Project config currently carries `project_id`, `required_stores`,
  `active_project`, `active_write_store`, `default_write_store`, and
  `write_routes`. Reference: `packages/shared/src/schemas/fabric-config.ts`.
- Read-set resolution is explicit shared stores plus implicit personal store.
  Reference: `packages/shared/src/resolver/store-resolver.ts`.
- Write paths are store-only and hard-fail when no store target resolves.
  Reference: `packages/server/src/services/cross-store-write.ts`.
- Recall/plan-context read canonical entries from read-set stores and use
  store-qualified IDs. Reference:
  `packages/server/src/services/cross-store-recall.ts`.
- `active_project` filters out other `project:*` entries. Reference:
  `packages/server/src/services/cross-store-recall.ts`.
- Current resolved-binding snapshots are keyed by `project_id`, which collides
  for worktrees that need different bindings. Reference:
  `packages/shared/src/store/bindings.ts`.
- The hot read path still scans read-set stores live for revision and candidate
  construction. Reference: `packages/server/src/services/plan-context.ts`.

### External Store Snapshot

- Team store `https://github.com/fenglimg/fabric-team-knowledge`:
  `store_uuid=152a5f20-9e23-419e-8397-06506461e928`, canonical alias `team`,
  no `projects.json`, current checked entries are `semantic_scope: team`.
- Personal store `https://github.com/fenglimg/fabric-store-personal-pcf`:
  `store_uuid=a2bec02a-6bac-4e1d-9c38-8a6bd327fd7f`, canonical alias
  `personal`, contains migrated entries missing scope metadata plus a personal
  canary.

## Branch Log

| # | Branch | Status | Decisions | Open Questions |
|---|--------|--------|-----------|----------------|
| 1 | Scope & Boundaries | Complete | 3 | none |
| 2 | Data Model & State | Complete | 4 | none |
| 3 | Edge Cases & Failure Modes | Complete | 4 | none |
| 4 | Integration & Dependencies | Complete | 5 | none |
| 5 | Scale & Performance | Complete | 3 | none |
| 6 | Security & Access Control | Complete | 1 | none |
| 7 | Observability & Operations | Complete | 1 | none |
| 8 | Migration & Rollback | Complete | 1 | none |

## Branch 1: Scope & Boundaries

### Decisions

1. Personal store is an implicit private layer, not a project
   `required_stores` dependency.
2. Shared-store knowledge should not blindly default to `team`; skill/agent
   proposes `semantic_scope`, and server validates it.
3. Store-only persistence means no canonical/pending knowledge under project
   local `.fabric/knowledge`.

### Evidence

`resolveReadSet` already appends implicit personal after explicit non-personal
required stores. The current write side has `semantic_scope` /
`visibility_store` frontmatter but `fab_extract_knowledge` does not yet accept a
general scope proposal, so server currently owns too much of scope selection.

### Implications

- Project config declares shared/team stores only.
- Personal-scope writes always target the personal store.
- `fab_extract_knowledge` needs a proposed `semantic_scope`.
- `fab_review.modify` must be able to correct `semantic_scope` before approve.

## Branch 2: Data Model & State

### Decisions

1. Scope routing is the final model: skill judges "who this knowledge is for";
   resolver decides "which store physically holds it".
2. Every write target must be in the current read-set, except implicit personal
   for personal scope.
3. Pending entries do not enter normal `fab_recall` / `fab_plan_context`.
4. `fabric doctor` default scope is current project read-set; global/all-store
   health is explicit mode.

### Evidence

`store-resolver.ts` already supports exact/prefix `write_routes`, defaults, and
personal special-casing. `cross-store-recall.ts` reads canonical type dirs and
excludes `knowledge/pending`; `fab_review` owns pending discovery. After pulling
`origin/main`, hooks and doctor now read resolved read-set store state instead
of retired project-local pending/canonical roots.

### Implications

- Write APIs must pass the actual `semantic_scope` to the resolver, not the
  generic `"team"` placeholder.
- A route to a mounted but unread store is a hard configuration error.
- Pending is visible through review, hints, doctor/audit, not normal recall.

## Branch 3: Edge Cases & Failure Modes

### Decisions

1. MCP primary reference form is `alias:id`, with structured provenance
   attached.
2. Scope priority is a retrieval tie-break, not a hard override.
3. Equal-relevance tie-break order is work-context first and personal last:
   `project:<active_project>` > `team` > future shared organization scopes >
   `personal`.
4. Future organization terminology is `org`, not `origin`.

### Evidence

`store-qualified-id.ts` accepts bare IDs only when unique in the read-set.
`provenance.ts` models `store_uuid`, `alias`, `local_id`, `global_ref`, and
optional `semantic_scope`. `plan-context.ts` makes BM25/locality/recency the
primary sort and uses scope rank only when scores tie. `scope.ts` already
supports `org:*`; "origin" is already used for Git remote and pending source.

### Implications

- AI cites `team:KT-DEC-0001` / `personal:KP-GLD-0001`.
- Each surfaced entry also carries `store_uuid`, `alias`, `local_id`,
  `semantic_scope`, and `visibility_store` when known.
- Same local ID across stores is shadowing, never silent merge.
- Real contradictions should use explicit metadata such as `supersedes`,
  `conflicts`, deprecation, or review/audit outcomes.

## Branch 4: Integration & Dependencies

### Decisions

1. Multi-team writes require explicit `write_routes`; missing route is a hard
   write error.
2. A repo/current working context has exactly one `active_project`.
3. Worktrees default to shared binding, with explicit isolation only when a
   worktree needs a different `active_project` or write route.
4. The local runtime isolation key is `workspace_binding_id`.
5. `project_id`, `active_project`, and `workspace_binding_id` are distinct:
   codebase identity, knowledge project scope, and local binding key.

### Evidence

`fabric-config.ts` supports multiple `required_stores` and a single
`active_project`. `cross-store-recall.ts` filters by that single project.
`project-root-resolver.ts` says worktrees share committed `project_id`, while
`bindings.ts` currently writes snapshots to
`~/.fabric/state/bindings/<project_id>_resolved.json`, which is not sufficient
for different worktree bindings.

### Implications

- Multi-project support is by switching current project, not multi-active
  project visibility.
- Same-project worktrees can share `.fabric` semantics and write/read the same
  stores.
- If a worktree needs different active project/routes, it gets a distinct
  `workspace_binding_id` under the same `project_id`.
- Resolved-binding snapshot paths should key by `workspace_binding_id`, not only
  `project_id`.

## Branch 5: Scale & Performance

### Decisions

1. MCP discovery uses derived index with live-scan fallback.
2. Index granularity is store-local canonical index plus binding-level filtered
   view.
3. Index invalidation is active write/sync/update plus fingerprint verification
   on read.

### Evidence

`computeReadSetRevision(projectRoot)` walks read-set stores and hashes content.
`plan-context.ts` then builds raw candidates from store frontmatter. BM25 is
cached by corpus revision, but the store walk remains on the hot path.

### Implications

- Store markdown remains source of truth.
- Store-local index is generated once per store and reused across projects and
  worktrees.
- Binding-level view applies read-set, active-project filtering, and
  layer/scope filters.
- Missing/stale/corrupt index falls back to live scan and can regenerate.

## Branch 6: Security & Access Control

### Decision

If a shared/team store contains personal-scope or `KP-*` entries, `fabric sync`
must block push until fixed.

### Evidence

`cross-store-write.ts` already refuses personal-scope writes into shared stores.
`doctor-scope-lint.ts` flags `personal_leak_in_shared_store` when
`semantic_scope: personal` or a `KP-*` ID appears in a shared store.

### Implications

- Personal leak is a privacy red line, not a warning-only lint.
- Auto-move is not the default because cross-store rewrite and permissions are
  too sensitive.
- Remediation should be explicit: move to personal store or reject/re-scope.

## Branch 7: Observability & Operations

### Decision

Cross-store event ledger lives in global state per `workspace_binding_id`.

### Evidence

Store schema comments already say cross-store volatile data belongs under
global `~/.fabric/state/`, but current event implementation still heavily uses
`<projectRoot>/.fabric/events.jsonl`. Worktree binding separation makes
project-root ledgers insufficient for final architecture.

### Implications

- Event rows carry `project_id`, `workspace_binding_id`, `active_project`,
  `store_uuid`, `alias`, `stable_id`, and source event IDs where applicable.
- Per-store ledgers are rejected for cross-store operations because recall,
  write, review, and cite attribution span stores.
- Project-root event files become legacy migration input, not final runtime
  state.

## Branch 8: Migration & Rollback

### Decision

Because there are 0 users, delete old runtime surfaces and provide only an
explicit one-time migration/import path.

### Evidence

User explicitly rejected prolonged new/old transition. Current upstream already
moved several doctor/hook surfaces to read-set stores. Remaining project-local
knowledge, dual-root fallback, and project-root event assumptions should not be
kept as normal runtime behavior.

### Implications

- Runtime MCP/hook/doctor/sync paths should not read retired
  `.fabric/knowledge` roots.
- Migration commands may rescue old local data, but normal operation is
  store-only.
- Compatibility should be short and explicit, not silent fallback.

## Synthesis

Final target architecture:

- Knowledge source of truth is mounted store markdown only.
- `semantic_scope` is the logical audience coordinate.
- `visibility_store` and provenance describe physical store location.
- Personal is implicit, private, and never a required shared dependency.
- Shared stores can hold project-scoped and team-scoped entries.
- Multi-team requires explicit write routes.
- Multi-project is single active project per working context.
- Worktrees share binding by default but can isolate via `workspace_binding_id`.
- MCP references are `alias:id` plus structured provenance.
- Discovery reads reviewed canonical knowledge only; pending is review-only.
- Derived indexes accelerate reads but never replace store markdown truth.
- Privacy leaks block sync.
- Event/state is global and binding-keyed, not store-committed.
- Old local knowledge/runtime surfaces are removed, with explicit migration only.

## Risk Register

| Risk | Severity | Resolution |
|------|----------|------------|
| `project_id` vs `active_project` confusion | High | Introduce `workspace_binding_id` and document the three identities separately. |
| Multi-team write ambiguity | High | Require explicit `write_routes`; no default guessing in multi-shared-store mode. |
| Personal knowledge leak into shared store | Critical | Block write and sync push; doctor reports manual error. |
| Snapshot collision across worktrees | High | Key resolved bindings by `workspace_binding_id`. |
| Live read-set scans become hot-path bottleneck | Medium | Store-local index plus binding-level view with fallback. |
| Lingering legacy project-local paths | High | Delete runtime fallback; provide one-time migration/import. |

## Downstream Targets

- `$maestro-analyze` for implementation impact by module.
- `$maestro-roadmap` for phased execution.
- `$maestro-blueprint` if a formal PRD/architecture package is needed.

## Surface Alignment Addendum

### Q1 Evidence

Follow-up scan found store-only concerns spread across multiple runtime
surfaces, not only the shared resolver:

- CLI: `packages/cli/src/commands/store.ts`, `commands/sync.ts`,
  `commands/doctor.ts`, `commands/scope-explain.ts`,
  `store/bindings-io.ts`, `store/store-migrate.ts`,
  `install/store-project-onboarding.ts`.
- Server services: `cross-store-write.ts`, `cross-store-recall.ts`,
  `extract-knowledge.ts`, `review.ts`, `doctor.ts`, `event-ledger.ts`,
  `plan-context.ts`, `knowledge-sections.ts`.
- MCP contracts/tools: `schemas/api-contracts.ts`,
  `schemas/mcp-store-contracts.ts`, `tools/extract-knowledge.ts`,
  `tools/review.ts`, `tools/recall.ts`, `tools/plan-context.ts`.
- Hooks: `.codex/hooks/*`, `.claude/hooks/*`,
  especially `fabric-hint.cjs`, `knowledge-hint-broad.cjs`,
  `knowledge-hint-narrow.cjs`, `bindings-snapshot-reader.cjs`.
- Skills: `.codex/skills/fabric-*` and `.claude/skills/fabric-*` still carry
  references to `layer`, project-root `.fabric/events.jsonl`, and old pending
  path semantics in several places.
- Tests/i18n/docs: many comments and schemas still mention project-local
  `.fabric/knowledge`, dual-root, `events.jsonl`, and
  `bindings/<project_id>_resolved.json`.

This proves the prior grill locked architecture direction, but did not yet
fully enumerate each surface's required changes.

### Q1 Answer

Decision: surface alignment matrix is a completion gate for the store-only
architecture.

Implications:
- The architecture is not complete until CLI, server, MCP, hooks, skills,
  docs/tests/i18n all state the same contract.
- Every surface needs explicit rows for: required change, old behavior to
  delete, tests, and owner module.
- Runtime changes and instruction-layer changes must land together; otherwise
  skills/hooks can keep steering users into retired paths.

### Q2 Evidence

The codebase already has central contracts in shared packages:
`schemas/store.ts`, `schemas/scope.ts`, `schemas/provenance.ts`,
`schemas/mcp-store-contracts.ts`, `resolver/store-resolver.ts`,
`store/resolve-input.ts`, and `store/bindings.ts`. However hooks and skills
still contain independent prose/rules for `events.jsonl`, `pending_path`,
`layer`, and store path behavior. If those stay hand-authored per surface, they
can drift from the runtime contract again.

### Q2 Answer

Decision: CLI, server, MCP, hooks, and skills must use shared contract as the
single source of truth.

Implications:
- CLI and server import shared schemas/resolvers instead of duplicating rules.
- MCP schemas expose the same store/scope/provenance fields that server uses.
- Hooks read generated snapshots/state only; they do not re-resolve store trees.
- Skills call CLI/MCP or quote generated contract docs; they do not maintain
  independent path/routing rules.
- Tests must assert parity across CLI/server/MCP/hook-facing snapshots.

### Q3 Evidence

`packages/shared/src/schemas/api-contracts.ts` still describes
`fab_extract_knowledge` as writing under workspace/home pending roots and uses
`layer: "team" | "personal"` as the write selector. `review` still exposes
`modify-layer` semantics. That conflicts with the locked architecture where
`semantic_scope` is the logical audience and the resolver selects
`visibility_store`.

### Q3 Answer

Decision: MCP write/review contracts become scope-first; `layer` must not remain
the write-routing primitive.

Implications:
- `fab_extract_knowledge` accepts proposed `semantic_scope`.
- Server validates scope grammar, personal privacy, project registry, read-set,
  and route resolution before writing pending.
- `fab_review.modify` can edit `semantic_scope` and rerun validation.
- `layer` may be removed or only derived for display from store visibility /
  stable_id prefix; it cannot drive routing.
- MCP descriptions and examples must stop mentioning workspace/home pending
  roots.

### Q4 Evidence

CLI already has both write-target models:
`packages/cli/src/commands/store.ts` exposes `store route-write <scope> <alias>`
and `store switch-write <alias>`. `packages/cli/src/install/store-project-onboarding.ts`
currently binds the project and then calls `storeSwitchWrite`, which writes
`active_write_store` / `default_write_store`. That preserves a generic "default
shared write store" behavior even though the final architecture requires
scope-aware routing.

### Q4 Answer

Decision: CLI onboarding should automatically write `write_routes`; it should
not rely on `active_write_store` as the final write-routing semantics.

Plain-language model:
- `active_write_store` / `switch-write` is a default mailbox: all non-personal
  knowledge goes to one store.
- `write_routes` is address-based routing: `project:fabric-v2 -> team-core`,
  `project:agent-ui -> team-ai`, `team -> team-core`.
- Single-store onboarding can still feel one-step because CLI writes the route
  for the user.

Implications:
- `fabric store bind <alias> --project <id>` should ensure
  `write_routes += project:<id> -> <alias>`.
- `switch-write` should be removed or turned into a compatibility alias that
  writes routes, not a parallel default model.
- Multi-shared-store mode must not fall back to `active_write_store`.
- `scope-explain` remains the user-facing debug command for route resolution.

### Q5 Evidence

Hook scripts already consume a generated bindings snapshot for read-set stats,
but the snapshot path is still `bindings/<project_id>_resolved.json`. Hook code
also reads and writes project-root `.fabric/events.jsonl` / `metrics.jsonl` in
multiple places (`fabric-hint.cjs`, `cite-policy-evict.cjs`,
`post-tooluse-mutation.cjs`, `session-end-marker.cjs`,
`knowledge-hint-broad.cjs`). This conflicts with the locked decision that
cross-store observability lives in global state per `workspace_binding_id`.

### Q5 Answer

Decision: hooks use only global `workspace_binding_id` state for binding
snapshot, event ledger, metrics, and hook stats.

Implications:
- Hook snapshot reader keys by `workspace_binding_id`, not `project_id`.
- Hooks do not append to project-root `.fabric/events.jsonl`.
- Hooks may read minimal project config only to discover or bootstrap the
  `workspace_binding_id`; after that they use generated global state.
- Hook-facing snapshots must include ledger/stats paths or enough metadata for
  zero-resolution reads.
- Retired `archive-hint.cjs` / summary fallback paths that scan
  `.fabric/knowledge` must be deleted or made unreachable.

### Q6 Evidence

The Fabric skills are duplicated under `.codex/skills` and `.claude/skills`.
`fabric-archive` still instructs candidates to carry `layer`, refers to
`fab_extract_knowledge` inputs keyed by `layer`, and mentions appending
`session_archive_attempted` to `.fabric/events.jsonl`. Reference files still
include examples of `layer: "team" | "personal"` and old pending/event paths.
`fabric-sync` and `fabric-store` already say skills should not parse store trees
directly, which matches the single-contract rule.

### Q6 Answer

Decision: Fabric skills must be updated in the same version as runtime to be
scope-first and store-only.

Implications:
- Skill prompts/examples use `semantic_scope`, not `layer`, as the primary
  write/review concept.
- Skills do not hand-write `.fabric/events.jsonl`; archive/review events go
  through MCP/server/global ledger.
- Skill docs/examples stop saying pending lives under project-root or home
  `.fabric/knowledge/pending`.
- `.codex/skills` and `.claude/skills` must stay byte/semantic parity for
  Fabric behavior.
- `fabric-archive`, `fabric-review`, `fabric-import`, `fabric-sync`,
  `fabric-store`, `fabric-audit`, and `fabric-connect` all need contract audit.

### Q7 Evidence

Doctor already contains store-scope lint for missing `semantic_scope` /
`visibility_store`, personal leak, and dangling project references. Sync
currently owns multi-store git pull/rebase/push, but the locked architecture
adds hard safety requirements before push: personal leak must not reach a team
remote, write routes must resolve into the read-set, and generated binding/index
state must be current enough for hooks/MCP to agree.

### Q7 Answer

Decision: doctor/sync enforce store-only contract violations as hard gates with
safe fix paths where possible.

Implications:
- Doctor reports route outside read-set, missing project route, personal in
  `required_stores`, missing scope metadata, dangling project refs, personal
  leak, stale binding snapshot, and stale/missing index.
- `doctor --fix` may regenerate snapshots/indexes and remove invalid personal
  `required_stores`, but must not silently move private knowledge across stores.
- Sync blocks push for privacy and route/read-set violations.
- Sync regenerates binding snapshots and indexes after successful pull/rebase
  and before push validation.

### Q8 Evidence

The repo already has tests spanning CLI (`packages/cli/__tests__`), server
services/tools (`packages/server/src/services/*.test.ts`,
`packages/server/src/tools/*.test.ts`), shared schemas/resolvers
(`packages/shared/src/**.test.ts`), hook behavior (`packages/cli/__tests__/fabric-hint.test.ts`),
and snapshots/i18n. The scan also shows many old strings still present
(`.fabric/knowledge`, `.fabric/events.jsonl`, `layer`, `switch-write`,
`bindings/<project_id>_resolved.json`), so static forbidden-pattern checks are
needed in addition to behavioral tests.

### Q8 Answer

Decision: every row in the surface alignment matrix must have a test or static
scan acceptance check.

Implications:
- Runtime rows need unit/integration tests.
- Hook/skill/docs rows need snapshot tests or forbidden-pattern scans.
- Old-path strings are allowed only in explicit migration docs/tests with an
  allowlist.
- Release is blocked if any matrix row lacks an acceptance check.

### Surface Alignment Matrix

| Surface | Required final behavior | Delete/retire | Acceptance |
|---|---|---|---|
| Shared schemas/resolver | Define `semantic_scope`, `visibility_store`, `workspace_binding_id`, route validation, read-set/write-target contracts. | Ambiguous `layer` as routing primitive; `project_id` as snapshot key. | Schema/resolver unit tests + golden read-set/write-route fixtures. |
| CLI install/bind/store | Onboarding writes `write_routes` for `project:<id> -> store`; `scope-explain` explains real route; `switch-write` removed or compatibility alias to route writer. | `active_write_store` as primary write model; personal in `required_stores`; silent multi-store fallback. | CLI unit/integration tests for single store, multi-team, missing route, route outside read-set. |
| CLI sync | Pull/rebase/push stores; validate privacy, routes, scope metadata, snapshots/indexes before push. | Push with personal leak or invalid route; sync that leaves stale snapshots. | Sync state-machine tests + privacy-block integration fixture. |
| Server write path | `fab_extract_knowledge` validates proposed `semantic_scope` and writes pending to resolved readable store. | Generic `"team"` scope passed to resolver; workspace/home pending fallback. | Service/tool tests for project/team/personal/multi-store routes and failure cases. |
| Server review path | Review lists pending across read-set stores; modify can change `semantic_scope`; approve preserves scope/provenance. | `modify-layer` as primary concept; layer-flip-only ID semantics. | Review tests for modify scope, approve, reject, search, provenance. |
| Server recall/plan/get_sections | Read canonical entries from store index/view or live fallback; return `alias:id` + provenance; pending excluded. | Project-local agents/meta/canonical scans; bare ambiguous IDs. | Plan/recall/sections tests for shadowing, active_project filter, index fallback. |
| MCP schemas/tools | Scope-first inputs/outputs; store provenance envelope on surfaced entries and written-store echo on writes. | MCP descriptions saying `.fabric/knowledge/pending`, home/workspace roots, layer storage selector. | MCP schema registration tests + output shape tests. |
| Hooks | Read global `workspace_binding_id` snapshot/stats/ledger paths; never resolve stores or write project-root ledger. | `bindings/<project_id>_resolved.json`; `.fabric/events.jsonl` writes; `.fabric/knowledge` summary fallback. | Hook tests + forbidden-pattern scans with allowlist. |
| Skills | Fabric skills use `semantic_scope`, CLI/MCP contract, global ledger semantics, store-only pending/review. | Hand-written `.fabric/events.jsonl`; layer-first examples; old pending path examples. | Skill snapshot/static scans across `.codex` and `.claude` copies. |
| Doctor/audit | Default checks current binding read-set; explicit all-store mode; reports route/read-set/scope/index violations. | Project-local knowledge health as runtime source. | Doctor tests for each lint and --fix-safe behavior. |
| Derived index | Store-local canonical index + binding-level view; fingerprint validation and live fallback. | Hot-path full store scan as only normal path. | Index unit/integration tests for invalidation, fallback, multi-project/worktree reuse. |
| Event/metrics ledger | Global state per `workspace_binding_id`, rows carry project/store/scope provenance. | Project-root `.fabric/events.jsonl` as runtime ledger. | Ledger path tests + event schema tests + hook/server parity tests. |
| Migration/import | Explicit one-time rescue from retired local roots; normal runtime never reads them. | Silent compatibility fallback. | Migration tests + forbidden runtime imports/globs for retired paths. |

Surface alignment synthesis: the prior architecture decisions are valid, but
completion requires this matrix to pass. Without it, store-only would remain a
partial runtime refactor while CLI/hook/skill instructions keep old behavior
alive.

# Planning Context: CLI → MCP Host → MCP Server → Agent → Web Client Chain Optimization

## Source Evidence
- `.workflow/.analysis/ANL-cli-mcp-agent-web-audit-2026-04-21/conclusions.json` — 14 accepted recommendations spanning hot-path I/O, MCP protocol compliance, CLI ergonomics, dashboard resilience
- `packages/server/src/meta-reader.ts:43` — readFileSync sync blocking; root cause of hot-path latency
- `packages/server/src/services/get-rules.ts:77-90` — loadGetRulesContext 3 I/O calls per invocation, no cache
- `packages/server/src/services/audit-log.ts:64,91-111` — O(n) full-file read on every fab_append_intent call
- `packages/server/src/http.ts:131-135` — /mcp endpoint unprotected while /api and /events have bearer auth
- `packages/server/src/tools/get-rules.ts:15-24` — all 4 tools use JSON.stringify text response, no outputSchema
- `packages/server/src/tools/plan-context.ts:9` — paths.min(1) overlaps semantically with fab_get_rules
- `packages/cli/src/commands/pre-commit.ts:34-51` — serial 3-check pipeline with no fast exit for non-fabric commits
- `packages/dashboard/src/hooks/use-events.ts` — bare EventSource without Last-Event-ID or auth header support

## Understanding
- **Current State**: PCF project has a well-architected 4-package monorepo (cli, server, dashboard, shared) with dual MCP transport (stdio+SSE), L0/L1/L2 rule layering, and chokidar-based file watching. The main optimization gaps are: (1) hot-path I/O redundancy in every MCP tool call, (2) MCP 2025-06-18 protocol features underused, (3) CLI command discoverability and missing update command, (4) dashboard SSE connection resilience.
- **Approach**: Group 14 recommendations into 7 cohesive tasks that map to natural feature/module boundaries, enabling parallel independent execution by separate agents. Tasks are sized 20-60 min each.

## Key Decisions

- **Decision**: Merge Rec#1 + Rec#2 + Rec#13 into TASK-001 (cache layer) | **Rationale**: All three address the same hot-path I/O problem at different layers; implementing them together avoids partial solutions and ensures the ContextCache unifies the TTL/watcher invalidation pattern once | **Evidence**: conclusions.json Rec#13 notes "partially overlaps Rec#1 & Rec#2; treat as unification/refactor task"

- **Decision**: Merge Rec#3 + Rec#6 + Rec#7 into TASK-002 (MCP tools conformance) | **Rationale**: All 4 tool files need touching for outputSchema/annotations; Rec#6 and Rec#7 are schema-level changes to plan-context.ts and update-registry.ts respectively — natural co-location with the outputSchema pass | **Evidence**: All 4 tools share the same createTextResponse pattern

- **Decision**: Merge Rec#4 + Rec#5 into TASK-003 (security + compliance feedback) | **Rationale**: Both are server-side changes to http.ts/append-intent.ts that close two symmetrical gaps (auth surface and audit feedback surface); no shared code but same deployment unit | **Evidence**: http.ts:131-135 and append-intent.ts are server package changes with no cross-dep risk

- **Decision**: Merge Rec#10 + Rec#11 into TASK-004 (CLI reorganization) | **Rationale**: Both touch CLI command registration (index.ts and config.ts); fab update command and config visibility/restructuring are best shipped together to avoid two separate CLI interface changes | **Evidence**: commands/index.ts:1-34 is the shared registration point

- **Decision**: Rec#8 is TASK-005 standalone | **Rationale**: pre-commit fast-skip is entirely self-contained in pre-commit.ts with no dependency on other tasks; isolating it avoids blocking a quick win on CLI reorg timeline | **Evidence**: Single-file change with clear scope

- **Decision**: Rec#9 is TASK-006 standalone | **Rationale**: Dashboard SSE resilience spans two packages (dashboard + server); standalone grouping lets a frontend-capable agent take it without touching server business logic | **Evidence**: use-events.ts + events.ts are the complete scope

- **Decision**: Merge Rec#12 + Rec#14 into TASK-007 (MCP Resources + notifications) | **Rationale**: Both are MCP protocol extension features that require wiring into createFabricServer and the sessions Map; AGENTS.md resource + notifications/resources/updated + notifications/tools/list_changed all share the same notification dispatch infrastructure | **Evidence**: Both target packages/server/src/index.ts + http.ts

- **Decision**: TASK-007 depends_on TASK-001 | **Rationale**: The resource/notification subscription path benefits from the unified cache's file-watch invalidation hooks; TASK-001's ContextCache watcher is the natural trigger point for both resource-updated and tools-list-changed notifications. TASK-002 dependency was considered but dropped — outputSchema and resource URI shape are independent concerns that don't share code paths.

## Dependencies
- TASK-007 depends_on TASK-001 (notification triggers should wire into cache invalidation watcher)
- All other tasks (TASK-001 through TASK-006) are fully parallel and independent

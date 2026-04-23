## Goal
Implement Dashboard Module A first batch: coverage heatmap and hit reason visualization. Establish four-module navigation skeleton.

## CRITICAL: Multi-task context
This is TASK-005 in a 5-task plan. The uncommitted changes you see in packages/shared, packages/server, and packages/cli are from TASK-001 (activation tier), TASK-002 (tree-sitter), and TASK-004 (fab approve) — all part of the SAME plan. You are EXPLICITLY AUTHORIZED to:
1. Modify i18n locale files (en.ts, zh-CN.ts) that already have changes from TASK-004
2. Add a minimal read-only server API route to expose RulesPayload for Dashboard consumption
3. Modify packages/server/src/http.ts to register the new route
4. Work on top of the changes from TASK-001 in packages/shared and packages/server

These are NOT conflicts — they are prerequisites from earlier tasks in the same plan.

## Previous Work (from TASK-001)
- AgentsMetaNode now has `activation?: { tier: 'always' | 'path' | 'description'; description?: string }`
- RulesPayload now includes `description_stubs?: DescriptionStub[]`
- loadRulesForPath() supports always/path/description tier branches
- These changes are in packages/shared and packages/server (uncommitted but intentional)

## Task: Dashboard Module A — coverage heatmap + hit reason visualization

**Scope**: `packages/dashboard/src/ + minimal server read API` | **Action**: Implement

### Design Principles (MANDATORY)
- **Zero write operations** — Dashboard is pure observation platform, NO POST/PUT/DELETE
- **Second-screen monitoring** — Information density, don't interrupt dev flow
- **SSoT purity** — Rules source of truth is file system, Dashboard only reads

### Files
- **packages/dashboard/src/views/rule-topology.tsx** → New Rule Topology view with CoverageHeatmap and HitReasonPanel
- **packages/dashboard/src/components/coverage-heatmap.tsx** → Directory coverage visualization from scope_glob patterns
- **packages/dashboard/src/components/hit-reason-panel.tsx** → Per-rule activation tier badges (Always-on / Glob / Description)
- **packages/dashboard/src/app.tsx** → Four-module navigation skeleton (A active, B/C/D placeholder stubs)
- **packages/dashboard/src/components/index.ts** → Export new components
- **packages/dashboard/src/api/client.ts** → Add getRulesContext() client function for the new read-only API
- **packages/server/src/api/rules-context.ts** → NEW: Minimal read-only GET endpoint exposing RulesPayload for a sample path
- **packages/server/src/http.ts** → Register the new read-only route
- **packages/shared/src/i18n/locales/en.ts** → Add dashboard module labels (APPEND to existing changes)
- **packages/shared/src/i18n/locales/zh-CN.ts** → Add dashboard module labels (APPEND to existing changes)

### How to do it
1. Read existing views (rules-tree.tsx, human-lock.tsx) to understand patterns
2. Add minimal read-only GET `/api/rules/context` endpoint on server that calls getRules() with a query path param and returns RulesPayload
3. Add getRulesContext(path) to dashboard api/client.ts
4. Create rule-topology.tsx with two-panel layout
5. Implement CoverageHeatmap from AgentsMeta scope_glob patterns
6. Implement HitReasonPanel consuming RulesPayload including description_stubs
7. Add four-module navigation skeleton to app.tsx
8. Add i18n labels for module names
9. Export new components

### Done when
- [ ] rule-topology view renders without runtime errors
- [ ] CoverageHeatmap displays covered vs uncovered directory distinction
- [ ] HitReasonPanel shows activation tier badges (Always-on / Glob / Description)
- [ ] Description stubs display description text from RulesPayload.description_stubs
- [ ] Four-module navigation skeleton present in app.tsx (A active, B/C/D labeled stubs)
- [ ] Zero write operations in new components (no POST/PUT/DELETE calls)
- [ ] TypeScript compilation passes with zero new errors

Complete each item in the "Done when" checklist.

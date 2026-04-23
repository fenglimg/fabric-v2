## Goal
Implement Dashboard Module A first batch: coverage heatmap and hit reason visualization. Establish four-module navigation skeleton.

## Previous Work
- TASK-001 completed: activation.tier field added to AgentsMetaNode, RulesPayload now includes `description_stubs?: DescriptionStub[]`, loadRulesForPath() supports always/path/description tier branches.
- Resume from TASK-001 session for continuity.

## Task: Dashboard Module A — coverage heatmap + hit reason visualization

**Scope**: `packages/dashboard/src/views/ + packages/dashboard/src/components/` | **Action**: Implement

### Design Principles (MANDATORY)
- **Zero write operations** — Dashboard is pure observation platform, NO POST/PUT/DELETE
- **Second-screen monitoring** — Information density, don't interrupt dev flow
- **SSoT purity** — Rules source of truth is file system, Dashboard only reads

### Files
- **packages/dashboard/src/views/rule-topology.tsx** → `new Rule Topology view`: New view component for Module A. Renders two sections: CoverageHeatmap and HitReasonPanel. Reads rules data from SSE hook. No write operations.
- **packages/dashboard/src/components/coverage-heatmap.tsx** → `new CoverageHeatmap component`: Visualize directory coverage: cross agents.meta.json scope_glob patterns against project file tree. Color by coverage density: green=covered, yellow=partial, gray=no rules. Use CSS grid or simple tree list with colored rows.
- **packages/dashboard/src/components/hit-reason-panel.tsx** → `new HitReasonPanel component`: Display each rule with activation tier badge: Always-on / Glob match / Description stub. For Glob rules: show matched pattern. For Description stubs: show description text. For Always-on: show 'Global'. Data from RulesPayload including description_stubs.
- **packages/dashboard/src/app.tsx** → `app router / navigation`: Add route or tab for rule-topology view. Establish four-module navigation skeleton (A: Rule Topology, B: Cognitive Forensic, C: Semantic Timeline, D: Historical Ledger) with placeholder stubs for B/C/D.
- **packages/dashboard/src/components/index.ts** → `component exports`: Export CoverageHeatmap and HitReasonPanel

### Why this approach
Module A first batch (S-complexity features) as proof of concept for four-module architecture before investing in M/L features.
Key factors: Coverage heatmap + hit reason are S-complexity and directly enabled by TASK-001, Establishes navigation skeleton for all four modules.
Tradeoffs: B/C/D modules are stubs only — acceptable since they depend on future tasks.

### How to do it
Establish Dashboard four-module layout structure and implement Module A first batch.

1. Read existing views (rules-tree.tsx, human-lock.tsx) to understand SSE hook usage and data access patterns
2. Read use-events.ts and api/client.ts to understand available data endpoints
3. Confirm RulesPayload type is accessible in dashboard (check shared package re-exports)
4. Create rule-topology.tsx view with two-panel layout: CoverageHeatmap (left/top) + HitReasonPanel (right/bottom)
5. Implement CoverageHeatmap: fetch agents meta nodes, extract scope_glob patterns, group by directory prefix, render colored directory tree
6. Implement HitReasonPanel: consume SSE rules events, display each rule entry with tier badge (Always-on/Glob/Description)
7. Add four-module navigation skeleton to app.tsx with A=active, B/C/D=placeholder stubs
8. Register rule-topology route in app router

### Code skeleton
**Interface**: `DirectoryCoverage { path: string; covered: boolean; matchingGlobs: string[]; density: 'full' | 'partial' | 'none' }`
**Function**: `buildCoverageMap(nodes: AgentsMetaNode[], fileTree: string[]): DirectoryCoverage[]` — Cross scope_glob patterns against project file tree
**Component**: `CoverageHeatmap` — React component rendering directory coverage grid with color coding
**Component**: `HitReasonPanel` — React component rendering per-rule tier badges from RulesPayload

### Reference
- Pattern: SSE hook consumption pattern from existing views
- Files: packages/dashboard/src/views/rules-tree.tsx, packages/dashboard/src/hooks/use-events.ts, packages/dashboard/src/api/client.ts, packages/dashboard/src/app.tsx
- Notes: Follow rules-tree.tsx for SSE data consumption; follow human-lock.tsx for list rendering pattern

### Risk mitigations
- RulesPayload.description_stubs field not yet available if TASK-001 not completed → **Handle undefined description_stubs with empty array fallback**
- agents.meta.json scope_glob parsing for coverage heatmap requires directory-level grouping → **Use minimatch negation patterns to infer directory prefix from glob**

### Done when
- [ ] rule-topology view renders without runtime errors
- [ ] CoverageHeatmap displays at least covered vs uncovered directory distinction
- [ ] HitReasonPanel shows activation tier for each rule (Always-on / Glob / Description badges)
- [ ] Description stubs display description text (not file content) from RulesPayload.description_stubs
- [ ] Four-module navigation skeleton present in app.tsx (A active, B/C/D labeled stubs)
- [ ] Zero write operations in new components (no POST/PUT/DELETE calls)
- [ ] TypeScript compilation passes with zero new errors

**Success metrics**: CoverageHeatmap renders directory tree with coverage colors in under 200ms after data load, HitReasonPanel correctly distinguishes all 3 tier types with distinct visual badges

### Data Flow
agents.meta.json → agentsMetaNodeSchema (activation.tier) → loadRulesForPath() → RulesPayload (with description_stubs) → Dashboard RuleTopology view → CoverageHeatmap + HitReasonPanel

Complete each item in the "Done when" checklist.

# Planning Context: AI Client Init Rules + Web Interaction — Four-Scope Implementation

## Source Evidence

- `conclusions.json` — Validated analysis from ANL-2026-04-23 with 5 fully-covered intent areas, 5 recommendations (2 active, 1 deferred, 2 withdrawn), and dashboard vision with 4 modules
- `packages/shared/src/types/agents.ts:5-13` — `AgentsMetaNode` interface: 7 fields, no activation field currently
- `packages/shared/src/schemas/agents-meta.ts:16-24` — `agentsMetaNodeBaseSchema` zod schema: 7 required fields, all strict
- `packages/server/src/services/get-rules.ts:136-161` — `loadRulesForPath()`: pure minimatch glob filter, no tier awareness; `RulesPayload` at L22-26 has no stub concept
- `packages/server/src/services/approve-human-lock.ts:24-85` — `approveHumanLock()` takes `ApproveHumanLockInput` (file, start_line, end_line, new_hash)
- `packages/server/src/services/read-human-lock.ts:19-33` — `readHumanLock()` returns `HumanLockStatus[]` with drift field
- `packages/cli/src/commands/human-lint.ts` — citty `defineCommand` pattern; reads human-lock.json, computes hashes, reports violations
- `packages/cli/src/commands/index.ts` — `allCommands` record: 12 commands, all lazy dynamic imports
- `packages/cli/src/scanner/forensic.ts:36-48` — `PatternHintResult` type: includes `ast_level: boolean` (currently always false), `confidence` field
- `packages/dashboard/src/views/` — 5 existing views: doctor, history-replay, human-lock, intent-timeline, rules-tree
- `packages/dashboard/src/components/` — 7 existing components including approve-button (to be deprecated per zero-write decision)

## Understanding

- **Current State**: Rule activation uses a single glob-only path (`minimatch`). All rules either match or don't — no semantic tiering. forensic.ts does text pattern matching with a hard `MEDIUM` confidence ceiling for web frameworks. Dashboard has approve-button component contradicting the zero-write positioning.
- **Problem**: (1) No way to register always-on rules or description-only stubs — limits AI's ability to self-load relevant rules. (2) Web framework detection stuck at MEDIUM confidence because text matching can't detect import structure. (3) Dashboard approve button is a write operation violating the zero-write principle — CLI must compensate. (4) Dashboard needs a structured 4-module architecture.
- **Approach**: (1) Add optional `activation.tier` field to schema with backward-compatible defaults; gate rule loading by tier before glob matching. (2) Integrate web-tree-sitter WASM for AST-level imports analysis, upgrade confidence scoring. (3) New `fab approve` CLI command reusing existing server-side services. (4) Dashboard: establish 4-module layout + implement Module A first batch (coverage heatmap + hit reason visualization).

## Key Decisions

- Decision: `activation` field optional with default `tier='path'` | Rationale: Zero breaking changes — existing nodes get path behavior implicitly | Evidence: `agentsMetaNodeBaseSchema` has no optional fields currently
- Decision: `description` tier returns stub (path + description only, not content) | Rationale: Model self-selects by reading stub, zero inference cost for irrelevant rules | Evidence: conclusions.json REC-1 validated design
- Decision: tree-sitter WASM evaluation before implementation | Rationale: 3.5MB WASM integration has bundle size risk; evaluation step confirms feasibility | Evidence: conclusions.json step 2 blocks step 3
- Decision: CLI `fab approve` reuses server-side `approveHumanLock()` directly | Rationale: Logic already correct, avoids duplication; CLI imports from server package (existing pattern) | Evidence: `human-lint.ts` imports from `@fenglimg/fabric-shared`
- Decision: Dashboard Module A first batch = coverage heatmap + hit reason only | Rationale: These two are S-complexity and directly enabled by REC-1 matchReason field | Evidence: conclusions.json dashboard_vision.modules[A] features 命中理由可视化 (S) + 覆盖率热力图 (S)
- Decision: REC-1 and CLI approve are independent tasks (no deps between them) | Rationale: They touch separate code paths | Evidence: conclusions.json dependency analysis
- Decision: Dashboard Module A depends on REC-1 | Rationale: matchReason field in RulesPayload (from tier-aware get-rules.ts) is the data source for "hit reason visualization" | Evidence: task description dependency constraints

## Dependencies

- TASK-001 (REC-1 activation tier): No dependencies — start immediately
- TASK-002 (tree-sitter evaluation): No dependencies — start immediately  
- TASK-003 (forensic AST upgrade): Depends on TASK-002 (evaluation must confirm WASM feasibility)
- TASK-004 (CLI approve): No dependencies — start immediately
- TASK-005 (Dashboard Module A): Depends on TASK-001 (needs matchReason from tier-aware RulesPayload)

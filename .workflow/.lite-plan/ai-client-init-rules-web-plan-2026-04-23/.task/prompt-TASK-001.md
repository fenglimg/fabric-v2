## Goal
Implement REC-1 from analysis: three-tier activation model for Fabric Protocol rule loading.

## Task: REC-1 — Add activation.tier field to agents-meta schema and tier-based rule loading

**Scope**: `packages/shared/src/types/agents.ts + packages/shared/src/schemas/agents-meta.ts + packages/server/src/services/get-rules.ts` | **Action**: Implement

### Files
- **packages/shared/src/types/agents.ts** → `AgentsMetaNode interface`: Add optional `activation?: { tier: 'always' | 'path' | 'description'; description?: string }` field
- **packages/shared/src/schemas/agents-meta.ts** → `agentsMetaNodeBaseSchema zod object`: Add `activation: z.object({ tier: z.enum(['always','path','description']), description: z.string().optional() }).optional()` to schema; update `withDerivedAgentsMetaNodeDefaults` to preserve activation field
- **packages/server/src/services/get-rules.ts** → `loadRulesForPath() L136-161 and RulesPayload type L22-27`: Add DescriptionStub type. In loadRulesForPath(), add tier branch before minimatch: always→include without glob check, description→push stub (no file read), path→existing minimatch. Update RulesPayload to include `description_stubs?: DescriptionStub[]`

### Why this approach
Optional field with undefined-as-path-default avoids any schema migration or breaking change.
Key factors: Zero breaking changes, Minimal LOC (~50-60), Aligns with Windsurf/Cursor/Claude Code industry standard.
Tradeoffs: description_stubs is a new array in RulesPayload — clients must handle it gracefully (undefined-safe access).

### How to do it
Add optional activation.tier field (always/path/description) to AgentsMetaNode interface and agentsMetaNodeBaseSchema. Modify loadRulesForPath() in get-rules.ts to branch on tier before minimatch: always→include directly, description→return stub (path + description, no content), path→existing minimatch logic. Update RulesPayload and RulesEntry types to support description stubs. Default tier='path' ensures zero breaking changes.

1. Add activation type to AgentsMetaNode interface in agents.ts with optional activation field
2. Add activation zod schema to agentsMetaNodeBaseSchema in agents-meta.ts, ensure optional with no default (undefined means path behavior)
3. Define DescriptionStub type in get-rules.ts: `{ path: string; description: string }`
4. Extend RulesPayload with `description_stubs?: DescriptionStub[]` field
5. Rewrite loadRulesForPath() to pre-filter by tier: always nodes skip minimatch, description nodes produce stubs, path nodes use existing minimatch logic
6. Verify backward compatibility: run existing tests, ensure nodes without activation field still behave as path tier

### Code skeleton
**Interface**: `DescriptionStub { path: string; description: string }` — Lightweight rule stub returned for description-tier nodes, no content loaded
**Function**: `loadRulesForPath(projectRoot, meta, path): Promise<{ rules: LoadedRule[]; stubs: DescriptionStub[] }>` — Returns full rule content for always/path tiers, description stubs for description tier

### Reference
- Pattern: Optional zod field with no default (undefined = legacy behavior)
- Files: packages/shared/src/schemas/agents-meta.ts, packages/shared/src/types/agents.ts, packages/server/src/services/get-rules.ts
- Notes: Follow existing zod optional pattern; match existing agentsMetaNodeBaseSchema field style

### Risk mitigations
- Clients reading RulesPayload may not handle new description_stubs field → **Make description_stubs optional in RulesPayload type (?: not :)**

### Done when
- [ ] AgentsMetaNode interface has `activation?: { tier: 'always' | 'path' | 'description'; description?: string }`
- [ ] agentsMetaNodeBaseSchema parses nodes with and without activation field without error
- [ ] loadRulesForPath() returns node content directly for tier=always (no glob check)
- [ ] loadRulesForPath() returns DescriptionStub (no file content read) for tier=description
- [ ] loadRulesForPath() preserves existing minimatch behavior for tier=path and undefined activation
- [ ] RulesPayload.description_stubs field populated correctly when description-tier nodes match
- [ ] Existing test suite passes with zero modifications to test files

**Success metrics**: All 3 tier branches execute in loadRulesForPath without regression, TypeScript compilation passes with zero new type errors

### Data Flow
agents.meta.json → agentsMetaNodeSchema (activation.tier) → loadRulesForPath() → RulesPayload (with description_stubs)

Complete each item in the "Done when" checklist.

# REQ-001: Install Stage Refactor

**Priority**: MUST
**Feature ID**: F-001
**Status**: Draft

## User Story

**As a** Fabric CLI developer
**I want** the install command decomposed into 7 discrete, idempotent stages
**So that** the codebase is maintainable, testable, and each stage can run independently without side effects.

## Context

The current `install.ts` exceeds 2000 lines with mixed concerns, making it difficult to:
- Test individual stages in isolation
- Resume from failed stages
- Understand the execution flow
- Maintain idempotency guarantees

## Acceptance Criteria

### AC1: Seven Discrete Stages

**GIVEN** the install command architecture
**WHEN** the refactor is complete
**THEN** the following stages MUST exist as separate modules:

| Stage | Name | Responsibility | Idempotent |
|-------|------|----------------|------------|
| 1 | Detect | Detect client type (claude/codex/cursor) and environment | Yes |
| 2 | Validate | Validate prerequisites and configuration | Yes |
| 3 | Bootstrap | Create `.fabric/` directory structure | Yes |
| 4 | Hooks | Install/upgrade hooks for detected client | Yes |
| 5 | Config | Generate/update `fabric-config.json` | Yes |
| 6 | Knowledge | Bootstrap knowledge directories | Yes |
| 7 | Verify | Verify installation integrity | Yes |

### AC2: Idempotency Guarantee

**GIVEN** any stage S in the pipeline
**WHEN** S is executed multiple times with identical inputs
**THEN** the system state after each execution MUST be identical
**AND** no side effects MUST accumulate across executions.

**Test Cases**:
```typescript
// Stage 3 Bootstrap - Running twice must not duplicate directories
await stage3Bootstrap.run(config);
const stateAfter1 = await fs.stat('.fabric');
await stage3Bootstrap.run(config);
const stateAfter2 = await fs.stat('.fabric');
assert.deepEqual(stateAfter1, stateAfter2);

// Stage 4 Hooks - Running twice must not duplicate hook entries
await stage4Hooks.run(config);
const hooksAfter1 = await readHooks();
await stage4Hooks.run(config);
const hooksAfter2 = await readHooks();
assert.deepEqual(hooksAfter1, hooksAfter2);
```

### AC3: Stage Isolation

**GIVEN** the stage execution pipeline
**WHEN** stage N fails
**THEN** stages 1 through N-1 MUST have committed their state
**AND** stages N+1 through 7 MUST NOT have executed
**AND** the system MUST support resuming from stage N.

**Example**:
```
Stage 1 (Detect)    ✓ Committed
Stage 2 (Validate)  ✓ Committed
Stage 3 (Bootstrap) ✗ Failed: Permission denied
Stage 4 (Hooks)     ⊘ Not executed
Stage 5 (Config)    ⊘ Not executed
Stage 6 (Knowledge) ⊘ Not executed
Stage 7 (Verify)    ⊘ Not executed

→ User can fix permission and run: fabric install --resume-from=3
```

### AC4: Orchestrator Pattern

**GIVEN** the refactored architecture
**WHEN** the install command is invoked
**THEN** an orchestrator MUST coordinate stage execution
**AND** each stage MUST expose a consistent interface:

```typescript
interface Stage {
  name: string;
  order: number;
  run(context: StageContext): Promise<StageResult>;
  isApplicable(context: StageContext): boolean;
  rollback(context: StageContext): Promise<void>;
}

interface StageContext {
  client: ClientType;
  config: FabricConfig;
  previousResults: Map<string, StageResult>;
  dryRun: boolean;
}

interface StageResult {
  success: boolean;
  changes: Change[];
  errors: Error[];
  skipped: boolean;
}
```

## Technical Constraints

1. **MUST** preserve backward compatibility with existing `.fabric/` structures
2. **MUST** support `--dry-run` flag that reports changes without executing
3. **MUST** emit structured telemetry for each stage completion
4. **SHOULD** support parallel execution where stages are independent
5. **MAY** cache detection results across invocations

## Dependencies

- None (foundational requirement)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing installations | HIGH | Comprehensive integration tests with real `.fabric/` directories |
| Stage boundary misalignment | MEDIUM | Design review with team before implementation |
| Idempotency edge cases | MEDIUM | Property-based testing for idempotency |

## Implementation Notes

- Consider using the Command pattern for stage implementations
- Stage rollback logic is required for AC3 but may be deferred to v2.3
- Telemetry schema must be documented in a separate ADR

## Traceability

- **NFR-PERF-001**: Stage isolation enables targeted performance optimization
- **NFR-UX-001**: Discrete stages enable granular progress reporting
- **NFR-TEST-001**: Each stage can be unit tested independently

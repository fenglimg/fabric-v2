# Test Strategist Analysis: Fabric CLI Install/Uninstall UX Refactoring

**Session**: 2026-06-06
**Role**: test-strategist
**Scope**: F-001 (install-stage-refactor), F-002 (ink-output-layer), F-003 (store-onboarding-wizard), F-004 (uninstall-symmetry)

---

## §1. Role Mandate

Define comprehensive test strategy for Fabric CLI's Ink TUI refactoring, covering:

1. **Per-Stage Testing (TS-01)** - Unit tests for each of the 7 pipeline stages with idempotency, failure_mode handling, and mock external dependencies
2. **Wizard Flow Testing (TS-02)** - Branching logic tests for Skip/Join/Create paths, --url auto-join, context detection, and cancellation scenarios
3. **Visual Output Testing (TS-03)** - Snapshot testing for ink components across terminal width variations

Key constraints from guidance:
- MUST test idempotency (run twice produces same result)
- MUST test failure_mode handling (graceful vs hard-fail)
- MUST mock external dependencies (git, filesystem, MCP configs)
- SHOULD test edge cases: partial install, interrupted execution
- SHOULD capture expected output snapshots
- SHOULD test across terminal width variations
- MAY use ink-testing-library for component tests

---

## §2. Decision Digest

### Table 2.1: Test Architecture Decisions

| Decision ID | Feature | Decision | Rationale | Constraints |
|-------------|---------|----------|-----------|-------------|
| TD-001 | F-001 | MUST adopt per-stage unit test pattern from existing uninstall.test.ts | Existing pattern proven: stage enumeration, dry-run, idempotency tests mirror current codebase | Follow `__tests__/helpers/init-test-utils.ts` fixture pattern |
| TD-002 | F-001 | MUST introduce stage contract tests (input → output shape) | Staged refactoring requires explicit contracts; prevents regression during migration | Define `StageResult` interface, test each stage independently |
| TD-003 | F-001 | MUST mock git operations via `vi.doMock` pattern | Git clone/fetch are external deps; existing tests mock `@clack/prompts` same way | Mock `isomorphic-git` or `simple-git` at module level |
| TD-004 | F-002 | SHOULD use `ink-testing-library` for component unit tests | ink provides official testing utilities; matches React Testing Library paradigm | Add devDependency `@inkjs/testing-library` |
| TD-005 | F-002 | SHOULD implement snapshot tests for OutputRenderer primitives | Visual regression protection; ink output is deterministic in mock environment | Use vitest `expect().toMatchSnapshot()` |
| TD-006 | F-003 | MUST test wizard branching with mock state machine | Wizard has 3+ paths; state machine test ensures correct transitions | Create `WizardStateMachine` test helper |
| TD-007 | F-003 | MUST test --url flag short-circuits wizard | Critical UX path; auto-join must skip all prompts | Mock `process.argv` or options object |
| TD-008 | F-003 | MUST test context detection accuracy | Fresh machine vs existing global vs team URL available | Mock `existsSync` for different scenarios |
| TD-009 | F-004 | MUST mirror uninstall tests to install symmetry | Existing uninstall.test.ts pattern is proven; symmetric test ensures cleanup completeness | Copy test structure, adapt assertions |
| TD-010 | F-004 | MUST test store-binding-cleanup removes correct entries | Uninstall must clean global registry; integration test with mock registry | Create mock `~/.fabric/stores/` structure |

### Table 2.2: Test Coverage Targets

| Feature | Target Coverage | Critical Paths | Rationale |
|---------|----------------|----------------|-----------|
| F-001 Stage Execution | 90% | Stage contracts, idempotency, failure modes | Core logic; high coverage justified |
| F-001 Stage Enumeration | 95% | Plan building, entry filtering, personal-root guard | Existing test pattern already high |
| F-002 OutputRenderer | 80% | Component rendering, error handling | UI code; snapshot tests supplement |
| F-003 Wizard Flow | 95% | All branches, cancellation, --url bypass | User interaction critical |
| F-004 Uninstall Symmetry | 90% | Store-binding cleanup, knowledge preservation | Matches existing uninstall coverage |

### Table 2.3: Test File Organization

| Feature | Primary Test File | Integration Test File | Helper File |
|---------|-------------------|----------------------|-------------|
| F-001 | `__tests__/install/stage-*.test.ts` (7 files) | `__tests__/integration/install-stages.test.ts` | `__tests__/helpers/stage-test-utils.ts` |
| F-002 | `__tests__/output/renderer.test.ts` | `__tests__/integration/ink-snapshots.test.ts` | `__tests__/helpers/ink-test-utils.ts` |
| F-003 | `__tests__/wizard/store-onboarding.test.ts` | `__tests__/integration/wizard-e2e.test.ts` | `__tests__/helpers/wizard-state-machine.ts` |
| F-004 | `__tests__/uninstall/store-binding-cleanup.test.ts` | `__tests__/integration/uninstall-symmetry.test.ts` | Reuse existing helpers |

### Table 2.4: Mock Strategy

| Dependency | Mock Approach | Scope | Implementation |
|------------|---------------|-------|----------------|
| Filesystem | Real filesystem + tmpdir | Per-test isolation | `createWerewolfFixtureRoot` pattern |
| Git operations | `vi.doMock` at module level | Stage tests requiring clone/fetch | Mock `simple-git` or `isomorphic-git` |
| MCP configs | Mock config paths | MCP stage tests | Mock `getMcpConfigPath` return values |
| Ink render | `ink-testing-library` | Component tests | `render` from `@inkjs/testing-library` |
| Clack prompts | `vi.doMock('@clack/prompts')` | Wizard tests | Existing pattern in init-wizard.test.ts |
| Process TTY | `setProcessTty` helper | Interactive tests | Existing helper in init-test-utils.ts |

---

## §3. Cross-Cutting Foundations

### 3.1 Test Infrastructure Requirements

**MUST** establish before F-001 implementation:

1. **Stage contract interface** - Define `StageInput`, `StageOutput`, `StageResult` types in `src/commands/install/types.ts`
2. **Stage test utilities** - Create `__tests__/helpers/stage-test-utils.ts` with:
   - `createStageTestFixture(prefix)` - tmpdir setup
   - `mockGitOperations(operations)` - git mock factory
   - `runStageTwice(stage, input)` - idempotency helper
   - `assertStageResult(result, expected)` - assertion helper

3. **Ink test utilities** - Create `__tests__/helpers/ink-test-utils.ts` with:
   - `renderInkComponent(component)` - wrap ink-testing-library
   - `captureOutput(component)` - capture rendered output
   - `mockTerminalWidth(width)` - simulate different widths

### 3.2 Shared Test Patterns

**Idempotency Test Pattern** (applies to F-001, F-004):
```typescript
it("second run reports every step as skipped", async () => {
  await executeStage(input);  // First run
  const result2 = await executeStage(input);  // Second run
  expect(result2.steps.every(s => s.status === "skipped")).toBe(true);
});
```

**Dry-Run Test Pattern** (applies to F-001, F-004):
```typescript
it("dry-run does NOT mutate disk", async () => {
  const before = snapshotTree(target, ".fabric");
  await runCommand({ dryRun: true });
  const after = snapshotTree(target, ".fabric");
  expect(after).toEqual(before);
});
```

### 3.3 Test Data Management

**Fixture Strategy**:
- Reuse `cocos-stub` fixture for install/uninstall tests
- Create `store-fixtures/` for store-onboarding wizard tests:
  - `fresh-machine/` - No global config, no stores
  - `existing-global/` - Has `~/.fabric/config.json`
  - `team-url-available/` - Has `--url` flag scenario

---

## §4. File Index

| File | Purpose | Words |
|------|---------|-------|
| `analysis.md` | INDEX - Decision Digest + Cross-Cutting + File Index | ~800 |
| `analysis-F-001-install-stage-refactor.md` | Per-stage test strategy | ~600 |
| `analysis-F-002-ink-output-layer.md` | Ink component test strategy | ~500 |
| `analysis-F-003-store-onboarding-wizard.md` | Wizard flow test strategy | ~600 |
| `analysis-F-004-uninstall-symmetry.md` | Uninstall symmetry test strategy | ~500 |

---

## §5. TODOs

- [ ] Add `ink` and `@inkjs/testing-library` to `devDependencies`
- [ ] Create `src/commands/install/types.ts` with stage contract interfaces
- [ ] Create `__tests__/helpers/stage-test-utils.ts`
- [ ] Create `__tests__/helpers/ink-test-utils.ts`
- [ ] Write per-stage test files (7 files)
- [ ] Write wizard branching tests
- [ ] Write ink component snapshot tests
- [ ] Write uninstall symmetry tests

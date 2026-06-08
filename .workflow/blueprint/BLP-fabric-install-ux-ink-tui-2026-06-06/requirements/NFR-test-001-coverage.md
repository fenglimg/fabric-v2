# NFR-TEST-001: Coverage

**Priority**: MUST
**Category**: Non-Functional Requirement
**Status**: Draft

## Overview

This NFR defines testing coverage requirements for the Ink-based TUI refactor to ensure maintainability and reliability.

## Coverage Targets

### Overall Coverage

| Metric | Target | Tool |
|--------|--------|------|
| Line coverage | ≥ 80% | `jest --coverage` |
| Branch coverage | ≥ 75% | `jest --coverage` |
| Function coverage | ≥ 85% | `jest --coverage` |
| Mutation score | ≥ 70% | `stryker` |

### Per-Component Coverage

| Component Type | Target |
|----------------|--------|
| Ink components | ≥ 80% |
| Stage modules | ≥ 85% |
| Wizard state machine | ≥ 90% |
| Error handling | ≥ 95% |
| CLI entry points | ≥ 70% |

### Coverage by Priority

| Priority | Minimum Coverage |
|----------|-----------------|
| MUST features | ≥ 85% |
| SHOULD features | ≥ 75% |
| MAY features | ≥ 60% |

## Test Types

### Unit Tests

**Scope**: Individual components and functions

**Coverage**: 80% of total tests

**Tools**: `jest`, `ink-testing-library`

```typescript
// Example: VisualAnchor unit test
import { render } from 'ink-testing-library';
import { VisualAnchor } from '../VisualAnchor';

describe('VisualAnchor', () => {
  it('should render create glyph with green color', () => {
    const { lastFrame } = render(
      <VisualAnchor type="create" message="Creating .fabric/" />
    );
    expect(lastFrame()).toContain('[+]');
    expect(lastFrame()).toContain('Creating .fabric/');
  });

  it('should render error glyph with red color', () => {
    const { lastFrame } = render(
      <VisualAnchor type="failure" message="Permission denied" />
    );
    expect(lastFrame()).toContain('[✗]');
    expect(lastFrame()).toContain('Permission denied');
  });

  it('should render detail text dimmed', () => {
    const { lastFrame } = render(
      <VisualAnchor
        type="info"
        message="Detected client"
        detail="Claude Code v2.1.0"
      />
    );
    expect(lastFrame()).toContain('Claude Code v2.1.0');
  });
});
```

### Integration Tests

**Scope**: Multi-component interactions

**Coverage**: 15% of total tests

**Tools**: `jest`, real `.fabric/` directories

```typescript
// Example: Install stage integration test
import { execSync } from 'child_process';
import { mkdirSync, rmSync } from 'fs';

describe('Install Integration', () => {
  const testDir = './test-workspace';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should complete full installation flow', () => {
    const output = execSync(
      `fabric install --non-interactive --cd ${testDir}`,
      { encoding: 'utf-8' }
    );

    expect(output).toContain('[✓] Installation complete');
    expect(existsSync(`${testDir}/.fabric`)).toBe(true);
    expect(existsSync(`${testDir}/.fabric/fabric-config.json`)).toBe(true);
  });

  it('should resume from failed stage', () => {
    // Simulate partial install (Stage 3 fails)
    execSync(`fabric install --fail-at=3 --cd ${testDir}`);

    // Resume should pick up from Stage 3
    const output = execSync(
      `fabric install --resume-from=3 --cd ${testDir}`,
      { encoding: 'utf-8' }
    );

    expect(output).toContain('Resuming from Stage 3');
    expect(output).toContain('[✓] Installation complete');
  });
});
```

### E2E Tests

**Scope**: Full CLI workflows

**Coverage**: 5% of total tests

**Tools**: `playwright-cli`, real terminals

```typescript
// Example: E2E wizard test
import { launchTerminal, waitForOutput, sendInput } from 'playwright-cli';

describe('Wizard E2E', () => {
  it('should complete wizard flow with default options', async () => {
    const terminal = await launchTerminal('fabric install');

    // Wait for welcome screen
    await waitForOutput(terminal, 'Welcome to Fabric');
    await sendInput(terminal, '\n'); // Enter to proceed

    // Select personal store
    await waitForOutput(terminal, 'What kind of knowledge');
    await sendInput(terminal, '\n'); // Select first option

    // Confirm default scope
    await waitForOutput(terminal, 'How should this store be activated');
    await sendInput(terminal, '\n'); // Select first option

    // Verify completion
    await waitForOutput(terminal, '[✓] Installation complete');
  });
});
```

### Mutation Tests

**Scope**: Code quality validation

**Tool**: `stryker`

```json
// stryker.conf.json
{
  "$schema": "./node_modules/stryker-api/stryker-schema.json",
  "testRunner": "jest",
  "coverageAnalysis": "perTest",
  "mutate": [
    "src/components/**/*.ts",
    "src/stages/**/*.ts",
    "!src/**/*.test.ts"
  ],
  "thresholds": {
    "high": 80,
    "low": 70,
    "break": 70
  }
}
```

## Test Matrix

### Component Test Matrix

| Component | Unit | Integration | E2E | Mutation |
|-----------|------|-------------|-----|----------|
| VisualAnchor | ✓ | ✓ | - | ✓ |
| SummaryCard | ✓ | ✓ | ✓ | ✓ |
| ErrorDisplay | ✓ | ✓ | - | ✓ |
| ProgressBar | ✓ | - | - | ✓ |
| Wizard | ✓ | ✓ | ✓ | ✓ |
| Stage N | ✓ | ✓ | ✓ | ✓ |

### Scenario Test Matrix

| Scenario | Test Type | Priority |
|----------|-----------|----------|
| Fresh install | E2E | MUST |
| Resume from failure | Integration | MUST |
| Knowledge preservation | Integration | MUST |
| Error recovery | Integration | SHOULD |
| Wizard abandonment | E2E | SHOULD |
| Progress animation | Unit | MAY |

## Testing Infrastructure

### Test Directory Structure

```
packages/cli/src/
├── __tests__/
│   ├── unit/
│   │   ├── components/
│   │   │   ├── VisualAnchor.test.ts
│   │   │   ├── SummaryCard.test.ts
│   │   │   └── ErrorDisplay.test.ts
│   │   └── stages/
│   │       ├── stage-1.test.ts
│   │       └── stage-2.test.ts
│   ├── integration/
│   │   ├── install-flow.test.ts
│   │   ├── resume-flow.test.ts
│   │   └── wizard-flow.test.ts
│   ├── e2e/
│   │   ├── wizard-e2e.test.ts
│   │   └── install-e2e.test.ts
│   └── performance/
│   │   ├── render-perf.test.ts
│   │   └── memory-perf.test.ts
│   └── mocks/
│   │   ├── mockTerminal.ts
│   │   ├── mockFileSystem.ts
│   │   └── mockWizardState.ts
├── components/
├── stages/
└── wizards/
```

### Mock Utilities

```typescript
// packages/cli/src/__tests__/mocks/mockTerminal.ts
import { stdin as mockStdin, stdout as mockStdout } from 'mock-stdin';

export const mockTerminal = () => {
  const stdin = mockStdin();
  const stdout = mockStdout();

  return {
    stdin,
    stdout,
    sendKeys: (keys: string) => {
      stdin.send(keys);
    },
    getOutput: () => {
      return stdout.getContents();
    },
    clear: () => {
      stdout.clear();
    },
  };
};

// packages/cli/src/__tests__/mocks/mockFileSystem.ts
import { vol } from 'memfs';

export const mockFileSystem = (structure: Record<string, string>) => {
  vol.fromJSON(structure, '/test-workspace');
  return {
    read: (path: string) => vol.readFileSync(path, 'utf-8'),
    write: (path: string, content: string) => {
      vol.writeFileSync(path, content);
    },
    exists: (path: string) => vol.existsSync(path),
    reset: () => vol.reset(),
  };
};
```

### CI Integration

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: pnpm install
      - run: pnpm test:coverage
      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info
      - name: Check coverage thresholds
        run: |
          node scripts/check-coverage.js \
            --line=80 \
            --branch=75 \
            --function=85

  mutation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: pnpm install
      - run: pnpm test:mutation
      - name: Check mutation score
        run: |
          node scripts/check-mutation.js \
            --threshold=70
```

## Coverage Enforcement

### Pre-commit Hook

```bash
# .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run affected tests only (based on changed files)
pnpm test:affected --coverage

# Check coverage threshold
node scripts/check-coverage.js --staged
```

### PR Gate

```typescript
// scripts/check-coverage.js
const { readFileSync } = require('fs');
const coverage = JSON.parse(readFileSync('coverage/coverage-summary.json'));

const thresholds = {
  lines: 80,
  branches: 75,
  functions: 85,
};

const checkThreshold = (metric, threshold) => {
  if (coverage[metric].pct < threshold) {
    console.error(`❌ ${metric} coverage (${coverage[metric].pct}%) < ${threshold}%`);
    process.exit(1);
  }
  console.log(`✓ ${metric} coverage (${coverage[metric].pct}%) ≥ ${threshold}%`);
};

Object.entries(thresholds).forEach(([metric, threshold]) => {
  checkThreshold(metric, threshold);
});

console.log('✓ All coverage thresholds met');
```

## Coverage Exclusions

The following files are excluded from coverage requirements:

| Pattern | Rationale |
|---------|-----------|
| `*.test.ts` | Test files themselves |
| `*.types.ts` | Type-only files (no runtime code) |
| `index.ts` | Barrel exports (only imports) |
| `constants.ts` | Static constants only |
| `__mocks__/**` | Mock implementations |

```json
// jest.config.js
{
  "coveragePathIgnorePatterns": [
    "/node_modules/",
    ".test.ts",
    ".types.ts",
    "index.ts",
    "constants.ts",
    "__mocks__/"
  ]
}
```

## Traceability

| REQ | Coverage Target | Test Type |
|-----|-----------------|-----------|
| REQ-001 | ≥ 85% | Unit + Integration |
| REQ-002 | ≥ 80% | Unit (ink-testing-library) |
| REQ-003 | ≥ 90% | Unit (state machine) + E2E |
| REQ-004 | ≥ 85% | Integration (reverse-order) |
| REQ-005 | ≥ 80% | Unit (glyph rendering) |
| REQ-006 | ≥ 80% | Unit + Integration |
| REQ-007 | ≥ 95% | Unit (error classification) + Integration |
| REQ-008 | ≥ 60% | Unit (animation) |
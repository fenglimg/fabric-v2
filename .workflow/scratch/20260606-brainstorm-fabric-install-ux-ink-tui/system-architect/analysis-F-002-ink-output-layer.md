# F-002 — Ink Output Layer

> Role: system-architect | Related decisions: SA-02, SA-04

## Architecture

The OutputRenderer abstraction MUST replace the current three-system fragmentation (console.log / writeStderr / clack) with a unified React-based TUI. The ink framework provides declarative component composition, flexbox layout, and live-updating dashboards.

### Current State (Fragmented Output)

Analysis of `packages/cli/src/commands/install.ts` reveals three output mechanisms:

1. **console.log** — Primary output for scaffold results, capability tables, stage summaries (lines 1132, 1151, 1810, 1825, 1857)
2. **writeStderr** — Progress nudges, warnings, non-blocking messages (lines 1302, 1312, 1317, 1341, 2022)
3. **clack (intro/outro/log/note)** — Wizard prompts, grouped confirmations (lines 1440, 1442, 1450, 1461, 1553)

This fragmentation causes:
- Visual inconsistency (clack styling vs paint.* colors)
- No centralized theming
- Difficult to test output appearance
- Mixed React/clack paradigms prevent future config panel

### Target State (Unified OutputRenderer)

The OutputRenderer MUST provide a single interface for all user-facing output:

```
packages/cli/src/
├── output/
│   ├── renderer.ts              # OutputRenderer interface + createRenderer()
│   ├── ink-renderer.ts          # InkOutputRenderer implementation
│   ├── components/
│   │   ├── StepHeader.tsx       # "Step 1/7 Global Setup" header
│   │   ├── Spinner.tsx          # ora-style progress indicator
│   │   ├── SummaryCard.tsx      # boxen-bordered final summary
│   │   ├── ErrorBox.tsx         # Red-bordered error presentation
│   │   ├── Table.tsx            # Capability table replacement
│   │   └── ProgressBar.tsx      # File copy progress
│   └── theme.ts                 # Color palette from fabric-config.json
```

The `renderer.ts` MUST export the interface:

```typescript
export interface OutputRenderer {
  // Stage-level output
  stepHeader(stage: string, step: number, total: number): void;
  stageComplete(stage: string, result: StageResult): void;
  
  // Progress indicators
  spinner(operation: string): SpinnerHandle;
  progressBar(operation: string, total: number): ProgressHandle;
  
  // Final output
  summaryCard(data: SummaryData): void;
  errorBox(error: Error, recovery?: string): void;
  
  // Low-level primitives
  info(message: string): void;
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}
```

### Ink Integration

The `ink-renderer.ts` MUST implement OutputRenderer using ink components:

```typescript
import { render } from 'ink';
import React from 'react';

export class InkOutputRenderer implements OutputRenderer {
  private readonly config: RendererConfig;
  
  constructor(config: RendererConfig) {
    this.config = config;
  }
  
  stepHeader(stage: string, step: number, total: number): void {
    render(<StepHeader stage={stage} step={step} total={total} theme={this.config.theme} />);
  }
  
  spinner(operation: string): SpinnerHandle {
    const { unmount, rerender } = render(
      <Spinner text={operation} theme={this.config.theme} />
    );
    return {
      update: (message) => rerender(<Spinner text={message} theme={this.config.theme} />),
      succeed: (message) => { rerender(<Spinner text={message} type="success" />); setTimeout(unmount, 500); },
      fail: (message) => { rerender(<Spinner text={message} type="error" />); setTimeout(unmount, 1000); },
    };
  }
}
```

The **Spinner component** MUST use ink-spinner under the hood:

```typescript
import Spinner from 'ink-spinner';

export function Spinner({ text, type = 'spinner', theme }: SpinnerProps) {
  const color = type === 'success' ? theme.success : type === 'error' ? theme.error : theme.info;
  return (
    <Box>
      {type === 'spinner' && <Spinner type="dots" />}
      <Text color={color}> {text}</Text>
    </Box>
  );
}
```

### Migration Path

The refactoring MUST proceed in three phases:

**Phase 1: Abstraction Layer**
1. Create `OutputRenderer` interface in `renderer.ts`
2. Create `ConsoleOutputRenderer` that delegates to console.log/writeStderr (backward compat)
3. Inject renderer into `executeInitExecutionPlan` and `executeUninstallExecutionPlan`
4. All new code MUST use renderer; existing console.log calls remain

**Phase 2: Ink Implementation**
1. Install ink and @inkjs/ui dependencies
2. Create `InkOutputRenderer` with StepHeader, Spinner, SummaryCard components
3. Add `--ink` flag to install/uninstall for opt-in testing
4. Parallel-run both renderers; compare output visually

**Phase 3: Full Migration**
1. Switch default renderer to InkOutputRenderer
2. Remove ConsoleOutputRenderer
3. Retire clack usage; migrate wizard to ink components
4. Remove all console.log/writeStderr calls from install/uninstall

## Interface Contract

### SpinnerHandle

```typescript
export interface SpinnerHandle {
  update(message: string): void;
  succeed(message: string): void;
  fail(message: string): void;
}
```

### ProgressHandle

```typescript
export interface ProgressHandle {
  tick(): void;
  complete(): void;
  fail(error: Error): void;
}
```

### SummaryData

```typescript
export type SummaryData = {
  target: string;
  stages: Array<{ name: string; disposition: string }>;
  clients: DetectedClientSupport[];
  storeStatus?: {
    mounted: string;
    bound: boolean;
    writeTarget?: string;
  };
  nextSteps: string[];
};
```

### Consumers

- **All install/uninstall stages** — Use renderer.stepHeader, renderer.spinner, renderer.summaryCard
- **doctor command** — Use renderer.errorBox for lint failures
- **Future config command** — Use renderer for interactive configuration panel

## Constraints (RFC 2119)

1. **Ink for all user-facing output** — Stages MUST NOT call console.log, console.error, or process.stderr.write for user-visible messages. Internal logging MUST use a separate logger (debug-mode.ts).

2. **OutputRenderer abstraction** — All components MUST interact with OutputRenderer interface; ink-specific imports MUST be isolated to `ink-renderer.ts` and `components/`.

3. **@inkjs/ui for standard components** — The renderer SHOULD use @inkjs/ui for Box, Text, SelectInput, ConfirmInput. Custom components MUST extend these primitives.

4. **Clack retention during migration** — The wizard MAY continue using clack during Phase 1-2. Once ink components stabilize, the wizard MUST migrate to ink SelectInput/ConfirmInput.

5. **NO_COLOR support** — The renderer MUST check `process.env.NO_COLOR` and force monochrome mode when set.

6. **Theme configuration** — Color palette MUST be read from `.fabric/fabric-config.json` under `cli_theme` field. Defaults MUST match UI-04 specification.

7. **Spinner for long operations** — Operations expected to take >100ms MUST use renderer.spinner. The forensic scan, bootstrap hook installation, and file copies MUST display progress.

## Test Approach

### Component Tests

Each ink component MUST have a snapshot test:

```
tests/output/components/
├── StepHeader.test.tsx
├── Spinner.test.tsx
├── SummaryCard.test.tsx
├── ErrorBox.test.tsx
└── Table.test.tsx
```

Tests MUST use ink-testing-library:

```typescript
import { render } from 'ink-testing-library';

test('StepHeader renders step counter', () => {
  const { lastFrame } = render(<StepHeader stage="Global Setup" step={2} total={7} />);
  expect(lastFrame()).toMatch(/Step 2\/7.*Global Setup/);
});
```

### Integration Tests

`tests/output/ink-renderer.test.ts` MUST verify:

1. **Spinner lifecycle** — Create spinner, update message, succeed; assert output sequence
2. **Summary card rendering** — Pass SummaryData; assert boxen border, line count ≤15
3. **Error box presentation** — Pass error with recovery; assert red border, recovery message
4. **NO_COLOR mode** — Set env, render component; assert no ANSI color codes

### Visual Regression

Manual QA MUST verify:

1. **Terminal compatibility** — Test on Windows Terminal, macOS Terminal, iTerm2, VS Code terminal, Linux gnome-terminal
2. **Width responsiveness** — Test at 80, 120, 160 column widths; assert no text overflow
3. **Color contrast** — Verify theme colors meet WCAG AA contrast ratios

## TODOs

1. **Install ink dependencies** — Add ink, @inkjs/ui, ink-spinner, ink-testing-library to package.json.

2. **Create OutputRenderer interface** — Define `renderer.ts` with all method signatures.

3. **Implement ConsoleOutputRenderer** — Create initial implementation that wraps console.log/writeStderr for backward compatibility.

4. **Create StepHeader component** — Implement "Step N/M StageName" header with theme colors.

5. **Create Spinner component** — Wrap ink-spinner with handle API matching ora interface.

6. **Create SummaryCard component** — Implement boxen-bordered card with store status and next steps.

7. **Create ErrorBox component** — Implement red-bordered error card with recovery suggestion.

8. **Implement InkOutputRenderer** — Wire all components into renderer methods.

9. **Add --ink flag** — Allow opt-in testing of ink renderer in Phase 2.

10. **Migrate clack wizard** — Replace clack intro/outro/select/confirm with ink components in Phase 3.
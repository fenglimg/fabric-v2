# REQ-002: Ink Output Layer

**Priority**: MUST
**Feature ID**: F-002
**Status**: Draft

## User Story

**As a** Fabric CLI user
**I want** a consistent, modern terminal UI with React-style components
**So that** the installation experience is intuitive, visually appealing, and responsive across different terminal emulators.

## Context

The current CLI uses `console.log` with ad-hoc formatting, resulting in:
- Inconsistent visual presentation
- No support for interactive elements
- Poor handling of terminal resize events
- Limited color support across platforms

## Acceptance Criteria

### AC1: Ink Foundation

**GIVEN** the CLI output architecture
**WHEN** the refactor is complete
**THEN** the following dependencies MUST be installed and configured:

```json
{
  "dependencies": {
    "ink": "^4.0.0",
    "@inkjs/ui": "^2.0.0",
    "react": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "ink-testing-library": "^3.0.0"
  }
}
```

**AND** the package MUST export a root `<FabricApp>` component:

```tsx
// packages/cli/src/components/FabricApp.tsx
export const FabricApp: FC<FabricAppProps> = ({ command, args }) => {
  return (
    <AppContext.Provider value={context}>
      <ThemeContext.Provider value={theme}>
        <CommandRouter command={command} args={args} />
      </ThemeContext.Provider>
    </AppContext.Provider>
  );
};
```

### AC2: Cross-Platform Rendering

**GIVEN** Ink-based components
**WHEN** rendered in different terminal environments
**THEN** the following platforms MUST be supported:

| Platform | Terminal | Requirements |
|----------|----------|--------------|
| macOS | Terminal.app, iTerm2, Alacritty | Full color, emoji support |
| Linux | GNOME Terminal, Konsole, xterm | 256-color fallback |
| Windows | Windows Terminal, PowerShell, CMD | Windows-specific color handling |

**AND** color detection MUST use fallback chains:

```typescript
const theme = {
  colors: {
    primary: process.env.COLORTERM === 'truecolor' ? '#00D4AA' : 'green',
    error: process.env.COLORTERM === 'truecolor' ? '#FF4444' : 'red',
    warning: process.env.COLORTERM === 'truecolor' ? '#FFAA00' : 'yellow',
  }
};
```

### AC3: Component Library

**GIVEN** the Ink foundation
**WHEN** implementing CLI features
**THEN** the following reusable components MUST be available:

```tsx
// Core components
<Text color="primary" bold>Installation Complete</Text>
<Spinner type="dots" />
<ProgressBar value={75} max={100} />
<Select items={options} onSelect={handler} />
<Confirm message="Continue?" onConfirm={handler} />
<Box borderStyle="round" borderColor="primary">
  <Text>Content here</Text>
</Box>

// Custom components
<VisualAnchor stage={3} status="running" />
<SummaryCard results={stageResults} />
<ErrorDisplay error={err} context={ctx} />
<StageProgress current={3} total={7} />
```

### AC4: Streaming Output

**GIVEN** long-running operations (e.g., hook installation, knowledge sync)
**WHEN** the operation produces incremental output
**THEN** the UI MUST render updates in real-time without flickering
**AND** the render loop MUST NOT exceed 60 FPS
**AND** buffered output MUST be displayed with a maximum latency of 100ms.

**Implementation**:
```tsx
const StreamingOutput: FC<{ stream: Readable }> = ({ stream }) => {
  const [lines, setLines] = useState<string[]>([]);

  useStdoutDimensions(); // Re-render on resize

  useEffect(() => {
    const buffer: string[] = [];
    const flushBuffer = debounce(() => {
      setLines(prev => [...prev, ...buffer]);
      buffer.length = 0;
    }, 100);

    stream.on('data', (chunk) => {
      buffer.push(chunk.toString());
      flushBuffer();
    });

    return () => stream.removeAllListeners();
  }, [stream]);

  return (
    <Box flexDirection="column">
      {lines.slice(-10).map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
    </Box>
  );
};
```

## Technical Constraints

1. **MUST** support React 18+ concurrent features where applicable
2. **MUST** handle `SIGWINCH` (terminal resize) gracefully
3. **MUST** support `--no-color` and `FORCE_COLOR` environment variables
4. **SHOULD** minimize bundle size impact (tree-shakeable imports)
5. **MAY** support custom themes via configuration file

## Dependencies

- **REQ-001**: Stage refactor defines the execution model that Ink will render

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bundle size increase | MEDIUM | Tree-shaking, lazy load heavy components |
| Terminal compatibility edge cases | MEDIUM | Test matrix with real terminals, fallback modes |
| React learning curve for CLI developers | LOW | Provide component examples and documentation |

## Implementation Notes

- Use `ink-testing-library` for component unit tests
- Create a Storybook-like visual test harness for development
- Document color palette and theming in a separate design system doc

## Traceability

- **NFR-PERF-001**: 60 FPS render loop constraint
- **NFR-TEST-001**: Ink components can be tested with `ink-testing-library`
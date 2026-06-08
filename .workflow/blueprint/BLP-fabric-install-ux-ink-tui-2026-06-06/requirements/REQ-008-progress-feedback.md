# REQ-008: Progress Feedback

**Priority**: MAY
**Feature ID**: F-008
**Status**: Draft

## User Story

**As a** Fabric CLI user
**I want** visual progress indicators during long-running operations
**So that** I know the command is still working and haven't frozen.

## Context

Some installation steps (especially knowledge sync and hook installation) can take several seconds. Without visual feedback, users may think the CLI has hung and interrupt it prematurely.

## Acceptance Criteria

### AC1: Indeterminate Progress

**GIVEN** a stage with unknown duration
**WHEN** the stage is executing
**THEN** an animated progress indicator MUST be displayed:

```
Stage 4: Installing hooks...
  ⠋ Analyzing client configuration
```

**AND** the animation MUST use one of these spinner styles:

```typescript
const SPINNER_STYLES = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arrow: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
};
```

**AND** the animation MUST update at 80-120ms intervals.

### AC2: Determinate Progress

**GIVEN** a stage with known item count
**WHEN** processing items
**THEN** a progress bar MUST be displayed:

```
Stage 6: Syncing knowledge base...
  [████████░░░░░░░░] 8/15 entries (53%)
```

**AND** the progress bar MUST support:

```tsx
interface ProgressBarProps {
  current: number;
  total: number;
  label?: string;
  width?: number; // default: 20
}

const ProgressBar: FC<ProgressBarProps> = ({ current, total, label, width = 20 }) => {
  const percentage = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  return (
    <Box>
      <Text dimColor>[</Text>
      <Text color="cyan">{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
      <Text dimColor>]</Text>
      <Text> {current}/{total} {label} ({percentage}%)</Text>
    </Box>
  );
};
```

### AC3: Stage Transitions

**GIVEN** multiple stages executing in sequence
**WHEN** transitioning between stages
**THEN** a stage indicator MUST show progress:

```
Fabric Install
────────────────────────────────────────────────────────────
Progress: ●●●○○○○ Stage 3/7: Bootstrap

[+] Creating .fabric/ directory...
    [████████████████████] 100%
```

**AND** completed stages MUST be marked with `●` (filled circle)
**AND** pending stages MUST be marked with `○` (empty circle)
**AND** the current stage MUST be highlighted.

## Technical Constraints

1. **MUST** disable animations if `TERM=dumb` or `--no-animations` flag
2. **SHOULD** estimate remaining time for determinate progress
3. **MAY** support custom spinner themes via configuration

## Dependencies

- **REQ-002**: Ink provides animation primitives
- **NFR-PERF-001**: Animation frame rate must not impact performance

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Spinner animations cause CPU overhead | LOW | Test on low-power devices, allow disable |
| Progress estimation inaccurate | LOW | Use conservative estimates, update dynamically |

## Implementation Notes

- Use `ink-spinner` package for built-in spinner styles
- Create a `<StageProgress>` component that tracks stage execution
- Consider adding ETA estimation for long-running operations

## Traceability

- **NFR-PERF-001**: Animation frame rate constraint (60 FPS max)
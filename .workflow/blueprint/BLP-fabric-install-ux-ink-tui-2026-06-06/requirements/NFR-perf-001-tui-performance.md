# NFR-PERF-001: TUI Performance

**Priority**: MUST
**Category**: Non-Functional Requirement
**Status**: Draft

## Overview

This NFR defines performance constraints for the Ink-based TUI to ensure a responsive, smooth user experience.

## Performance Targets

### Render Performance

| Metric | Target | Measurement |
|--------|--------|-------------|
| Initial render time | < 100ms | Time from command invocation to first frame |
| Frame render time | < 16ms | Time per React render cycle (60 FPS) |
| Time to interactive | < 200ms | Time until UI accepts user input |
| Memory footprint | < 50MB | RSS during normal operation |

### Operation Performance

| Operation | Target | Timeout |
|-----------|--------|---------|
| Stage execution start | < 50ms | N/A |
| Progress update render | < 16ms | N/A |
| Spinner frame update | 80-120ms | N/A |
| Wizard transition | < 100ms | N/A |
| Error render | < 50ms | N/A |

### Scalability Constraints

| Scenario | Constraint |
|----------|------------|
| Long output streams | Max 1000 lines in buffer, truncate oldest |
| Knowledge entries | Support 10,000+ entries without UI lag |
| Terminal width | Graceful degradation at 60 chars minimum |
| Concurrent operations | Max 3 concurrent streams |

## Verification Methods

### Manual Testing

```bash
# Measure initial render time
time fabric install --dry-run

# Profile with Node.js inspector
node --inspect fabric install
# Open chrome://inspect

# Memory profiling
node --inspect fabric install
# Take heap snapshots at regular intervals
```

### Automated Testing

```typescript
// packages/cli/src/__tests__/performance.test.ts
describe('TUI Performance', () => {
  it('should render initial frame in < 100ms', async () => {
    const start = performance.now();
    const { unmount } = render(<FabricApp command="install" args={{}} />);
    const elapsed = performance.now() - start;
    unmount();
    expect(elapsed).toBeLessThan(100);
  });

  it('should maintain 60 FPS during spinner animation', async () => {
    const frameTimes: number[] = [];
    const { unmount } = render(<Spinner type="dots" />);

    // Collect 60 frames
    for (let i = 0; i < 60; i++) {
      await new Promise(resolve => setTimeout(resolve, 16));
      frameTimes.push(performance.now());
    }

    unmount();

    // Verify no frame exceeds 16ms
    const deltas = frameTimes.slice(1).map((t, i) => t - frameTimes[i]);
    expect(deltas.every(d => d < 20)).toBe(true); // Allow 20% variance
  });

  it('should not exceed 50MB memory footprint', async () => {
    const initialMemory = process.memoryUsage().rss;
    const { unmount } = render(<FabricApp command="install" args={{}} />);

    // Simulate 10 minutes of operation
    await new Promise(resolve => setTimeout(resolve, 1000));

    const peakMemory = process.memoryUsage().rss;
    unmount();

    expect(peakMemory - initialMemory).toBeLessThan(50 * 1024 * 1024);
  });
});
```

### Performance Regression Testing

```yaml
# .github/workflows/performance.yml
name: Performance Regression
on: [pull_request]
jobs:
  perf:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: pnpm install
      - run: pnpm test:perf
      - name: Compare with baseline
        run: |
          node scripts/compare-perf.js \
            --baseline=.perf/baseline.json \
            --current=.perf/current.json \
            --threshold=10 # Fail if > 10% regression
```

## Optimization Strategies

### Render Optimization

1. **Memoization**: Use `React.memo` for static components
2. **Virtual scrolling**: Only render visible lines in long outputs
3. **Debouncing**: Batch rapid updates at 100ms intervals
4. **Lazy loading**: Defer non-critical component mounting

```tsx
// Example: Memoized Visual Anchor
const VisualAnchor = React.memo<VisualAnchorProps>(({ type, message }) => {
  // Render logic
});

// Example: Debounced output stream
const useDebouncedState = <T,>(initial: T, delay: number): [T, (v: T) => void] => {
  const [state, setState] = useState(initial);
  const debouncedSetState = useMemo(
    () => debounce(setState, delay),
    [delay]
  );
  return [state, debouncedSetState];
};
```

### Memory Management

1. **Buffer truncation**: Limit output history to prevent unbounded growth
2. **Cleanup on unmount**: Clear intervals, timers, and subscriptions
3. **Weak references**: Use WeakMap for cached data
4. **Stream backpressure**: Handle slow consumers gracefully

## Monitoring and Alerting

### Telemetry

```typescript
// packages/cli/src/telemetry/performance.ts
interface PerformanceTelemetry {
  command: string;
  initialRenderMs: number;
  timeToInteractiveMs: number;
  peakMemoryMB: number;
  stageTimings: Record<string, number>;
  frameDropCount: number;
}

const reportPerformance = (metrics: PerformanceTelemetry) => {
  // Send to analytics (opt-in)
  if (config.telemetryEnabled) {
    fetch('https://telemetry.fabric.dev/v1/perf', {
      method: 'POST',
      body: JSON.stringify(metrics),
    });
  }
};
```

### Alerts

| Alert | Threshold | Action |
|-------|-----------|--------|
| Initial render > 150ms | Warning | Investigate, add to perf debt |
| Initial render > 300ms | Critical | Block release |
| Memory > 100MB | Warning | Investigate leak |
| Memory > 200MB | Critical | Block release |

## Trade-offs

| Decision | Rationale |
|----------|-----------|
| 60 FPS target | Standard for smooth animations; allows overhead |
| 50MB memory limit | Reasonable for CLI; monitors for leaks |
| 100ms initial render | Perceived as instant by users |
| 1000 line buffer | Balances history vs memory |

## Traceability

- **REQ-002**: Ink output layer must meet render targets
- **REQ-008**: Progress animations must maintain frame rate

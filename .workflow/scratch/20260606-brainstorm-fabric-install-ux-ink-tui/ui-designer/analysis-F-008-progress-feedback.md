# F-008: Progress Feedback Analysis (UI-04)

**Decision Reference**: UI-04 from guidance specification Section 6
**Priority**: MAY
**Dependencies**: SA-02 (ink architecture), SA-01 (stage lifecycle events), OutputRenderer interface

---

## 1. Component Specification

### 1.1 ProgressSpinner Component

**Purpose**: Provide visual feedback during CPU-heavy operations.

**Behavioral Constraints** (RFC 2119):
- MUST use ora-style spinner for forensic scan, bootstrap hooks
- MUST show "done in Xms" timing feedback
- SHOULD support multi-task progress (listr2-style) for concurrent operations
- MAY show percentage for file copy operations

**State Design**:

```
┌─ ProgressSpinner States ─────────────┐
│                                      │
│  RUNNING    │ ora spinner animation  │
│  ⠋ Scanning forensic cache...        │
│                                      │
│  SUCCESS    │ green checkmark        │
│  ✓ Done in 342ms                     │
│                                      │
│  ERROR      │ red X symbol           │
│  ✗ Failed after 5s                   │
│                                      │
│  TIMEOUT    │ yellow warning         │
│  ⚠ Timeout (>30s)                    │
│                                      │
└──────────────────────────────────────┘
```

**Spinner Styles** (ora compatible):

| Style | Animation | Use Case |
|-------|-----------|----------|
| **dots** | ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏ | Default |
| **line** | ─━│┃┃│━─ | Compact |
| **circle** | ◐◑◒◓ | Subtle |
| **arrow** | ←↑→↓ | Directional |

### 1.2 TimingDisplay Component

**Purpose**: Show operation duration for performance awareness.

**Behavioral Constraints** (RFC 2119):
- MUST show "done in Xms" for operations < 1s
- MUST show "done in X.Xs" for operations >= 1s
- SHOULD show stage timing in separator line
- MAY show total install timing in summary

**Timing Format**:

| Duration | Display | Example |
|----------|---------|---------|
| **< 100ms** | "Done in {ms}ms" | "Done in 89ms" |
| **100ms-1s** | "Done in {ms}ms" | "Done in 342ms" |
| **1s-10s** | "Done in {s.X}s" | "Done in 1.2s" |
| **>= 10s** | "Done in {m:X}s" | "Done in 12.3s" |
| **>= 60s** | "Done in {m}m{s}s" | "Done in 1m23s" |

### 1.3 MultiTaskProgress Component

**Purpose**: Show concurrent operations progress (listr2-style).

**Behavioral Constraints** (RFC 2119):
- SHOULD display multiple tasks in parallel
- SHOULD show task status (running/success/error)
- MAY show task dependencies
- MAY collapse completed tasks

**Visual Design**:

```
┌─ Multi-Task Progress ────────────────┐
│                                      │
│  [1/3] Creating UID...               │
│  ⠋ Running                           │
│                                      │
│  [2/3] Initializing store...         │
│  ○ Waiting for [1]                   │
│                                      │
│  [3/3] Writing config...             │
│  ○ Waiting for [2]                   │
│                                      │
└──────────────────────────────────────┘
```

### 1.4 PercentageProgress Component

**Purpose**: Show file copy/scan progress percentage.

**Behavioral Constraints** (RFC 2119):
- MAY show percentage for file operations
- MUST update progress smoothly (not jumpy)
- SHOULD show current file count
- MAY show remaining estimate

**Visual Design**:

```
┌─ Percentage Progress ────────────────┐
│                                      │
│  Copying hooks...                    │
│  ████████████░░░░░░░░ 67%            │
│  8/12 files                          │
│                                      │
└──────────────────────────────────────┘
```

---

## 2. Progress Events Integration

### 2.1 Stage Lifecycle Events

| Event | Timing | Visual Response |
|-------|--------|-----------------|
| **stage:start** | 0ms | Show spinner, update StepCounter |
| **stage:progress** | Every 100ms | Update spinner animation |
| **stage:complete** | Final | Show ✓ + timing |
| **stage:error** | On failure | Show ✗ + error (F-007) |
| **stage:timeout** | After 30s | Show warning |

### 2.2 CPU-Heavy Operations

Operations requiring spinner feedback:

| Operation | Typical Duration | Spinner Type |
|-----------|------------------|--------------|
| **Forensic scan** | 2-5s | dots (animated) |
| **Hook bootstrap** | 1-3s | dots |
| **Store clone** | 5-30s | line (network) |
| **UID generation** | 100ms | dots (fast) |
| **File copy** | Variable | percentage |

### 2.3 Threshold Rules

| Threshold | Behavior |
|-----------|----------|
| **< 50ms** | No spinner (instant) |
| **50-100ms** | Brief spinner flash |
| **100ms-30s** | Full spinner |
| **> 30s** | Spinner + timeout warning |

---

## 3. ASCII Wireframe

### 3.1 Single Spinner (inline)

```
  Step 3/7 [CLIENT] Hooks Bootstrap
  ├─ Running forensic scan...
  │  ⠋ Scanning .fabric/ (3s elapsed)
  ├─ Writing hooks...
  │  ✓ Done in 89ms
  ├─ Syncing MCP config...
  │  ⠙ Running (1.2s elapsed)
──────────────────────────────────────────────────────────────────────────────
```

### 3.2 Multi-Task Progress

```
  Step 4/7 [STORE] Store Onboarding
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ [1/3] Generating UID                                                    │
  │ ⠋ Running                                                               │
  │                                                                         │
  │ [2/3] Initializing personal store                                       │
  │ ○ Waiting for UID generation                                            │
  │                                                                         │
  │ [3/3] Configuring write target                                          │
  │ ○ Waiting for store init                                                │
  └─────────────────────────────────────────────────────────────────────────┘
──────────────────────────────────────────────────────────────────────────────
```

### 3.3 Percentage Progress

```
  Step 5/7 [PROJECT] Project Scaffold
  ├─ Copying template files...
  │  ████████████████░░░░░░ 80%
  │  16/20 files (~2s remaining)
──────────────────────────────────────────────────────────────────────────────
```

### 3.4 Timing Summary

```
  ✓ Step 7/7 [CLIENT] Post-Setup
──────────────────────────────────────────────────────────────────────────────
  
  Install Timing Summary:
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ Stage              │ Duration │ Status                                 │
  │────────────────────│──────────│────────────────────────────────────────│
  │ Global Layer       │   124ms  │ ✓                                      │
  │ Project Scaffold   │    89ms  │ ✓                                      │
  │ Hooks Bootstrap    │   1.2s   │ ✓                                      │
  │ Store Onboarding   │   342ms  │ ✓                                      │
  │ Client Config      │   156ms  │ ✓                                      │
  │ Post-Setup         │    23ms  │ ✓                                      │
  │────────────────────│──────────│────────────────────────────────────────│
  │ Total              │   1.9s   │ ✓                                      │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Component API Specification

### 4.1 ProgressSpinner Props

```typescript
interface ProgressSpinnerProps {
  text: string;                   // Spinner label
  status: 'running' | 'success' | 'error' | 'timeout';
  timing?: number;                // Duration when complete
  style?: 'dots' | 'line' | 'circle' | 'arrow';
  startTime?: number;             // Start timestamp
}
```

### 4.2 TimingDisplay Props

```typescript
interface TimingDisplayProps {
  duration: number;               // Duration in ms
  format?: 'auto' | 'ms' | 's' | 'm:s';
  label?: string;                 // Optional prefix
}
```

### 4.3 MultiTaskProgress Props

```typescript
interface MultiTaskProgressProps {
  tasks: TaskProgress[];          // Task list
  collapsed?: boolean;            // Collapse completed tasks
  showDependencies?: boolean;     // Show task dependencies
}

interface TaskProgress {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'success' | 'error';
  progress?: number;              // 0-100 percentage
  dependsOn?: string[];           // Dependency task IDs
}
```

### 4.4 PercentageProgress Props

```typescript
interface PercentageProgressProps {
  current: number;                // Current count
  total: number;                  // Total count
  label?: string;                 // Operation label
  showEstimate?: boolean;         // Show remaining time
}
```

---

## 5. Timing Aggregation

### 5.1 Stage Timing Collection

```typescript
interface StageTiming {
  stageId: string;
  stageName: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'success' | 'error' | 'skipped';
}
```

### 5.2 Total Timing Calculation

- Sum all stage durations
- Exclude skipped stages
- Include spinner overhead (negligible)

---

## 6. Edge Cases

### 6.1 Operation Timing Variations

| Scenario | Behavior |
|----------|----------|
| **Instant (<50ms)** | Skip spinner, show instant result |
| **Variable duration** | Adaptive spinner threshold |
| **Timeout (>30s)** | Warning + continue option |
| **Stuck spinner** | Heartbeat check + fallback |

### 6.2 Network Operations

| Network State | Spinner Behavior |
|---------------|------------------|
| **Connecting** | "Connecting..." spinner |
| **Progress** | Percentage if available |
| **Timeout** | Yellow warning + retry hint |
| **Error** | Red X + network error (F-007) |

### 6.3 Terminal Limitations

| Limitation | Fallback |
|------------|----------|
| **No animation support** | Static "Running..." text |
| **NO_COLOR env** | Monochrome symbols |
| **Slow terminal** | Reduce animation rate |

---

## 7. Implementation Recommendations

### 7.1 Technology Stack

- **ora**: Primary spinner library (Node.js)
- **ink `<Spinner>`**: ink-compatible spinner component
- **listr2**: Multi-task progress (optional)
- **chalk**: Timing color formatting

### 7.2 Spinner Integration

```typescript
// Pseudo-code for OutputRenderer integration
class OutputRenderer {
  progressSpinner(text: string): SpinnerHandle {
    return ora({ text, spinner: 'dots' }).start();
  }
  
  completeSpinner(spinner: SpinnerHandle, timing: number) {
    spinner.succeed(`Done in ${formatTiming(timing)}`);
  }
  
  errorSpinner(spinner: SpinnerHandle, error: Error) {
    spinner.fail(error.message);
  }
}
```

### 7.3 Timing Formatting

```typescript
function formatTiming(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m${s}s`;
}
```

---

## 8. Testing Strategy

### 8.1 Visual Tests

- [ ] Spinner animation snapshot
- [ ] Timing display formatting tests
- [ ] Multi-task progress layout tests
- [ ] Percentage progress rendering tests

### 8.2 Timing Tests

- [ ] Duration formatting (ms/s/m:s)
- [ ] Stage timing aggregation
- [ ] Total timing calculation
- [ ] Timeout detection

### 8.3 Integration Tests

- [ ] Spinner lifecycle (start→complete→success)
- [ ] Error spinner handling
- [ ] Multi-task dependency resolution
- [ ] Terminal compatibility tests

---

## 9. Integration Dependencies

| Dependency | Required From | Integration Point |
|------------|---------------|-------------------|
| Stage lifecycle | SA-01 | Progress event timing |
| OutputRenderer | SA-04 | Spinner mounting |
| Error handling | UI-03 | Error spinner state |
| Timing display | UI-02 | Summary card timing |

---

## 10. Future Enhancements (MAY)

- **Adaptive animation rate**: Slow down for slow terminals
- **Progress persistence**: Resume timing from interrupted install
- **Verbose timing**: Show detailed breakdown with --verbose
- **Export timing**: Save timing report to file for analysis
# F-005: Visual Anchor System Analysis (UI-01)

**Decision Reference**: UI-01 from guidance specification Section 6
**Priority**: SHOULD
**Dependencies**: SA-02 (ink architecture), OutputRenderer interface

---

## 1. Component Specification

### 1.1 StepCounter Component

**Purpose**: Provide visual progress tracking through 7-stage install pipeline.

**Behavioral Constraints** (RFC 2119):
- MUST display format: "Step {n}/7 {stage_name}"
- MUST update immediately when stage transitions
- MUST show completion state with green checkmark when stage succeeds
- SHOULD use cyan bold styling for active stage
- MAY show elapsed time per stage in debug mode

**State Design**:

```
┌─ StepCounter States ─────────────────┐
│                                      │
│  PENDING    │ gray, dim              │
│  "Step 1/7 Global Layer"             │
│                                      │
│  ACTIVE     │ cyan, bold             │
│  "Step 1/7 Global Layer"             │
│                                      │
│  COMPLETED  │ green + checkmark      │
│  "✓ Step 1/7 Global Layer"           │
│                                      │
│  ERROR      │ red + X symbol         │
│  "✗ Step 1/7 Global Layer"           │
│                                      │
└──────────────────────────────────────┘
```

**Implementation Notes**:
- Use ink `<Text>` component with conditional color/styling
- Stage name mapping from SA-01 stage definitions
- Counter state managed by OutputRenderer context

### 1.2 StageSeparator Component

**Purpose**: Create visual boundary between pipeline stages.

**Behavioral Constraints** (RFC 2119):
- MUST render 1-line separator after each stage (except final)
- MUST use consistent horizontal rule character
- SHOULD adapt to terminal width
- MAY show stage duration in separator

**Visual Design**:

```
Standard separator (80+ cols):
────────────────────────────────────────────────────────────────────────────────

Compact separator (<80 cols):
──────

With timing:
────────────────────────────────────────────── done in 342ms
```

**Implementation Notes**:
- Use ink `<Box>` with border styling
- Timing integration from UI-04 ProgressSpinner events

### 1.3 BrandedLogo Component

**Purpose**: Establish Fabric brand identity at install start.

**Behavioral Constraints** (RFC 2119):
- MUST display ASCII logo at install flow entry
- MUST use consistent logo design (not per-flow variation)
- SHOULD center logo within available width
- MAY animate on first-run experience

**ASCII Logo Design**:

```
┌─ Fabric ASCII Logo ──────────────────┐
│                                      │
│     ╔══════════════════════════╗     │
│     ║   FABRIC                  ║     │
│     ║   Knowledge Layer         ║     │
│     ╚══════════════════════════╝     │
│                                      │
└──────────────────────────────────────┘

Compact version (<80 cols):
┌─ Fabric ──┐
│  v2.0.1   │
└───────────┘
```

**Implementation Notes**:
- Use ink `<Box>` + `<Text>` composition
- Version string from package.json
- NO_COLOR support: use box characters without color

### 1.4 StageBadge Component

**Purpose**: Scope color-coding for stage headers.

**Behavioral Constraints** (RFC 2119):
- MUST use consistent color per scope category
- MUST display badge inline with stage name
- SHOULD use muted badge style for completed stages
- MAY support custom scope colors via config

**Color Mapping**:

```
┌─ Scope Color System ─────────────────┐
│                                      │
│  GLOBAL     │ blue (#3b82f6)         │
│  PROJECT    │ green (#22c55e)        │
│  CLIENT     │ purple (#a855f7)       │
│  STORE      │ cyan (#06b6d4)         │
│                                      │
└──────────────────────────────────────┘
```

**Badge Format**:
- `[GLOBAL]` blue background, white text
- `[PROJECT]` green background, white text
- `[CLIENT]` purple background, white text

---

## 2. User Flow Integration

### 2.1 Install Flow Sequence

```
┌─ Install Flow Visual Anchors ────────┐
│                                      │
│  1. Entry: BrandedLogo               │
│     ┌──────────────────────┐         │
│     │    FABRIC v2.0.1     │         │
│     └──────────────────────┘         │
│                                      │
│  2. Pipeline: StepCounter sequence   │
│     Step 1/7 [GLOBAL] Global Layer   │
│     ───────────────────────          │
│     Step 2/7 [PROJECT] Scaffold      │
│     ───────────────────────          │
│     ...                              │
│     ✓ Step 7/7 [CLIENT] Post-Setup   │
│                                      │
│  3. Exit: SummaryCard (F-006)        │
│                                      │
└──────────────────────────────────────┘
```

### 2.2 Stage Transition Behavior

| Event | Visual Response | Timing |
|-------|-----------------|--------|
| Stage start | StepCounter → ACTIVE | Immediate |
| Stage complete | StepCounter → COMPLETED | Immediate |
| Stage fail | StepCounter → ERROR | Immediate |
| Stage timeout | Show spinner state | After 100ms |

---

## 3. ASCII Wireframe

### 3.1 Full Width Layout (100+ cols)

```
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║                           FABRIC v2.0.1                                      ║
║                        Knowledge Layer for AI                                ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝

  Step 1/7 [GLOBAL] Global Layer Setup
  ├─ Creating UID: fabric-abc123...
  ├─ Initializing personal store...
  ✓ Done in 124ms
──────────────────────────────────────────────────────────────────────────────────

  Step 2/7 [PROJECT] Project Scaffold
  ├─ Creating .fabric/ directory...
  ├─ Writing agents.meta.json...
  ✓ Done in 89ms
──────────────────────────────────────────────────────────────────────────────────

  [... stages 3-6 ...]

  ✓ Step 7/7 [CLIENT] Post-Setup Guidance
──────────────────────────────────────────────────────────────────────────────────
```

### 3.2 Compact Layout (80 cols)

```
┌─ Fabric v2.0.1 ─┐
└─────────────────┘

Step 1/7 Global Layer
├─ UID: fabric-abc123
├─ Personal store...
✓ 124ms
─────────────────────

Step 2/7 Project Scaffold
├─ .fabric/ directory
├─ agents.meta.json
✓ 89ms
─────────────────────

[... compact stages ...]
```

### 3.3 Minimal Layout (<80 cols)

```
Fabric v2.0.1

[1/7] Global Layer ✓
[2/7] Project Scaffold ✓
[3/7] Hooks Bootstrap ✓
...
[7/7] Post-Setup ✓
```

---

## 4. Component API Specification

### 4.1 StepCounter Props

```typescript
interface StepCounterProps {
  current: number;        // Current stage number (1-7)
  total: number;          // Total stages (7)
  stageName: string;      // Stage display name
  status: 'pending' | 'active' | 'completed' | 'error';
  scope: 'global' | 'project' | 'client' | 'store';
  timing?: number;        // Stage duration in ms
}
```

### 4.2 StageSeparator Props

```typescript
interface StageSeparatorProps {
  width?: number;         // Terminal width (auto-detect if omitted)
  timing?: number;        // Stage duration to display
  showTiming?: boolean;   // Whether to show timing
}
```

### 4.3 BrandedLogo Props

```typescript
interface BrandedLogoProps {
  version: string;        // Fabric version from package.json
  width?: number;         // Terminal width for centering
  compact?: boolean;      // Use compact logo variant
}
```

---

## 5. Edge Cases

### 5.1 Width Constraints

| Scenario | Behavior |
|----------|----------|
| **Terminal < 60 cols** | Fallback to inline counters only |
| **NO_COLOR env** | Remove all color, retain ASCII structure |
| **Unicode unavailable** | Use ASCII alternatives (✓→[OK], ✗→[FAIL]) |

### 5.2 Error States

| Error Type | Visual Response |
|------------|-----------------|
| **Stage failure** | Red StepCounter, ErrorBox (F-007) |
| **Timeout** | Spinner → X, timing display |
| **Interrupt** | Gray incomplete state, resume hint |

### 5.3 Resume Flow

When `fabric install --resume` is called:
- MUST show previously completed stages with ✓
- MUST highlight interrupted stage
- MUST show "Resuming from Step X/7" message

---

## 6. Integration Dependencies

| Dependency | Required From | Integration Point |
|------------|---------------|-------------------|
| Stage definitions | SA-01 | StepCounter stageName mapping |
| OutputRenderer | SA-04 | Component mounting context |
| Progress events | UI-04 | Timing integration |
| Error mapping | UI-03 | Error state styling |

---

## 7. Implementation Recommendations

### 7.1 Technology Stack

- **ink `<Box>`**: Container layout for separators
- **ink `<Text>`**: Text rendering with color/styling
- **chalk**: Color utility (fallback if ink unavailable)
- **boxen**: Border styling for logo

### 7.2 Testing Strategy

- [ ] Visual snapshot tests for each width variant
- [ ] State transition tests (pending→active→completed)
- [ ] NO_COLOR environment test
- [ ] Unicode fallback test

### 7.3 Documentation

- Component usage examples in OutputRenderer docs
- Color palette reference in design token system
- ASCII wireframe as visual spec reference
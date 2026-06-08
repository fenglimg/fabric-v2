# F-007: Error Presentation Analysis (UI-03)

**Decision Reference**: UI-03 from guidance specification Section 6
**Priority**: SHOULD
**Dependencies**: SA-02 (ink architecture), SA-04 (failure_mode mapping), OutputRenderer interface

---

## 1. Component Specification

### 1.1 ErrorBox Component

**Purpose**: Upgrade error visual weight to ensure users recognize blocking failures.

**Behavioral Constraints** (RFC 2119):
- MUST use boxen-style red border for blocking errors
- MUST display prominent X symbol
- MUST provide recovery suggestion in error card
- SHOULD differentiate warnings (yellow) from errors (red)
- MAY categorize errors by type (network, permission, validation)

**State Design**:

```
┌─ ErrorBox States ────────────────────┐
│                                      │
│  ERROR (blocking)                    │
│  ┌─────────────────────────────────┐ │
│  │ ✗ Stage 3 Failed                │ │
│  │                                 │ │
│  │ Hook bootstrap failed:          │ │
│  │ Permission denied writing to    │ │
│  │ .claude/hooks/                  │ │
│  │                                 │ │
│  │ Recovery:                       │ │
│  │ Check folder permissions or     │ │
│  │ run with --force flag           │ │
│  └─────────────────────────────────┘ │
│  Red border, X symbol, recovery     │
│                                      │
│  WARNING (non-blocking)             │
│  ┌─────────────────────────────────┐ │
│  │ ⚠ Store bind skipped            │ │
│  │                                 │ │
│  │ No store URL provided.          │ │
│  │ Run `fabric store wizard`       │ │
│  │ to configure later.             │ │
│  └─────────────────────────────────┘ │
│  Yellow border, warning symbol      │
│                                      │
└──────────────────────────────────────┘
```

### 1.2 RecoverySuggestion Component

**Purpose**: Guide users toward actionable fix.

**Behavioral Constraints** (RFC 2119):
- MUST show specific recovery action for each error type
- MUST use imperative phrasing ("Run X", "Check Y")
- SHOULD link to documentation when available
- MAY show alternative recovery paths

**Recovery Template**:

```
┌─ Recovery Suggestion Format ─────────┐
│                                      │
│  Primary: "Check {context}"          │
│  Alternative: "Or run with {flag}"   │
│  Documentation: "See docs: {url}"    │
│                                      │
│  Example:                            │
│  Recovery:                           │
│  ├─ Check .claude/ permissions       │
│  ├─ Or run: fabric install --force   │
│  └─ Docs: fabric.dev/errors#E03     │
│                                      │
└──────────────────────────────────────┘
```

### 1.3 ErrorType Classification

**Purpose**: Map errors to visual treatment and recovery paths.

**Behavioral Constraints** (RFC 2119):
- MUST classify errors into severity categories
- MUST map each category to visual style
- SHOULD provide recovery suggestion per category
- MAY support custom error types via config

**Error Categories**:

| Type | Severity | Border | Symbol | Recovery |
|------|----------|--------|--------|----------|
| **drift-abort** | blocking | red | ✗ | Re-run with --force |
| **permission-denied** | blocking | red | ✗ | Check folder permissions |
| **network-error** | blocking | red | ✗ | Check connectivity, retry |
| **validation-failed** | blocking | red | ✗ | Fix input, re-run |
| **store-bind-failed** | blocking | red | ✗ | Check URL, run wizard |
| **partial-failure** | warning | yellow | ⚠ | Resume with --resume |
| **skipped-stage** | info | gray | ○ | Manual setup required |

---

## 2. Visual Design

### 2.1 Error Box Layout (Full Width)

```
╔══════════════════════════════════════════════════════════════════════════╗
║  ✗ ERROR: Hook Bootstrap Failed                                         ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Stage 3/7 failed during execution                                       ║
║                                                                          ║
║  Error Details:                                                          ║
║  Permission denied: cannot write to .claude/hooks/                       ║
║  Directory owned by another process                                      ║
║                                                                          ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Recovery Options:                                                       ║
║  1. Check directory permissions: ls -la .claude/hooks/                   ║
║  2. Or run with elevated privileges                                      ║
║  3. Or force overwrite: fabric install --force                           ║
║                                                                          ║
║  Documentation: https://fabric.dev/errors#E03-permission                 ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### 2.2 Warning Box Layout

```
╔══════════════════════════════════════════════════════════════════════════╗
║  ⚠ WARNING: Store Bind Skipped                                          ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  No team store URL was provided during install                           ║
║  Knowledge will be stored locally only                                   ║
║                                                                          ║
║  To configure a shared store later:                                      ║
║  fabric store wizard                                                     ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### 2.3 Compact Error Display

```
✗ ERROR: Hook Bootstrap Failed
Permission denied: cannot write to .claude/hooks/
→ Check permissions or run: fabric install --force
```

---

## 3. Error Flow Integration

### 3.1 Error Detection Sequence

```
┌─ Error Flow ──────────────────────────┐
│                                       │
│  1. Stage execution                   │
│     └─ Error detected                 │
│                                       │
│  2. Error classification              │
│     ├─ Type: permission-denied        │
│     ├─ Severity: blocking             │
│     └─ Recovery: check permissions    │
│                                       │
│  3. Visual response                   │
│     ├─ StepCounter → ERROR state      │
│     ├─ Display ErrorBox               │
│     └─ Show RecoverySuggestion        │
│                                       │
│  4. User decision                     │
│     ├─ Retry with fix                 │
│     ├─ Force override                 │
│     └─ Abort                          │
│                                       │
└───────────────────────────────────────┘
```

### 3.2 Drift-Abort Handling (from guidance)

**Drift-abort** is a special error type when local config differs from expected.

```
╔══════════════════════════════════════════════════════════════════════════╗
║  ✗ ERROR: Configuration Drift Detected                                  ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Local .fabric/ differs from expected state                              ║
║                                                                          ║
║  Drift Details:                                                          ║
║  ├─ agents.meta.json modified locally                                    ║
║  ├─ Expected: 3 hooks, Found: 2 hooks                                    ║
║  ├─ Modified: 2026-06-05 14:32                                          ║
║                                                                          ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Recovery Options:                                                       ║
║  1. Review changes: cat .fabric/agents.meta.json                         │
║  2. Accept drift: fabric install --force                                 │
║  3. Reset to expected: rm .fabric/ && fabric install                     ║
║                                                                          ║
║  ⚠ Warning: --force will overwrite local modifications                   ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## 4. Component API Specification

### 4.1 ErrorBox Props

```typescript
interface ErrorBoxProps {
  type: ErrorType;                // Error classification
  severity: 'blocking' | 'warning' | 'info';
  title: string;                  // Error title
  details: string;                // Error description
  context?: string;               // Additional context
  recovery: RecoveryOption[];     // Recovery suggestions
  documentation?: string;         // Docs URL
  compact?: boolean;              // Compact mode flag
}
```

### 4.2 RecoveryOption Type

```typescript
interface RecoveryOption {
  priority: number;               // Option priority (1=primary)
  action: string;                 // Action description
  command?: string;               // Command to run
  warning?: string;               // Warning text if destructive
}
```

### 4.3 ErrorType Enum

```typescript
type ErrorType = 
  | 'drift-abort'
  | 'permission-denied'
  | 'network-error'
  | 'validation-failed'
  | 'store-bind-failed'
  | 'partial-failure'
  | 'skipped-stage';
```

---

## 5. Error Recovery Matrix

### 5.1 Blocking Errors

| Error Type | Primary Recovery | Alternative | Destructive? |
|------------|------------------|-------------|--------------|
| **drift-abort** | Review changes | --force override | Yes (--force) |
| **permission-denied** | Check permissions | --force overwrite | Yes (--force) |
| **network-error** | Check connectivity | Retry later | No |
| **validation-failed** | Fix input | Re-run wizard | No |
| **store-bind-failed** | Check URL | Run wizard | No |

### 5.2 Non-Blocking Errors

| Warning Type | Action | Follow-up |
|--------------|--------|-----------|
| **partial-failure** | Resume with --resume | Fix remaining stages |
| **skipped-stage** | Manual setup | Run wizard later |
| **deprecated-config** | Update config | See migration docs |

---

## 6. Edge Cases

### 6.1 Multiple Errors

When multiple errors occur:
- MUST display first blocking error prominently
- SHOULD list remaining errors as summary
- MAY show "N errors detected" with expand option

```
╔══════════════════════════════════════════════════════════════════════════╗
║  ✗ ERROR: Stage 3 Failed (3 errors total)                               ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Primary Error:                                                          ║
║  Permission denied: cannot write to .claude/hooks/                       ║
║                                                                          ║
║  Additional Errors:                                                      ║
║  ├─ Hook sync failed (network)                                          ║
║  ├─ MCP config write failed (permission)                                ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

### 6.2 NO_COLOR Environment

- MUST retain error structure without colors
- MUST use ASCII symbols (✗→[X], ⚠→[!])
- MUST retain visual hierarchy via spacing/borders

```
[X] ERROR: Hook Bootstrap Failed
========================================
Permission denied: cannot write to .claude/hooks/
Recovery: Check permissions or run: fabric install --force
```

### 6.3 Compact Mode

```
✗ Hook Bootstrap Failed: Permission denied
→ Check permissions or --force
```

---

## 7. ASCII Wireframe

### 7.1 Standard Error Display

```
╔══════════════════════════════════════════════════════════════╗
║  ✗ ERROR: Hook Bootstrap Failed                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Stage 3/7 failed                                            ║
║                                                              ║
║  Permission denied: cannot write to .claude/hooks/           ║
║                                                              ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Recovery:                                                   ║
║  1. Check permissions: ls -la .claude/hooks/                 ║
║  2. Or force: fabric install --force                         ║
║                                                              ║
║  Docs: fabric.dev/errors#E03                                 ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

### 7.2 Inline Error (during stage)

```
  Step 3/7 [CLIENT] Hooks Bootstrap
  ├─ Writing hooks to .claude/hooks/...
  ✗ Permission denied (blocking error)
──────────────────────────────────────────────────────────────────────────────
```

---

## 8. Integration Dependencies

| Dependency | Required From | Integration Point |
|------------|---------------|-------------------|
| Stage lifecycle | SA-01 | Error timing/position |
| Failure mode mapping | SA-04 | ErrorType classification |
| StepCounter | UI-01 | Error state display |
| Recovery docs | UX-03 | Documentation links |

---

## 9. Implementation Recommendations

### 9.1 Technology Stack

- **ink `<Box>`**: Error container with red border
- **ink `<Text>`**: Error content rendering
- **boxen**: Bordered error styling
- **chalk**: Color differentiation (red/yellow)

### 9.2 Testing Strategy

- [ ] Visual snapshot for each error type
- [ ] Multiple errors aggregation test
- [ ] NO_COLOR fallback test
- [ ] Compact mode test
- [ ] Recovery suggestion validation

### 9.3 Error Logging

- Log error details to `.fabric/logs/install.log`
- Include timestamp, error type, recovery path
- Support `fabric doctor --error-log` for debugging
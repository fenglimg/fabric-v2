# UX Expert Analysis: F-007 Error Presentation

KB: none [not-applicable]

## 1. Feature Overview

**Feature ID**: F-007
**Slug**: error-presentation
**Guidance Decision**: UX-03 — MUST upgrade error presentation for drift-abort and critical failures
**UI Decision**: UI-04 — MUST establish consistent color palette (error=red)

## 2. User Experience Assessment

### 2.1 Current State Analysis

Current error handling patterns (install.ts:1341, uninstall.ts:528):
```
writeStderr(formatInitStageFailure(stageName, error));
writeStderr(formatUninstallStageFailure(stage.name, error));
```

Current formatInitStageFailure output:
```
<stage name> failed: <error message>
```

**Current Friction Points**:
1. **Errors blend into stream**: writeStderr outputs plain text
2. **No visual weight**: No border or symbol distinction
3. **No recovery guidance**: Only shows error, no fix suggestion
4. **No blocking differentiation**: All errors look the same

### 2.2 Error Classification

| Error Type | Severity | Current Treatment | Target Treatment |
|------------|----------|-------------------|------------------|
| Drift-abort | Critical | writeStderr plain | Boxen red border + recovery |
| Git clone failure | Recoverable | writeStderr plain | Yellow warning + retry |
| MCP install failure | Non-blocking | writeStderr plain | Continue + log |
| Hook script failure | Non-blocking | writeStderr plain | Continue + log |

### 2.3 Journey Impact Analysis

| Scenario | Current User Response | Target User Response |
|----------|----------------------|----------------------|
| Drift-abort | Confusion, manual cleanup | Clear recovery path |
| Clone failure | Retry manually | Prompted retry/skip |
| MCP failure | Ignore | Continue with warning |

## 3. Interaction Design Analysis

### 3.1 Error Card Specification

```
┌─────────────────────────────────────────────────┐
│ ✗ Error: Bootstrap Failed                       │
├─────────────────────────────────────────────────┤
│                                                 │
│ Reason: .fabric/agents.md has local changes     │
│ that differ from canonical template.            │
│                                                 │
│ Recovery:                                       │
│   1. Run 'fabric uninstall' to clean scaffold   │
│   2. Re-run 'fabric install'                    │
│                                                 │
│ Or preserve your changes:                       │
│   • Commit current .fabric/agents.md            │
│   • Re-run install (will preserve existing)     │
└─────────────────────────────────────────────────┘
```

### 3.2 Error Visual Weight Requirements

| Requirement | UX-03 Constraint |
|-------------|------------------|
| Border style | MUST use boxen-style red border |
| Symbol | MUST display prominent ✗ symbol |
| Recovery | MUST provide recovery suggestion in card |
| Differentiation | MUST differentiate warnings (yellow) from errors (red) |

### 3.3 Error Message Structure

| Section | Content | Priority |
|---------|---------|----------|
| Header | ✗ Error: <stage> Failed | P1 |
| Reason | What went wrong | P1 |
| Recovery | How to fix | P1 |
| Alternative | Other options | P2 |

### 3.4 Blocking vs Non-blocking Logic

| Error Class | Behavior | Visual |
|-------------|----------|--------|
| Blocking (critical) | MUST abort pipeline | Red boxen |
| Recoverable | MUST offer retry/skip | Yellow warning |
| Non-blocking | MUST continue + log | Inline warning |

## 4. Usability & Accessibility

### 4.1 Heuristic Evaluation

| Heuristic | Current | Target | Gap |
|-----------|---------|--------|-----|
| Error prevention | Good | Good | Drift detection works |
| Help users recognize errors | Weak | Strong | Visual weight |
| Help users recover from errors | Weak | Strong | Recovery suggestion |
| Visibility of system status | Weak | Strong | Error prominence |

### 4.2 Error Prevention Strategy

| Prevention | Implementation |
|------------|----------------|
| Pre-flight checks | Validate before execution |
| Idempotent design | Re-run safe |
| Graceful degradation | Non-blocking continue |

### 4.3 Recovery-First Pattern

- **Pattern**: Show recovery before diagnosis
- **Rationale**: Users need "how to fix" more than "what broke"
- **UX-E2**: Error MUST prioritize recovery over diagnosis

## 5. Design System Integration

### 5.1 Component Pattern Requirements

| Component | Source | Requirement |
|-----------|--------|-------------|
| Error box | boxen | MUST use red border |
| Warning box | boxen | MUST use yellow border |
| Error symbol | Unicode | MUST use ✗ |
| Warning symbol | Unicode | MUST use ⚠ |
| Recovery text | Template | MUST use structured format |

### 5.2 Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| Error border | red (boxen) | Critical errors |
| Warning border | yellow (boxen) | Recoverable warnings |
| Error symbol | ✗ | Error header |
| Warning symbol | ⚠ | Warning header |
| Recovery header | "Recovery:" | Recovery section |

### 5.3 Color Palette Integration (UI-04)

| Color | Usage | Hex/ANSI |
|-------|-------|----------|
| Red | Critical errors | ANSI 31 |
| Yellow | Recoverable warnings | ANSI 33 |
| Green | Success | ANSI 32 |
| Cyan | Info | ANSI 36 |

### 5.4 Interaction Consistency

- MUST use paint.error for error messages
- MUST match existing formatInitStageFailure pattern
- MUST support NO_COLOR environment variable (UI-04)

## 6. Testing & Validation Strategy

### 6.1 Error Flow Testing

| Test Case | Expected Behavior |
|-----------|-------------------|
| Drift-abort | Red boxen + recovery suggestion |
| Clone failure | Yellow warning + retry/skip options |
| MCP failure | Inline warning + continue |
| Hook failure | Inline warning + continue |
| NO_COLOR env | No color output |

### 6.2 Success Metrics

| Metric | Target |
|--------|--------|
| User understands error | >95% (clear visual) |
| User attempts recovery | >80% (recovery suggestion) |
| Recovery success rate | >90% (re-run install) |

### 6.3 Iteration Plan

1. Define error classification (blocking/recoverable/non-blocking)
2. Design error card template with boxen
3. Implement recovery suggestion templates
4. Add yellow warning differentiation
5. Test NO_COLOR support
6. Validate UX-E2 (recovery-first)

## 7. Recommendations

### 7.1 UX Optimization Strategies

1. **Use boxen-style red border for blocking errors** (UX-03 MUST)
2. **Add recovery suggestion in error card** (UX-03 MUST)
3. **Differentiate warnings from errors** (UX-03 SHOULD)

### 7.2 Interaction Design Improvements

1. **Show recovery before diagnosis** (UX-E2)
2. **Use prominent ✗ symbol** (UX-03 MUST)
3. **Support NO_COLOR for accessibility** (UI-04 SHOULD)

### 7.3 Implementation Priorities

| Priority | Item | Rationale |
|----------|------|-----------|
| P1 | Error card template | Visual weight foundation |
| P1 | Recovery suggestion | UX-03 requirement |
| P2 | Warning differentiation | Severity clarity |
| P2 | NO_COLOR support | Accessibility |
| P3 | Alternative options | Polish |

---

**Guidance Reference**: UX-03 (§5), UI-04 (§6)
**Related UI Decisions**: UI-01 (visual anchors)
**Error Types**: drift-abort, git clone failure, MCP install failure, hook script failure
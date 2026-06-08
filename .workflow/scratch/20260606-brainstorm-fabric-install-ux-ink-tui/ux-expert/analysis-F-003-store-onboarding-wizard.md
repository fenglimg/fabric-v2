# UX Expert Analysis: F-003 Store Onboarding Wizard

KB: none [not-applicable]

## 1. Feature Overview

**Feature ID**: F-003
**Slug**: store-onboarding-wizard
**Guidance Decision**: UX-01 — MUST implement interactive wizard in store-onboarding stage

## 2. User Experience Assessment

### 2.1 Current State Analysis

The current `promptStoreOnboarding()` function (install.ts:581-598) provides:
- Single select prompt with three options (skip/join/create)
- Idempotent behavior (skips if active_write_store exists)
- Clean cancellation handling

**Current Friction Points**:
1. **No context explanation**: Users see prompt without understanding what "store" means
2. **No auto-detect feedback**: Wizard doesn't show detected context state
3. **No URL fast-path explanation**: --url flag silently joins without wizard

### 2.2 Journey Implications

| User Scenario | Current Journey | Target Journey |
|---------------|-----------------|----------------|
| Fresh machine | Direct prompt | Detect + explain + prompt |
| Team URL provided | --url auto-join (silent) | Auto-join + success feedback |
| Existing active_write_store | Silent skip | Skip + status summary |

### 2.3 Interaction Complexity

- **Decision count**: 1-2 (context explanation + selection)
- **Input type**: Select (no free-form text)
- **Branching**: 3 paths (skip/join/create)
- **Reversibility**: Cancellation = clean no-op

## 3. Interaction Design Analysis

### 3.1 Wizard Flow Specification

```
┌─────────────────────────────────────────────────┐
│ [Step X/Y] Store Onboarding                     │
├─────────────────────────────────────────────────┤
│                                                 │
│ 📦 What is a "knowledge store"?                 │
│    A shared git-backed repository where your    │
│    team's decisions, pitfalls, and guidelines   │
│    live. Think of it as a shared brain for      │
│    your AI assistant.                           │
│                                                 │
│ [Context Detection]                             │
│    • Global config: ✓ exists                    │
│    • Personal store: ✓ mounted                  │
│    • Team stores: 0 mounted                     │
│                                                 │
│ Set up a team / shared knowledge store?         │
│                                                 │
│   skip        — personal store only (default)   │
│   join        — clone + bind a shared store     │
│   create      — start a fresh local store       │
│                                                 │
│ [ESC to cancel]                                 │
└─────────────────────────────────────────────────┘
```

### 3.2 Microinteractions

| Microinteraction | Behavior |
|------------------|----------|
| Context detection display | MUST show detected state before prompt |
| Selection change | MUST update hint text dynamically |
| Cancel action | MUST exit without modification |
| Error during join/create | MUST show error + offer retry or skip |

### 3.3 State Management

| State | Visual Indicator | Behavior |
|-------|------------------|----------|
| Detecting context | Spinner + "Detecting..." | Brief pause before prompt |
| Prompt shown | Select component | User interaction |
| Join in progress | Spinner + "Cloning..." | Non-interactive |
| Create in progress | Spinner + "Creating..." | Non-interactive |
| Completed | Success message | Next stage |

### 3.4 Feedback Mechanisms

| Feedback Type | When | Content |
|---------------|------|---------|
| Concept explanation | Before prompt | 30-second store explanation |
| Detection summary | Before prompt | Detected context state |
| Progress spinner | During join/create | "Cloning/Creating..." |
| Success message | After completion | Bound + write target set |
| Error recovery | On failure | Retry or skip options |

## 4. Usability & Accessibility

### 4.1 Heuristic Evaluation

| Heuristic | Current | Target | Gap |
|-----------|---------|--------|-----|
| Visibility of system status | Partial | Full | Add detection summary |
| Error prevention | Good | Good | Cancel = no-op |
| User control & freedom | Good | Good | ESC to cancel |
| Consistency | Good | Good | Match clack/prompts style |
| Help users recognize errors | Weak | Strong | Add error recovery |
| Recognition over recall | Weak | Strong | Add concept explanation |

### 4.2 Error Prevention Strategy

| Error Type | Prevention |
|------------|------------|
| Invalid URL | Validate before clone attempt |
| Already-mounted store | Idempotent reuse (UX-E5) |
| Git clone failure | Show error + offer skip |

### 4.3 Cognitive Load Optimization

- **Explanation brevity**: MUST stay under 80 characters per line
- **Option count**: MUST stay at 3 (skip/join/create) — no expansion
- **Decision sequencing**: MUST show context before prompt

## 5. Design System Integration

### 5.1 Component Pattern Requirements

| Component | Source | Requirement |
|-----------|--------|-------------|
| Select prompt | @clack/prompts | MUST use select with hints |
| Context box | ink Box | MUST use boxen for detection summary |
| Spinner | ora/ink-spinner | MUST show for join/create operations |
| Success message | paint.success | MUST bind to existing pattern |

### 5.2 Interaction Consistency

- MUST match existing clack/prompts visual style
- MUST use same paint color palette (success/warning/error)
- MUST follow existing stage header format

### 5.3 Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| Explanation padding | 1 line | Before prompt |
| Context box border | single | Detection summary |
| Spinner style | dots | ora default |

## 6. Testing & Validation Strategy

### 6.1 Wizard Flow Testing (TS-02)

| Test Case | Expected Behavior |
|-----------|-------------------|
| Skip selection | No store modification |
| Join with valid URL | Clone + bind + switch-write |
| Join with invalid URL | Error + retry or skip |
| Create new store | Create + bind + switch-write |
| Cancel at prompt | Clean exit, no modification |
| Re-run with existing active_write_store | Skip wizard entirely (UX-E5) |
| --url flag | Auto-join, bypass wizard |

### 6.2 Success Metrics

| Metric | Target |
|--------|--------|
| Wizard completion rate | >90% (for users with team URL) |
| Error recovery rate | >80% (retry success after initial failure) |
| Cancel rate | <10% (informational skip is default) |

### 6.3 Iteration Plan

1. Implement base wizard with concept explanation
2. Add context detection display
3. Test cancellation handling
4. Test idempotent skip (UX-E5)
5. Add error recovery options

## 7. Recommendations

### 7.1 UX Optimization Strategies

1. **Add 30-second concept explanation** before prompt (UX-01 SHOULD)
2. **Show detected context state** before prompt (UX-01 SHOULD)
3. **Offer retry or skip** on join/create failure (UX-E1)

### 7.2 Interaction Design Improvements

1. **Use dynamic hints** based on context detection
2. **Add progress feedback** for join/create operations (UX-04)
3. **Show success message** with bound + write target details

### 7.3 Implementation Priorities

| Priority | Item | Rationale |
|----------|------|-----------|
| P1 | Concept explanation | Addresses user confusion |
| P1 | Context detection display | Improves system status visibility |
| P2 | Error recovery options | Graceful degradation |
| P3 | Dynamic hints | Polish, not critical |

---

**Guidance Reference**: UX-01 (§5)
**Related UI Decisions**: UI-01 (visual anchors), UI-02 (summary card)
**Related Test Decisions**: TS-02 (wizard flow testing)
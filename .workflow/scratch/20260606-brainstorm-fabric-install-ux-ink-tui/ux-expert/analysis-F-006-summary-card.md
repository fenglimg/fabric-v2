# UX Expert Analysis: F-006 Summary Card

KB: none [not-applicable]

## 1. Feature Overview

**Feature ID**: F-006
**Slug**: summary-card
**Guidance Decision**: UX-02 — MUST output "3-Step Quick Start" guidance after install completes
**UI Decision**: UI-02 — MUST compress capability table and next-steps into single summary card

## 2. User Experience Assessment

### 2.1 Current State Analysis

Current install completion output (install.ts:408-416):
```
<capability table - 6+ lines>
Next steps:
1. Restart AI client
2. Try /fabric-archive skill
3. Write knowledge in .fabric/knowledge/

More: docs/surfaces.md explains...
```

**Current Friction Points**:
1. **Dispersed output**: Capability table + next steps + footer scattered
2. **No visual anchor**: Plain console.log blocks blend together
3. **Post-install cliff**: No immediate actionable guidance
4. **Information overload**: Multiple separate blocks compete for attention

### 2.2 Journey Implications

| Phase | Current | Target |
|-------|---------|--------|
| Completion | Dispersed blocks | Single boxed card |
| Next action | Listed but not emphasized | First step highlighted |
| Store status | Separate console.log | Integrated in card |
| Unbound nudge | Separate message | Integrated in card |

### 2.3 Cognitive Load Analysis

- **Current scan time**: 15+ seconds to read all blocks
- **Target scan time**: 5 seconds for summary card
- **Information density**: Must compress without losing clarity

## 3. Interaction Design Analysis

### 3.1 Summary Card Specification

```
┌─────────────────────────────────────────────────┐
│ ✓ Fabric Installed                              │
├─────────────────────────────────────────────────┤
│                                                 │
│ Clients: Claude Code ✓  Cursor ✓  Codex CLI ✓  │
│ Store:   'team-store' mounted, bound, write ✓  │
│                                                 │
│ ── Quick Start ──────────────────────────────   │
│                                                 │
│ 1. Restart your AI client                       │
│ 2. Try /fabric-archive in a conversation        │
│ 3. Write knowledge in .fabric/knowledge/        │
│                                                 │
│ Docs: docs/surfaces.md                          │
└─────────────────────────────────────────────────┘
```

### 3.2 Card Content Requirements

| Content | Source | Constraint |
|---------|--------|------------|
| Installed clients | detectClientSupports | MUST show per-client status |
| Store status | loadProjectConfig | MUST show: mounted, bound, write target |
| Quick start steps | UX-02 | MUST be 3 steps exactly |
| Unbound nudge | unboundAvailableStores | MUST integrate if applicable |
| Doc link | surfaces.md | MUST be single line |

### 3.3 Visual Anchor Integration

| Anchor | Position | Requirement |
|--------|----------|-------------|
| Success header | Top of card | MUST show ✓ symbol |
| Section divider | After status | MUST use ─ line |
| Quick start header | Before steps | MUST label clearly |
| Footer | Bottom of card | MUST link to docs |

### 3.4 State Variations

| Scenario | Card Content |
|----------|--------------|
| Fresh install (no store) | "Store: personal only (no team store)" |
| Store bound + write target | "Store: 'alias' mounted, bound, write ✓" |
| Unbound stores exist | Add nudge line in card |
| MCP skipped | Show "MCP: skipped" in clients row |

## 4. Usability & Accessibility

### 4.1 Heuristic Evaluation

| Heuristic | Current | Target | Gap |
|-----------|---------|--------|-----|
| Visibility of system status | Partial | Strong | Compressed status in card |
| Recognition over recall | Weak | Strong | All info in one place |
| Aesthetic integrity | Weak | Strong | Boxed presentation |
| Help and documentation | Good | Good | surfaces.md link |

### 4.2 Cognitive Load Optimization

- **Line count constraint**: MUST stay under 15 lines (UX-E3)
- **Scanability**: MUST use visual hierarchy (header/divider/footer)
- **Action prominence**: MUST highlight step 1 (restart client)

### 4.3 Error Prevention

| Error | Prevention |
|-------|------------|
| Misreading status | Clear visual structure |
| Missing next steps | Steps in card, not separate |
| Overlooking unbound stores | Integrated nudge |

## 5. Design System Integration

### 5.1 Component Pattern Requirements

| Component | Source | Requirement |
|-----------|--------|-------------|
| Boxen card | boxen npm | MUST use single border |
| Status symbols | paint.success | MUST use ✓ for completed |
| Divider line | Unicode | MUST use ─ separator |
| Client badges | paint.* | MUST color-code per client |

### 5.2 Design Tokens

| Token | Value | Usage |
|-------|-------|-------|
| Card border | single (boxen) | Summary card |
| Card padding | 1 | Internal spacing |
| Header prefix | ✓ | Success indicator |
| Divider | ────── | Section separator |
| Max height | 15 lines | Cognitive load limit |

### 5.3 Interaction Consistency

- MUST match UI-04 color palette (success=green)
- MUST use same paint functions for status
- MUST integrate with existing formatCapabilityTableRow style

## 6. Testing & Validation Strategy

### 6.1 Visual Output Testing (TS-03)

| Test Case | Expected Output |
|-----------|-----------------|
| Fresh install | Card with "Store: personal only" |
| Store bound | Card with store status |
| Unbound stores | Card with integrated nudge |
| MCP skipped | Card with "MCP: skipped" |
| Compact mode (--quiet) | Reduced card or single line |

### 6.2 Success Metrics

| Metric | Target |
|--------|--------|
| User reads next steps | >95% (all info in card) |
| User restarts client | >90% (step 1 prominence) |
| Card comprehension time | <5 seconds |

### 6.3 Iteration Plan

1. Design card template with boxen
2. Integrate capability table into card
3. Add quick start steps
4. Add store status row
5. Test unbound nudge integration
6. Validate line count constraint (UX-E3)

## 7. Recommendations

### 7.1 UX Optimization Strategies

1. **Compress all post-install output into single card** (UX-02 MUST)
2. **Highlight step 1 with visual emphasis** (restart client)
3. **Integrate unbound nudge into card** (reduce message count)

### 7.2 Interaction Design Improvements

1. **Use boxen for visual anchoring** (UI-02 MUST)
2. **Show client status with symbols** (✓ for installed)
3. **Link to surfaces.md in footer** (single line)

### 7.3 Implementation Priorities

| Priority | Item | Rationale |
|----------|------|-----------|
| P1 | Boxen card template | Visual anchor foundation |
| P1 | Quick start steps | UX-02 requirement |
| P2 | Store status row | Information density |
| P2 | Unbound nudge integration | Reduce message count |
| P3 | Compact mode | Optional polish |

---

**Guidance Reference**: UX-02 (§5), UI-02 (§6)
**Related UI Decisions**: UI-01 (visual anchors), UI-03 (table component)
**Related Test Decisions**: TS-03 (visual output testing)
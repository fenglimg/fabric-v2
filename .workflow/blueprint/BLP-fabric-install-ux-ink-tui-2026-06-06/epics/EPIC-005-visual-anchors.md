# EPIC-005: Visual Anchor System

**Feature**: F-005 - Visual Anchor System
**Priority**: SHOULD (Enhancement)
**Estimated Size**: S (2-3 days)

## Overview

Consistent visual markers (icons, colors, formatting) that create "anchors" for users to quickly identify the type and state of information being displayed.

## User Story Map

```
[User] scans terminal output
    |
    v
[Icon System] --> [Color System] --> [Format Patterns]
```

## Stories

### STORY-005-A: Icon Registry and Usage

**As a** Fabric user,
**I want** consistent icons for different states and types,
**So that** I can quickly scan output for what matters.

**Acceptance Criteria**:
- [ ] AC1: Define icon set: success (✓), error (✗), warning (⚠), info (ℹ), pending (○)
- [ ] AC2: Type icons: decision (◈), pitfall (!), guideline (▸), model (◇), process (※)
- [ ] AC3: `getIcon(type, state)` function with fallback to ASCII
- [ ] AC4: Icons render correctly across terminals (UTF-8 fallback)

**Size**: S
**REQ**: REQ-016
**Feature**: F-005

---

### STORY-005-B: Semantic Color System

**As a** Fabric user with visual preferences,
**I want** semantic colors that convey meaning,
**So that** I can understand status at a glance.

**Acceptance Criteria**:
- [ ] AC1: Semantic colors: success=green, error=red, warning=yellow, info=cyan
- [ ] AC2: Type colors: decision=magenta, pitfall=red, guideline=blue, model=yellow
- [ ] AC3: Muted color for secondary information (gray)
- [ ] AC4: `--no-color` mode falls back to text-only

**Size**: S
**REQ**: REQ-017
**Feature**: F-005

---

### STORY-005-C: Format Pattern Library

**As a** Fabric developer,
**I want** consistent format patterns,
**So that** all output has a cohesive look.

**Acceptance Criteria**:
- [ ] AC1: Header pattern: `━━━ [Title] ━━━`
- [ ] AC2: Item pattern: `  [icon] [text]`
- [ ] AC3: Indent pattern: 2 spaces per level
- [ ] AC4: Truncation pattern: long text → `...` with tooltip

**Size**: S
**REQ**: REQ-018
**Feature**: F-005

---

## Technical Notes

### Icon Registry

```typescript
const ICON_REGISTRY = {
  // State icons
  success: { primary: '✓', fallback: '[OK]' },
  error: { primary: '✗', fallback: '[ERR]' },
  warning: { primary: '⚠', fallback: '[WARN]' },
  info: { primary: 'ℹ', fallback: '[INFO]' },
  pending: { primary: '○', fallback: '[...]' },

  // Type icons
  decision: { primary: '◈', fallback: '[D]' },
  pitfall: { primary: '!', fallback: '[P]' },
  guideline: { primary: '▸', fallback: '[G]' },
  model: { primary: '◇', fallback: '[M]' },
  process: { primary: '※', fallback: '[X]' },
};

function getIcon(type: IconType, preferUnicode = true): string {
  const entry = ICON_REGISTRY[type];
  return preferUnicode ? entry.primary : entry.fallback;
}
```

### Color Tokens

```typescript
const COLOR_TOKENS = {
  // Semantic
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',

  // Knowledge types
  decision: 'magenta',
  pitfall: 'red',
  guideline: 'blue',
  model: 'yellow',
  process: 'cyan',

  // UI
  muted: 'gray',
  primary: 'cyan',
  text: 'white',
};
```

### Format Patterns

```
Header:
━━━ Install Pipeline ━━━

Stage:
  ✓ Validation
    ├─ fabric-config.json: OK
    ├─ Write permissions: OK
    └─ Required fields: OK

Item:
  ◈ K-001: Use TypeScript strict mode
```

## Dependencies

- EPIC-002 (Ink TUI) - uses Ink's `<Text>` component for colors

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Terminal encoding issues | Medium | UTF-8 detection, ASCII fallback |
| Color blindness | Low | Don't rely solely on color; use icons too |
| Windows console limitations | Low | Windows Terminal handles UTF-8; CMD fallback |

## Definition of Done

- [ ] All 3 stories implemented and tested
- [ ] Icon rendering verified across 3+ terminals
- [ ] Color palette documented with hex values
- [ ] Format patterns documented with examples

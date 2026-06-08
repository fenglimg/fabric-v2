# EPIC-002: Ink TUI Output Layer

**Feature**: F-002 - Ink Output Layer
**Priority**: MUST (MVP)
**Estimated Size**: M (3-5 days)

## Overview

Replace console.log based output with Ink (React for CLI) components, enabling rich terminal UI with consistent styling, proper line management, and reusable component library.

## User Story Map

```
[Developer] sees rich terminal output
    |
    v
[Base Components] --> [Stage Components] --> [Layout Components] --> [Theme System]
```

## Stories

### STORY-002-A: Ink Integration Foundation

**As a** Fabric developer,
**I want** Ink integrated with the CLI framework,
**So that** I can render React components to the terminal.

**Acceptance Criteria**:
- [ ] AC1: Add `ink` and `react` as dependencies
- [ ] AC2: Create `render()` wrapper that handles cleanup and error states
- [ ] AC3: Implement `<App>` root component with error boundary
- [ ] AC4: Ensure proper terminal cleanup on exit (no cursor artifacts)

**Size**: S
**REQ**: REQ-005
**Feature**: F-002

---

### STORY-002-B: Base UI Components

**As a** Fabric developer,
**I want** reusable base UI components,
**So that** I can build consistent terminal interfaces.

**Acceptance Criteria**:
- [ ] AC1: `<Text>` component with color, bold, dim variants
- [ ] AC2: `<Box>` component for layout with padding/margin
- [ ] AC3: `<Spinner>` component with multiple animation styles
- [ ] AC4: `<Icon>` component with check, cross, warning, info variants

**Size**: M
**REQ**: REQ-006
**Feature**: F-002

---

### STORY-002-C: Stage Output Components

**As a** Fabric user,
**I want** clear stage-by-stage output during install,
**So that** I can follow the progress and understand what's happening.

**Acceptance Criteria**:
- [ ] AC1: `<StageHeader>` shows stage name with icon and status
- [ ] AC2: `<StageProgress>` shows step-by-step progress within stage
- [ ] AC3: `<StageResult>` shows pass/fail/skip with details
- [ ] AC4: `<StageLog>` shows timestamped log entries with verbosity control

**Size**: M
**REQ**: REQ-007
**Feature**: F-002

---

### STORY-002-D: Theme and Styling System

**As a** Fabric maintainer,
**I want** a centralized theme system,
**So that** colors and styles are consistent and customizable.

**Acceptance Criteria**:
- [ ] AC1: `ThemeProvider` component with default Fabric theme
- [ ] AC2: Theme tokens: `colors`, `spacing`, `typography`
- [ ] AC3: Support `--no-color` flag to disable colors
- [ ] AC4: Export `useTheme()` hook for component access

**Size**: S
**REQ**: REQ-008
**Feature**: F-002

---

## Technical Notes

### Component Hierarchy

```
<App>
  <ThemeProvider>
    <InstallPipeline>
      <Stage name="validate">
        <StageHeader />
        <StageProgress />
        <StageResult />
      </Stage>
      ...
    </InstallPipeline>
  </ThemeProvider>
</App>
```

### Theme Tokens

```typescript
const fabricTheme = {
  colors: {
    primary: 'cyan',
    success: 'green',
    warning: 'yellow',
    error: 'red',
    muted: 'gray',
    text: 'white',
  },
  icons: {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ',
    spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  },
};
```

## Dependencies

- EPIC-001 (Install Pipeline) - stages provide data for components

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ink rendering flicker | Medium | Use static mode for final output, minimize re-renders |
| Terminal compatibility | Medium | Test across terminals (iTerm2, Windows Terminal, VS Code) |
| Performance on slow terminals | Low | Debounce updates, batch renders |

## Definition of Done

- [ ] All 4 stories implemented and tested
- [ ] Storybook-like component demo command
- [ ] Accessibility: works with screen readers
- [ ] CI tests verify component snapshots

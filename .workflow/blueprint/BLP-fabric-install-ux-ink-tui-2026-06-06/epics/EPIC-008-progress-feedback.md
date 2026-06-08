# EPIC-008: Progress Feedback

**Feature**: F-008 - Progress Feedback
**Priority**: MAY (Optional Enhancement)
**Estimated Size**: XS (1 day)

## Overview

Real-time progress indicators for long-running operations, providing visual feedback during file operations, hook installation, and knowledge processing.

## User Story Map

```
[User] watches long operation
    |
    v
[Spinner] --> [Progress Bar] --> [Step Counter]
```

## Stories

### STORY-008-A: Spinner Component

**As a** Fabric user,
**I want** a spinner for operations without known duration,
**So that** I know the process is still running.

**Acceptance Criteria**:
- [ ] AC1: Spinner with configurable frames and speed
- [ ] AC2: Show operation name next to spinner
- [ ] AC3: Replace spinner with success/error icon on completion
- [ ] AC4: Support multiple concurrent spinners (parallel operations)

**Size**: XS
**REQ**: REQ-024
**Feature**: F-008

---

### STORY-008-B: Progress Bar Component

**As a** Fabric user,
**I want** a progress bar for operations with known duration,
**So that** I can estimate time remaining.

**Acceptance Criteria**:
- [ ] AC1: Progress bar with percentage and item count
- [ ] AC2: Show current item being processed
- [ ] AC3: Animate smoothly without flicker
- [ ] AC4: Support nested progress (stage > step)

**Size**: XS
**REQ**: REQ-025
**Feature**: F-008

---

## Technical Notes

### Spinner Component

```tsx
<Spinner
  label="Installing hooks..."
  frames={['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']}
  speed={80}
/>
```

### Progress Bar Component

```tsx
<ProgressBar
  current={5}
  total={10}
  label="Copying files"
  currentItem="src/utils/helper.ts"
/>
```

### Progress Bar Output

```
Installing hooks... ⠸ 50% (5/10)
  Current: .claude/hooks/fabric-session-start.cjs
```

### Integration Points

| Operation | Component | Duration |
|-----------|-----------|----------|
| Validation | Spinner | Fast (<1s) |
| File copying | Progress bar | Medium (1-5s) |
| Hook installation | Progress bar | Medium (1-5s) |
| Knowledge indexing | Spinner | Variable |

### Ink Implementation

```tsx
import { useState, useEffect } from 'react';
import { Text } from 'ink';

function Spinner({ label, frames, speed }) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(f => (f + 1) % frames.length);
    }, speed);
    return () => clearInterval(timer);
  }, [frames.length, speed]);

  return (
    <Text>
      <Text color="cyan">{frames[frame]}</Text>
      {' '}
      {label}
    </Text>
  );
}
```

## Dependencies

- EPIC-002 (Ink TUI) - uses Ink components for rendering
- EPIC-001 (Install Pipeline) - stages provide progress data

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Spinner on non-TTY | Low | Detect TTY, show static text in non-TTY |
| Flicker on slow terminals | Low | Use Ink's static mode for completed items |
| Nested progress complexity | Low | Keep to 2 levels max (stage > step) |

## Definition of Done

- [ ] Both stories implemented and tested
- [ ] Spinner works in TTY and non-TTY environments
- [ ] Progress bar accurate with large file counts (100+)
- [ ] Components exported for reuse in other commands

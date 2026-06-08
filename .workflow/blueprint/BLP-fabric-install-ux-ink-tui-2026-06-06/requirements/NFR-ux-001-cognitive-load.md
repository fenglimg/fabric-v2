# NFR-UX-001: Cognitive Load

**Priority**: MUST
**Category**: Non-Functional Requirement
**Status**: Draft

## Overview

This NFR defines user experience constraints focused on minimizing cognitive load during installation and uninstallation workflows.

## Cognitive Load Targets

### Information Density

| Metric | Target | Rationale |
|--------|--------|-----------|
| Maximum unique concepts per screen | 5 | Miller's Law: 7±2 items working memory |
| Sentence length (max) | 20 words | Reading ease for quick scanning |
| Options per prompt (max) | 5 | Hick's Law: decision time increases with options |
| Nested menu depth (max) | 3 | Reduce navigation complexity |

### Reading Metrics

| Metric | Target | Tool |
|--------|--------|------|
| Flesch Reading Ease | > 60 (standard) | `write-good` |
| Flesch-Kincaid Grade Level | < 10 | `readability-score` |
| Gunning Fog Index | < 12 | `fog` |

### Visual Hierarchy

| Element | Constraint |
|---------|------------|
| Primary actions | 1 per screen, high contrast |
| Secondary actions | ≤ 3 per screen, lower contrast |
| Warning visibility | Always above fold |
| Error visibility | Immediate, inline with context |

## Usability Heuristics (Nielsen)

### 1. Visibility of System Status

**Target**: User always knows what's happening

**Verification**:
- [ ] Every stage shows clear status (running/success/failure)
- [ ] Long operations show progress indicator
- [ ] Summary card confirms final state

### 2. Match Between System and Real World

**Target**: Use familiar concepts and language

**Verification**:
- [ ] "Store" metaphor documented in wizard
- [ ] No jargon without inline explanation
- [ ] Real-world analogies in onboarding

### 3. User Control and Freedom

**Target**: Users can easily undo actions

**Verification**:
- [ ] `--dry-run` shows what will happen
- [ ] Wizard supports "Back" navigation
- [ ] Uninstall has knowledge preservation prompt

### 4. Consistency and Standards

**Target**: Follow platform conventions

**Verification**:
- [ ] CLI flags follow POSIX conventions (`--verbose`, `-v`)
- [ ] Keyboard shortcuts match terminal conventions
- [ ] Color scheme consistent across stages

### 5. Error Prevention

**Target**: Prevent errors before they occur

**Verification**:
- [ ] Validation before destructive actions
- [ ] Confirmation prompts for "Delete" operations
- [ ] Auto-save wizard state to allow resume

### 6. Recognition Rather Than Recall

**Target**: Minimize memory burden

**Verification**:
- [ ] Summary card shows all configured items
- [ ] Next steps provide copy-pasteable commands
- [ ] Visual anchors enable quick scanning

### 7. Flexibility and Efficiency of Use

**Target**: Support both novice and expert users

**Verification**:
- [ ] Wizard for first-time users
- [ ] Flags for experienced users (`--store-id`, `--scope`)
- [ ] `--non-interactive` for CI/CD

### 8. Aesthetic and Minimalist Design

**Target**: Only essential information

**Verification**:
- [ ] Summary card < 15 lines (REQ-006)
- [ ] No redundant status messages
- [ ] Verbose mode for extra details

### 9. Help Users Recognize, Diagnose, and Recover from Errors

**Target**: Errors are actionable

**Verification**:
- [ ] Error classification (REQ-007 AC1)
- [ ] Solutions provided for every error
- [ ] Recovery commands shown

### 10. Help and Documentation

**Target**: Contextual help available

**Verification**:
- [ ] `--help` flag on every command
- [ ] Inline tooltips in wizard
- [ ] Links to docs in summary card

## Verification Methods

### Usability Testing Protocol

```markdown
## Session Setup
- Participant: New Fabric user (no prior experience)
- Task: Install Fabric for a personal project
- Time limit: 10 minutes

## Tasks
1. Run `fabric install` without reading docs
2. Complete the store onboarding wizard
3. Verify installation with `fabric status`
4. Uninstall and preserve knowledge

## Metrics
- Task completion rate: ≥ 80%
- Time on task: ≤ 5 minutes per task
- Error rate: ≤ 2 errors per session
- SUS score: ≥ 70

## Think-aloud protocol
- Participant verbalizes thoughts
- Observer notes confusion points
- Post-session interview for insights
```

### Automated UX Audits

```typescript
// packages/cli/src/__tests__/ux-audit.test.ts
import { render } from 'ink-testing-library';
import { FleschKincaid } from 'readability-score';

describe('UX Audit', () => {
  it('should keep sentences under 20 words', () => {
    const messages = extractAllMessages(InstallWizard);
    const longSentences = messages.filter(m => m.split(' ').length > 20);
    expect(longSentences).toHaveLength(0);
  });

  it('should limit options to 5 per prompt', () => {
    const prompts = extractPrompts(InstallWizard);
    const excessiveOptions = prompts.filter(p => p.options.length > 5);
    expect(excessiveOptions).toHaveLength(0);
  });

  it('should achieve Flesch Reading Ease > 60', () => {
    const messages = extractAllMessages(InstallWizard);
    const avgScore = messages.reduce((sum, m) => {
      return sum + FleschKincaid(m);
    }, 0) / messages.length;
    expect(avgScore).toBeGreaterThan(60);
  });
});
```

### Cognitive Walkthrough

```markdown
## Walkthrough Questions (for each task step)

1. Will users know what to do at this step?
   - [ ] Yes, it's obvious
   - [ ] Yes, with previous experience
   - [ ] No, needs improvement

2. If users do the right thing, will they know it's correct?
   - [ ] Yes, immediate feedback
   - [ ] Yes, eventual feedback
   - [ ] No, needs improvement

3. If users do the wrong thing, will they know it's wrong?
   - [ ] Yes, immediate error
   - [ ] Yes, eventually discover
   - [ ] No, needs improvement

4. How many mental steps does this require?
   - Count: ____
   - Target: ≤ 3
```

## Accessibility Considerations

### Terminal Accessibility

| Requirement | Constraint |
|-------------|------------|
| Color contrast | WCAG AA minimum (4.5:1) |
| Color independence | Information not conveyed by color alone |
| Screen reader support | Structured output for accessibility tools |
| Keyboard navigation | All actions accessible via keyboard |

### Color Independence

```tsx
// ✗ Bad: Status only by color
<Text color={success ? 'green' : 'red'}>{message}</Text>

// ✓ Good: Status by color AND symbol
<Text color={success ? 'green' : 'red'}>
  {success ? '[✓]' : '[✗]'} {message}
</Text>
```

## Monitoring and Improvement

### User Feedback Collection

```typescript
// After installation, prompt for feedback
const collectFeedback = async () => {
  const rating = await prompt({
    message: 'How was your installation experience? (1-5)',
    type: 'number',
    min: 1,
    max: 5,
  });

  if (rating < 4) {
    await prompt({
      message: 'What could we improve?',
      type: 'text',
    });
  }
};
```

### Analytics

| Event | Metric |
|-------|--------|
| `install_wizard_abandoned` | Step where user quit |
| `install_error_recovery` | Errors that required `--resume` |
| `install_duration` | Total time to complete |
| `wizard_back_usage` | Frequency of "Back" navigation |

## Success Criteria

| Metric | Target | Measurement |
|--------|--------|-------------|
| SUS score | ≥ 70 | Post-install survey |
| Task completion rate | ≥ 80% | Usability testing |
| Error recovery rate | ≥ 90% | Errors followed by `--resume` |
| Documentation lookup | < 20% | Users who needed external docs |

## Traceability

- **REQ-003**: Wizard minimizes decisions with guided flow
- **REQ-006**: Summary card reduces memory burden
- **REQ-007**: Error solutions reduce cognitive load for debugging

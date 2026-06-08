# EPIC-007: Error Presentation

**Feature**: F-007 - Error Presentation
**Priority**: SHOULD (Enhancement)
**Estimated Size**: S (2-3 days)

## Overview

Structured error presentation with clear messages, context, and actionable suggestions. Transforms raw errors into helpful guidance.

## User Story Map

```
[User] encounters error
    |
    v
[Error Detection] --> [Error Formatting] --> [Error Display]
```

## Stories

### STORY-007-A: Error Classification System

**As a** Fabric developer,
**I want** errors classified by type and severity,
**So that** users get appropriate responses.

**Acceptance Criteria**:
- [ ] AC1: Error types: ConfigError, PermissionError, NetworkError, ValidationError
- [ ] AC2: Severity levels: Error (blocking), Warning (continue), Info (hint)
- [ ] AC3: Error codes: `E001`, `E002`, etc. for documentation lookup
- [ ] AC4: `FabricError` base class with structured fields

**Size**: S
**REQ**: REQ-021
**Feature**: F-007

---

### STORY-007-B: Error Formatting with Context

**As a** Fabric user,
**I want** errors to show context and suggestions,
**So that** I can understand and fix the problem.

**Acceptance Criteria**:
- [ ] AC1: Show error code and type
- [ ] AC2: Show contextual message (not raw error text)
- [ ] AC3: Show file path and line number if applicable
- [ ] AC4: Show "Suggestion:" with actionable fix

**Size**: M
**REQ**: REQ-022
**Feature**: F-007

---

### STORY-007-C: Error Display Component

**As a** Fabric user,
**I want** errors displayed clearly,
**So that** they stand out from normal output.

**Acceptance Criteria**:
- [ ] AC1: Error block with red border and background
- [ ] AC2: Warning block with yellow border
- [ ] AC3: Info block with blue border
- [ ] AC4: Stack trace hidden by default, show with `--verbose`

**Size**: S
**REQ**: REQ-023
**Feature**: F-007

---

## Technical Notes

### Error Class Hierarchy

```typescript
class FabricError extends Error {
  code: string;           // E001, E002, ...
  type: ErrorType;        // config, permission, network, validation
  severity: Severity;     // error, warning, info
  context?: ErrorContext; // file, line, suggestions
  cause?: Error;          // original error

  constructor(opts: FabricErrorOptions) {
    super(opts.message);
    this.code = opts.code;
    this.type = opts.type;
    this.severity = opts.severity;
    this.context = opts.context;
    this.cause = opts.cause;
  }
}

class ConfigError extends FabricError {
  constructor(message: string, context?: ErrorContext) {
    super({
      code: 'E001',
      type: 'config',
      severity: 'error',
      message,
      context,
    });
  }
}
```

### Error Codes Registry

| Code | Type | Message | Suggestion |
|------|------|---------|------------|
| E001 | config | fabric-config.json not found | Run `fabric init` to create config |
| E002 | config | Invalid JSON in fabric-config.json | Check JSON syntax at line X |
| E003 | permission | Cannot write to .fabric/ | Check directory permissions |
| E004 | validation | Missing required field: knowledge_dir | Add field to fabric-config.json |
| E005 | network | Cannot fetch remote knowledge | Check internet connection |
| E006 | validation | Hook file not found | Run `fabric install` to regenerate |

### Error Display Format

```
╭─ Error [E001] ──────────────────────────────────────────────╮
│ Config file not found                                        │
│                                                              │
│ File: fabric-config.json                                     │
│                                                              │
│ Suggestion:                                                  │
│ Run 'fabric init' to create a new configuration file        │
│                                                              │
│ Docs: https://fabric.dev/errors/E001                        │
╰──────────────────────────────────────────────────────────────╯
```

### Ink Component

```tsx
<ErrorDisplay
  error={{
    code: 'E001',
    type: 'config',
    severity: 'error',
    message: 'Config file not found',
    context: {
      file: 'fabric-config.json',
      suggestion: "Run 'fabric init' to create a new configuration file",
    },
  }}
/>
```

## Dependencies

- EPIC-002 (Ink TUI) - uses Ink components for rendering
- EPIC-001 (Install Pipeline) - stages produce errors

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Missing error cases | Medium | Error audit, common case enumeration |
| Suggestions become outdated | Low | Link to docs, version-specific suggestions |
| Verbose errors overwhelm | Medium | Default concise, --verbose for details |

## Definition of Done

- [ ] All 3 stories implemented and tested
- [ ] Error codes documented in external docs
- [ ] Each error type has at least one test case
- [ ] `--verbose` shows stack trace

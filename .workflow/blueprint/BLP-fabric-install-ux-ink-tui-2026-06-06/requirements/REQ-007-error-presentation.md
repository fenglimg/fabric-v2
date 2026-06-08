# REQ-007: Error Presentation

**Priority**: SHOULD
**Feature ID**: F-007
**Status**: Draft

## User Story

**As a** Fabric CLI user
**I want** clear, actionable error messages
**So that** I can quickly diagnose and fix issues without deep technical knowledge.

## Context

Current error messages are often raw stack traces or terse technical messages that require domain expertise to interpret. This creates frustration and support burden.

## Acceptance Criteria

### AC1: Error Classification

**GIVEN** an error occurs during installation
**WHEN** the error is presented to the user
**THEN** it MUST be classified into one of these categories:

| Category | Prefix | Example |
|----------|--------|---------|
| Permission | `[PERM]` | Cannot write to .fabric/ (permission denied) |
| Network | `[NET]` | Failed to fetch knowledge base (timeout) |
| Validation | `[VALID]` | Invalid store ID format (expected: alphanumeric-hyphen) |
| State | `[STATE]` | Store already exists (run `fabric store delete` first) |
| Dependency | `[DEP]` | Node.js v14+ required (found v12) |
| Internal | `[INT]` | Unexpected error (please report this bug) |

**AND** each category MUST have a distinct color:

```typescript
const ERROR_COLORS = {
  permission: 'red',
  network: 'yellow',
  validation: 'cyan',
  state: 'magenta',
  dependency: 'yellow',
  internal: 'red',
};
```

### AC2: Structured Error Format

**GIVEN** an error of any category
**WHEN** it is rendered
**THEN** it MUST follow this structure:

```
┌──────────────────────────────────────────────────────────┐
│ [PERM] Permission Error                                   │
├──────────────────────────────────────────────────────────┤
│ Cannot write to .fabric/ directory                        │
│                                                          │
│ Details:                                                  │
│   Path: /home/user/project/.fabric                       │
│   Current permissions: drwxr-xr-x                         │
│   Required: write access                                  │
│                                                          │
│ Solutions:                                                │
│   1. Check ownership: ls -la .fabric                      │
│   2. Fix permissions: chmod 755 .fabric                   │
│   3. Run with appropriate permissions                     │
│                                                          │
│ Error code: EACCES                                        │
│ Stage: 3 (Bootstrap)                                     │
└──────────────────────────────────────────────────────────┘
```

**AND** the error component MUST be reusable:

```tsx
interface ErrorDisplayProps {
  category: ErrorCategory;
  title: string;
  message: string;
  details?: Record<string, string>;
  solutions: string[];
  errorCode?: string;
  stage?: number;
  verbose?: boolean;
}

const ErrorDisplay: FC<ErrorDisplayProps> = (props) => {
  // Render structured error box
};
```

### AC3: Contextual Solutions

**GIVEN** an error occurs
**WHEN** the error is displayed
**THEN** the solutions section MUST provide 1-3 actionable steps:

**Permission Error**:
```
Solutions:
  1. Check ownership: ls -la .fabric
  2. Fix permissions: chmod 755 .fabric
  3. Run with appropriate permissions
```

**Network Error**:
```
Solutions:
  1. Check internet connection
  2. Retry with: fabric install --retry
  3. Use offline mode: fabric install --offline
```

**Validation Error**:
```
Solutions:
  1. Use alphanumeric characters and hyphens
  2. Example: my-team-store
  3. Edit input and press Enter
```

**AND** solutions MUST be specific to the error context (not generic).

### AC4: Verbose Mode

**GIVEN** an error occurs
**WHEN** the `--verbose` flag is set
**THEN** the error MUST include:

```
┌──────────────────────────────────────────────────────────┐
│ [PERM] Permission Error                                   │
├──────────────────────────────────────────────────────────┤
│ ... (standard error content) ...                        │
│                                                          │
│ Stack Trace:                                             │
│   at writeFile (fs.js:123:45)                            │
│   at Stage3Bootstrap.run (stage-3.ts:89:12)             │
│   at Orchestrator.execute (orchestrator.ts:45:18)       │
│                                                          │
│ Environment:                                              │
│   Node.js: v20.10.0                                      │
│   OS: macOS 14.0.0                                       │
│   Fabric: v2.0.1                                          │
│   CLI: fabric install --verbose                          │
│                                                          │
│ Debug Info:                                               │
│   Config: {"storeId": "team-alpha", ...}                │
│   Stage Context: {"previousStages": [...]}              │
└──────────────────────────────────────────────────────────┘
```

**AND** a prompt to report internal errors:

```
┌──────────────────────────────────────────────────────────┐
│ [INT] Internal Error                                      │
├──────────────────────────────────────────────────────────┤
│ An unexpected error occurred. This might be a bug.        │
│                                                          │
│ Please report this issue:                                │
│   https://github.com/fenglimg/fabric/issues/new         │
│                                                          │
│ Include the stack trace above for faster resolution.    │
└──────────────────────────────────────────────────────────┘
```

## Technical Constraints

1. **MUST** extend native Error class with custom properties
2. **MUST** support `--json` output for programmatic error handling
3. **SHOULD** support error code lookup via `fabric error <code>`
4. **MAY** support error telemetry (opt-in, privacy-first)

## Dependencies

- **REQ-002**: Ink provides Box component for error rendering

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Overly verbose error messages | MEDIUM | Default to concise, `--verbose` for details |
| Solutions become outdated | LOW | Version solutions with Fabric version |
| Error parsing breaks automation | LOW | Preserve machine-readable error codes |

## Implementation Notes

- Create a `FabricError` class that extends `Error`
- Build an error catalog with category → solutions mapping
- Consider error telemetry as a future enhancement (v2.2+)

## Traceability

- **NFR-UX-001**: Clear error presentation reduces cognitive load for debugging
# REQ-005: Visual Anchor System

**Priority**: SHOULD
**Feature ID**: F-005
**Status**: Draft

## User Story

**As a** Fabric CLI user
**I want** consistent visual markers throughout the installation process
**So that** I can quickly scan the output and understand what's happening at each stage.

## Context

Current CLI output uses inconsistent formatting (some lines use emojis, some use brackets, some are plain text). This makes it difficult to visually parse the output and creates a disjointed experience.

## Acceptance Criteria

### AC1: Anchor Glyph Set

**GIVEN** the CLI output system
**WHEN** rendering status messages
**THEN** the following glyph set MUST be used consistently:

| Symbol | Meaning | Use Case | Color |
|--------|---------|----------|-------|
| `[+]` | Create/Add | Creating files, directories, configs | Green |
| `[-]` | Remove/Delete | Removing files, uninstalling | Yellow |
| `[→]` | Install forward | Installing hooks, components | Cyan |
| `[←]` | Uninstall reverse | Uninstalling hooks | Yellow |
| `[✓]` | Success | Operation completed successfully | Green |
| `[✗]` | Failure | Operation failed | Red |
| `[?]` | Prompt | Awaiting user input | Cyan |
| `[!]` | Warning | Non-blocking issue | Yellow |
| `[i]` | Info | Informational message | Dim/Gray |

**AND** symbols MUST be rendered consistently across platforms:

```typescript
// Cross-platform glyph rendering
const glyphs = {
  create: process.platform === 'win32' ? '[+]' : '[+]',
  remove: process.platform === 'win32' ? '[-]' : '[-]',
  success: process.platform === 'win32' ? '[OK]' : '[✓]',
  failure: process.platform === 'win32' ? '[FAIL]' : '[✗]',
};
```

### AC2: Visual Anchor Component

**GIVEN** Ink-based output
**WHEN** rendering stage output
**THEN** a reusable `<VisualAnchor>` component MUST be available:

```tsx
interface VisualAnchorProps {
  type: 'create' | 'remove' | 'install' | 'uninstall' | 'success' | 'failure' | 'prompt' | 'warning' | 'info';
  message: string;
  detail?: string;
  indent?: number;
}

const VisualAnchor: FC<VisualAnchorProps> = ({ type, message, detail, indent = 0 }) => {
  const { glyph, color } = ANCHOR_CONFIG[type];

  return (
    <Box flexDirection="column">
      <Box marginLeft={indent}>
        <Text color={color} bold>{glyph}</Text>
        <Text> {message}</Text>
      </Box>
      {detail && (
        <Box marginLeft={indent + 3}>
          <Text dimColor>{detail}</Text>
        </Box>
      )}
    </Box>
  );
};
```

**Example Usage**:
```tsx
<VisualAnchor type="create" message="Creating .fabric/ directory" />
<VisualAnchor type="success" message="Installation complete" detail="4 stores configured" />
<VisualAnchor type="warning" message="Found legacy config" detail="Run 'fabric migrate' to upgrade" />
```

### AC3: Scannable Output Format

**GIVEN** a complete installation log
**WHEN** the user scans the output vertically
**THEN** anchors MUST be left-aligned for easy scanning:

```
Fabric Install
────────────────────────────────────────────────────────────
[+] Stage 1: Detect
    [i] Detected client: Claude Code v2.1.0
    [i] Environment: macOS, Node.js v20.10.0

[+] Stage 2: Validate
    [✓] Prerequisites met
    [!] Warning: Low disk space (< 1GB)

[+] Stage 3: Bootstrap
    [+] Creating .fabric/ directory...
    [+] Creating .fabric/knowledge/...
    [+] Creating .fabric/stores/...

[+] Stage 4: Hooks
    [→] Installing SessionStart hook...
    [→] Installing PreToolUse hook...
    [✓] 2 hooks installed

────────────────────────────────────────────────────────────
[✓] Installation complete (3.2s)
```

**AND** failure output MUST highlight the failure point:

```
[+] Stage 4: Hooks
    [→] Installing SessionStart hook...
    [✗] Failed: Permission denied on .claude/settings.json
    [!] Run with elevated permissions or check file ownership
────────────────────────────────────────────────────────────
[✗] Installation failed at Stage 4
```

## Technical Constraints

1. **MUST** work in terminals without emoji support (fallback to ASCII)
2. **MUST** maintain alignment with variable-width characters
3. **SHOULD** support custom glyph themes via configuration
4. **MAY** support animated glyphs for progress indicators

## Dependencies

- **REQ-002**: Ink provides the component foundation

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Glyph misalignment in some terminals | LOW | Test matrix with real terminals |
| Color blindness accessibility | MEDIUM | Ensure glyphs convey meaning without color |

## Implementation Notes

- Create a glyph normalization test suite
- Document the visual anchor system in a separate design doc
- Consider adding a `--no-anchors` flag for machine-readable output

## Traceability

- **NFR-UX-001**: Visual anchors reduce cognitive load for output scanning
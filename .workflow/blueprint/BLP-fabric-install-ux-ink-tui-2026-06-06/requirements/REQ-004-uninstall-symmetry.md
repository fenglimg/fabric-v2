# REQ-004: Uninstall Symmetry

**Priority**: MUST
**Feature ID**: F-004
**Status**: Draft

## User Story

**As a** Fabric CLI user
**I want** the uninstall command to mirror the install experience in reverse
**So that** the removal process is predictable and I understand what changes are being made.

## Context

The current uninstall command is implemented as an afterthought, with different visual style and missing stages. This violates the principle of reversibility and creates confusion about what gets removed.

## Acceptance Criteria

### AC1: Reverse-Order Stage Execution

**GIVEN** the install command executes stages 1 → 7
**WHEN** the uninstall command is invoked
**THEN** stages MUST execute in reverse order: 7 → 1

| Install Order | Uninstall Order | Stage | Action |
|---------------|-----------------|-------|--------|
| 1 | 7 | Detect | Verify client still exists |
| 2 | 6 | Validate | Skip (no validation needed) |
| 3 | 5 | Bootstrap | Remove `.fabric/` directory (if empty) |
| 4 | 4 | Hooks | Remove hooks from client config |
| 5 | 3 | Config | Remove `fabric-config.json` |
| 6 | 2 | Knowledge | Preserve knowledge directories (see AC2) |
| 7 | 1 | Verify | Confirm uninstallation |

### AC2: Knowledge Preservation

**GIVEN** the uninstall command reaches the Knowledge stage
**WHEN** knowledge directories contain user data
**THEN** the following behavior MUST occur:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Found 47 knowledge entries in team store                  │
│                                                             │
│   What would you like to do with this knowledge?            │
│                                                             │
│   ◉ Keep for future use (recommended)                      │
│   ○ Archive to ~/.fabric/archives/<timestamp>              │
│   ○ Delete permanently                                     │
│                                                             │
│   [↑↓ to navigate, Enter to select]                        │
└─────────────────────────────────────────────────────────────┘
```

**AND** if "Keep" is selected, the `.fabric/knowledge/` directory MUST NOT be removed
**AND** if "Delete" is selected, a confirmation MUST be required:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ⚠  WARNING: This will permanently delete 47 knowledge    │
│      entries. This action cannot be undone.                │
│                                                             │
│   Type "DELETE" to confirm: ________                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### AC3: Visual Symmetry

**GIVEN** the install command uses Visual Anchors (REQ-005)
**WHEN** the uninstall command runs
**THEN** the same visual elements MUST appear but with inverted semantics:

| Install | Uninstall |
|---------|-----------|
| `[+] Creating .fabric/` | `[-] Removing .fabric/` |
| `[→] Installing hooks` | `[←] Uninstalling hooks` |
| `[✓] Installation complete` | `[✓] Uninstallation complete` |
| Green checkmarks | Yellow checkmarks |

**Example Output**:
```
Fabric Uninstall
────────────────────────────────────────────────────────────

Stage 1/7: Verify
  [-] Checking installation state... ✓ Found Fabric v2.0.1

Stage 2/7: Knowledge
  [?] Found 47 entries in team store
  → User selected: Keep for future use

Stage 3/7: Config
  [-] Removing fabric-config.json... ✓

Stage 4/7: Hooks
  [←] Uninstalling hooks from Claude Code... ✓
  [←] Uninstalling hooks from Cursor... ✓

Stage 5/7: Bootstrap
  [-] Removing .fabric/ directory... ✓

────────────────────────────────────────────────────────────
✓ Uninstallation complete

Knowledge preserved at: .fabric/knowledge/
To fully remove, run: rm -rf .fabric/
```

### AC4: Rollback on Failure

**GIVEN** the uninstall process fails at stage N
**WHEN** an error occurs
**THEN** stages N-1 through 7 MUST have completed successfully
**AND** stages 1 through N-1 MUST remain completed
**AND** an error message MUST indicate the failure point:

```
✓ Stage 7: Verify
✓ Stage 6: Knowledge
✓ Stage 5: Config
✗ Stage 4: Hooks - Failed: Cannot modify .claude/settings.json (permission denied)

Uninstall partially complete. Remaining:
  - Hooks still installed for Claude Code

To retry: fabric uninstall --resume
To manually fix: Check file permissions on .claude/settings.json
```

## Technical Constraints

1. **MUST** share stage definitions with install command (DRY principle)
2. **MUST** support `--dry-run` flag that reports what would be removed
3. **MUST** support `--force` flag that skips knowledge preservation prompt
4. **SHOULD** support `--keep-knowledge` flag as a non-interactive default
5. **MAY** support `--backup <path>` to archive before uninstall

## Dependencies

- **REQ-001**: Stage refactor provides the reverse-order execution model

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Accidental data loss | HIGH | Knowledge preservation prompt, `--dry-run` by default |
| Partial uninstall leaving inconsistent state | MEDIUM | Rollback guidance, `--resume` support |
| User confusion about what remains | MEDIUM | Clear summary of partial state |

## Implementation Notes

- Consider implementing `UninstallStage` as a wrapper around `InstallStage` with `direction: 'uninstall'`
- Knowledge preservation logic should be a shared utility
- Document the `--force` flag dangers in help text

## Traceability

- **NFR-UX-001**: Symmetric UX reduces cognitive load (predictable behavior)
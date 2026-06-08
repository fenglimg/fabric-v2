# EPIC-004: Uninstall Symmetry

**Feature**: F-004 - Uninstall Symmetry
**Priority**: MUST (MVP)
**Estimated Size**: S (1-2 days)

## Overview

Implement `fabric uninstall` command that symmetrically reverses install, with clear user confirmation and safe removal of generated artifacts.

## User Story Map

```
[Developer] runs 'fabric uninstall'
    |
    v
[Confirm] --> [Preview] --> [Remove] --> [Verify]
```

## Stories

### STORY-004-A: Uninstall Confirmation Flow

**As a** Fabric user,
**I want** confirmation before uninstall,
**So that** I don't accidentally remove my Fabric setup.

**Acceptance Criteria**:
- [ ] AC1: Show what will be removed (files, directories, configs)
- [ ] AC2: Prompt "Are you sure you want to uninstall Fabric?" with default "No"
- [ ] AC3: Require `--force` flag to skip confirmation in scripts
- [ ] AC4: Show "Uninstall cancelled" message on user abort

**Size**: S
**REQ**: REQ-013
**Feature**: F-004

---

### STORY-004-B: Artifact Removal Logic

**As a** Fabric maintainer,
**I want** uninstall to remove only generated artifacts,
**So that** user-created knowledge is preserved.

**Acceptance Criteria**:
- [ ] AC1: Remove generated files: `agents.meta.json`, hook files
- [ ] AC2: Preserve user files: `fabric-config.json`, `.fabric/knowledge/`
- [ ] AC3: Remove empty directories (`.fabric/` if empty after artifact removal)
- [ ] AC4: Track generated artifacts in `agents.meta.json` manifest

**Size**: M
**REQ**: REQ-014
**Feature**: F-004

---

### STORY-004-C: Uninstall Verification and Report

**As a** Fabric user,
**I want** a clear report of what was removed,
**So that** I can verify the uninstall completed correctly.

**Acceptance Criteria**:
- [ ] AC1: List each removed file/directory with checkmark
- [ ] AC2: List preserved files with "kept" indicator
- [ ] AC3: Show summary: "Removed X files, Y directories"
- [ ] AC4: Verify no orphan files remain (hooks, temp files)

**Size**: S
**REQ**: REQ-015
**Feature**: F-004

---

## Technical Notes

### Uninstall Pipeline

```
[Load Manifest] --> [Preview Artifacts] --> [Confirm] --> [Remove] --> [Verify]
        |                  |                  |            |           |
        v                  v                  v            v           v
    [ERROR:             [Show list]      [User input]  [Delete]    [Report]
     not installed]
```

### Manifest Structure

```json
{
  "version": "2.0.0",
  "generated_files": [
    ".fabric/agents.meta.json",
    ".claude/hooks/fabric-session-start.cjs",
    ".cursor/hooks/fabric-session-start.cjs"
  ],
  "created_at": "2026-06-06T10:00:00Z",
  "fabric_version": "2.2.0"
}
```

### Preserved vs Removed

| Artifact | Action | Reason |
|----------|--------|--------|
| `fabric-config.json` | Preserve | User configuration |
| `.fabric/knowledge/` | Preserve | User knowledge |
| `.fabric/agents.meta.json` | Remove | Generated state |
| `.claude/hooks/fabric-*.cjs` | Remove | Generated hooks |
| `.fabric/` (if empty) | Remove | Cleanup |

## Dependencies

- EPIC-001 (Install Pipeline) - install must create manifest for uninstall to use

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Remove user data | Critical | Manifest tracking, explicit preserve list |
| Incomplete uninstall | Medium | Verification step, orphan detection |
| Cross-client cleanup | Low | Enumerate all hook paths in manifest |

## Definition of Done

- [ ] All 3 stories implemented and tested
- [ ] Round-trip test: install → uninstall → verify clean
- [ ] Test preserves user knowledge on uninstall
- [ ] `--dry-run` flag shows what would be removed

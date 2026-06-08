# EPIC-001: Install Pipeline Refactor

**Feature**: F-001 - Install Stage Refactor
**Priority**: MUST (MVP)
**Estimated Size**: M (3-5 days)

## Overview

Refactor the `fabric install` command from monolithic function to staged pipeline with clear separation of concerns. Each stage produces a well-defined artifact, enabling better error handling, testability, and future extensibility.

## User Story Map

```
[Developer] runs 'fabric install'
    |
    v
[Stage 1: Validate] --> [Stage 2: Prepare] --> [Stage 3: Install] --> [Stage 4: Verify]
```

## Stories

### STORY-001-A: Stage Orchestrator Pattern

**As a** Fabric maintainer,
**I want** a stage orchestrator that executes stages sequentially with rollback support,
**So that** install failures can cleanly revert partial state.

**Acceptance Criteria**:
- [ ] AC1: `InstallPipeline` class with `addStage(stage)` method
- [ ] AC2: Each stage implements `execute(): Promise<StageResult>` and `rollback(): Promise<void>`
- [ ] AC3: Pipeline stops on first failure and calls `rollback()` on completed stages in reverse order
- [ ] AC4: Unit tests cover success path, single-stage failure, and multi-stage rollback

**Size**: M
**REQ**: REQ-001
**Feature**: F-001

---

### STORY-001-B: Validation Stage

**As a** Fabric user,
**I want** pre-install validation to catch issues early,
**So that** I get clear errors before any filesystem changes.

**Acceptance Criteria**:
- [ ] AC1: Validate `fabric-config.json` exists and is valid JSON
- [ ] AC2: Validate required fields: `knowledge_dir`, `language`, `client_hooks`
- [ ] AC3: Check write permissions in target directories
- [ ] AC4: Return structured `ValidationResult` with specific error messages

**Size**: S
**REQ**: REQ-002
**Feature**: F-001

---

### STORY-001-C: Installation Stage

**As a** Fabric user,
**I want** the installation to create all required artifacts,
**So that** my project is ready to use Fabric.

**Acceptance Criteria**:
- [ ] AC1: Create `.fabric/` directory structure if not exists
- [ ] AC2: Generate `agents.meta.json` with correct derived state
- [ ] AC3: Install hooks to `.claude/hooks/`, `.cursor/hooks/`, `.codex/hooks/` per config
- [ ] AC4: Handle idempotent re-install (skip existing, warn on conflicts)

**Size**: M
**REQ**: REQ-003
**Feature**: F-001

---

### STORY-001-D: Verification Stage

**As a** Fabric user,
**I want** post-install verification to confirm success,
**So that** I can trust the installation worked correctly.

**Acceptance Criteria**:
- [ ] AC1: Verify all expected files exist with correct content
- [ ] AC2: Verify hook files are executable (Unix) or have correct extension (Windows)
- [ ] AC3: Verify `agents.meta.json` hash matches expected
- [ ] AC4: Return `VerificationResult` with detailed checklist

**Size**: S
**REQ**: REQ-004
**Feature**: F-001

---

## Technical Notes

### Stage Interface

```typescript
interface Stage {
  name: string;
  execute(context: InstallContext): Promise<StageResult>;
  rollback(context: InstallContext): Promise<void>;
}

interface StageResult {
  success: boolean;
  artifacts: string[];  // Created files/dirs for rollback
  errors: InstallError[];
}
```

### Pipeline Flow

```
validate() → prepare() → install() → verify()
     ↓           ↓           ↓          ↓
  [fail]      [fail]      [fail]     [fail]
     ↓           ↓           ↓          ↓
  (stop)     rollback   rollback   (warn only)
```

## Dependencies

- None (foundation epic)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing install paths break | High | Comprehensive integration tests against legacy behavior |
| Rollback partial state | Medium | Stage artifacts tracking, atomic file operations |
| Cross-platform path handling | Medium | Use `path.resolve()` consistently, test on Windows/macOS/Linux |

## Definition of Done

- [ ] All 4 stories implemented and tested
- [ ] Integration tests pass for full install flow
- [ ] Rollback tested for each stage failure scenario
- [ ] Documentation updated for new pipeline architecture

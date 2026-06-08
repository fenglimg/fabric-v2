---
title: Fabric CLI Install/Uninstall UX Refactoring
slug: fabric-install-ux-ink-tui
version: 1.0.0
status: draft
created: 2026-06-06
authors:
  - fabric-v2 team
domain: Developer Tools / CLI UX
---

# Product Brief: Fabric CLI Install/Uninstall UX Refactoring (ink TUI)

## Vision & Goals

### Vision
Transform Fabric CLI's install/uninstall flows from a fragmented console output system into a cohesive, visually-guided terminal wizard experience. Users SHOULD complete installation with confidence and clarity, never wondering "what just happened" or "what's next."

### Primary Goals
1. **Visual Coherence** — Replace mixed `console.log`/`clack`/`writeStderr` system with unified ink-based TUI components
2. **User Guidance** — Provide clear visual anchors at each of the 7 discrete pipeline stages
3. **Error Recovery** — Surface actionable error messages with remediation hints
4. **Idempotency Transparency** — Clearly communicate when operations are skipped due to existing state

### Secondary Goals
- Reduce support questions about install/uninstall behavior by 40%
- Achieve <3 second perceived latency for wizard initialization
- Support both interactive (wizard) and non-interactive (CI) modes

---

## Target Users

### Personas

#### P1: Solo Developer (Fresh Machine)
- **Context**: Just cloned a repo, running `fabric install` for the first time
- **Pain Points**: Uncertain what Fabric does, worried about side effects
- **Needs**: Clear explanation of each stage, confidence that operation is safe

#### P2: Team Member (Existing Project)
- **Context**: Joining a project with existing `.fabric/` configuration
- **Pain Points**: Wants to sync hooks without re-reading documentation
- **Needs**: Quick status display, minimal friction for routine operations

#### P3: Project Owner (Maintainer)
- **Context**: Managing `.fabric/knowledge/` and team onboarding
- **Pain Points**: Debugging install failures for teammates
- **Needs**: Verbose mode, exportable diagnostics, summary cards

#### P4: CI/CD Pipeline (Automation)
- **Context**: Running `fabric install --ci` in automated workflows
- **Pain Points**: Mixed output formats break log parsing
- **Needs**: Machine-readable output, stable exit codes, deterministic behavior

---

## Scope

### F-001: Unified Output Renderer
- **Description**: Single ink-based `OutputRenderer` component replacing all ad-hoc console output
- **Priority**: P0
- **Acceptance Criteria**:
  - MUST route all install/uninstall output through unified renderer
  - MUST support `--json` flag for CI mode
  - SHOULD detect TTY availability and adapt output format

### F-002: Pipeline Stage Visualization
- **Description**: Visual progress indicator for 7 discrete stages
- **Priority**: P0
- **Stages**:
  1. Environment Detection
  2. Store Initialization
  3. Config Loading
  4. Hook Deployment
  5. Knowledge Sync
  6. MCP Registration
  7. Summary & Verification
- **Acceptance Criteria**:
  - MUST display current stage with visual anchor (spinner/checkmark/cross)
  - MUST show stage duration on completion
  - SHOULD allow `--stage` flag to resume from specific stage

### F-003: Interactive Wizard Mode
- **Description**: Guided install flow with prompts and confirmations
- **Priority**: P0
- **Acceptance Criteria**:
  - MUST prompt for missing configuration values
  - MUST support `--non-interactive` flag to skip prompts
  - SHOULD remember previous choices in `.fabric/.install-preferences`

### F-004: Idempotency Indicators
- **Description**: Clear visual differentiation between "created" vs "already exists" states
- **Priority**: P1
- **Acceptance Criteria**:
  - MUST use distinct symbols for [NEW], [EXISTS], [UPDATED], [SKIPPED]
  - MUST display summary count of each state type
  - SHOULD show diff for updated files when `--verbose`

### F-005: Error Context Cards
- **Description**: Rich error messages with remediation hints
- **Priority**: P1
- **Acceptance Criteria**:
  - MUST include file path and operation context
  - MUST suggest at least one remediation action
  - SHOULD link to relevant documentation URL

### F-006: Summary Card
- **Description**: End-of-operation summary with key metrics
- **Priority**: P0
- **Acceptance Criteria**:
  - MUST be ≤15 lines in default mode
  - MUST include: files changed, hooks deployed, knowledge entries synced, duration
  - SHOULD support `--full-summary` for detailed breakdown

### F-007: Uninstall Confirmation Flow
- **Description**: Safe uninstall with explicit confirmation and dry-run
- **Priority**: P1
- **Acceptance Criteria**:
  - MUST require `--confirm` flag for destructive operations
  - MUST support `--dry-run` to preview changes
  - SHOULD preserve `.fabric/knowledge/` unless `--purge-all` specified

### F-008: Progress Persistence
- **Description**: Resume interrupted install/uninstall operations
- **Priority**: P2
- **Acceptance Criteria**:
  - MUST write progress to `.fabric/.install-progress.json` after each stage
  - MUST detect and offer resume on subsequent invocation
  - SHOULD support `--clean-start` to discard progress

---

## Non-Goals

1. **Backward Compatibility for Output Format** — Existing scripts parsing raw console output MAY break; migration guide provided
2. **Alias Commands** — No support for `fabric i`, `fabric u` shortcuts (use full commands)
3. **Non-CLI GUI** — Web-based or desktop GUI out of scope; focus on terminal UX
4. **Cross-Session State** — No sharing of install state between different terminals
5. **Plugin Architecture** — Output renderer is not pluggable; use ink components only

---

## Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Install completion rate (no errors) | 78% | 95% | Telemetry (opt-in) |
| User confusion incidents (support tickets) | 12/month | ≤7/month | GitHub issues |
| Perceived initialization latency | 4.2s | <3s | User testing (n=10) |
| CI log parse success rate | 67% | 99% | Automated test suite |
| Summary card accuracy (files changed count) | N/A | 100% | Unit tests |

---

## Risks & Mitigations

### R1: ink@4 Breaking Changes
- **Risk**: ink v4 API differs from v3; existing knowledge base may be outdated
- **Impact**: Medium
- **Mitigation**: Pin to `ink@^4.0.0`, read official migration guide, test on Node 18/20

### R2: Terminal Compatibility
- **Risk**: TUI components may render incorrectly in non-standard terminals (Windows Terminal, iTerm2, tmux)
- **Impact**: Medium
- **Mitigation**: Test on 5+ terminal emulators, implement fallback to simple mode for incompatible terminals

### R3: Performance Regression
- **Risk**: React-based rendering adds overhead vs direct `console.log`
- **Impact**: Low
- **Mitigation**: Profile with `node --inspect`, ensure <100ms overhead for typical operations

### R4: Idempotency Edge Cases
- **Risk**: Partial failures may leave inconsistent state, breaking idempotency
- **Impact**: High
- **Mitigation**: Implement atomic file operations, stage-level rollback on failure

### R5: User Resistance to Change
- **Risk**: Existing users accustomed to current output format may dislike new UX
- **Impact**: Low
- **Mitigation**: Provide `--legacy-output` flag for one version cycle, gather feedback in release notes

---

## Dependencies

### Technical
- `ink@^4.0.0` — React-based TUI framework
- `ink-spinner@^5.0.0` — Progress indicators
- `ink-text-input@^6.0.0` — Interactive prompts
- `ink-box@^3.0.0` — Bordered containers

### Process
- Fabric CLI v2.2.0 codebase access
- User testing participants (n≥10)
- Documentation update capacity

---

## Timeline

| Phase | Duration | Milestones |
|-------|----------|------------|
| Design | 1 week | Component mockups, interaction flow diagrams |
| Implementation | 2 weeks | F-001 to F-008 development |
| Testing | 1 week | Terminal compatibility, CI integration tests |
| Documentation | 3 days | Migration guide, FAQ updates |
| Release | 1 day | v2.3.0 release with feature flag |

---

## Appendix: Stage Details

### Stage 1: Environment Detection
- Detect Node.js version, npm/pnpm version, OS, terminal capabilities
- Validate minimum requirements (Node ≥18)

### Stage 2: Store Initialization
- Create `~/.fabric/stores/<id>/` if not exists
- Initialize store metadata

### Stage 3: Config Loading
- Read `.fabric/fabric-config.json`
- Validate schema, apply defaults

### Stage 4: Hook Deployment
- Write hooks to `.claude/hooks/`, `.cursor/hooks/`, `.codex/hooks/`
- Detect client installations

### Stage 5: Knowledge Sync
- Scan `.fabric/knowledge/` directories
- Build metadata index

### Stage 6: MCP Registration
- Update Claude Code settings for MCP server
- Register fabric-archive skill

### Stage 7: Summary & Verification
- Display summary card
- Run integrity checks

# Guidance Specification: Fabric CLI Install/Uninstall UX Refactoring

## §1. Project Positioning & Goals

**Problem Statement**: Fabric CLI 的 install/uninstall 流程功能解耦良好，但用户体验存在引导断层。`fabric install` 完成后无明确下一步指引，`fabric store *` 命令让用户无所适从，CLI 输出缺乏视觉锚点和交互连贯性。

**Target Solution**: 采用 ink TUI 方案，重构 install 为 7 阶段智能引导流程，补充 uninstall 对称性清理，统一输出层为 React 组件化 TUI。

**Primary Goals**:
1. 统一 install wizard - 单一入口处理所有场景（首次全局、团队加入、项目初始化）
2. 视觉体验升级 - 引入 ink 组件，提供 step counter、spinner、summary card
3. 对称 uninstall - 新增 store-binding-cleanup 阶段
4. 支持 config 面板 - 为后续 fabric config 交互式设置预留架构

## §2. Concepts & Terminology

| Term | Definition | Aliases | Category |
|------|------------|---------|----------|
| **ink** | React for CLI - Declarative component framework for terminal apps | inkjs | Technical |
| **TUI** | Terminal User Interface - Interactive CLI with widgets and dynamic refresh | - | Technical |
| **Store** | Knowledge repository - Git-backed team knowledge storage | team-store | Core |
| **Store-binding** | Project-store association - Links project to store via required_stores | bind | Core |
| **Pipeline Stage** | Atomic execution unit - Defined scope, actions, idempotency, failure_mode | stage | Technical |
| **Wizard** | Interactive guided flow - Multi-step prompts with smart defaults | onboarding | Technical |
| **Visual Anchor** | Structural UI element - Step counters, box separators, headers | anchor | Technical |
| **Output Layer** | Unified rendering abstraction - Single component system for all CLI output | renderer | Technical |

## §3. Non-Goals (Out of Scope)

| Non-Goal | Rationale |
|----------|-----------|
| Backward compatibility | Zero users stated - no migration path needed |
| Gradual upgrade (Plan A) | User selected Plan B (ink TUI) - not incremental approach |
| Independent `fabric store *` optimization | Goal is unified in install wizard - store commands remain for advanced users only |
| Non-CLI GUI (Web/Electron) | Explicit TUI scope - browser/desktop UI out of scope |
| Alias commands (fabric join/setup) | User feedback: unnecessary - keep single `fabric install` entry point |
| i18n for new UI components | Can defer - English first, localization later |

## §4. System Architect Decisions

### SA-01: Install Pipeline Refactoring
**Decision**: MUST refactor install.ts from monolithic 2000+ lines to 7 discrete stages with clear scope boundaries.

**Constraints**:
- MUST separate global-layer (uid + personal store) from project-scaffold
- MUST add store-onboarding stage with interactive wizard
- MUST ensure each stage is idempotent (repeat execution safe)
- SHOULD detect context automatically (fresh machine vs existing project)

**Rationale**: Current single-file architecture makes maintenance hard; staged approach enables per-stage testing and clearer error handling.

### SA-02: ink TUI Architecture
**Decision**: MUST introduce ink as the primary UI framework, replacing mixed console.log/clack/writeStderr system.

**Constraints**:
- MUST use ink components for all user-facing output
- MUST implement OutputRenderer abstraction layer
- SHOULD use @inkjs/ui for standard components (Box, Text, Spinner, SelectInput)
- MAY retain clack for simple prompts during migration

**Rationale**: ink provides React paradigm, flexbox layout, and live-updating dashboards; enables future config panel implementation.

### SA-03: Uninstall Symmetry
**Decision**: MUST add store-binding-cleanup stage to uninstall.ts.

**Constraints**:
- MUST mirror install stages in reverse order
- MUST preserve knowledge/ content (E4 protocol - never delete)
- MUST prompt user before unmount store (only when no other projects bound)
- SHOULD provide rollback path via re-run `fabric install`

**Rationale**: Current uninstall misses store binding cleanup, leaving orphan entries in global registry.

### SA-04: Output Layer Unification
**Decision**: MUST create unified OutputRenderer interface.

**Constraints**:
- MUST replace all console.log with renderer methods
- MUST replace writeStderr nudge with ink components
- SHOULD provide summaryCard(), stepHeader(), progressSpinner(), errorBox() primitives
- MAY support streaming output for long operations

**Rationale**: Eliminates three-system fragmentation; single component tree ensures visual consistency.

## §5. UX Expert Decisions

### UX-01: Store Onboarding Wizard Flow
**Decision**: MUST implement interactive wizard in store-onboarding stage.

**Constraints**:
- MUST auto-detect: fresh machine, existing global, team URL available
- MUST prompt: "Configure a shared knowledge store?" with Skip/Join/Create options
- MUST handle --url flag by auto-joining (skip wizard)
- SHOULD display store concept 30-second explanation before prompt

**Rationale**: Users confused about store necessity; wizard provides context-aware guidance.

### UX-02: Post-Setup Guidance
**Decision**: MUST output "3-Step Quick Start" guidance after install completes.

**Constraints**:
- MUST display: (1) Restart AI client (2) Try /fabric-archive skill (3) Write knowledge
- MUST show store status summary (mounted, bound, write target)
- SHOULD detect unbound stores and emit bind nudge
- MAY link to surfaces.md for deeper docs

**Rationale**: Users currently see capability table but no actionable next steps.

### UX-03: Error Visual Weight
**Decision**: MUST upgrade error presentation for drift-abort and critical failures.

**Constraints**:
- MUST use boxen-style red border for blocking errors
- MUST display prominent X symbol
- MUST provide recovery suggestion in error card
- SHOULD differentiate warnings (yellow) from errors (red)

**Rationale**: Current errors blend into output stream; users miss critical blocking information.

### UX-04: Progress Feedback
**Decision**: MUST add spinner and progress indicators for CPU-heavy operations.

**Constraints**:
- MUST use ora-style spinner for forensic scan, bootstrap hooks
- MUST show "done in Xms" timing feedback
- SHOULD support multi-task progress (listr2-style) for concurrent operations
- MAY show percentage for file copy operations

**Rationale**: Long operations currently show static stderr nudge; users feel stalled.

## §6. UI Designer Decisions

### UI-01: Visual Anchor System
**Decision**: MUST implement consistent visual anchors across install flow.

**Constraints**:
- MUST display step counter: "Step 1/7 Global Layer"
- MUST use box separator between stages
- MUST display branded Fabric ASCII logo at start
- SHOULD use consistent badge style for stage headers
- MAY color-code stages by scope (global=blue, project=green, client=purple)

**Rationale**: Current output lacks visual hierarchy; users cannot track progress.

### UI-02: Summary Card Design
**Decision**: MUST compress capability table and next-steps into single summary card.

**Constraints**:
- MUST use boxen-bordered card for final summary
- MUST include: installed clients, store status, write target
- MUST display 3-step quick start in card
- SHOULD keep card under 15 lines height
- MAY support compact mode (--quiet flag)

**Rationale**: Dispersed console.log blocks waste screen space; card provides dense, scanable summary.

### UI-03: Table Component
**Decision**: MUST replace manual padEnd tables with ink table component.

**Constraints**:
- MUST use cli-table3 or ink table for capability display
- MUST support responsive width adjustment
- SHOULD align columns automatically
- MAY support sorting/filtering for large tables

**Rationale**: Current manual table calculation is brittle; component ensures maintainability.

### UI-04: Color Palette
**Decision**: MUST establish consistent color palette for Fabric CLI.

**Constraints**:
- MUST define: success=green, warning=yellow, error=red, info=cyan
- MUST use muted colors for secondary info
- SHOULD support NO_COLOR environment variable
- MAY provide custom theme via fabric-config.json

**Rationale**: Current mixed color usage (paint.* vs chalk) inconsistent; unified palette improves readability.

## §7. Test Strategist Decisions

### TS-01: Per-Stage Testing
**Decision**: MUST implement unit tests for each pipeline stage independently.

**Constraints**:
- MUST test stage idempotency (run twice produces same result)
- MUST test failure_mode handling (graceful vs hard-fail)
- MUST mock external dependencies (git, filesystem, MCP configs)
- SHOULD test edge cases: partial install, interrupted execution

**Rationale**: Staged architecture enables isolated testing; ensures each stage robust independently.

### TS-02: Wizard Flow Testing
**Decision**: MUST test wizard branching logic.

**Constraints**:
- MUST test each wizard path: Skip/Join/Create
- MUST test --url auto-join path
- MUST test context detection accuracy
- SHOULD test wizard cancellation scenarios

**Rationale**: Wizard is primary user interaction; branching correctness critical.

### TS-03: Visual Output Testing
**Decision**: SHOULD implement snapshot testing for ink components.

**Constraints**:
- SHOULD capture expected output snapshots
- SHOULD test across terminal width variations
- MAY use ink-testing-library for component tests

**Rationale**: Visual output testing ensures UI changes don't accidentally break presentation.

## §8. Cross-Role Integration

### Integration Points
| Source Role | Target Role | Integration | Status |
|-------------|-------------|-------------|--------|
| System Architect | UX Expert | Stage definitions → wizard flow mapping | Pending |
| UX Expert | UI Designer | Wizard prompts → component design | Pending |
| UI Designer | System Architect | Component library → OutputRenderer interface | Pending |
| Test Strategist | All | Test strategy per stage/flow/component | Pending |

### Key Dependencies
- SA-02 (ink architecture) MUST complete before UI-01/02/03 can implement
- UX-01 (wizard flow) MUST finalize before TS-02 can test
- SA-01 (stage refactor) MUST complete before TS-01 can test stages

## §9. Risks & Constraints

| Risk | Severity | Mitigation |
|------|----------|------------|
| ink bundle size (~500KB) | Medium | Acceptable for CLI; user already has node_modules |
| React paradigm unfamiliarity | Low | Team can learn; ink API simpler than React web |
| Migration complexity | Medium | Phased rollout: OutputRenderer first, then wizard |
| Terminal compatibility | Low | ink handles most terminals; test on Windows/macOS/Linux |
| Forensic scan performance | Medium | Spinner feedback mitigates user perception |

## §10. Feature Decomposition

| F-ID | Slug | Description | Related Roles | Priority |
|------|------|-------------|---------------|----------|
| F-001 | install-stage-refactor | Refactor install.ts into 7 discrete stages | SA, TS | MUST |
| F-002 | ink-output-layer | Create OutputRenderer abstraction with ink components | SA, UI | MUST |
| F-003 | store-onboarding-wizard | Implement interactive store wizard | UX, UI | MUST |
| F-004 | uninstall-symmetry | Add store-binding-cleanup stage | SA, TS | MUST |
| F-005 | visual-anchor-system | Implement step counter, separators, branding | UI | SHOULD |
| F-006 | summary-card | Compress final output into boxen card | UI, UX | SHOULD |
| F-007 | error-presentation | Upgrade error visual weight with box styling | UI, UX | SHOULD |
| F-008 | progress-feedback | Add spinner and timing for long operations | UI, SA | MAY |

## §11. Appendix: Decision Tracking

| Decision ID | Role | Decision | Status | Ref |
|-------------|------|----------|--------|-----|
| SA-01 | system-architect | Install pipeline refactoring | locked | §4 |
| SA-02 | system-architect | ink TUI architecture | locked | §4 |
| SA-03 | system-architect | Uninstall symmetry | locked | §4 |
| SA-04 | system-architect | Output layer unification | locked | §4 |
| UX-01 | ux-expert | Store onboarding wizard | locked | §5 |
| UX-02 | ux-expert | Post-setup guidance | locked | §5 |
| UX-03 | ux-expert | Error visual weight | locked | §5 |
| UX-04 | ux-expert | Progress feedback | locked | §5 |
| UI-01 | ui-designer | Visual anchor system | locked | §6 |
| UI-02 | ui-designer | Summary card design | locked | §6 |
| UI-03 | ui-designer | Table component | locked | §6 |
| UI-04 | ui-designer | Color palette | locked | §6 |
| TS-01 | test-strategist | Per-stage testing | locked | §7 |
| TS-02 | test-strategist | Wizard flow testing | locked | §7 |
| TS-03 | test-strategist | Visual output testing | should | §7 |

## §12. Cross-Role Resolutions

### G-001: WizardStateMachine Interface Definition
| ID | Type | Source(s) | Resolution | Applied to |
|---|---|---|---|---|
| G-001 | gap | ux-expert/analysis (UX-E1), test-strategist/analysis (TD-006) | System Architect will define `WizardState` interface as part of InstallStage contract in `src/commands/install/types.ts`. Interface includes: `currentStep`, `context`, `transition(event)`, `cancel()`. | guidance §4 SA-01, test-strategist TODO |

### G-002: StageInput/StageOutput Sequencing
| ID | Type | Source(s) | Resolution | Applied to |
|---|---|---|---|---|
| G-002 | gap | system-architect/analysis, test-strategist/analysis (TD-002) | Sequencing clarified: (1) SA audits install.ts for 6→7 stage mapping, (2) SA defines StageInput/StageOutput in types.ts, (3) TS implements contract tests against SA's types. | system-architect TODO #1 |

### G-003: Ink Version Lock
| ID | Type | Source(s) | Resolution | Applied to |
|---|---|---|---|---|
| G-003 | gap | system-architect/analysis (SA-02), ui-designer/analysis | **Decision locked**: Use `ink@^4.0.0` + `@inkjs/ui@^2.0.0`. Rationale: ink v4 is ESM-first, stable, matches React 18 patterns. | guidance §4 SA-02, ui-designer dependencies |

### Synergies Validated
| ID | Roles | Description |
|---|---|---|
| S-001 | SA, TS | Idempotency test pattern aligned with stage state machine |
| S-002 | SA, UI | OutputRenderer primitives map 1:1 to UI components |
| S-003 | UX, UI | Error recovery-first pattern validated across roles |
| S-004 | UX, UI | 15-line cognitive load constraint converged |
| S-005 | TS, SA | Test fixture reuse from existing codebase patterns |
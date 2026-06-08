# Fabric CLI Install/Uninstall UX Refactoring PRD

## Overview

This PRD defines the requirements for refactoring the Fabric CLI install/uninstall commands from monolithic implementations to a modern Ink-based TUI with discrete stages, visual anchors, and symmetric user experience.

## Summary Table

| REQ ID | Title | Priority | Status | Dependencies |
|--------|-------|----------|--------|--------------|
| REQ-001 | Install Stage Refactor | MUST | Draft | None |
| REQ-002 | Ink Output Layer | MUST | Draft | REQ-001 |
| REQ-003 | Store Onboarding Wizard | MUST | Draft | REQ-001, REQ-002 |
| REQ-004 | Uninstall Symmetry | MUST | Draft | REQ-001 |
| REQ-005 | Visual Anchor System | SHOULD | Draft | REQ-002 |
| REQ-006 | Summary Card | SHOULD | Draft | REQ-002, REQ-005 |
| REQ-007 | Error Presentation | SHOULD | Draft | REQ-002 |
| REQ-008 | Progress Feedback | MAY | Draft | REQ-002 |
| NFR-PERF-001 | TUI Performance | MUST | Draft | REQ-001-008 |
| NFR-UX-001 | Cognitive Load | MUST | Draft | REQ-001-008 |
| NFR-TEST-001 | Coverage | MUST | Draft | REQ-001-008 |

## MoSCoW Breakdown

### MUST (Core Scope - Release Blocking)
- **REQ-001**: Install Stage Refactor - Split 2000+ line install.ts into 7 discrete, idempotent stages
- **REQ-002**: Ink Output Layer - Establish ink@^4.0.0 + @inkjs/ui@^2.0.0 foundation
- **REQ-003**: Store Onboarding Wizard - Multi-store onboarding flow with state machine
- **REQ-004**: Uninstall Symmetry - Mirror install UX in reverse order
- **NFR-PERF-001**: TUI must render < 100ms, no frame drops
- **NFR-UX-001**: Cognitive load metrics met (see NFR doc)
- **NFR-TEST-001**: 80% coverage on new TUI components

### SHOULD (High Value - Include if Possible)
- **REQ-005**: Visual Anchor System - Consistent visual markers across stages
- **REQ-006**: Summary Card - Compact result display < 15 lines
- **REQ-007**: Error Presentation - User-friendly error formatting

### MAY (Nice to Have - Future Enhancement)
- **REQ-008**: Progress Feedback - Indeterminate progress indicators

## Feature Traceability Matrix

| Feature ID | User Story | Acceptance Criteria | NFR Impact |
|------------|------------|---------------------|------------|
| F-001 | REQ-001 | AC1-AC4 | NFR-PERF-001, NFR-UX-001 |
| F-002 | REQ-002 | AC1-AC4 | NFR-PERF-001, NFR-TEST-001 |
| F-003 | REQ-003 | AC1-AC5 | NFR-UX-001, NFR-TEST-001 |
| F-004 | REQ-004 | AC1-AC4 | NFR-UX-001 |
| F-005 | REQ-005 | AC1-AC3 | NFR-UX-001 |
| F-006 | REQ-006 | AC1-AC4 | NFR-UX-001 |
| F-007 | REQ-007 | AC1-AC4 | NFR-UX-001 |
| F-008 | REQ-008 | AC1-AC3 | NFR-PERF-001 |

## Architecture Context

```
Current State: packages/cli/src/commands/install.ts (2000+ lines)
Target State:  packages/cli/src/commands/install/
                 ├── index.ts              (orchestrator)
                 ├── stages/
                 │   ├── stage-1-detect.ts
                 │   ├── stage-2-validate.ts
                 │   ├── stage-3-bootstrap.ts
                 │   ├── stage-4-hooks.ts
                 │   ├── stage-5-config.ts
                 │   ├── stage-6-knowledge.ts
                 │   └── stage-7-verify.ts
                 ├── components/
                 │   ├── VisualAnchor.tsx
                 │   ├── SummaryCard.tsx
                 │   ├── ErrorBoundary.tsx
                 │   └── ProgressIndicator.tsx
                 └── wizards/
                     └── StoreOnboardingWizard.tsx
```

## Stakeholder Review

| Reviewer | Role | Approval Status | Date |
|----------|------|-----------------|------|
| TBD | Product Owner | Pending | - |
| TBD | Tech Lead | Pending | - |
| TBD | UX Designer | Pending | - |

## Version History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-06-06 | Claude | Initial PRD generation |

---

**Next Steps**: Review individual REQ files for detailed acceptance criteria and implementation notes.

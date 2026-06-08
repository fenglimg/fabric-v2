# UX Expert Analysis: Fabric CLI Install/Uninstall UX Refactoring

KB: none [not-applicable]

## §1. Role Mandate

**Role**: UX Expert — User experience optimization, interaction design, usability testing, and design system consistency

**Assigned Features**:
- F-003: Store Onboarding Wizard (UX-01)
- F-006: Summary Card (UX-02)
- F-007: Error Presentation (UX-03)

**Cross-Cutting Focus**: Progress feedback (UX-04), Visual anchors (UI-01)

## §2. Decision Digest

### §2.1 Applied Guidance Decisions

| ID | Decision | Application |
|----|----------|-------------|
| UX-01 | MUST implement interactive wizard in store-onboarding stage | Store wizard MUST auto-detect context + prompt Skip/Join/Create options |
| UX-02 | MUST output "3-Step Quick Start" guidance after install completes | Summary card MUST embed actionable next steps |
| UX-03 | MUST upgrade error presentation for drift-abort and critical failures | Error visual weight MUST use boxen-style with recovery suggestion |
| UX-04 | MUST add spinner and progress indicators for CPU-heavy operations | Long operations MUST show ora-style spinner + timing feedback |

### §2.2 UX Expert Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| UX-E1 | Wizard MUST respect cancellation without blocking | Cancellation MUST be clean no-op — never gate completion (KT-DEC-0007) |
| UX-E2 | Error card MUST prioritize recovery over diagnosis | Users MUST see "how to fix" before "what went wrong" |
| UX-E3 | Summary card MUST stay under 15 lines height | Cognitive load constraint — users scan vertically |
| UX-E4 | Progress feedback MUST support interruption | Spinner MUST gracefully stop on user interrupt |
| UX-E5 | Wizard MUST NOT re-prompt when active_write_store exists | Idempotent behavior — respect existing configuration |
| UX-E6 | Error MUST differentiate blocking vs non-blocking | Critical errors MUST block; warnings MUST continue |

### §2.3 Deferred Decisions

| ID | Decision | Deferred Reason |
|----|----------|-----------------|
| UX-D1 | A/B testing wizard phrasing | Requires user base — zero-user phase |
| UX-D2 | Accessibility audit (WCAG 2.1 AA) | TUI scope limitation — terminal accessibility differs from web |
| UX-D3 | Usability testing with target personas | Zero-user phase — no real users to test |

### §2.4 Rejected Decisions

| ID | Decision | Rejection Rationale |
|----|----------|---------------------|
| UX-R1 | Multi-step wizard with back navigation | Terminal wizard simplicity — forward-only is standard TUI pattern |
| UX-R2 | Wizard progress bar | Over-engineering — single-step wizard doesn't need progress bar |
| UX-R3 | Error modal/popup | TUI constraint — boxen-style inline is terminal standard |

## §3. Cross-Cutting Foundations

### §3.1 Experience Principles

1. **Recall-first, write-second**: Users MUST see what exists before deciding to change
2. **Graceful degradation**: Non-critical failures MUST NOT block completion
3. **Actionable feedback**: Every message MUST include next action
4. **Idempotent safety**: Re-running MUST produce same result without re-prompting

### §3.2 Interaction Pattern Requirements

| Pattern | Requirement | F-ID |
|---------|-------------|------|
| Auto-detect | MUST detect: fresh machine, existing global, team URL available | F-003 |
| Clean cancellation | MUST allow cancel without side effects | F-003 |
| Recovery-first error | MUST show recovery suggestion before technical details | F-007 |
| Scanable summary | MUST compress status into dense, scannable card | F-006 |

### §3.3 Cognitive Load Constraints

- Summary card MUST stay under 15 lines (UX-E3)
- Wizard MUST show single decision at a time (UX-R1)
- Error MUST prioritize action over diagnosis (UX-E2)

### §3.4 Friction Point Analysis

| Friction | Current State | Target State | F-ID |
|----------|---------------|--------------|------|
| Post-install cliff | No actionable next steps | 3-step quick start in card | F-006 |
| Store confusion | Users don't understand store necessity | 30-second concept explanation | F-003 |
| Error invisibility | Errors blend into output stream | Boxen-style red border | F-007 |
| Long operation stall | Static stderr nudge | Ora-style spinner + timing | UX-04 |

## §4. File Index

| File | Feature | Content |
|------|---------|---------|
| analysis-F-003-store-onboarding-wizard.md | F-003 | Wizard flow, context detection, interaction patterns |
| analysis-F-006-summary-card.md | F-006 | Post-setup guidance, card design, cognitive load |
| analysis-F-007-error-presentation.md | F-007 | Error visual weight, recovery-first pattern, blocking logic |

## §5. TODOs

- [ ] UX-E1: Define cancellation behavior specification for wizard
- [ ] UX-E2: Write error card template with recovery-first structure
- [ ] UX-E3: Validate summary card line count constraint
- [ ] UX-E4: Specify spinner interrupt handling
- [ ] UX-E5: Document idempotent wizard skip logic
- [ ] UX-E6: Define blocking vs non-blocking error classification
- [ ] Cross-check with UI Designer on component boundaries
- [ ] Validate wizard flow against Test Strategist TS-02

---

**Analysis Date**: 2026-06-06
**Guidance Version**: guidance-specification.md §5
**Role Template**: ux-expert.md
# REQ-003: Store Onboarding Wizard

**Priority**: MUST
**Feature ID**: F-003
**Status**: Draft

## User Story

**As a** new Fabric user
**I want** an interactive wizard to configure my first knowledge store
**So that** I can start using Fabric without understanding the underlying store architecture.

## Context

With v2.1's multi-store architecture, users must understand store concepts before their first use. The current CLI assumes prior knowledge, leading to:
- Confusion about personal vs team stores
- Incorrect scope configuration
- Abandoned installations at the store setup step

## Acceptance Criteria

### AC1: First-Run Detection

**GIVEN** a user invoking `fabric install` for the first time
**WHEN** the install command detects no existing stores
**THEN** the wizard MUST be triggered automatically
**AND** a welcome screen MUST explain the multi-store concept:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Welcome to Fabric!                                        │
│                                                             │
│   Fabric organizes AI knowledge into "stores". Think of     │
│   stores as separate notebooks for different contexts:      │
│                                                             │
│   • Personal store - Your private notes and rules           │
│   • Team stores - Shared rules for your projects            │
│                                                             │
│   Let's set up your first store...                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### AC2: Guided Store Creation

**GIVEN** the wizard is active
**WHEN** the user proceeds through the flow
**THEN** the following questions MUST be asked in sequence:

```
Step 1/3: Store Type
┌─────────────────────────────────────────────────────────────┐
│ What kind of knowledge will this store contain?             │
│                                                             │
│   ◉ Personal rules (just for me)                           │
│   ○ Team rules (shared with my team)                       │
│   ○ Both - create personal and team stores                 │
│                                                             │
│   [↑↓ to navigate, Enter to select]                        │
└─────────────────────────────────────────────────────────────┘

Step 2/3: Store Identity (if team selected)
┌─────────────────────────────────────────────────────────────┐
│ Team store identifier:                                      │
│                                                             │
│   my-project-team                                           │
│                                                             │
│   This will be used in citations like: K-TEAM-0001          │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Step 3/3: Default Scope
┌─────────────────────────────────────────────────────────────┐
│ How should this store be activated?                         │
│                                                             │
│   ◉ Always active (recommended for personal)               │
│   ○ Only in specific projects                               │
│   ○ Manual activation with fabric use <store>              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### AC3: State Machine Validation

**GIVEN** the wizard flow
**WHEN** the user makes selections
**THEN** the wizard MUST validate state transitions:

```typescript
// State machine definition
type WizardState =
  | 'welcome'
  | 'select-type'
  | 'configure-personal'
  | 'configure-team'
  | 'configure-scope'
  | 'confirm'
  | 'complete';

type WizardEvent =
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'SELECT_TYPE'; value: 'personal' | 'team' | 'both' }
  | { type: 'SET_TEAM_ID'; value: string }
  | { type: 'SET_SCOPE'; value: 'always' | 'project' | 'manual' };

const wizardMachine = createMachine({
  initial: 'welcome',
  states: {
    welcome: {
      on: { NEXT: 'select-type' }
    },
    'select-type': {
      on: {
        SELECT_TYPE: [
          { target: 'configure-personal', cond: 'isPersonal' },
          { target: 'configure-team', cond: 'isTeam' },
          { target: 'configure-scope', cond: 'isBoth' }
        ],
        BACK: 'welcome'
      }
    },
    // ... remaining states
  }
});
```

**AND** invalid transitions MUST be prevented:
- Cannot skip from 'welcome' to 'confirm'
- Cannot set team ID if personal-only selected
- Cannot proceed without team ID if team store selected

### AC4: Skip and Resume

**GIVEN** the wizard is active
**WHEN** the user presses Ctrl+C or `--skip-wizard` flag is passed
**THEN** the wizard MUST exit with a clear message:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   Wizard skipped. Default store configuration applied.      │
│                                                             │
│   To re-run the wizard: fabric install --wizard             │
│   To manually configure: fabric store create                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**AND** partial progress MUST be saved to `.fabric/.wizard-state.json`
**AND** resuming MUST restore the previous state.

### AC5: Error Recovery

**GIVEN** the wizard encounters an error (e.g., invalid team ID format)
**WHEN** validation fails
**THEN** an inline error message MUST be displayed:

```
Step 2/3: Store Identity
┌─────────────────────────────────────────────────────────────┐
│ Team store identifier:                                      │
│                                                             │
│   my-project-team!@#                                        │
│                                                             │
│   ✗ Error: Store IDs must be alphanumeric with hyphens      │
│                                                             │
│   [Backspace to edit]                                       │
└─────────────────────────────────────────────────────────────┘
```

**AND** the user MUST be able to correct the input
**AND** the error MUST clear automatically when valid input is entered.

## Technical Constraints

1. **MUST** use XState or similar state machine library for flow control
2. **MUST** support keyboard navigation (arrows, Enter, Escape, Ctrl+C)
3. **MUST** persist wizard state to allow resume after crash
4. **SHOULD** support `--non-interactive` mode that accepts all defaults
5. **MAY** support `--wizard-config <file>` for pre-defined answers

## Dependencies

- **REQ-001**: Stage refactor defines when wizard runs (Stage 5: Config)
- **REQ-002**: Ink provides interactive components (Select, Confirm, TextInput)

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Complex state machine bugs | HIGH | Thorough unit tests with mocked state transitions |
| User confusion on multi-store concepts | MEDIUM | UX testing with new users, iterate on copy |
| Non-interactive CI environments | LOW | `--non-interactive` flag with sensible defaults |

## Implementation Notes

- Consider using `@xstate/react` for state machine integration with Ink
- Store state in `.fabric/.wizard-state.json` with schema versioning
- Provide a "wizard preview" mode for testing (`--dry-run --wizard`)

## Traceability

- **NFR-UX-001**: Wizard reduces cognitive load by guiding decisions
- **NFR-TEST-001**: State machine can be tested in isolation with mock events
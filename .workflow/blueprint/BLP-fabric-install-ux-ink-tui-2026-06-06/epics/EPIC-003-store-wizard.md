# EPIC-003: Store Onboarding Wizard

**Feature**: F-003 - Store Onboarding Wizard
**Priority**: MUST (MVP)
**Estimated Size**: L (5-8 days)

## Overview

Interactive wizard for store setup during install. Guides users through store creation, configuration, and initial knowledge seeding, making Fabric accessible to new users.

## User Story Map

```
[New User] runs 'fabric install' (first time)
    |
    v
[Welcome] --> [Store Type] --> [Store Config] --> [Seed Knowledge] --> [Complete]
```

## Stories

### STORY-003-A: Welcome and Onboarding Flow

**As a** new Fabric user,
**I want** a welcoming onboarding experience when I first run install,
**So that** I understand what Fabric does and feel guided.

**Acceptance Criteria**:
- [ ] AC1: Detect first-time install (no `.fabric/` exists)
- [ ] AC2: Show welcome message with Fabric overview
- [ ] AC3: Prompt "Would you like to set up a knowledge store?"
- [ ] AC4: Allow skip with "Run with defaults" option

**Size**: M
**REQ**: REQ-009
**Feature**: F-003

---

### STORY-003-B: Store Type Selection

**As a** Fabric user,
**I want** to choose my store type interactively,
**So that** I can match Fabric to my workflow.

**Acceptance Criteria**:
- [ ] AC1: Present options: "Team store (in-repo)" / "Personal store (~/.fabric)" / "Both"
- [ ] AC2: Show description and use-case for each option
- [ ] AC3: Default to "Team store" for solo users, "Both" for teams
- [ ] AC4: Allow reconfiguration via `fabric store init` later

**Size**: M
**REQ**: REQ-010
**Feature**: F-003

---

### STORY-003-C: Store Configuration Form

**As a** Fabric user,
**I want** to configure my store settings,
**So that** Fabric works with my project structure.

**Acceptance Criteria**:
- [ ] AC1: Prompt for store name (default: project name)
- [ ] AC2: Prompt for knowledge directory (default: `.fabric/knowledge/`)
- [ ] AC3: Prompt for default language (default: `zh` based on config)
- [ ] AC4: Validate inputs inline with helpful error messages

**Size**: M
**REQ**: REQ-011
**Feature**: F-003

---

### STORY-003-D: Initial Knowledge Seeding

**As a** new Fabric user,
**I want** starter knowledge templates,
**So that** I can see how Fabric works immediately.

**Acceptance Criteria**:
- [ ] AC1: Offer to create example entries: 1 decision, 1 guideline, 1 pitfall
- [ ] AC2: Templates are project-specific (detect Node.js, Python, etc.)
- [ ] AC3: Skip option with "I'll add knowledge later"
- [ ] AC4: Created entries have clear "EXAMPLE" marker for cleanup

**Size**: M
**REQ**: REQ-012
**Feature**: F-003

---

## Technical Notes

### Wizard State Machine

```
[IDLE] --> [WELCOME] --> [STORE_TYPE] --> [STORE_CONFIG] --> [SEED] --> [COMPLETE]
               |              |               |              |
               v              v               v              v
           [SKIP]         [BACK]          [BACK]         [SKIP]
               |              |               |              |
               +--------------+---------------+--------------+
                                              |
                                              v
                                         [COMPLETE]
```

### Ink Components

```tsx
<Wizard>
  <WelcomeStep />
  <StoreTypeStep />
  <StoreConfigStep />
  <SeedKnowledgeStep />
  <CompleteStep />
</Wizard>
```

### Prompts Library

Consider using `@inquirer/prompts` for consistent UX:
- `select()` for single choice
- `checkbox()` for multiple selection
- `input()` for text input
- `confirm()` for yes/no

## Dependencies

- EPIC-001 (Install Pipeline) - wizard integrates with install stages
- EPIC-002 (Ink TUI) - uses Ink components for rendering

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Non-interactive environments | High | `--non-interactive` flag falls back to defaults |
| Long wizard causes fatigue | Medium | Each step shows progress indicator, allow quick skip |
| Template relevance | Low | Project detection heuristics, easy cleanup |

## Definition of Done

- [ ] All 4 stories implemented and tested
- [ ] Wizard works in interactive and non-interactive modes
- [ ] Integration tests cover full wizard flow
- [ ] Documentation includes wizard screenshots

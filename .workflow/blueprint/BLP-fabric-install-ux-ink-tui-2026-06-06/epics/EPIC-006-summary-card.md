# EPIC-006: Summary Card

**Feature**: F-006 - Summary Card
**Priority**: SHOULD (Enhancement)
**Estimated Size**: S (1-2 days)

## Overview

Rich summary card displayed at the end of install/uninstall operations, showing what was done, where artifacts are, and next steps.

## User Story Map

```
[User] completes install/uninstall
    |
    v
[Summary Card] --> [Next Steps]
```

## Stories

### STORY-006-A: Install Summary Card

**As a** Fabric user,
**I want** a summary card after install completes,
**So that** I can see what was created and where.

**Acceptance Criteria**:
- [ ] AC1: Show header: "Fabric Installed Successfully"
- [ ] AC2: List created artifacts with paths
- [ ] AC3: Show knowledge store statistics (if applicable)
- [ ] AC4: Display configuration summary (language, clients)

**Size**: S
**REQ**: REQ-019
**Feature**: F-006

---

### STORY-006-B: Next Steps Guidance

**As a** new Fabric user,
**I want** next step suggestions,
**So that** I know how to start using Fabric.

**Acceptance Criteria**:
- [ ] AC1: Show "Next Steps" section with 2-3 actionable items
- [ ] AC2: Include example commands: `fabric doctor`, `fabric store add`
- [ ] AC3: Link to documentation URL
- [ ] AC4: Adapt suggestions based on install context (first-time vs. re-install)

**Size**: S
**REQ**: REQ-020
**Feature**: F-006

---

## Technical Notes

### Summary Card Layout

```
╔══════════════════════════════════════════════════════════════╗
║                    Fabric Installed ✓                        ║
╠══════════════════════════════════════════════════════════════╣
║  Created Artifacts                                           ║
║  ├─ .fabric/agents.meta.json                                ║
║  ├─ .claude/hooks/fabric-session-start.cjs                  ║
║  └─ .cursor/hooks/fabric-session-start.cjs                  ║
║                                                              ║
║  Knowledge Store                                             ║
║  ├─ Type: Team (in-repo)                                    ║
║  ├─ Location: .fabric/knowledge/                            ║
║  └─ Entries: 3 decisions, 2 guidelines, 1 pitfall           ║
║                                                              ║
║  Configuration                                               ║
║  ├─ Language: zh                                            ║
║  └─ Clients: claude-code, cursor                             ║
╠══════════════════════════════════════════════════════════════╣
║  Next Steps                                                  ║
║  1. Run 'fabric doctor' to verify setup                     ║
║  2. Add knowledge: .fabric/knowledge/decisions/             ║
║  3. Docs: https://fabric.dev/docs/getting-started           ║
╚══════════════════════════════════════════════════════════════╝
```

### Ink Component

```tsx
<SummaryCard>
  <SummaryHeader success={true} title="Fabric Installed" />
  <SummarySection title="Created Artifacts">
    {artifacts.map(a => <ArtifactItem key={a.path} {...a} />)}
  </SummarySection>
  <SummarySection title="Knowledge Store">
    <StoreStats {...storeStats} />
  </SummarySection>
  <SummarySection title="Configuration">
    <ConfigSummary {...config} />
  </SummarySection>
  <NextSteps steps={nextSteps} />
</SummaryCard>
```

### Data Structure

```typescript
interface InstallSummary {
  success: boolean;
  artifacts: Array<{
    path: string;
    type: 'file' | 'directory';
    action: 'created' | 'updated' | 'skipped';
  }>;
  store: {
    type: 'team' | 'personal' | 'both';
    location: string;
    stats: {
      decisions: number;
      guidelines: number;
      pitfalls: number;
      models: number;
      processes: number;
    };
  };
  config: {
    language: string;
    clients: string[];
  };
  nextSteps: Array<{
    description: string;
    command?: string;
    url?: string;
  }>;
}
```

## Dependencies

- EPIC-002 (Ink TUI) - uses Ink components for rendering
- EPIC-001 (Install Pipeline) - stages provide summary data

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Card width on narrow terminals | Medium | Responsive layout, truncate long paths |
| Too much information | Low | Hierarchical display, collapsible sections |

## Definition of Done

- [ ] Both stories implemented and tested
- [ ] Card renders correctly at 80, 120, 200 column widths
- [ ] Uninstall also shows summary card
- [ ] Summary card exported as reusable component

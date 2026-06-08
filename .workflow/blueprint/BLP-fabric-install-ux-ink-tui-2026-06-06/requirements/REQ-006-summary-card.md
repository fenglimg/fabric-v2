# REQ-006: Summary Card

**Priority**: SHOULD
**Feature ID**: F-006
**Status**: Draft

## User Story

**As a** Fabric CLI user
**I want** a compact summary at the end of installation
**So that** I can quickly verify what was configured without scrolling through pages of output.

## Context

After a successful install, users currently need to scroll back through the entire log to see what was created. This is error-prone and time-consuming, especially in long-running installations.

## Acceptance Criteria

### AC1: Height Constraint

**GIVEN** a completed installation
**WHEN** the summary card is rendered
**THEN** the total height MUST NOT exceed 15 lines
**AND** the card MUST be visually distinct from regular output:

```
┌──────────────────────────────────────────────────────────┐
│ Fabric v2.0.1 Installed                                  │
├──────────────────────────────────────────────────────────┤
│ Client:     Claude Code v2.1.0                          │
│ Stores:     2 configured (1 personal, 1 team)           │
│ Knowledge:  0 entries (ready for first run)             │
│ Hooks:      2 installed (SessionStart, PreToolUse)      │
│ Config:     .fabric/fabric-config.json                  │
│                                                          │
│ Next steps:                                              │
│   • Add knowledge: fabric knowledge create              │
│   • View status: fabric status                          │
│   • Read docs: https://fabric.dev/docs                  │
└──────────────────────────────────────────────────────────┘
```

**Height breakdown**:
- Header: 2 lines
- Content: 5 lines
- Next steps: 4 lines
- Total: 11 lines (under 15 line limit)

### AC2: Dynamic Content

**GIVEN** different installation scenarios
**WHEN** the summary card is rendered
**THEN** it MUST adapt to show relevant information:

**Scenario A: Fresh Install (No Knowledge)**
```
│ Knowledge:  0 entries (ready for first run)             │
```

**Scenario B: Import from Existing**
```
│ Knowledge:  47 entries imported from legacy KB           │
│             • 12 decisions, 8 pitfalls, 27 guidelines   │
```

**Scenario C: Multi-Client Install**
```
│ Client:     Claude Code, Cursor (2 clients detected)   │
│ Hooks:      4 installed (2 per client)                 │
```

**Scenario D: Store Onboarding Completed**
```
│ Stores:     2 configured                                │
│             • personal (always active)                  │
│             • team-proj-alpha (project scope)           │
```

### AC3: Actionable Next Steps

**GIVEN** a completed installation
**WHEN** the summary card displays
**THEN** the "Next steps" section MUST provide relevant commands based on context:

| Scenario | Next Steps |
|----------|-----------|
| Fresh install | `fabric knowledge create`, `fabric docs` |
| Imported knowledge | `fabric status`, `fabric knowledge list` |
| Multi-client | `fabric hooks verify`, `fabric status --client=cursor` |
| Store wizard completed | `fabric store list`, `fabric use <store-id>` |

**AND** commands MUST be copy-pasteable:
```tsx
<Text>
  <Text dimColor>• </Text>
  <Text>Add knowledge: </Text>
  <Text backgroundColor="#333" paddingX={1}>fabric knowledge create</Text>
</Text>
```

### AC4: Failure Summary

**GIVEN** a failed installation
**WHEN** the summary card is rendered
**THEN** it MUST show failure context:

```
┌──────────────────────────────────────────────────────────┐
│ Fabric Installation Failed                               │
├──────────────────────────────────────────────────────────┤
│ Stage:      4/7 (Hooks)                                 │
│ Error:      Permission denied on .claude/settings.json  │
│                                                          │
│ Completed:                                              │
│   ✓ Stage 1-3: Detect, Validate, Bootstrap              │
│                                                          │
│ Remaining:                                               │
│   ✗ Stage 4: Hooks (failed)                             │
│   ⊘ Stage 5-7: Config, Knowledge, Verify                │
│                                                          │
│ Recovery:                                                │
│   • Fix permissions: chmod 644 .claude/settings.json    │
│   • Resume: fabric install --resume-from=4              │
│   • Full log: fabric install --verbose                  │
└──────────────────────────────────────────────────────────┘
```

## Technical Constraints

1. **MUST** use Ink Box component with border styling
2. **MUST** truncate long paths/IDs to fit within card width
3. **SHOULD** support `--json` output for programmatic consumption
4. **MAY** support custom summary templates

## Dependencies

- **REQ-002**: Ink provides Box component for card rendering
- **REQ-005**: Visual Anchors used within the card

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Card exceeds 15 lines in complex scenarios | LOW | Dynamic content truncation with "..." |
| Terminal width too narrow for card | LOW | Responsive width adaptation (min 60 chars) |

## Implementation Notes

- Create a `<SummaryCard>` component with conditional rendering logic
- Use a `formatSummary()` utility to generate card content
- Test with various terminal widths (80, 120, 160 chars)

## Traceability

- **NFR-UX-001**: Summary card reduces cognitive load for result verification
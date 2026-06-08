# UI Designer Analysis: Fabric CLI Install/Uninstall UX Refactoring

**Visual System**: This analysis covers UX structure and interaction design only. Visual styling decisions (colors, typography, spacing) will be determined by the design system integration in Phase 2.

**Guidance Reference**: This analysis addresses UI decisions UI-01 through UI-04 from the guidance specification (Section 6).

---

## 1. Role Mandate

### 1.1 Design Goal

Transform Fabric CLI's install/uninstall flow from fragmented console output into a cohesive, visually-anchored terminal experience using ink TUI framework.

### 1.2 Target Users

| User Type | Description | Primary Need |
|-----------|-------------|--------------|
| **First-time user** | New developer trying Fabric | Clear guidance, visual progress, next steps |
| **Team joiner** | Developer joining existing project | Quick setup, store connection |
| **Project initializer** | Developer starting new project | Full configuration, store creation |
| **Advanced user** | Power user with existing config | Minimal friction, skip wizard |

### 1.3 Design Philosophy

- **Progressive disclosure**: Show only essential info, expand on demand
- **Visual consistency**: Unified component language across all stages
- **Graceful degradation**: Terminal width/NO_COLOR support
- **Action-oriented**: Clear next steps, not just status tables

### 1.4 User Experience Goals

- **Usability**: User MUST track progress through 7-stage pipeline
- **Efficiency**: User MUST complete install in under 60 seconds (normal path)
- **Clarity**: User MUST understand what happened and what to do next
- **Recovery**: User MUST know how to fix errors without re-running entire flow

---

## 2. Decision Digest

### 2.1 Feature Mapping Table

| F-ID | Feature | UI Decision | Status | Priority |
|------|---------|-------------|--------|----------|
| F-005 | visual-anchor-system | UI-01 | locked | SHOULD |
| F-006 | summary-card | UI-02 | locked | SHOULD |
| F-007 | error-presentation | UI-03 | locked | SHOULD |
| F-008 | progress-feedback | UI-04 | locked | MAY |

### 2.2 Component Inventory Table

| Component | Type | States | F-ID | Dependencies |
|-----------|------|--------|------|--------------|
| StepCounter | Visual Anchor | default, active, completed | F-005 | ink/Text |
| StageSeparator | Visual Anchor | default | F-005 | ink/Box |
| BrandedLogo | Visual Anchor | default | F-005 | ink/Text + chalk |
| SummaryCard | Container | default, compact | F-006 | ink/Box, boxen |
| StoreStatusBadge | Indicator | bound, unbound, error | F-006 | ink/Text |
| QuickStartList | Information | default | F-006 | ink/Text |
| ErrorBox | Container | error, warning | F-007 | ink/Box, boxen |
| RecoverySuggestion | Information | default | F-007 | ink/Text |
| ProgressSpinner | Feedback | running, success, error | F-008 | ink/Spinner |
| TimingDisplay | Feedback | default | F-008 | ink/Text |

### 2.3 State Matrix Table

| Component | Default | Active | Loading | Error | Success | Compact |
|-----------|---------|--------|---------|-------|---------|---------|
| StepCounter | gray "Step 1/7" | cyan bold | - | - | green checkmark | inline |
| SummaryCard | boxen border | - | - | red border | green border | no border |
| ErrorBox | - | - | - | red box with X | - | - |
| ProgressSpinner | - | ora spinner | spinning | X symbol | checkmark | - |
| StoreStatusBadge | gray | cyan | yellow | red | green | inline |

### 2.4 Interaction Pattern Table

| Pattern | Trigger | Response | Feedback |
|---------|---------|----------|----------|
| Stage transition | Stage complete | Update StepCounter, show separator | Timing display |
| Store bind | User confirms | Show spinner, update badge | Success/failure message |
| Error recovery | Error detected | Display ErrorBox | Recovery suggestion |
| Final summary | All stages complete | Render SummaryCard | Quick start list |
| Terminal resize | Width change | Re-render responsive layout | Maintain readability |

---

## 3. Cross-Cutting Foundations

### 3.1 Information Architecture

```
fabric install flow:
├── Header (branded logo)
├── Pipeline Progress
│   ├── Step 1/7: Global Layer
│   │   ├── [Stage content]
│   │   └── [Separator]
│   ├── Step 2/7: Project Scaffold
│   │   └── ...
│   └── Step 7/7: Post-Setup
├── Summary Card
│   ├── Client Status Table
│   ├── Store Status
│   └── Quick Start Guide
└── Footer (version, docs link)
```

### 3.2 Responsive Strategy

| Terminal Width | Layout Adaptation |
|----------------|-------------------|
| **>= 100 cols** | Full card borders, multi-column status table |
| **80-99 cols** | Narrow cards, single-column table |
| **< 80 cols** | Compact mode (--quiet style), inline status |
| **NO_COLOR env** | Monochrome output, retain structure |

### 3.3 Accessibility Considerations

- **Keyboard navigation**: All wizard prompts MUST be keyboard-navigable
- **Color contrast**: MUST maintain WCAG AA equivalent in terminal
- **Screen reader**: Structural markers for assistive technology (future)
- **Motion reduction**: Spinners MUST respect terminal capabilities

### 3.4 Design Token System

```
Colors (chalk/ink compatible):
- success: #22c55e (green-500)
- warning: #eab308 (yellow-500)
- error: #ef4444 (red-500)
- info: #06b6d4 (cyan-500)
- muted: #6b7280 (gray-500)
- primary: #3b82f6 (blue-500)

Typography:
- header: bold
- body: normal
- code: monospace
- muted: dim

Spacing:
- card-padding: 1 line
- section-gap: 1 line
- separator-height: 1 line
```

---

## 4. File Index

| File | Description | Status |
|------|-------------|--------|
| [analysis.md](./analysis.md) | INDEX document (this file) | READY |
| [analysis-F-005-visual-anchor-system.md](./analysis-F-005-visual-anchor-system.md) | UI-01: Visual anchor specification | READY |
| [analysis-F-006-summary-card.md](./analysis-F-006-summary-card.md) | UI-02: Summary card specification | READY |
| [analysis-F-007-error-presentation.md](./analysis-F-007-error-presentation.md) | UI-03: Error presentation specification | READY |
| [analysis-F-008-progress-feedback.md](./analysis-F-008-progress-feedback.md) | UI-04: Progress feedback specification | READY |

---

## 5. TODOs

### 5.1 Implementation Dependencies

- [ ] **BLOCKER**: SA-02 (ink architecture) MUST complete before F-005/F-006/F-007/F-008 implementation
- [ ] OutputRenderer interface MUST define `stepHeader()`, `summaryCard()`, `errorBox()`, `progressSpinner()` primitives
- [ ] Install dependency: `@inkjs/ui`, `boxen`, `chalk`

### 5.2 Design Validation Tasks

- [ ] ASCII wireframe review with System Architect
- [ ] Component state matrix validation with UX Expert
- [ ] Color palette accessibility audit (contrast ratios)
- [ ] Terminal width testing plan (80/100/120 columns)

### 5.3 Integration Points

| Integration | Source | Target | Status |
|-------------|--------|--------|--------|
| Stage headers | SA-01 stages | UI-01 StepCounter | Pending |
| Error mapping | SA-04 failure_mode | UI-03 ErrorBox | Pending |
| Progress events | SA-01 stage lifecycle | UI-04 ProgressSpinner | Pending |
| Summary data | UX-02 post-setup | UI-02 SummaryCard | Pending |

---

## 6. References

- **Guidance Spec**: `.workflow/scratch/20260606-brainstorm-fabric-install-ux-ink-tui/guidance-specification.md`
- **Role Template**: `~/.maestro/templates/planning-roles/ui-designer.md`
- **ink Documentation**: https://github.com/vadimdemedes/ink
- **@inkjs/ui**: https://github.com/vadimdemedes/ink-ui

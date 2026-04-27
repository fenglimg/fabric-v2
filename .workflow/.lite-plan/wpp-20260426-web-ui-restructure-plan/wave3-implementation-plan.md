# Wave 3: Implementation Plan

This document serves as the implementation blueprint for the Web UI Restructure, fulfilling the Wave 3 requirements. Since the preliminary structural implementation of Wave 2 was completed proactively, this plan focuses on component consolidation, testing strategies, and i18n extraction to reach full production readiness.

## 1. File-Level Implementation Steps

### Completed Structural Steps (Wave 2)
- **`packages/dashboard/src/app.tsx`**: Updated to host the 4 core routes (`#readiness`, `#rules-explain`, `#timeline`, `#health`), removing legacy placeholders.
- **`packages/dashboard/src/views/readiness.tsx`**: Implemented using `getScan()`, focusing on read-only project readiness and setup guidance.
- **`packages/dashboard/src/views/rules-explain.tsx`**: Merged `rules-tree.tsx` and `rule-topology.tsx` into a split-pane layout (Registry Tree on the left, Topology/Heatmap on the right).
- **`packages/dashboard/src/views/timeline.tsx`**: Merged `intent-timeline.tsx` and `history-replay.tsx`. Features a main chronological feed with a side-drawer for snapshot replay.
- **`packages/dashboard/src/views/health.tsx`**: Updated from `doctor.tsx` to include Tooling Boundaries and SSE (MCP Runtime) connection status.

### Next Steps for Polish
- **i18n Extraction**: Extract hardcoded English strings from the newly created views into `packages/shared/src/i18n/locales/en.ts` and `zh-CN.ts`.
- **Test Implementation**: Add or update UI unit tests for the four core views to assert boundary constraints (no write actions).
- **Stale Code Cleanup**: Remove unused deprecated files if any linger.

## 2. Component Reuse and New Components

### Reused Components
- `ViewHeader` (moved to `rules-explain.tsx` but could be centralized).
- `DriftIndicator`: Used across all views for status representation.
- `HitReasonPanel`: Reused in `RulesExplainView`.
- `CoverageHeatmap`: Reused in `RulesExplainView`.
- `TimelineEntry` & `SourceBadge`: Reused in `TimelineView`.
- `TreeNode`: Reused in `RulesExplainView` and `TimelineView`.

### New / Promoted Components (To extract if reused further)
- **`SummaryCard`**: Currently in `health.tsx` and `readiness.tsx`. Should be abstracted as a shared micro-component.
- **`SideDrawer`**: Currently inline in `TimelineView`. Good candidate for a shared layout component if needed elsewhere.

## 3. Test Plan

The test suite must ensure that the Web UI strictly remains a viewer and does not expose MCP write commands.

### `readiness.test.tsx`
- **Render State**: Assert that loading and empty states render correctly.
- **Data Binding**: Assert that `getScan()` payload correctly maps to Framework, File Count, and Fabric Status cards.
- **Read-Only Constraint**: Assert that initialization commands (`fab init`) are rendered strictly as text/code snippets, without click-to-execute buttons.

### `rules-explain.test.tsx`
- **Render State**: Assert split-pane renders tree on the left and topology on the right.
- **Interaction**: Assert clicking a TreeNode invokes `getRulesContext()` and updates the right pane.
- **Read-Only Constraint**: Assert no CRUD operations exist for registry nodes.

### `timeline.test.tsx`
- **Render State**: Assert timeline feed renders sorted entries.
- **Interaction**: Assert selecting a timeline node opens the snapshot side-drawer.
- **Audit Constraint**: Assert `annotateIntent` is the only POST operation permitted, explicitly labeled as audit annotation.

### `health.test.tsx`
- **Data Binding**: Assert `getDoctor()` payload maps to issue lists.
- **Connection Status**: Assert `connected` prop accurately toggles the SSE live badge.
- **Read-Only Constraint**: Assert `$ fabric doctor --fix` is rendered as a copyable command and NOT a clickable execution button.

## 4. i18n Copy Keys Definition

The following new i18n keys need to be added to `en.ts` and `zh-CN.ts` and applied to the components:

**Readiness Theme**
- `dashboard.readiness.filter.analysis`: "Project Analysis"
- `dashboard.readiness.loading`: "Loading scan data..."
- `dashboard.readiness.summary.framework`: "Framework"
- `dashboard.readiness.summary.files`: "Files"
- `dashboard.readiness.summary.status`: "Fabric Status"
- `dashboard.readiness.card.evidence`: "Readiness Evidence"
- `dashboard.readiness.card.recommendations`: "Recommendations & Next Steps"
- `dashboard.readiness.readme.description`: "Quality of project documentation"
- `dashboard.readiness.contributing.description`: "Contribution guidelines for AI/Human"
- `dashboard.readiness.fully-ready`: "Project is fully ready."
- `dashboard.readiness.init-prompt`: "Run this command to initialize:"

**Rules Explain Theme**
- `dashboard.rules-explain.analyze`: "Analyze Path"
- `dashboard.rules-explain.detail.topology-type`: "Topology Type"

**Timeline Theme**
- `dashboard.timeline.history-replay.title`: "History Replay"
- `dashboard.timeline.close`: "Close"

**Health Theme**
- `dashboard.health.ledger-path.label`: "Event Ledger Path"
- `dashboard.health.ledger-path.detail`: "Append-only timeline source"
- `dashboard.health.boundary.title`: "Control Plane Boundaries"
- `dashboard.health.boundary.description`: "The Web Dashboard operates as a Viewer. All rules, metadata, and fixes must be managed via the CLI."
- `dashboard.health.boundary.cli-action`: "CLI Action Required:"
- `dashboard.health.boundary.cli-prompt`: "You have {count} fixable issues. Run the following command in your terminal to repair metadata automatically."
- `dashboard.health.runtime.connected`: "MCP Runtime Connected"
- `dashboard.health.runtime.disconnected`: "MCP Runtime Disconnected"

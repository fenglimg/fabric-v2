# Web UI Restructure Lite Plan

**Session**: `wpp-20260426-web-ui-restructure-plan`  
**Requirement**: 暂时不修改当前 UI，规划 Web 端四主题重构方案，后续交给 Gemini 完成 UI 重构设计。  
**Generated**: 2026-04-26T21:10:00+08:00  
**Mode**: planning only, no source code changes

## Source Context

Primary analysis source:

- `.workflow/.analysis/ANL-2026-04-26-web端能力保留新增讨论/conclusions.json`
- `.workflow/.analysis/ANL-2026-04-26-web端能力保留新增讨论/discussion.md`

Current branch facts:

- `Approval / Human Lock` should not be treated as a current Web capability.
- Current implemented Dashboard views are:
  - `packages/dashboard/src/views/rule-topology.tsx`
  - `packages/dashboard/src/views/rules-tree.tsx`
  - `packages/dashboard/src/views/intent-timeline.tsx`
  - `packages/dashboard/src/views/history-replay.tsx`
  - `packages/dashboard/src/views/doctor.tsx`
- Current old top-level placeholders are:
  - `forensic`
  - `semantic`
  - `ledger`
- Current API client supports:
  - `getRules`
  - `getRulesContext`
  - `getLedger`
  - `getScan`
  - `getDoctor`
  - `annotateIntent`
  - `getHistoryState`
  - `openSseConnection`

## Recommended IA

Use four first-level themes:

```text
Readiness
Rules Explain
Timeline
Health
```

Do not keep `Approval` as a first-level theme. `annotateIntent` belongs under `Timeline` as audit annotation, not approval.

## Theme Definitions

### Readiness

Question answered:

> Is this project ready to use Fabric?

Primary data:

- `getScan()`
- `GET /api/scan`

Content:

- Framework detection
- README quality
- CONTRIBUTING presence
- Existing `.fabric` status
- File count and ignored count
- Recommendations
- Suggested CLI next steps

Boundaries:

- Read-only.
- Do not execute `fab init`, `fab update`, `sync-meta`, or any command from Web.

### Rules Explain

Question answered:

> Why did this file match these rules, and what does the current rule system look like?

Primary data:

- `getRules()`
- `getRulesContext(path)`

Existing views to absorb:

- `RuleTopologyView`
- `RulesTreeView`

Content:

- Rule topology
- Rule tree / registry detail
- Path-based hit explanation
- L0 / L1 / L2 context
- Coverage heatmap
- Dependency / scope / priority / hash / revision

Boundaries:

- No rule file editing.
- No registry node CRUD.
- `human_locked_nearby` is legacy/future extension only; do not design it as an active capability without a new data source.

### Timeline

Question answered:

> What happened, and how did state evolve over time?

Primary data:

- `getLedger()`
- `annotateIntent()`
- `getHistoryState()`

Existing views to absorb:

- `IntentTimelineView`
- `HistoryReplayView`

Content:

- AI / human ledger entries
- Audit annotation
- History replay by ledger point
- Future ledger analysis
- Future event / legacy ledger status

Boundaries:

- `annotateIntent` remains a narrow audit write.
- Do not frame annotation as approval.
- Do not resurrect Human Lock semantics.

### Health

Question answered:

> Is Fabric healthy, and what should the user do next?

Primary data:

- `getDoctor()`
- `useEvents()` connection state
- Future `/api/status` if needed

Existing views to absorb:

- `DoctorView`

Content:

- Doctor status
- Fixable errors
- Manual errors
- Warnings
- Target files
- Meta revision and computed revision
- Event ledger path
- Runtime status
- Tooling boundary: CLI vs MCP vs Web
- Future forensic/audit details

Boundaries:

- No Web `doctor --fix`.
- No Web `sync-meta`.
- No Web `init/update`.
- Show suggested CLI commands only.

## Current-To-Target Mapping

| Current Surface | Target Theme | Treatment |
|---|---|---|
| `topology` | Rules Explain | Keep capability, reorganize under theme |
| `rules` | Rules Explain | Keep capability, reorganize under theme |
| `timeline` | Timeline | Keep capability, clarify annotation as audit |
| `history` | Timeline | Keep capability, reorganize under theme |
| `doctor` | Health | Keep capability, extend with runtime/boundary |
| `forensic` placeholder | Health | Implement as forensic/audit subview or remove placeholder |
| `semantic` placeholder | Rules Explain | Implement as semantic/path explain subview or remove placeholder |
| `ledger` placeholder | Timeline | Implement as ledger analysis subview or remove placeholder |
| `locks` / Human Lock | none | Do not restore unless a new confirmation model is designed |

## Non-Goals

- Do not change UI in this planning session.
- Do not add Web command execution.
- Do not add rule/registry CRUD.
- Do not proxy MCP tool calls from Web.
- Do not reintroduce Human Lock / Approval wording as current capability.
- Do not rely on stale `docs/dashboard-tour.md` claims without checking current code.

## Execution Waves For Gemini

### Wave 1: IA And Routing Decision

Task:

- Replace mixed old module/diagnostic model with four-theme IA.
- Decide subnavigation model: tabs inside each theme vs nested route sections.
- Explicitly remove `Approval` from target IA.

Files likely involved later:

- `packages/dashboard/src/app.tsx`
- `packages/dashboard/src/i18n/*`
- Dashboard route tests if added

Acceptance:

- First-level navigation contains only `Readiness`, `Rules Explain`, `Timeline`, `Health`.
- Old placeholders are either removed or absorbed as subviews.

### Wave 2: Theme Designs

Parallel design tasks:

- Readiness design using `getScan()`.
- Rules Explain design using topology/tree/context.
- Timeline design using ledger/annotation/history replay.
- Health design using doctor/runtime/boundary.

Acceptance:

- Each theme has clear empty/loading/error states.
- Each theme lists exact API calls.
- Each theme documents prohibited write/control actions.

### Wave 3: Implementation Plan

Task:

- Convert theme designs into file-level implementation steps.
- Define component reuse and new components.
- Define test plan.
- Define i18n copy keys.

Acceptance:

- Gemini can implement from the plan without rediscovering current Web boundaries.
- No task writes outside Dashboard/server API surfaces unless explicitly justified.

### Wave 4: Cleanup Plan

Task:

- Identify stale docs and language.
- Remove or rewrite mentions of Locks/Human Lock/Approval as current Web feature.
- Align dashboard tour with four-theme IA.

Likely stale docs:

- `docs/dashboard-tour.md`
- Any generated analysis/planning doc that predates current branch removal of Human Lock.

## Detailed Task CSV

See:

- `.workflow/.lite-plan/wpp-20260426-web-ui-restructure-plan/tasks.csv`

Task summary:

| ID | Title | Wave |
|---|---|---|
| T1 | Lock target IA and routing model | 1 |
| T2 | Design Readiness theme | 2 |
| T3 | Design Rules Explain theme | 2 |
| T4 | Design Timeline theme | 2 |
| T5 | Design Health theme with Runtime & Boundaries | 2 |
| T6 | Define migration and implementation handoff for Gemini | 3 |

## Verification Checklist

Use this checklist when Gemini returns a design or implementation:

- [ ] No first-level `Approval` or `Locks`.
- [ ] No `doctor --fix`, `sync-meta`, `init`, `update`, hooks/config install execution from Web.
- [ ] `Readiness` uses scan/readiness data and remains read-only.
- [ ] `Rules Explain` uses rules/context data and does not edit rules.
- [ ] `Timeline` includes annotation as audit context, not approval.
- [ ] `Health` includes Doctor and Runtime/Boundary guidance.
- [ ] Old `forensic`, `semantic`, `ledger` placeholders are removed, implemented, or absorbed under the four themes.
- [ ] i18n copy does not mention removed Human Lock Web flow as current.
- [ ] Tests cover route mapping, API client usage, loading/error/empty states, and no unintended write API.

## Planning Artifacts

- `explore.csv`: exploration findings used to build the plan.
- `tasks.csv`: Gemini-ready planning and future implementation tasks.
- `discoveries.ndjson`: append-only discovery notes.
- `context.md`: this handoff document.
- `ui-ux-spec.md`: detailed UI/UX design specifications (Hybrid Dual-Theme).

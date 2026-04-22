# Fabric Dashboard — Component Inventory

**Target**: `packages/dashboard/src/components/` (TASK-009 Preact implementation)
**Source**: 3 HTML prototypes in this folder + tokens.json
**Framework**: Preact + TypeScript + Vite, no runtime CSS-in-JS — consume `--color-*` / `--space-*` / `--font-*` CSS custom properties from tokens.

---

## Shared types (import from `@fabric/shared`)

```ts
import type {
  AgentsMeta, AgentsMetaNode,
  LedgerEntry, AiLedgerEntry, HumanLedgerEntry,
  HumanLockEntry
} from '@fabric/shared'
```

All data coming over REST/SSE is already validated by zod on the server side — components receive strongly-typed objects and must not re-validate.

---

## Component list

Six reusable components cover all three views. Two view-level shells (`AppShell`, `ViewHeader`) are shared across pages.

### 1. `TreeNode` — Rules Tree Browser

**Purpose**: One row of the AgentsMeta hierarchy (recursive). Renders the caret, icon, label, level badge, optional state badges, hash, and line count. Recurses via `<TreeNode>` for children.

```ts
interface TreeNodeProps {
  node: AgentsMetaNode                         // from @fabric/shared
  level: 0 | 1 | 2 | 3                          // caps at 3 per AGENTS.md ≤4 nesting rule
  selected?: boolean
  onSelect?: (path: string) => void             // emits node.path on click/Enter
  humanLockedNearby?: boolean                   // hydrated from /api/human-lock
  staleReason?: 'hash-mismatch' | 'orphan' | null  // hydrated from drift check
  defaultExpanded?: boolean
}
```

**Visual states**:
- `default` — caret closed, label color by level (L0 bold primary / L1 secondary / L2 muted mono)
- `hover` — `--color-surface-raised` background, full label opacity
- `focus` — `--shadow-focus-ring`, caret gains `--color-border-strong`
- `selected` — persistent raised bg + 2px left border in `--color-source-ai-accent`
- `locked` — inset 3px left border in `--color-state-locked-border`, subtle `--color-state-locked-bg`
- `stale` — red dot (6px) attached to left gutter, stale badge chip in row
- `expanded` — caret rotates 90° with `--motion-duration-base` ease

**Animation**: caret rotate via transform (GPU-friendly); children reveal via `max-height` 0→auto transition, paired with opacity 0→1. Honors `prefers-reduced-motion` → instant show.

**A11y**: role=`treeitem`, aria-expanded toggles with open state, aria-level matches `level`. Enter/Space toggles expansion, arrow keys navigate siblings/parents/children.

---

### 2. `LockCard` — Human Lock Vault card

**Purpose**: One `HumanLockEntry` rendered as an audit card with header (path + line range + status pill), body (locked vs current hash + optional 3-line diff preview), and footer (metadata + Approve button).

```ts
interface LockCardProps {
  entry: HumanLockEntry                        // from @fabric/shared
  currentHash?: string                         // computed server-side, already diffed against entry.hash
  diffStats?: { added: number; removed: number; bytes?: number }
  diffPreview?: DiffLine[]                     // pre-rendered, see DiffLine type below
  onApprove?: (entry: HumanLockEntry) => Promise<void>   // POST /api/human-lock/approve
  busy?: boolean                               // during pending approve request
}

type DiffLine =
  | { kind: 'ctx'; line: number; text: string }
  | { kind: 'add'; line: number; text: string }
  | { kind: 'del'; line: number; text: string }
```

**Visual states**:
- `in-sync` — `ok` border-left (green), status pill `confirmed`, Approve button shown as disabled checkmark
- `drift` — `drift` border-left (orange), status pill `drift`, Approve button highlighted CTA
- `busy` — Approve button shows spinner (200ms debounce), card non-interactive
- `error` — red toast slides in from top-right, button returns to normal state
- `hover` — card border lightens to `--color-border-default`

**Animation**: Status transition (drift → confirmed) uses 180ms cross-fade + 200ms border color shift. Spinner uses 360° rotation. Respects reduced-motion.

**A11y**: article role, aria-label with file path + status. Approve button has descriptive label "Approve new hash for {path}". Disabled state uses `aria-disabled` not `disabled` to preserve focus (so screen readers can still announce state).

---

### 3. `TimelineEntry` — Intent Timeline entry

**Purpose**: One `LedgerEntry` (discriminated union) rendered in either the AI column (grid-column 1) or Human column (grid-column 3). AI entries show commit_sha, diff_stat, rule_ref; Human entries show annotation body + approve metadata.

```ts
interface TimelineEntryProps {
  entry: LedgerEntry                           // LedgerEntry from @fabric/shared (discriminated by source)
  onAnnotate?: (entry: AiLedgerEntry, text: string) => Promise<void>  // POST /api/intent/annotate
  expanded?: boolean                           // shows inline annotation input when true
}
```

**Visual states (source: 'ai')**:
- `default` — left column, `--color-source-ai-border` left border, indigo chip + axis dot
- `with-human-response` — subtle connector line drawn to paired human entry (CSS-only via `::after` + grid)
- `annotate-open` — inline `<input>` appears at bottom, animated height 0→auto

**Visual states (source: 'human')**:
- `default` — right column, `--color-source-human-border` right border, teal chip + axis dot
- `approve-record` — shows locked hash in metadata line
- `annotation` — body rendered in prose style (not monospace)

**Animation**: New entry insertion (via SSE) animates `translateY(-8px)` → `0` + opacity 0→1 over 240ms. Axis dot gets a one-time 600ms pulse highlight. Reduced-motion → fade only.

**A11y**: article role, aria-label includes source + short title. Timestamp uses `<time datetime>`. Annotation input has visible label and fires onAnnotate on Enter or button click.

---

### 4. `SourceBadge` — source chip

**Purpose**: Small uppercase chip with colored dot showing `ai` or `human` origin. Used in timeline entries, ledger filters, rule tree hover cards.

```ts
interface SourceBadgeProps {
  source: 'ai' | 'human'
  size?: 'sm' | 'md'       // sm = 10px/chip, md = 11px/pill
  variant?: 'filled' | 'outline'
  interactive?: boolean     // renders as button for filter usage
  selected?: boolean        // for filter usage
  onClick?: () => void
}
```

**Visual states**:
- `filled` — colored bg + border + text per source
- `outline` — transparent bg, bordered only
- `selected` (interactive only) — raised bg, full saturation
- `hover` (interactive only) — border darkens

No animation. Component is purely presentational; `interactive` variant adds cursor-pointer + transition.

**A11y**: When `interactive`, renders as `<button>` with aria-pressed on filter. Otherwise plain `<span>`.

---

### 5. `DriftIndicator` — hash drift / stale marker

**Purpose**: Inline marker signaling hash mismatch, orphan node, or stale meta. Used in TreeNode (red dot), LockCard (pill), and rule detail panel (banner).

```ts
interface DriftIndicatorProps {
  kind: 'dot' | 'pill' | 'banner'
  severity: 'drift' | 'stale' | 'orphan' | 'ok'
  message?: string          // pill/banner only
  diffStats?: { added: number; removed: number }   // pill only
}
```

**Visual states**:
- `ok` — green (hidden in default render for minimal noise)
- `drift` — orange (`--color-state-drift-*`), hash mismatch on HumanLockEntry
- `stale` — red (`--color-state-stale-*`), AgentsMeta revision hash no longer matches file
- `orphan` — slate (`--color-state-pending-*`), node references file that no longer exists

Dot has a soft breathing animation (opacity 1→0.6→1 over 2.4s) only when severity = `drift` or `stale`. Disabled under reduced-motion.

**A11y**: role=`status` for banner; aria-label on dot ("drift detected on {path}"). Color is never the only indicator — text or pill label accompanies.

---

### 6. `ApproveButton` — approve / annotate CTA

**Purpose**: Primary action button used for two ritual-write endpoints: `/api/human-lock/approve` and `/api/intent/annotate`. Enforces loading + success + error states, never allows double-submission.

```ts
interface ApproveButtonProps {
  variant: 'approve' | 'annotate'              // approve = green CTA, annotate = teal outline
  state?: 'idle' | 'busy' | 'success' | 'error'
  size?: 'sm' | 'md'
  onClick: () => Promise<void>                 // expected to throw on error so button can transition
  children: ComponentChildren                  // label text
  ariaLabel?: string
}
```

**Visual states**:
- `idle` — full CTA styling, cursor-pointer
- `busy` — button stays visible, inline 14px spinner prefixes label, aria-busy="true", pointer-events none
- `success` — checkmark icon prefixes label, background flashes `--color-state-approved-bg` then fades back over 600ms
- `error` — label shows "Retry", border shifts to `--color-action-danger` briefly
- `disabled` — `aria-disabled="true"`, reduced opacity 0.6, cursor default (still focusable)

**Animation**: Press uses tactile transform `scale(0.98)` on mousedown. Success flash uses keyframe. Honors reduced-motion → instant state change.

**A11y**: Uses `<button type="button">`. Includes visible icon + text (no icon-only). aria-busy on busy state. Announces success/error via a live region in AppShell.

---

## View-level shells (shared, single-instance)

### `AppShell`
- Grid: `240px` sidebar + `1fr` main (breakpoint: collapses sidebar → 64px below 960px, off-canvas below 640px)
- Sidebar nav: 3 primary + 2 diagnostic items
- Header: breadcrumb (mono) + CONNECTED pill + port indicator
- Includes `<LiveRegion>` div for aria announcements

```ts
interface AppShellProps {
  connected: boolean       // SSE connection state
  port: number
  children: ComponentChildren
}
```

### `ViewHeader`
- Title + subtitle + tools slot (buttons, filter bar)
- Sticky during scroll

---

## Data wiring map (TASK-009 reference)

| View | REST endpoint | SSE event | Components |
|------|---------------|-----------|------------|
| `rules-tree` | `GET /api/rules` → `AgentsMeta` | `meta:updated`, `meta:drift` | `TreeNode`, `DriftIndicator` |
| `human-lock` | `GET /api/human-lock` → `HumanLockEntry[]` | `lock:drift`, `lock:approved` | `LockCard`, `DriftIndicator`, `ApproveButton` |
| `intent-timeline` | `GET /api/ledger?source=ai|human&since=<ts>` → `LedgerEntry[]` | `ledger:appended` | `TimelineEntry`, `SourceBadge`, `ApproveButton` |

All views consume the same `useEvents()` hook (SSE subscription) and dispatch cache invalidation when relevant events arrive.

---

## Accessibility floor (all components)

- WCAG 2.2 AA minimum: 4.5:1 contrast for body text, 3:1 for large text. Muted tokens are calibrated against `--color-surface-panel`.
- All interactive elements ≥ 44×44px touch target on mobile (use padding — never fixed height below 40px).
- `:focus-visible` ring uses `--shadow-focus-ring` (never `:focus` alone).
- Color is never the only indicator — every colored state is paired with an icon, text, or shape.
- All animations respect `prefers-reduced-motion: reduce` (SKILL-mandated).

---

## What TASK-009 should **NOT** do

- Do not add a new CSS-in-JS dependency. Use CSS modules (Vite default) or a single `tokens.css` imported once.
- Do not reach for a component library. The inventory above is deliberately small — all six components are ≤ 200 LOC each.
- Do not add a state manager. Signals (`@preact/signals`) plus `useEvents()` is sufficient; adding Redux/Zustand violates the maintenance-tool body budget.
- Do not introduce chart/grid libraries. The three views do not require them.

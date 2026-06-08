# F-006: Summary Card Design Analysis (UI-02)

**Decision Reference**: UI-02 from guidance specification Section 6
**Priority**: SHOULD
**Dependencies**: SA-02 (ink architecture), UX-02 (post-setup guidance), OutputRenderer interface

---

## 1. Component Specification

### 1.1 SummaryCard Component

**Purpose**: Compress final output into dense, scanable summary replacing fragmented console.log blocks.

**Behavioral Constraints** (RFC 2119):
- MUST use boxen-bordered card for final summary
- MUST include: installed clients, store status, write target
- MUST display 3-step quick start in card
- MUST keep card under 15 lines height
- SHOULD support compact mode (--quiet flag)
- MAY show timing summary for entire install

**Content Structure**:

```
┌─ Summary Card Content ───────────────┐
│                                      │
│  Section 1: Status Summary           │
│  ├─ Installed clients                │
│  ├─ Store status (bound/unbound)     │
│  └─ Write target                     │
│                                      │
│  Section 2: Quick Start Guide        │
│  ├─ Step 1: Restart AI client        │
│  ├─ Step 2: Try /fabric-archive      │
│  └─ Step 3: Write knowledge          │
│                                      │
│  Section 3: Metadata                 │
│  ├─ Install duration                 │
│  └─ Version                          │
│                                      │
└──────────────────────────────────────┘
```

**Height Constraint**:
- Normal mode: max 15 lines including borders
- Compact mode: max 8 lines (inline status)
- Overflow: truncate secondary info, show "more" hint

### 1.2 StoreStatusBadge Component

**Purpose**: Indicate store binding state with visual clarity.

**Behavioral Constraints** (RFC 2119):
- MUST show status: bound (green), unbound (gray), error (red)
- MUST display store name when bound
- SHOULD show store URL as secondary info
- MAY indicate write permission status

**State Design**:

```
┌─ StoreStatusBadge States ────────────┐
│                                      │
│  BOUND      │ green, "✓ team-store"  │
│              │ secondary: URL        │
│                                      │
│  UNBOUND    │ gray, "○ No store"     │
│              │ hint: "Run wizard"    │
│                                      │
│  ERROR      │ red, "✗ Bind failed"   │
│              │ recovery hint         │
│                                      │
│  LOADING    │ yellow spinner         │
│              │ "Connecting..."       │
│                                      │
└──────────────────────────────────────┘
```

### 1.3 QuickStartList Component

**Purpose**: Provide actionable next steps after install.

**Behavioral Constraints** (RFC 2119):
- MUST display exactly 3 steps (per UX-02)
- MUST use numbered format: "1. [action]"
- SHOULD use emoji/symbol for visual anchor
- MAY link to documentation for deeper info

**Content** (from UX-02):

```
┌─ Quick Start Content ────────────────┐
│                                      │
│  1. Restart your AI client           │
│     → Claude Code / Cursor / Codex   │
│                                      │
│  2. Try /fabric-archive skill        │
│     → Archive your first session     │
│                                      │
│  3. Write knowledge                  │
│     → .fabric/knowledge/decisions/   │
│                                      │
└──────────────────────────────────────┘
```

### 1.4 ClientStatusTable Component

**Purpose**: Show installed client capabilities in table format.

**Behavioral Constraints** (RFC 2119):
- MUST use ink table component (not manual padEnd)
- MUST show: Client, Hooks, Skills, MCP status
- SHOULD align columns automatically
- MAY support responsive width adjustment

**Table Design**:

```
┌─ Client Status Table ────────────────┐
│                                      │
│  Client      │ Hooks │ Skills │ MCP  │
│  ────────────┼───────┼───────┼────── │
│  Claude Code │   ✓   │   ✓   │   ✓   │
│  Cursor      │   ✓   │   ✓   │   ✓   │
│  Codex CLI   │   ✓   │   ○   │   ✓   │
│                                      │
└──────────────────────────────────────┘

Legend: ✓=enabled, ○=partial, ✗=disabled
```

---

## 2. Layout Design

### 2.1 Full Width Card (100+ cols)

```
╔══════════════════════════════════════════════════════════════════════════╗
║                         INSTALL COMPLETE                                 ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Client Status                                                           ║
║  ┌─────────────────────────────────────────────────────────────────────┐║
║  │ Client        │ Hooks │ Skills │ MCP  │ Status                     │║
║  │───────────────│───────│───────│──────│─────────────────────────────│║
║  │ Claude Code   │   ✓   │   ✓   │   ✓  │ Ready                      │║
║  │ Cursor        │   ✓   │   ✓   │   ✓  │ Ready                      │║
║  │ Codex CLI     │   ✓   │   ○   │   ✓  │ Partial                    │║
║  └─────────────────────────────────────────────────────────────────────┘║
║                                                                          ║
║  Store Status                                                            ║
║  ✓ team-store (bound)                                                    ║
║    https://github.com/team/fabric-store                                  ║
║    Write target: team                                                    ║
║                                                                          ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Quick Start                                                             ║
║  1. Restart your AI client                                               ║
║  2. Try /fabric-archive skill                                            ║
║  3. Write knowledge in .fabric/knowledge/                                ║
║                                                                          ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Done in 1.2s · Fabric v2.0.1 · Docs: https://fabric.dev                 ║
╚══════════════════════════════════════════════════════════════════════════╝
```

**Line count**: 15 lines (within constraint)

### 2.2 Compact Card (80 cols)

```
┌─ INSTALL COMPLETE ────────────────────┐
│                                       │
│ Clients: Claude ✓ Cursor ✓ Codex ○    │
│                                       │
│ Store: ✓ team-store                   │
│ Target: team                          │
│                                       │
├─ Quick Start ─────────────────────────┤
│ 1. Restart AI client                  │
│ 2. Try /fabric-archive                │
│ 3. Write knowledge                    │
│                                       │
├───────────────────────────────────────┤
│ Done in 1.2s · v2.0.1                 │
└───────────────────────────────────────┘
```

**Line count**: 11 lines

### 2.3 Minimal Output (--quiet flag)

```
✓ Install complete (1.2s)
Clients: Claude ✓ Cursor ✓ Codex ○
Store: team-store (bound)
Next: Restart AI client → /fabric-archive → Write knowledge
```

**Line count**: 4 lines (inline format)

---

## 3. Content Rules

### 3.1 Client Status Display

| Client State | Display | Color |
|--------------|---------|-------|
| Fully enabled | ✓ | green |
| Partial support | ○ | yellow |
| Not available | ✗ | red |
| Not detected | ? | gray |

### 3.2 Store Status Logic

| Condition | Badge | Secondary |
|-----------|-------|-----------|
| Store bound | ✓ {name} | URL, write target |
| No store (skipped) | ○ No store | "Run `fabric store wizard`" |
| Bind failed | ✗ Bind failed | Recovery hint |
| Multiple stores | ✓ {count} stores | List names |

### 3.3 Timing Display

- Show total install duration: "Done in X.Xs"
- If > 5s: show breakdown by stage
- If < 1s: show in ms: "Done in 342ms"

---

## 4. ASCII Wireframe Variants

### 4.1 Standard (15-line max)

```
╔════════════════════════════════════════════════════════════╗
║                     INSTALL COMPLETE                       ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Client Status                                             ║
║  ┌──────────────────────────────────────────────────────┐ ║
║  │ Claude Code │ Hooks ✓ │ Skills ✓ │ MCP ✓ │ Ready    │ ║
║  │ Cursor      │ Hooks ✓ │ Skills ✓ │ MCP ✓ │ Ready    │ ║
║  │ Codex CLI   │ Hooks ✓ │ Skills ○ │ MCP ✓ │ Partial  │ ║
║  └──────────────────────────────────────────────────────┘ ║
║                                                            ║
║  Store: ✓ team-store (write: team)                         ║
║                                                            ║
╠════════════════════════════════════════════════════════════╣
║  Quick Start                                               ║
║  1. Restart AI client                                      ║
║  2. Try /fabric-archive                                    ║
║  3. Write knowledge                                        ║
╠════════════════════════════════════════════════════════════╣
║  Done in 1.2s · Fabric v2.0.1                              ║
╚════════════════════════════════════════════════════════════╝
```

### 4.2 Error Variant (unbound store)

```
╔════════════════════════════════════════════════════════════╗
║                     INSTALL COMPLETE                       ║
╠════════════════════════════════════════════════════════════╣
║                                                            ║
║  Client Status                                             ║
║  ┌──────────────────────────────────────────────────────┐ ║
║  │ Claude Code │ Hooks ✓ │ Skills ✓ │ MCP ✓ │ Ready    │ ║
║  └──────────────────────────────────────────────────────┘ ║
║                                                            ║
║  Store: ○ No store configured                              ║
║  → Run `fabric store wizard` to set up team knowledge     ║
║                                                            ║
╠════════════════════════════════════════════════════════════╣
║  Quick Start                                               ║
║  1. Restart AI client                                      ║
║  2. Configure store: `fabric store wizard`                 ║
║  3. Write knowledge                                        ║
╠════════════════════════════════════════════════════════════╣
║  Done in 0.8s · Fabric v2.0.1                              ║
╚════════════════════════════════════════════════════════════╝
```

---

## 5. Component API Specification

### 5.1 SummaryCard Props

```typescript
interface SummaryCardProps {
  clients: ClientStatus[];       // Installed client list
  store: StoreStatus;            // Store binding state
  quickStart: QuickStartStep[];  // 3-step guide
  timing: number;                // Total install duration
  version: string;               // Fabric version
  compact?: boolean;             // Compact mode flag
}
```

### 5.2 StoreStatus Type

```typescript
interface StoreStatus {
  status: 'bound' | 'unbound' | 'error';
  name?: string;                 // Store name if bound
  url?: string;                  // Store URL if bound
  writeTarget?: 'team' | 'personal';
  errorHint?: string;            // Recovery hint if error
}
```

### 5.3 QuickStartStep Type

```typescript
interface QuickStartStep {
  number: number;                // Step number (1-3)
  action: string;                // Action description
  hint?: string;                 // Optional hint text
}
```

---

## 6. Edge Cases

### 6.1 Content Overflow

| Scenario | Handling |
|----------|----------|
| **> 15 lines content** | Truncate table, show "more details" hint |
| **Many clients (>5)** | Show top 3 + "{n} more" |
| **Long store URL** | Truncate with ellipsis, show full on hover (future) |

### 6.2 Missing Data

| Missing Field | Fallback |
|---------------|----------|
| **No clients detected** | Show "No AI clients found" with setup hint |
| **Store status pending** | Show spinner state |
| **Timing unavailable** | Skip timing line |

### 6.3 Compact Mode (--quiet)

- MUST reduce to inline format
- MUST preserve essential info (clients, store, next steps)
- MUST skip visual borders
- MAY use single-line summary

---

## 7. Integration Dependencies

| Dependency | Required From | Integration Point |
|------------|---------------|-------------------|
| Client detection | SA-01 | ClientStatusTable data |
| Store binding | UX-01 | StoreStatusBadge state |
| Quick start content | UX-02 | QuickStartList content |
| Timing data | UI-04 | Duration display |

---

## 8. Implementation Recommendations

### 8.1 Technology Stack

- **ink `<Box>`**: Card container with border
- **ink `<Text>`**: Content rendering
- **boxen**: Bordered card styling (fallback)
- **cli-table3 or ink-table**: Table component

### 8.2 Testing Strategy

- [ ] Visual snapshot for each width variant
- [ ] Content overflow handling tests
- [ ] Edge case tests (missing data, error states)
- [ ] Compact mode toggle test

### 8.3 Performance

- Render card after all stages complete
- Avoid re-render during install flow
- Cache client/store status for final display
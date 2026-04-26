# Fabric v2 UI/UX Design Specification

**Status**: Approved (Hybrid Dual-Theme UI)  
**Date**: 2026-04-26  
**Reference Prototype**: `ui-prototype-hybrid.html`  

## 1. Core Design Philosophy
Fabric v2 targets senior developers and architects. It acts as a read-only, high-information-density diagnostic tool, syncing with the Fabric CLI. The UI must exude certainty, trust, and deep mapping between code paths and the rules registry.

### Hybrid Dual-Theme Architecture
We adopted a dual-theme structure to cater to different operating environments while retaining a distinct "developer tool" feel:
- **☀️ Light Mode (Minimalist Enterprise)**: Clean, high contrast, zinc-50 backgrounds, and distinct borders. Ideal for daytime usage and high text density reading.
- **🌙 Dark Mode (Modern Glassmorphism)**: Deep zinc-950 background with ambient blurs, translucent panels (backdrop-filter: blur), and subtle glow effects. Gives an immersive "Hacker/Geek" vibe.

## 2. Global Styling Rules

### Typography
- **Monospace Priority**: All file paths, hash values, rule IDs, CLI commands, and revisions **MUST** use Monospace fonts (`JetBrains Mono`, `SF Mono`, `Fira Code`).
- **Standard Text**: System sans-serif for descriptions and labels (`Inter`, `SF Pro Display`).
- **Font Sizing**: Optimize for high density. Use smaller text sizes (`text-xs`, `text-sm`) with tight tracking.

### Color Palette (Tailwind Mapping)
- **Neutral Scale**: `zinc` (zinc-900 to zinc-50).
- **Accent Color**: Blue-500 (`#3b82f6`) for selected active states.
- **Semantic Colors**:
  - Success: `green-500`
  - Warning: `amber-500` (Used heavily for "CLI Action Required" prompts)
  - Error: `rose-500`
- **L0/L1/L2 Tokens**: Maintain distinct token colors for visual separation of rule hierarchies in the registry tree.

### The "Read-Only" Metaphor
- **No Execution Buttons**: Instead of standard primary buttons for actions (like `Fix Errors`), the UI presents a terminal code snippet box (e.g., `$ fabric doctor --fix`) with a **Copy** icon.
- **Control Plane Boundaries**: Keep clear demarcation. Web is the Viewer; CLI is the Executor.

## 3. Page Layouts (Four-Theme IA)

The application navigation is stripped down to 4 core themes.

### 1. Readiness (`/readiness`)
- High-level project scanning results.
- **Layout**: Top dashboard summary, lower split cards for files vs ignores.
- Recommendations presented as copyable terminal commands.

### 2. Rules Explain (`/rules-explain`)
- **Layout**: Split view (Left: Registry Tree, Right: Detail & Context).
- **Left Pane**: Explorer-like file tree displaying `.fabric/rules/` hierarchy. Supports keyboard navigation.
- **Right Pane**: Bento-box cards showing inherited rules, scope glob, hash revision, topology type, and hit resolutions.

### 3. Timeline (`/timeline`)
- **Layout**: Vertical chronological scroll.
- Visual distinction between "AI Actions" and "Human Annotations" (Audit logs).
- Clickable nodes to open side-drawer for `History Replay` (state diff).

### 4. Health (`/health`)
- **Layout**: Top real-time terminal output / SSE stream view. Bottom categorized issue list.
- Explicit visual separation of `Fixable`, `Manual`, and `Warning` issues.
- Persistent "MCP Connected" indicator in sidebar.

## 4. Interactive & Micro-Interactions
- Use smooth transitions (`duration-300`) for all hover states and theme toggling.
- Always implement `hover:` and `focus:` states, especially on tree nodes and copy buttons.
- Implement keyboard shortcuts (e.g., `⌘K` for search).

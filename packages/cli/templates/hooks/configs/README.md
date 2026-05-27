# Client hook config templates

These JSON files are **fragment templates** consumed by `fabric install` and
`fabric hooks install`. They are not standalone client config files.

The supported clients are pinned by `packages/shared/src/schemas/fabric-config.ts`
to Claude Code, Cursor, and Codex CLI. Adding a new client requires extending
that schema first.

## claude-code.json

Deep-merged into the user repo's `.claude/settings.json` by the init pipeline.
Registers `fabric-hint.cjs` under `hooks.Stop[]` with `matcher: "*"`. The
existing `mcpServers`, `permissions`, and any other top-level keys in the user's
settings.json are preserved.

The `hooks.Stop[]` array merge needs special-case handling (array-append with
dedupe by `command` string) because `packages/cli/src/config/json.ts:18` default
`deepMerge` REPLACES arrays. The mergeClaudeCodeHookConfig helper owns that
wiring.

## codex-hooks.json

Written to (or merged into) the user repo's `.codex/hooks.json`. NOTE: Codex
project-level hooks file is JSON, **not** TOML — only the user-level Codex MCP
config (`~/.codex/config.toml`) is TOML.

## cursor-hooks.json

Written to (or merged into) the user repo's `.cursor/hooks.json`. Schema
authoritative source: https://cursor.com/cn/docs/hooks. Top-level requires
`version: 1` (number literal, NOT string) and a `hooks` object (NOT `events`)
keyed by camelCase event names: `stop`, `sessionStart`, `preToolUse`. Per-entry
shape stays flat (Codex-style): `{command, matcher?, type?, timeout?,
loop_limit?, failClosed?}`. rc.14 TASK-001 corrected rc.13's wrong top-level
envelope (was `{events: {Stop, SessionStart, PreToolUse}}` PascalCase, which
Cursor rejects with "Config version must be a number; Config hooks must be an
object").

## Per-client schema comparison (v2.0.0-rc.37 NEW-29)

Each host program enforces its own wire format — `fabric install` cannot
serialize one shared shape across all three. Differences are pinned here
side-by-side so anyone editing one config knows what the others require.

| Axis                 | Claude Code                              | Codex CLI                                          | Cursor                                          |
| -------------------- | ---------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| Settings file        | `.claude/settings.json`                  | `.codex/hooks.json`                                | `.cursor/hooks.json`                            |
| Top-level envelope   | `hooks: { ... }` (no version)            | `events: { ... }` (no version)                     | `{ version: 1, hooks: { ... } }` (number, not string) |
| Event-name case      | PascalCase: `Stop`, `SessionStart`, `PreToolUse`, `UserPromptSubmit` | PascalCase: `Stop`, `SessionStart`, `PreToolUse`     | camelCase: `stop`, `sessionStart`, `preToolUse` |
| Per-entry shape      | Nested matcher: `[{matcher, hooks:[{type:"command", command}]}]` | Flat: `[{command, matcher?}]`                      | Flat: `[{command, matcher?, type?, timeout?, loop_limit?, failClosed?}]` |
| Path interpolation   | `${CLAUDE_PROJECT_DIR}` (env var)        | `"$(git rev-parse --show-toplevel)"` (shell expansion) | project-relative (resolved by Cursor)           |
| Cite-policy event    | `UserPromptSubmit` (per-prompt)          | `SessionStart` 2nd entry (rc.37 NEW-21 parity)     | `sessionStart` 2nd entry (rc.37 NEW-21 parity)  |

Whenever a hook is added to one config, walk this table and add the equivalent
entry to the other two — `fabric install` merges each into its respective
target verbatim, so missing entries silently degrade the cross-client surface.

## fabric-hint.cjs script paths

- Claude: `.claude/hooks/fabric-hint.cjs` (project-relative)
- Codex:  `.codex/hooks/fabric-hint.cjs`  (project-relative)
- Cursor: `.cursor/hooks/fabric-hint.cjs` (project-relative)

The single shared script lives at `packages/cli/templates/hooks/fabric-hint.cjs`
in this repo and is copied into all three `<client>/hooks/` destinations by the
install wiring. The script emits stdout JSON
`{decision:"block", reason, signal, recommended_skill}` with exit 0 when one of
three signals trips:

- **archive** (rc.5 TASK-015): 24h elapsed since last `knowledge_proposed`
  event. Silent on a never-archived workspace (that case is the **import**
  signal's domain). Recommends the `fabric-archive` skill. The previous
  `5 plan_contexts` count branch (rc.2) was dropped because rc.5+ hooks
  auto-fire plan_context events; rc.6 will reintroduce an Edit-count signal
  via a PreToolUse sidecar.
- **review** (rc.3): pending knowledge count >= 10, OR oldest pending entry >= 7
  days old. Recommends the `fabric-review` skill.
- **import** (rc.5): canonical knowledge node count < `underseed_node_threshold`
  (default 10) AND `init_scan_completed` event >= 24h ago AND no
  `knowledge_proposed` event in last 24h. Recommends the `fabric-import` skill.

Precedence: archive > review > import. After firing, the hook stays silent for
`archive_hint_cooldown_hours` (default 12h, keyed by `signal` so the three
signals share a cache file but throttle independently).

The script is silent + exit 0 when no signal trips. It NEVER blocks tool
execution on its own failure — any read/parse error is swallowed.

## Historical note: archive-hint.cjs rename

Pre-rc.5, this script was named `archive-hint.cjs` (only the archive signal
existed). rc.5 TASK-010 renamed it to `fabric-hint.cjs` to reflect its expanded
three-signal scope. The cooldown cache file is intentionally still named
`archive-hint-shown.json` so an in-place upgrade does not flush the user's
existing throttle state.

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

Written to (or merged into) the user repo's `.cursor/hooks.json`. Mirrors the
Codex `events.Stop[]` envelope shape — Cursor's hook event vocabulary is
not stable across releases, so the canonical Stop-on-tool-finish lifecycle hook
is the only entry we register today. SessionStart / PreToolUse slots are left
unfilled for rc.6 to add when their semantics stabilise.

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

# Client hook config templates

These JSON files are **fragment templates** consumed by `fabric init` (TASK-005
wires the install). They are not standalone client config files.

## claude-code.json

Deep-merged into the user repo's `.claude/settings.json` by the init pipeline.
Registers `archive-hint.cjs` under `hooks.Stop[]` with `matcher: "*"`. The
existing `mcpServers`, `permissions`, and any other top-level keys in the user's
settings.json are preserved.

Schema is pinned by `packages/server/src/services/doctor.test.ts:141` (Claude
Code Stop-hook fixture).

The `hooks.Stop[]` array merge needs special-case handling (array-append with
dedupe by `command` string) because `packages/cli/src/config/json.ts:18` default
`deepMerge` REPLACES arrays. TASK-005 owns that wiring.

## codex-hooks.json

Written to (or merged into) the user repo's `.codex/hooks.json`. NOTE: Codex
project-level hooks file is JSON, **not** TOML — only the user-level Codex MCP
config (`~/.codex/config.toml`) is TOML. Verified at
`packages/cli/src/config/resolver.ts:157` (`existsSync(workspaceRoot, ".codex",
"hooks.json")`).

## archive-hint.cjs script paths

- Claude: `.claude/hooks/archive-hint.cjs` (project-relative)
- Codex:  `.codex/hooks/archive-hint.cjs` (project-relative)

The single shared script (TASK-003, commit `50367b5`) lives at
`packages/cli/templates/hooks/archive-hint.cjs` in this repo and is copied into
both `.claude/hooks/` and `.codex/hooks/` destinations by TASK-005's init
wiring. The script emits stdout JSON `{decision:"block", reason}` with exit 0
when the threshold (5 plan_contexts since last archive OR 24h) trips, and is
silent + exit 0 otherwise.

## Cursor

Deliberately omitted. Cursor has no documented Stop-hook surface as of
2026-05; `packages/cli/src/config/resolver.ts:139` declares `hook: false` for
Cursor. Documented as a schema deviation from the original v2 handoff in
`.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/planning-context.md`.

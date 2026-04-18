# Fabric Quickstart

This quickstart installs Fabric into a project and connects supported AI clients to the local Fabric MCP server.

Use this on a disposable project first. For projects with private `.claude/`, `.cursor/`, `.codex/`, `.windsurf/`, or `.roo/` config, run each dry-run step and inspect diffs before writing.

## 1. Initialize Fabric

Run from the target project root:

```bash
fab init
```

Expected output:

```text
Created <project>/AGENTS.md
Created <project>/.fabric/agents.meta.json
Created <project>/.fabric/human-lock.json
Next: run fab hooks install to add the Day 4 pre-commit pipeline.
```

Expected files:

- `AGENTS.md`
- `.fabric/agents.meta.json`
- `.fabric/human-lock.json`

Abort if:

- `AGENTS.md` already exists and `fab init` does not stop.
- `.fabric/` already exists and `fab init` does not stop.
- Any existing project file is modified.

## 2. Install Git Hooks

Run:

```bash
fab hooks install
```

Expected output:

```text
Installed <project>/.husky/pre-commit
Added prepare script to <project>/package.json
```

If `package.json` already has a `prepare` script:

```text
Installed <project>/.husky/pre-commit
Left existing prepare script unchanged in <project>/package.json
```

Expected behavior:

- `.husky/pre-commit` runs `fab sync-meta --check-only`.
- `.husky/pre-commit` runs `fab human-lint`.
- `.husky/pre-commit` runs `fab ledger-append --staged`.
- Direct staged edits to `.fabric/agents.meta.json` are blocked unless `FAB_ALLOW_META_EDIT=1` is set.

Abort if:

- Existing hook content is overwritten unexpectedly.
- Existing `package.json` scripts are removed.

## 3. Install Bootstrap Prompts

Run:

```bash
fab bootstrap install --clients claude,cursor,windsurf,roo,gemini,codex
```

Expected output:

```text
Installed <project>/CLAUDE.md
Installed <project>/.cursor/rules/fabric-bootstrap.mdc
Installed <project>/.windsurf/rules/fabric.md
Installed <project>/.roo/rules/fabric.md
Installed <project>/GEMINI.md
Prepended <project>/AGENTS.md
```

Codex-specific note:

- If `AGENTS.md` already contains `# Fabric Bootstrap`, Codex bootstrap is skipped.
- Expected output in that case:

  ```text
  Skipped <project>/AGENTS.md: Fabric Bootstrap header already present.
  ```

Expected bootstrap instruction:

```text
Before any file modification, call MCP tool fab_get_rules(path=<file being changed>).
```

Abort if:

- Existing bootstrap files are replaced without approval.
- `AGENTS.md` loses existing content.

## 4. Preview MCP Config Writes

Set the server path if running from the Fabric monorepo:

```bash
FAB_SERVER_PATH="/Users/wepie/Desktop/personal-projects/pcf/packages/server/dist/index.js"
```

Preview config writes:

```bash
FAB_SERVER_PATH="$FAB_SERVER_PATH" fab config install --clients claude,cursor,windsurf,roo,gemini,codex --dry-run
```

Expected output:

```text
[dry-run] ClaudeCodeCLI: would write <path>
[dry-run] Cursor: would write <project>/.cursor/mcp.json
[dry-run] Windsurf: would write <project>/.windsurf/mcp.json
[dry-run] RooCode: would write <project>/.roo/mcp.json
[dry-run] GeminiCLI: would write <path>
[dry-run] CodexCLI: would write <path>
```

If no clients are detected:

```text
No Fabric MCP client configs detected. Create a client directory or set fabric.config.json clientPaths.
```

Create workspace-local directories or configure `fabric.config.json` before continuing.

## 5. Install MCP Config

Run only after reviewing the dry-run output:

```bash
FAB_SERVER_PATH="$FAB_SERVER_PATH" fab config install --clients claude,cursor,windsurf,roo,gemini,codex
```

Expected output:

```text
ClaudeCodeCLI: wrote <path>
Cursor: wrote <project>/.cursor/mcp.json
Windsurf: wrote <project>/.windsurf/mcp.json
RooCode: wrote <project>/.roo/mcp.json
GeminiCLI: wrote <path>
CodexCLI: wrote <path>
```

Expected JSON config shape:

```json
{
  "mcpServers": {
    "fabric": {
      "command": "<node>",
      "args": ["<path-to-packages/server/dist/index.js>"]
    }
  }
}
```

Expected Codex TOML shape:

```toml
[mcp.servers.fabric]
command = "<node>"
args = ["<path-to-packages/server/dist/index.js>"]
```

Abort if:

- Existing `mcpServers` entries disappear.
- Existing non-Fabric settings are deleted.
- The Fabric server path points to a missing file.

## 6. Restart Clients

Restart every configured client so it reloads MCP configuration:

- Claude Code
- Cursor
- Windsurf
- Roo Code
- Gemini CLI
- Codex CLI

Expected client tool list:

```text
fab_get_rules
fab_append_intent
fab_update_registry
```

Minimal smoke request:

```text
Before editing any file, call fab_get_rules for README.md and summarize the active Fabric rules.
```

Expected behavior:

- The client invokes `fab_get_rules`.
- The response includes `revision_hash`.
- The response includes L0 rules from `AGENTS.md`.

## Troubleshooting

- If `fab` is not found, build the CLI and invoke `node /Users/wepie/Desktop/personal-projects/pcf/packages/cli/dist/index.js <command>`.
- If no MCP tools appear, confirm `FAB_SERVER_PATH` points to `packages/server/dist/index.js`.
- If a client still does not see tools after restart, inspect that client's MCP config file and confirm the Fabric entry exists.
- If private client config changes unexpectedly, stop, inspect `git diff`, and restore only the Fabric change after user approval.

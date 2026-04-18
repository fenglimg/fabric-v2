# Day 2 Smoke Test: MCP Client Config Installation

This smoke test verifies that `fab config install` writes a Fabric MCP server entry and that all target clients can list the Fabric tools.

## Prerequisites

- Run from the Fabric repository root.
- Build the CLI and MCP server before testing real clients: `pnpm --filter @fabric/cli build` and `pnpm --filter @fabric/server build`.
- If the server entry should point somewhere else, set `FAB_SERVER_PATH=/absolute/path/to/server/dist/index.js` before running the install command.
- Have at least one target client installed and configured locally.

## Install Configs

1. Create or confirm workspace-local client directories for workspace-based clients:
   - Cursor: `.cursor/`
   - Windsurf: `.windsurf/`
   - Roo Code: `.roo/`
2. Confirm global client directories exist for global clients:
   - Claude Code CLI: `~/.claude/`
   - Gemini CLI: `~/.gemini/`, or a workspace `GEMINI.md`
   - Codex CLI: `~/.codex/`
3. Preview the writes:

   ```bash
   FAB_SERVER_PATH="$PWD/packages/server/dist/index.js" pnpm --filter @fabric/cli exec fab config install --dry-run
   ```

4. Install the detected configs:

   ```bash
   FAB_SERVER_PATH="$PWD/packages/server/dist/index.js" pnpm --filter @fabric/cli exec fab config install
   ```

5. To target a subset, pass a comma-separated list:

   ```bash
   pnpm --filter @fabric/cli exec fab config install --clients cursor,codex,gemini
   ```

## Expected Config Targets

- Claude Code CLI: `~/.claude/settings.json`
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS
- Cursor: `<workspace>/.cursor/mcp.json`
- Windsurf: `<workspace>/.windsurf/mcp.json`
- Roo Code: `<workspace>/.roo/mcp.json`
- Gemini CLI: `~/.gemini/settings.json`
- Codex CLI: `~/.codex/config.toml`

Each JSON client should contain `mcpServers.fabric`. Codex should contain `[mcp.servers.fabric]`.

## Client Verification

For each installed client:

1. Restart the client so it reloads MCP configuration.
2. Open the MCP tools view or run the client's `tools/list` equivalent.
3. Confirm these tools appear:
   - `fab_get_rules`
   - `fab_append_intent`
   - `fab_update_registry`
4. Run a minimal tool call if the client supports direct invocation:

   ```json
   {
     "path": "README.md"
   }
   ```

5. Record pass/fail for the client before moving to the next one.

## Troubleshooting

- If no clients are detected, create the workspace-local directory for the client or add an explicit path in `fabric.config.json`.
- If a client cannot start the server, confirm `FAB_SERVER_PATH` points to a built JavaScript file and that Node can execute it.
- If Codex rejects the config, inspect `~/.codex/config.toml` and confirm the Fabric entry is under `[mcp.servers.fabric]`.
- If JSON clients lose existing settings, stop and inspect the before/after file. The writer is expected to preserve unrelated top-level keys and other `mcpServers` entries.
- If Claude Desktop is not detected on macOS, create or locate `~/Library/Application Support/Claude/claude_desktop_config.json`, or set `clientPaths.claudeCodeDesktop` in `fabric.config.json`.
- If Roo Code or Windsurf uses a non-workspace config path in your installation, do not rely on runtime probing. Set `clientPaths.rooCode` or `clientPaths.windsurf` explicitly.

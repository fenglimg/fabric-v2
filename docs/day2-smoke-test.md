# Day 2 Smoke Test：MCP Client Config 安装

本 smoke test 验证 `fab config install` 会写入 Fabric MCP server entry，且各目标 client 能列出 Fabric tools。

## 前置条件

- 在 Fabric 仓库根目录运行。
- 在测试真实 client 前先构建 CLI 与 MCP server：`pnpm --filter @fenglimg/fabric-cli build` 与 `pnpm --filter @fenglimg/fabric-server build`。
- 若 server entry 应指向其他位置，在运行 install 命令前设置 `FAB_SERVER_PATH=/absolute/path/to/server/dist/index.js`。
- 至少安装并本地配置一种目标 client。

## 安装 Configs

1. 为基于 workspace 的 client 创建或确认 workspace-local 目录：
   - Cursor：`.cursor/`
   - Windsurf：`.windsurf/`
   - Roo Code：`.roo/`
2. 确认全局 client 的全局目录存在：
   - Claude Code CLI：`~/.claude/`
   - Gemini CLI：`~/.gemini/`，或 workspace `GEMINI.md`
   - Codex CLI：`~/.codex/`
3. 预览写入：

   ```bash
   FAB_SERVER_PATH="$PWD/packages/server/dist/index.js" node "$PWD/packages/cli/dist/index.js" config install --dry-run
   ```

4. 安装检测到的 config：

   ```bash
   FAB_SERVER_PATH="$PWD/packages/server/dist/index.js" node "$PWD/packages/cli/dist/index.js" config install
   ```

5. 若只针对子集，传入逗号分隔列表：

   ```bash
   node "$PWD/packages/cli/dist/index.js" config install --clients cursor,codex,gemini
   ```

## 预期 Config 目标

- Claude Code CLI：`~/.claude/settings.json`
- Claude Desktop：macOS 上 `~/Library/Application Support/Claude/claude_desktop_config.json`
- Cursor：`<workspace>/.cursor/mcp.json`
- Windsurf：`<workspace>/.windsurf/mcp.json`
- Roo Code：`<workspace>/.roo/mcp.json`
- Gemini CLI：`~/.gemini/settings.json`
- Codex CLI：`~/.codex/config.toml`

各 JSON client 应包含 `mcpServers.fabric`。Codex 应包含 `[mcp_servers.fabric]`。

## Client 验证

对每个已安装 client：

1. 重启 client 以重新加载 MCP configuration。
2. 打开 MCP tools 视图或运行该 client 的 `tools/list` 等价操作。
3. 确认出现以下 tools：
   - `fab_get_rules`
   - `fab_append_intent`
   - `fab_update_registry`
4. 若 client 支持直接调用，运行最小 tool call：

   ```json
   {
     "path": "README.md"
   }
   ```

5. 在进入下一个 client 前记录 pass/fail。

## 故障排除

- 若未检测到任何 client，为该 client 创建 workspace-local 目录，或在 `fabric.config.json` 中添加显式 path。
- 若 client 无法启动 server，确认 `FAB_SERVER_PATH` 指向已构建的 JavaScript 文件且 Node 可执行。
- 若 Codex 拒绝 config，检查 `~/.codex/config.toml`，确认 Fabric entry 位于 `[mcp_servers.fabric]` 下。
- 若 JSON client 丢失既有 settings，先停止并检查 before/after 文件。Writer 预期保留无关 top-level keys 与其他 `mcpServers` entry。
- 若 macOS 上未检测到 Claude Desktop，创建或定位 `~/Library/Application Support/Claude/claude_desktop_config.json`，或在 `fabric.config.json` 中设置 `clientPaths.claudeCodeDesktop`。
- 若 Roo Code 或 Windsurf 在你安装中使用非 workspace config path，不要依赖 runtime probing。显式设置 `clientPaths.rooCode` 或 `clientPaths.windsurf`。

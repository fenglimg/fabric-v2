# Fabric v1.0 Smoke 测试

针对已发布的 Fabric v1.0 npm artifact 运行本清单。验证公开 release 时不要用本地 monorepo build 替代。

## 前置条件

- Node.js 20 或更高版本
- 可访问 public registry 的 npm
- Disposable test repository
- `127.0.0.1:7373` 上的空闲本地端口

## Smoke 清单

1. **安装已发布的 CLI**

   ```bash
   npm install -g @fenglimg/fabric-cli@1.0.0
   fab --help
   ```

   确认 `fab` 可用，且 help 输出包含 `fab v1.0.0`。

2. **初始化干净仓库**

   ```bash
   mkdir fabric-smoke-v1 && cd fabric-smoke-v1
   git init
   fab init
   ```

   确认在未手工编辑的情况下创建了 `AGENTS.md`、`.fabric/agents.meta.json`、`.fabric/human-lock.json` 与 `.fabric/forensic.json`。

3. **启动本地 control plane**

   ```bash
   fab serve
   ```

   确认 CLI 打印 `Fabric Dashboard: http://127.0.0.1:7373` 或其本地化等价输出，并在后续检查期间保持 server 运行。

4. **用 initialize 请求命中 MCP HTTP endpoint**

   ```bash
   curl -i -sS \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":"smoke-init","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}' \
     http://127.0.0.1:7373/mcp
   ```

   确认响应为 JSON-RPC、包含 server name，并返回 `Mcp-Session-Id` response header。

5. **验证 repository state 的 REST surface**

   ```bash
   curl -sS http://127.0.0.1:7373/api/rules
   ```

   确认响应为合法 JSON，包含 repository rule metadata，而非 HTTP error。

6. **打开 Dashboard**

   在浏览器中打开 `http://127.0.0.1:7373`。

   确认 Fabric Dashboard 可加载、sidebar 渲染所有 primary views，且 UI 不出现 missing-assets error。

7. **在 UI 内验证 release identity**

   在 Dashboard header/sidebar 品牌区，确认 version badge 显示 `v1.0.0`。

8. **可选：本地化 spot-check**

   使用 `FAB_LANG=zh-CN fab serve` 重启 CLI，确认 ready 输出已本地化，且 server 仍在同一 URL 可达。

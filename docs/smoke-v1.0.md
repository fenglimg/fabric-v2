# Fabric v1.0 Smoke Test

Run this checklist against the published npm artifact for Fabric v1.0. Do not substitute a local monorepo build when validating a public release.

## Preconditions

- Node.js 20 or newer
- npm access to the public registry
- A disposable test repository
- A free local port at `127.0.0.1:7373`

## Smoke Checklist

1. **Install the published CLI**

   ```bash
   npm install -g @fenglimg/fabric-cli@1.0.0
   fab --help
   ```

   Verify that `fab` is available and that the help output includes `fab v1.0.0`.

2. **Initialize a clean repository**

   ```bash
   mkdir fabric-smoke-v1 && cd fabric-smoke-v1
   git init
   fab init
   ```

   Verify that `AGENTS.md`, `.fabric/agents.meta.json`, `.fabric/human-lock.json`, and `.fabric/forensic.json` are created without manual edits.

3. **Start the local control plane**

   ```bash
   fab serve
   ```

   Verify that the CLI prints `Fabric Dashboard: http://127.0.0.1:7373` or the localized equivalent and keep the server running for the remaining checks.

4. **Hit the MCP HTTP endpoint with an initialize request**

   ```bash
   curl -i -sS \
     -H 'Content-Type: application/json' \
     -d '{"jsonrpc":"2.0","id":"smoke-init","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke-test","version":"1.0.0"}}}' \
     http://127.0.0.1:7373/mcp
   ```

   Verify that the response is JSON-RPC, includes a server name, and returns an `Mcp-Session-Id` response header.

5. **Verify the REST surface for repository state**

   ```bash
   curl -sS http://127.0.0.1:7373/api/rules
   ```

   Verify that the response is valid JSON and includes repository rule metadata instead of an HTTP error.

6. **Open the Dashboard**

   Open `http://127.0.0.1:7373` in a browser.

   Verify that the Fabric Dashboard loads, the sidebar renders all primary views, and the UI does not show a missing-assets error.

7. **Verify release identity inside the UI**

   In the Dashboard header/sidebar brand area, verify that the version badge displays `v1.0.0`.

8. **Optional localization spot-check**

   Restart the CLI with `FAB_LANG=zh-CN fab serve` and confirm the ready output is localized while the server remains reachable at the same URL.

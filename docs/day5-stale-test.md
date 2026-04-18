# Day 5 Stale Detection Test

## Terminal A

Start the Fabric MCP server:

```bash
pnpm --filter @fabric/server dev
```

Alternative:

```bash
node packages/server/dist/index.js
```

Keep this terminal open for the whole test.

## Terminal B

Start MCP Inspector in a second terminal. Configure it to launch the same Fabric server command for this workspace, then call `fab_get_rules`:

```bash
pnpm dlx @modelcontextprotocol/inspector
```

Inspector launch settings:

```text
Command: node
Args: packages/server/dist/index.js
Working Directory: /Users/wepie/Desktop/personal-projects/pcf
```

After the Inspector session is connected, call:

```json
{
  "method": "tools/call",
  "params": {
    "name": "fab_get_rules",
    "arguments": {
      "path": "src"
    }
  }
}
```

Expected response shape:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"revision_hash\":\"sha256:X\",\"stale\":false,\"rules\":{\"L0\":\"# Root AGENTS...\",\"L1\":[{\"path\":\"L1/features/foo/AGENTS.md\",\"content\":\"# Foo rules...\"}],\"L2\":[],\"human_locked_nearby\":[{\"file\":\"AGENTS.md\",\"excerpt\":\"## @HUMAN...\"}]}}"
    }
  ]
}
```

Record the returned `revision_hash` as `<X>`.

## Terminal A

Modify `L1/features/foo/AGENTS.md`, then refresh metadata:

```bash
fab sync-meta
```

This must update `.fabric/agents.meta.json.revision` from `<X>` to a new hash `<Y>`.

## Terminal B

Call `fab_get_rules` again, now with the old client hash:

```json
{
  "method": "tools/call",
  "params": {
    "name": "fab_get_rules",
    "arguments": {
      "path": "src",
      "client_hash": "sha256:X"
    }
  }
}
```

Expected response shape:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\"revision_hash\":\"sha256:Y\",\"stale\":true,\"rules\":{\"L0\":\"# Root AGENTS...\",\"L1\":[{\"path\":\"L1/features/foo/AGENTS.md\",\"content\":\"# Foo rules after edit...\"}],\"L2\":[],\"human_locked_nearby\":[{\"file\":\"AGENTS.md\",\"excerpt\":\"## @HUMAN...\"}]}}"
    }
  ]
}
```

## Pass Criteria

- First call returns `stale: false`.
- Second call returns `stale: true`.
- Second call returns a different `revision_hash` (`<Y> != <X>`).
- The second response includes refreshed rule content from the edited L1 file.

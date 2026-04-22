# Day 5 Stale Detection 测试

## 终端 A（启动 server）

启动 Fabric MCP server：

```bash
pnpm --filter @fenglimg/fabric-server dev
```

或：

```bash
node packages/server/dist/index.js
```

整个测试期间保持此终端打开。

## 终端 B（Inspector 与首次 tools/call）

在第二个终端启动 MCP Inspector。将其配置为对本 workspace 启动相同的 Fabric server command，然后调用 `fab_get_rules`：

```bash
pnpm dlx @modelcontextprotocol/inspector
```

Inspector 启动设置：

```text
Command: node
Args: packages/server/dist/index.js
Working Directory: /Users/wepie/Desktop/personal-projects/pcf
```

Inspector session 连接后，调用：

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

预期响应形态：

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

将返回的 `revision_hash` 记为 `<X>`。

## 终端 A（修改规则并 sync-meta）

修改 `L1/features/foo/AGENTS.md`，然后刷新 metadata：

```bash
fab sync-meta
```

这必须把 `.fabric/agents.meta.json.revision` 从 `<X>` 更新为新 hash `<Y>`。

## 终端 B（携带旧 client_hash 再次调用）

再次调用 `fab_get_rules`，此时携带旧的 client hash：

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

预期响应形态：

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

## 通过标准

- 第一次调用返回 `stale: false`。
- 第二次调用返回 `stale: true`。
- 第二次调用返回不同的 `revision_hash`（`<Y> != <X>`）。
- 第二次响应包含来自已编辑 L1 文件的刷新后 rule content。

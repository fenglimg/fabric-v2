---
version: 1.8.0
audience: existing 1.7.x users
status: draft
---

# 迁移指南：Fabric v1.7.x → v1.8.0

> 本文档将随 v1.8.0 开发逐步填充。

## 1. 客户端范围变更（6 → 3）

从 v1.8.0 起，以下三个客户端配置键将被彻底移除：

- `windsurf` — 从 1.7.1 起废弃，1.8.0 正式移除
- `rooCode` — 从 1.7.1 起废弃，1.8.0 正式移除
- `geminiCLI` — 从 1.7.1 起废弃，1.8.0 正式移除

保留的受支持客户端为：`claudeCodeCLI`、`claudeCodeDesktop`、`cursor`、`codexCLI`。

### 迁移方法

运行以下命令自动清理 `fabric.config.json` 中的废弃键：

```bash
fab doctor --fix
```

执行后，doctor 会从 `clientPaths` 中删除 `windsurf`、`rooCode`、`geminiCLI`，
并向事件账本写入一条 `legacy_client_path_present` 记录。

### 时间线

| 版本   | 状态               |
|--------|--------------------|
| 1.7.1  | 废弃警告（doctor warning） |
| 1.8.0  | 正式移除，配置文件中的对应键将被忽略 |

## 2. 配置迁移

TBD — 待 TASK-017（Claude MCP config path 修复）填充：`.claude/settings.json` → `.mcp.json` 迁移、scope flag 行为、deep-merge 策略、doctor 自动迁移说明。

## 3. --reapply 行为变更

TBD — 待 TASK-020 填充：保留 ledger、规则存在时跳过 meta 重新生成。

## 4. doctor 新检查

TBD — 待 TASK-031（stable_id_collision）/ TASK-024（rules consistency）/ TASK-029（content_ref_missing 重分类）等填充。

## 5. FAQ

TBD — 待团队 triage 完成。

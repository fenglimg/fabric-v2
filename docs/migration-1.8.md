---
version: 1.8.0
audience: existing 1.7.x users
status: draft
---

# 迁移指南：Fabric v1.7.x → v1.8.0

> 本文档将随 v1.8.0 开发逐步填充。

## 1. 客户端范围变更（6 → 3）

从 v1.8.0 起，以下三个客户端配置键将被彻底移除：

- `windsurf` — v1.8.0 移除
- `rooCode` — v1.8.0 移除
- `geminiCLI` — v1.8.0 移除

保留的受支持客户端为：`claudeCodeCLI`、`claudeCodeDesktop`、`cursor`、`codexCLI`。

### 迁移方法

运行以下命令自动清理 `fabric.config.json` 中的废弃键：

```bash
fab doctor --fix
```

执行后，doctor 会从 `clientPaths` 中删除 `windsurf`、`rooCode`、`geminiCLI`，
并向事件账本写入一条 `legacy_client_path_present` 记录。

### 升级流程

1. 升级到 v1.8.0
2. 运行 `fab doctor`：若 `fabric.config.json` 中存在已废弃的客户端键，会显示 `legacy_client_path_present` 检查项
3. 运行 `fab doctor --fix`：自动从 `clientPaths` 中删除废弃键并写入 `legacy_client_path_present` 账本事件

> 注：原计划经由 v1.7.1 提供废弃警告作为预告，但相关检查在实现上深度依赖 v1.8.0 的 FabricError 与新事件账本类型，无法干净地反向移植到 v1.7.0 主干。因此废弃 + 移除合并在 v1.8.0 一并发布；用户首次升级时仍可通过 `fab doctor` 看到清理建议再决定是否执行。

## 2. 配置迁移

### Claude MCP 配置路径变更

在 v1.8.0 之前，`fab init` 将 Claude Code 的 MCP 服务器条目写入
`.claude/settings.json`。这与 Claude Code 规范不符——该文件仅用于 hooks 和
权限配置，MCP 服务器条目应写入专用位置。

**v1.8.0 起的正确位置：**

| 作用域 | 文件路径 |
|--------|----------|
| project（默认） | `<repo-root>/.mcp.json` |
| user | `~/.claude.json` |

### 作用域标志

`fab init` 新增 `--scope` 参数：

```bash
fab init                    # 等同于 --scope project，写入 .mcp.json
fab init --scope project    # 写入 <repo-root>/.mcp.json
fab init --scope user       # 写入 ~/.claude.json
```

### 深合并策略

写入 MCP 配置时，Fabric 采用手动实现的深合并（无额外依赖），
仅更新 `mcpServers.fabric` 条目，**不会覆盖**文件中已有的其他 MCP 服务器条目。

```jsonc
// 合并前 .mcp.json（已有其他服务器）
{
  "mcpServers": {
    "other-tool": { "command": "npx", "args": ["other-mcp"] }
  }
}

// 合并后 .mcp.json（仅追加 fabric，不影响 other-tool）
{
  "mcpServers": {
    "other-tool": { "command": "npx", "args": ["other-mcp"] },
    "fabric": { "command": "npx", "args": ["@fenglimg/fabric-server"] }
  }
}
```

### 自动迁移（doctor --fix）

若 `.claude/settings.json` 中存在 `mcpServers.fabric` 条目，doctor 会报告
`mcp_config_in_wrong_file` 检查失败，并提供以下修复流程：

1. `fab doctor --fix` 从 `.claude/settings.json` 中**删除** `mcpServers.fabric` 条目。
2. 用户随后运行 `fab init`（或 `fab init --scope user`）将条目写入正确位置。

> 注意：doctor --fix 仅移除错误位置的条目，不会自动决定新的目标位置。
> 请根据团队协作需求选择 project 或 user 作用域后重新运行 `fab init`。

## 3. --reapply 行为变更

### 事件账本不再被截断

在 v1.8.0 之前，`fab init --reapply` 会清空 `.fabric/events.jsonl`（截断操作）。
从 v1.8.0 起，账本文件**字节内容完整保留**，现有事件历史不受影响。

### agents.meta.json 保留策略

`--reapply` 对 `agents.meta.json` 的处理行为取决于 `.fabric/rules/` 目录是否有内容：

| 场景 | 行为 |
|------|------|
| `rules/` 目录存在且有 `.md` 文件 | `agents.meta.json` **保留**（保护 AI 构建的规则树） |
| `rules/` 目录为空或不存在 | `agents.meta.json` **重新生成** |

此策略确保开发者通过 AI 客户端精心构建的规则结构在 `--reapply` 后不会丢失。

### 新增账本事件

`--reapply` 完成后会向事件账本写入一条 `reapply_completed` 事件，包含以下字段：

```jsonc
{
  "type": "reapply_completed",
  "preserved_ledger": true,   // 账本是否被保留（现在始终为 true）
  "preserved_meta": true,     // meta 是否被保留（取决于 rules/ 内容）
  "rules_count": 12           // 检测到的 rules/ 文件数量
}
```

## 4. doctor 新检查

v1.8.0 新增以下 doctor 检查项：

| 检查项 | 说明 | 可修复 |
|--------|------|--------|
| `mcp_config_in_wrong_file` | `.claude/settings.json` 中存在 `mcpServers.fabric` 条目（应在 `.mcp.json` 或 `~/.claude.json`）。`--fix` 从错误文件中删除该条目，之后需重新运行 `fab init` 写入正确位置。 | 是 |
| `event_ledger_partial_write` | `.fabric/events.jsonl` 末尾存在不完整的 JSON 行（写入被中断）。`--fix` 截断尾部残行并写入 `LedgerWarning` 事件。 | 是 |
| `meta_manually_diverged` | `agents.meta.json` 中的规则哈希与磁盘上 `rules/` 文件内容不一致，说明 meta 被手动修改或规则文件在 Fabric 外部变更。`--fix` 调用 `reconcileRules` 重建 meta。 | 是 |
| `legacy_client_path_present` | `fabric.config.json` 中存在已废弃的客户端键（`windsurf`、`rooCode`、`geminiCLI`）。`--fix` 从 `clientPaths` 中删除这些键。 | 是 |
| `rules_dir_unindexed` | `.fabric/rules/` 中存在 `.md` 文件，但 `agents.meta.json` 中没有对应条目。离线添加的规则文件尚未被索引。`--fix` 调用 `reconcileRules` 同步索引。 | 是 |
| `stable_id_collision` | 两个或多个规则节点具有相同的 `stable_id`，会导致客户端引用歧义。`--fix` 为冲突节点重新生成唯一 stable_id 并更新 meta。 | 是 |
| `claude_skill_legacy_path` | Claude Code SKILL 文件仍位于旧路径 `.claude/skills/agents-md-init/`，应迁移至 `.claude/skills/fabric-init/`。`--fix` 移动文件并删除旧目录。 | 是 |
| `preexisting_root_claude_md` | 项目根目录存在 `CLAUDE.md` 或 `AGENTS.md`，该文件早于 Fabric 初始化存在，可能与 Fabric 管理的规则树产生冲突。此项为**信息级别**（info），仅提示用户手动审查，不自动修复。 | 否（info） |

### 使用方式

```bash
fab doctor           # 列出所有检查结果
fab doctor --fix     # 自动修复所有可修复项
```

## 5. FAQ

**Q: Doctor reports `init_context_missing`. How do I fix this?**

A: Initialization context is created by running the `fabric-init` SKILL in your AI client (Claude Code or Codex CLI). The skill creates `.fabric/agents.meta.json` and the rule node tree. After running it once, doctor will pass.

---

**Q: What happens when I send SIGTERM or SIGINT to the Fabric server process?**

A: v1.8.0 adds graceful signal handling for SIGTERM, SIGINT, and SIGHUP. Upon receiving the first signal, the server:

1. Stops accepting new requests.
2. Drains all in-flight requests — waits up to **5 seconds** for active handlers to complete.
3. Calls `fsync` on the event ledger file to guarantee durability.
4. Exits cleanly with code 0.

If a **second signal** is received before drain completes (e.g., impatient Ctrl+C), the process exits immediately without waiting. This prevents the zombie-process pattern observed in Claude Code issue #15945.

---

**Q: Are there limits on MCP tool payload sizes?**

A: Yes. v1.8.0 introduces a two-tier MCP payload guard:

| Threshold | Behavior |
|-----------|----------|
| 16 KB | Warning logged and included in `response.warnings`; request proceeds. |
| 64 KB | Hard limit — request rejected with typed error `MCP_PAYLOAD_TOO_LARGE`. |

Both thresholds are configurable in `fabric.config.json`:

```jsonc
{
  "mcpPayloadLimits": {
    "warnBytes": 16384,   // 16 KB default
    "hardBytes": 65536    // 64 KB default
  }
}
```

---

**Q: What is the serve lockfile and what happens if the server crashes?**

A: When `fab serve` starts, it writes `.fabric/.serve.lock` containing the current process PID. This prevents accidental double-starts in the same repository.

- **Stale lockfile** (PID is no longer alive): automatically recovered — the old lockfile is deleted and the new server starts normally.
- **Live lockfile** (PID is running): `fab serve` refuses to start and prints the conflicting PID.
- **Force override**: pass `--force` to `fab serve` to remove the lockfile and start regardless (use with caution; only appropriate when you are certain the other process is safe to displace).

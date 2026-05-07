---
version: 1.8.0
audience: existing 1.7.x users
status: draft
---

# 迁移指南：Fabric v1.7.x → v1.8.0

> 本文档将随 v1.8.0 开发逐步填充。

## 1. 客户端范围变更（6 → 3）

TBD — 待 TASK-012（client narrow）填充：移除 Cline / Continue / Roo Cline 详细说明，保留 Claude / Codex / Cursor。

## 2. 配置迁移

TBD — 待 TASK-017（Claude MCP config path 修复）填充：`.claude/settings.json` → `.mcp.json` 迁移、scope flag 行为、deep-merge 策略、doctor 自动迁移说明。

## 3. --reapply 行为变更

TBD — 待 TASK-020 填充：保留 ledger、规则存在时跳过 meta 重新生成。

## 4. doctor 新检查

TBD — 待 TASK-031（stable_id_collision）/ TASK-024（rules consistency）/ TASK-029（content_ref_missing 重分类）等填充。

## 5. FAQ

TBD — 待团队 triage 完成。

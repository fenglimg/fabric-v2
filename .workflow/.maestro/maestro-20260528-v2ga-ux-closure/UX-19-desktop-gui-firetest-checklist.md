# UX-19 — Desktop GUI 手动 Fire-Test Checklist (用户手动跑)

> 自动循环不碰 GUI app (跑不进 CI / computer-use 太脆)。CLI 全测已传递性覆盖**配置层**;本 checklist 只验 CLI 测不到的 **GUI runtime 差异**。每项打 ✅/❌ + 备注。

## 前置
- [ ] 在一个干净测试 repo 跑 `fabric install --yes`(或交互), 确认 4 客户端摘要 ready。

## A. Claude Desktop — Code tab (GUI runtime hook-fire)
对照 issue #51904 的 `--setting-sources user` 风险:
- [ ] **A1 hook 真 fire**: 在 Claude Desktop 的 Code tab 打开该 repo, 编辑任一文件 → 观察是否触发 Fabric 的 PreToolUse narrow hint(knowledge-hint-narrow)。✅=有 hint 输出 / ❌=静默(可能 GUI 没加载 project hook)。
- [ ] **A2 SessionStart broad**: 新开一个 Code tab session → 是否出现 SessionStart 的 broad 知识列表。
- [ ] **A3 Stop nudge**: 完成一轮编辑/对话 → Stop hook 的归档/审阅 nudge 是否按 precedence 出现。
- [ ] **A4 MCP 工具可用**: 在 Code tab 让 AI 调 `fab_recall` / `fab_plan_context` → 是否成功返回(MCP server 已连)。

## B. MCP 双注册冲突检查
- [ ] **B1**: 确认 fabric MCP **不**同时出现在 `~/.claude.json`/`.mcp.json` 与 `claude_desktop_config.json` 造成双注册冲突(同名 server 重复 → 可能连接异常)。检查两处 mcpServers.fabric 是否仅一处生效。

## C. Codex Desktop
- [ ] **C1 codex-hooks.json 生效**: Codex Desktop 打开 repo → 编辑文件 → `.codex/hooks.json` 里的 PreToolUse(Edit|Write|MultiEdit) → knowledge-hint-narrow 是否 fire。
- [ ] **C2 config.toml 共享**: 确认 Codex Desktop 与 Codex CLI 共享 config.toml, fabric MCP server 在 Desktop 也生效(让 AI 调一次 fab_recall)。

## D. 装完即用无残留报错
- [ ] **D1**: 安装后首次在两个 Desktop app 打开 repo, 无 "hook script not found" / "MCP connection failed" / stderr 报错刷屏。
- [ ] **D2**: `fabric doctor` 在该 repo 报告无 GUI 相关 error(install→doctor --fix→green)。

## 已知 CLI 侧结论 (本轮自动验, GUI 侧请对照)
- 配置层: install 把 .claude(settings.json hooks+MCP) / .codex(hooks.json+config.toml 共享) 都装对 (UX-11 parity: 共享资产 byte-equal, 唯一 diff=cite hook 挂载点平台适配)。
- hook scripts + skills 两端 byte-equal。
- ⚠️ 注意 NEW-8: 若你之后 `fabric uninstall`, 当前版本会残留 skills + hooks config(P2, 非阻断, 需手动清或等修复)。

## 回填
跑完把每项结果回填到此文件, 并把整体 PASS/FAIL 告知 → 我据此更新 status.json 的 UX-19 verification.verified_at。

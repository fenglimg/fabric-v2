# Day 6 Bootstrap

## 背景

Day 6 的目标是把 Brainstorm §4.2 的 5 行首屏引导词落到 6 个客户端，并补一个可复现的 Cocos Creator stub fixture，方便 Day 7 做 inner-track 的 E2E。

这 5 行策略的作用是：

1. 在会话最开始提醒 AI 规则来源是 Fabric Protocol。
2. 在任何修改前强制回到 `fab_get_rules`，降低“记忆漂移”。
3. 把节点注册和 `.fabric/agents.meta.json` 的修改渠道硬性分离。
4. 把 `@HUMAN` 区域提升为显式停机点。
5. 用 `fab_append_intent` 给一次完整任务补齐意图记录。

## 客户端适配

- Claude Code: 使用根目录 `CLAUDE.md`，并在末尾追加 `@AGENTS.md` 导入完整规范。
- Cursor: 输出到 `.cursor/rules/fabric-bootstrap.mdc`，使用 `alwaysApply: true` frontmatter。
- Windsurf: 输出到 `.windsurf/rules/fabric.md`，保持纯 Markdown。
- Roo Code: 输出到 `.roo/rules/fabric.md`，保持纯 Markdown。
- Gemini CLI: 输出到根目录 `GEMINI.md`，并追加 `@AGENTS.md`。
- Codex CLI: 不新增独立规则文件，而是把 `templates/bootstrap/codex-AGENTS-header.md` prepend 到目标 `AGENTS.md` 顶部；若已存在 `Fabric Bootstrap` 头则跳过，避免破坏已有内容。

## 命令速查

`fabric init` 会自动运行 bootstrap install。如需针对性重跑：

```bash
fabric bootstrap install
```

显式指定客户端：

```bash
fabric bootstrap install --clients claude,cursor,windsurf,roo,gemini,codex
```

## Fixture 说明

`examples/werewolf-minigame-stub/` 是一个最小 Cocos Creator 工程骨架：

- `project.config.json` 触发 Cocos 检测。
- `assets/scripts/*.ts` 提供最小 `cc.Component` 样例。
- `assets/scripts/*.ts.meta` 用于验证扫描忽略规则确实屏蔽 Cocos `.meta` sidecar。
- `README.md` 保持短文本，确保 `fab scan` 仍会报告 `stub` 级 README 质量。

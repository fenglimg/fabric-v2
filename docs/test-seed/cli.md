# Test Seed — cli

> 模块单位: 命令级（5 个公共命令；内部子例程仅作 §2/§3 支撑出现）
> 维护原则: 仅在意图变更时更新（详见 ../README.md §5）
> 最近更新: 2026-05-08 / v1.8.0

## §1 Feature Surface

### Public commands (5)
- `install` — 项目脚手架与客户端配置写入；flags: `--target`, `--debug`, `--force`, `--yes`, `--plan`, `--reapply`, `--bootstrap/--no-bootstrap`, `--mcp/--no-mcp`, `--hooks/--no-hooks`, `--interactive/--no-interactive`, `--mcp-install`, `--scope project|user`
- `scan` — 静态项目扫描，产出 forensic report；flags: `--target`, `--debug`, `--json`
- `doctor` — 一致性自检与修复；flags: `--target`, `--fix`, `--fix-knowledge`, `--json`, `--rescan`, `--strict`, `--yes`
- `serve` — 启动 HTTP MCP server；flags: `--port`(默认 7373), `--host`(默认 127.0.0.1), `--target`, `--debug`
- `uninstall` — Remove Fabric-managed artifacts symmetrically to `fab install`. Flags: `--plan`, `--force`, `--yes`, `--no-bootstrap`, `--no-mcp`, `--no-scaffold`, `--target`, `--interactive`, `--purge`, `--clean-empties`.

### Internal surface（命令支撑，不单列模块）
- bootstrap / config / hooks 子例程
- forensic scanner（detector + ignores）
- 客户端配置写入器（Claude Code、Codex CLI、Cursor 三家）
- MCP 配置 deep-merge with `--scope` 路由（project → `.mcp.json`，user → `~/.claude.json`）
- 原子写入 primitives（tmp+rename，失败清理 .tmp）
- install wizard（交互模式 + `--yes` 跳过）
- serve-lock 检查（`install --reapply` / `doctor` / `serve` 共用 `checkLockOrThrow` / `acquireLock`）

## §2 Invariants

I1. `doctor` 当且仅当所有 check status=ok 时进程退出码为 0；任何 error 退出 1；`--strict` 下 warn 也退出 1。
I2. `install` 未带 `--force` 遇既有 fabric 文件时不覆盖、退出非 0、stderr 含可执行的 action_hint（如 "use --force"）。
I3. `install --reapply` 在已初始化项目上幂等：连续两次产出 byte-identical 的 `agents.meta.json`（当 `rules/` 非空）和 byte-identical 的 `events.jsonl`。
I4. `install --scope project` 写 `.mcp.json` 且不写入 `~/.claude.json`；`--scope user` 写 `~/.claude.json` 且不污染项目根。
I5. 所有客户端配置写入采用 atomic-write：rename 步骤失败时不留 `.tmp` 残留文件。
I6. `doctor --fix` 完成后再次运行 `doctor` 时，已修复的 fixable_error 不再出现；剩余 manual_error 在输出中显式列出。
I7. v1.8.0 弃用客户端 (`windsurf` / `rooCode` / `geminiCLI`) 触发 `legacy_client_path_present` 警告但 doctor 不因此失败。
I8. `scan` 在源码目录为空或不可读时不抛异常，产出有效 `forensic.json`（fileCount 可为 0，recommendations 数组存在）。
I9. `serve` 在 `EADDRINUSE` 时释放已获取的 serve-lock 并抛带 next-port 提示的错误，不留持锁孤儿进程。
I10. `doctor` / `serve` 在另一进程持锁时拒绝执行（rc.15: `--force` 已移除；CLI 层无逃生通道，需手动停止持锁进程）；锁条目带 PID 校验，错误消息暴露 PID 与停止指引。
I11. `fab uninstall` is idempotent — re-run on already-uninstalled project: exit code 0, all step statuses `skipped`.
I12. `fab uninstall` never modifies `~/.fabric/knowledge/` (personal root) regardless of `--purge`.
I13. `fab uninstall` un-merge preserves all non-fabric entries in deep-merged hook configs verbatim.

## §3 Known-Tricky Cases

T1. **init_context_missing 的 action_hint 必须指向 fabric-init skill** (TASK-039) — `.fabric/init-context.json` 缺失时 doctor 不提示 `--fix`（这不是 `doctor --fix` 能解决的），而提示运行 Claude Code / Codex CLI 中的 fabric-init skill。
    覆盖: `packages/server/src/services/doctor.test.ts`（"TASK-039" 用例）；CLI 端透传 server doctor 输出，需断言 action_hint 文本未在 CLI 渲染层丢失。

T2. **doctor 段头国际化 via `t()`** (TASK-038) — `fixable` / `manual` / `warnings` 三段标题来自 `doctor.section.*` i18n key，不再硬编码英文；切换 locale 时 CLI 输出对应翻译。
    覆盖: `packages/cli/src/commands/doctor.ts:82-84` 调用 `t("doctor.section.*")`；需断言 zh-CN locale 下三段头为中文且 protected-tokens 不被翻译。

T3. **MCP 配置 scope 冲突合并** — 既有 `.mcp.json` 已含其他 `mcpServers` 条目时，`install --scope project` 必须保留它们（hand-rolled deep-merge），仅替换 `fabric` 一项；`--scope user` 同理对 `~/.claude.json` 生效。
    覆盖: `packages/cli/__tests__/`（client-config 写入器单测 + golden snapshot）。

T4. **既有 root markdown 下的 install 行为** — 项目根已有 `CLAUDE.md` / `AGENTS.md` 时，`install` 既不删也不覆盖；server 启动会输出 info 级提示（见 `formatPreexistingRootMessage`），doctor `preexisting_root_claude_md` 给提醒不报 error。
    覆盖: `packages/server/src/index.ts:68-74`；CLI install 流需断言 root markdown 未被改写。

T5. **legacy 客户端清理路径** — `fabric.config.json` 中残留 `windsurf` / `rooCode` / `geminiCLI` 的 clientPaths 时，`doctor --fix` 应移除这些 key 而不影响活跃客户端配置。

T6. **`fab uninstall` round-trip equality (install → uninstall)** — bootstrap stage helpers preserve byte-for-byte equality of pre-install state on already-initialized fixtures; un-merge restores non-fabric hook entries verbatim and removes only fabric-owned ones (matched by command-path against `FABRIC_HOOK_COMMAND_PATHS`).
    覆盖: `packages/cli/__tests__/integration/uninstall-skills-and-hooks.test.ts` 对 cocos-stub fixture 做 init → uninstall → diff 三步断言（pinned in advance; created by TASK-005）。

T7. **`fab uninstall --plan` no-write contract** — `--plan` 模式必须列出 scaffold entries + per-stage actions + 检测到的客户端，但绝不触发任何 `rm` / `writer.remove`；stage results 全部 `skipped`。
    覆盖: `packages/cli/__tests__/uninstall.test.ts`（断言 `--plan` 调用后 fixture 目录 mtime 不变且 `writer.remove` spy 调用 0 次）。

## §4 Out of Scope

- server 运行时行为（HTTP/SSE/MCP tool 实现）— 见 `server.md`
- shared 包内部 schema/error/i18n 单元行为 — 见 `shared.md`
- dashboard 客户端 UI
- 已弃用的 `mcp-config` 命令（v1.8.0 已移除）

## §5 Source Traceability

- `packages/cli/src/commands/index.ts`（命令注册表）
- `packages/cli/src/commands/{install,scan,doctor,serve}.ts`（命令定义与 args schema）
- `packages/cli/README.md`、`docs/initialization.md`、`docs/getting-started.md`
- `CHANGELOG.md` 1.8.0 段（client trio、scope、atomic-write、legacy_client_path_present）
- ADR-002（MCP-first）、ADR-003（scope routing）

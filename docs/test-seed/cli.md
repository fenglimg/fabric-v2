# Test Seed — cli

> 模块单位: 命令级（当前注册的公共命令 + deprecated aliases；内部子例程仅作 §2/§3 支撑出现）
> 维护原则: 仅在意图变更时更新（详见 ../README.md §5）
> 最近更新: 2026-06-08 / v2.2.0-rc.5

## §1 Feature Surface

### Public commands
- `install` — 项目脚手架、TUI/wizard、客户端 MCP stdio 配置、bootstrap 与 hook 写入。
- `store` — 多 store 生命周期；子命令覆盖 list/add/remove/explain/bind/switch-write。
- `sync` — 多 store `pull --rebase` + `push`，含冲突 resume。
- `info` — 统一身份、项目状态与 scope 解释；替代 `whoami` / `status` / `scope-explain`。
- `doctor` — 一致性自检与修复；public flags: `--target`, `--fix`, `--fix-knowledge`, `--json`, `--verbose`；hidden/internal flags include `--strict` and report/debug surfaces。
- `uninstall` — Remove Fabric-managed artifacts symmetrically to `fabric install`. Flags: `--target`, `--debug`, `--yes`, `--dry-run`.
- `config` — 交互式配置面板；flags: `--target`。

### Deprecated top-level aliases（public but migration-only）
- `whoami` — deprecated alias；use `fabric info --global`。
- `status` — deprecated alias；use `fabric info`。
- `scope-explain` — deprecated alias；use `fabric info scope`。

`fabric serve` 已在 v2.0.0-rc.37 quarantine 到 `packages/server-http-experimental/`，主线 CLI 不再注册。`fabric scan` 顶层命令也已移除；安装与 doctor 内部仍可复用 deterministic scanner。

### Hidden top-level commands（callable but absent from `--help`）
- `plan-context-hint` — 给 rc.6 hooks 与 `fabric-import` skill 提供 JSON 知识提示流；rc.15 起通过 `meta.hidden: true` 隐藏，但脚本调用仍可触达。
- `onboard-coverage` — fabric-archive first-run 阶段检测未覆盖 slots。
- `metrics` — `.fabric/metrics.jsonl` 文本 dashboard。

### Internal surface（命令支撑，不单列模块）
- bootstrap / hooks 子例程（installHooks 现位于 `packages/cli/src/install/hooks-orchestrator.ts`）
- forensic scanner（detector + ignores）
- 客户端配置写入器（Claude Code、Codex CLI、Cursor 三家）
- MCP 配置 deep-merge with `--scope` 路由（project → `.mcp.json`，user → `~/.claude.json`）
- 原子写入 primitives（tmp+rename，失败清理 .tmp）
- install wizard（交互模式 + `--yes` 跳过）
- legacy serve-lock probe（doctor 用于检测/清理 rc ≤36 遗留 `.fabric/.serve.lock`，完整 serve-lock 已 quarantine）

## §2 Invariants

I1. `doctor` 当且仅当所有 check status=ok 时进程退出码为 0；任何 error 退出 1；hidden `--strict` 下 warn 也退出 1。
I2. `install` 未带 `--force` 遇既有 fabric 文件时不覆盖、退出非 0、stderr 含可执行的 action_hint（如 "use --force"）。
I3. `install --reapply` 在已初始化项目上幂等：连续两次产出 byte-identical 的 `agents.meta.json`（当 `rules/` 非空）和 byte-identical 的 `events.jsonl`。
I4. `install --scope project` 写 `.mcp.json` 且不写入 `~/.claude.json`；`--scope user` 写 `~/.claude.json` 且不污染项目根。
I5. 所有客户端配置写入采用 atomic-write：rename 步骤失败时不留 `.tmp` 残留文件。
I6. `doctor --fix` 完成后再次运行 `doctor` 时，已修复的 fixable_error 不再出现；剩余 manual_error 在输出中显式列出。
I7. v1.8.0 弃用客户端 (`windsurf` / `rooCode` / `geminiCLI`) 触发 `legacy_client_path_present` 警告但 doctor 不因此失败。
I8. install/doctor 的 deterministic scanner 在源码目录为空或不可读时不抛异常，产出有效 `forensic.json`（fileCount 可为 0，recommendations 数组存在）。
I9. `doctor --fix` 只修复 derived state；知识条目 demote/archive/default backfill 走 `doctor --fix-knowledge`。
I10. legacy `.fabric/.serve.lock` 仅作为 rc ≤36 遗留状态由 doctor probe 检测/清理；主线 CLI 不启动 HTTP server。
I11. `fabric uninstall` is idempotent — re-run on already-uninstalled project: exit code 0, all step statuses `skipped`.
I12. `fabric uninstall` never modifies `~/.fabric/knowledge/` (personal root) regardless of `--purge`.
I13. `fabric uninstall` un-merge preserves all non-fabric entries in deep-merged hook configs verbatim.

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

T6. **`fabric uninstall` round-trip equality (install → uninstall)** — bootstrap stage helpers preserve byte-for-byte equality of pre-install state on already-initialized fixtures; un-merge restores non-fabric hook entries verbatim and removes only fabric-owned ones (matched by command-path against `FABRIC_HOOK_COMMAND_PATHS`).
    覆盖: `packages/cli/__tests__/integration/uninstall-skills-and-hooks.test.ts` 对 cocos-stub fixture 做 init → uninstall → diff 三步断言（pinned in advance; created by TASK-005）。

T7. **`fabric uninstall --plan` no-write contract** — `--plan` 模式必须列出 scaffold entries + per-stage actions + 检测到的客户端，但绝不触发任何 `rm` / `writer.remove`；stage results 全部 `skipped`。
    覆盖: `packages/cli/__tests__/uninstall.test.ts`（断言 `--plan` 调用后 fixture 目录 mtime 不变且 `writer.remove` spy 调用 0 次）。

## §4 Out of Scope

- server 运行时行为（stdio MCP tool 实现）— 见 `server.md`
- shared 包内部 schema/error/i18n 单元行为 — 见 `shared.md`
- dashboard 客户端 UI
- 已弃用的 `mcp-config` 命令（v1.8.0 已移除）
- 已弃用的顶层 `fabric scan` 命令（已移除；scanner 仅作为 install/doctor 内部能力）
- 已弃用的顶层 `fabric hooks` 命令与 `fabric config {install,hooks}` 子命令（rc.15 移除；`installHooks` helper 迁至 `packages/cli/src/install/hooks-orchestrator.ts`）

## §5 Source Traceability

- `packages/cli/src/commands/index.ts`（命令注册表：公共命令、deprecated aliases、隐藏命令）
- `packages/cli/src/commands/{install-v2,store,sync,info,doctor,uninstall,config,metrics,plan-context-hint,onboard-coverage}.ts`（命令定义与 args schema）
- `packages/cli/src/install/hooks-orchestrator.ts`（rc.15 起 `installHooks` + `validateHookPaths` 的新家；旧路径 `commands/hooks.ts` 已删除）
- `packages/cli/src/scanner/forensic.ts`（deterministic scanner；供 install/doctor 流程复用）
- `packages/cli/README.md`、`docs/initialization.md`、`docs/getting-started.md`
- `CHANGELOG.md` 1.8.0 段（client trio、scope、atomic-write、legacy_client_path_present）
- ADR-002（MCP-first）、ADR-003（scope routing）

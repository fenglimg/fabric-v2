# Test Seed — server

> 模块单位: endpoint + service + MCP tool 级（12 REST + 14 services + 2 MCP tools + 1 MCP resource）
> 维护原则: 仅在意图变更时更新（详见 ../README.md §5）
> 最近更新: 2026-05-08 / v1.8.0

## §1 Feature Surface

### MCP tools (2)
- `fab_plan_context` — 规划阶段上下文与必选/可选规则描述
- `fab_get_rule_sections` — 按 AI 选择的 L1 ID 拉取规则正文（含强制 L0/L2）

### MCP resource (1)
- `AGENTS_MD_RESOURCE_URI` — L0 bootstrap README（`.fabric/bootstrap/README.md`）

### REST endpoints
- `GET  /api/rules` — 全量规则（cache-backed）
- `GET  /api/rules/context` — 规划上下文 HTTP 镜像
- `GET  /api/ledger` — 事件账本读取
- `GET  /api/history/state` — 状态重建
- `GET  /api/replay` — 历史回放
- `GET  /api/scan` — 触发扫描
- `GET  /api/doctor` — 一致性报告
- `POST /api/intent/annotate` — 意图标注
- `GET  /events` — SSE 事件流
- `ALL  /mcp` — MCP HTTP transport（Streamable HTTP）
- `GET  /` + `GET /(?!api|mcp|events).*` — Dashboard static + SPA fallback

### Auth
- Bearer token middleware；当 `FABRIC_AUTH_TOKEN` 环境变量存在时挂载于 `/api`、`/events`、`/mcp` 三前缀

### Services (14)
- `get-rules`, `plan-context`, `rule-sections`, `rule-sync`（含 `ensureRulesFresh` / `reconcileRules`）
- `event-ledger`（含 `flushAndSyncEventLedger`）, `audit-log`, `read-ledger`
- `doctor`（含 `runDoctorReport` / `runDoctorFix`）, `annotate-intent`, `rehydrate-state`
- `rule-meta-builder`, `human-lock-or-equivalent`, `in-flight-tracker`, `serve-lock`

### Doctor checks（v1.8.0 新增 8 个）
- `mcp_config_in_wrong_file`, `event_ledger_partial_write`, `meta_manually_diverged`, `rules_dir_unindexed`, `stable_id_collision`, `claude_skill_legacy_path`, `preexisting_root_claude_md`(info), `legacy_client_path_present`

### Lifecycle hooks
- SIGINT / SIGTERM / SIGHUP shutdown handlers（drain 5s + ledger fsync）
- chokidar watcher（`.fabric/rules/` invalidate-only）
- MCP payload guard（16KB warn / 64KB hard limit）
- ledger write queue（per-path 串行）
- serve-lock（cross-process PID 校验）

## §2 Invariants

I1. SIGINT / SIGTERM / SIGHUP 触发后，server 在 ≤5s 内完成 in-flight 请求 drain，随后对 event ledger 调用 fsync，最后 close transport；同信号重复触发立即 `exit(1)`。
I2. MCP payload >16KB 触发 warning（`response.warnings` 含 `MCP_PAYLOAD_LARGE`），>64KB 抛 `MCPError` (code=`MCP_PAYLOAD_TOO_LARGE`)；阈值可由 `fabric.config.json mcpPayloadLimits` 覆盖。
I3. `acquireLock` 对存活 PID 持锁返回 `ServeLockHeldError`，对失效 PID 自动恢复；`--force` 强制覆盖。
I4. chokidar 在 `.fabric/rules/` 任意 add/change/unlink 触发缓存失效，下次 MCP 请求看到新内容（write 路径不被 watcher 触发）。
I5. 所有 MCP tool 的 input/output 与 `@fenglimg/fabric-shared/schemas/api-contracts` 一致；schema 漂移触发 golden snapshot 失败。
I6. REST 错误响应统一形态：`{ error: { code, message, actionHint } }`；`PathEscape` 类错误返回 403，ledger/lock 类返回 404，其余按 FabricError 子类的 `httpStatus`。
I7. 配置 `FABRIC_AUTH_TOKEN` 后，对 `/api` / `/events` / `/mcp` 缺/错 token 的请求返回 401；未配置时不挂载该中间件。
I8. ledger write queue 对同一 path 的并发 append 串行化；写中途崩溃后 `readEventLedger` 不静默丢弃 trailing partial line，emit `LedgerWarning`，doctor `event_ledger_partial_write --fix` 截断到完整行。
I9. server 启动时执行一次 full rule consistency scan（`reconcileRules trigger=startup`），结果以 `[startup] rule sync: status=...` 写到 stderr；该 scan 失败时 server 仍启动并通过 `response.warnings` 暴露问题（优雅降级）。
I10. `ensureRulesFresh` 在高频 MCP 轮询下被 500ms 全局 cooldown + watcher invalidate 联合保护，不产生 I/O 风暴。

## §3 Known-Tricky Cases

T1. **preexisting root markdown 检测** — 项目根已有 `CLAUDE.md` / `AGENTS.md` 时，server 启动写一行 info 到 stderr（不阻塞），doctor `preexisting_root_claude_md` 给提醒；既不读取也不覆盖该文件。
    覆盖: `packages/server/src/index.ts:68-74` (`formatPreexistingRootMessage`) + `index.test.ts`。

T2. **watcher race** — chokidar 在批量 IDE 保存（`.fabric/rules/` 多文件秒级变更）下 cache 失效需保证最终一致：去抖窗口内多次 invalidate 不丢更新。
    覆盖: `packages/server/src/watcher.test.ts`、`services/rule-sync.test.ts`。

T3. **`mcp_config_in_wrong_file` doctor check** — 检测旧版本残留的 `.claude/settings.json` 中 mcpServers 条目；`--fix` 迁移到 `.mcp.json` 或 `~/.claude.json`（按既有 scope 推断）。
    覆盖: `packages/server/src/services/doctor.test.ts:786` 附近。

T4. **`stable_id_collision` doctor check** — 多条规则计算出相同 stable_id 时报告冲突清单；不自动重命名（manual_error），需用户介入。
    覆盖: `packages/server/src/services/doctor.test.ts:1018` 附近。

T5. **MCP `init_context_missing` action_hint** (TASK-039) — `.fabric/init-context.json` 缺失时 doctor 不建议 `--fix`，而是引导用户运行客户端 fabric-init skill；CLI 透传该 hint 不丢字段。
    覆盖: `packages/server/src/services/doctor.test.ts:582` 用例。

## §4 Out of Scope

- CLI 命令实现（install / scan / doctor / serve 命令外壳）— 见 `cli.md`
- shared 包 schema / errors / i18n 单元行为 — 见 `shared.md`
- Dashboard 客户端 UI / SPA 路由层
- stdio transport 启动（仅作为入口存在；test surface 集中在 HTTP）

## §5 Source Traceability

- `packages/server/src/index.ts`（生命周期 + stdio 入口）
- `packages/server/src/http.ts`（HTTP app 工厂 + auth wiring）
- `packages/server/src/api/*.ts`（10 个 endpoint 注册器）
- `packages/server/src/services/*.ts`（14 个 service）
- `packages/server/src/tools/{plan-context,rule-sections}.ts`（2 个 MCP tool）
- `packages/server/src/middleware/bearer-auth.ts`
- `docs/SPEC_INTERNAL.md`、`CHANGELOG.md` 1.8.0 段
- ADR-001（rule-sync 架构）、ADR-002（MCP-first）、ADR-003（scope）

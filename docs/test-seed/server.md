# Test Seed — server

> 模块单位: stdio MCP tool + service 级（6 MCP tools + supporting services + 1 MCP resource）
> 维护原则: 仅在意图变更时更新（详见 ../README.md §5）
> 最近更新: 2026-06-08 / v2.2.0-rc.5

## §1 Feature Surface

### MCP tools (6)
- `fab_recall` — 默认一跳召回：按 paths / intent / ids 返回相关知识正文。
- `fab_plan_context` — 两步流第一步：返回候选描述与 `selection_token`。
- `fab_get_knowledge_sections` — 两步流第二步：按 `selection_token` + `stable_id` 拉取完整 markdown body。
- `fab_extract_knowledge` — 从 session/context 文本写入 pending knowledge entry。
- `fab_archive_scan` — 扫描近期工作，返回 archive-worthy 候选供 Skill 判断。
- `fab_review` — list / approve / reject / modify / search / defer pending 与 canonical entries。

### MCP resource (1)
- `AGENTS_MD_RESOURCE_URI` — L0 bootstrap canonical（`.fabric/AGENTS.md`）。

### Quarantined HTTP surface

REST endpoints、SSE `/events`、Streamable HTTP `/mcp`、bearer auth、Dashboard static serving 和完整 serve-lock 实现已在 v2.0.0-rc.37 quarantine 到 `packages/server-http-experimental/`。这些代码是历史参考，不进入主线 server test seed。

### Services
- `recall`, `plan-context`, `knowledge-sections` — read-path retrieval。
- `extract-knowledge`, `review`, `archive-scan` — write / review / archive workflow support。
- `event-ledger`, `audit-log`, `read-ledger`, `rehydrate-state` — ledger and projection support。
- `doctor`, `load-active-meta`, `knowledge-sync`, `rule-meta-builder` — target-state diagnosis and derived index repair。
- `legacy-serve-lock-probe` — read-only rc <=36 `.fabric/.serve.lock` cleanup probe。

### Doctor checks
- `mcp_config_in_wrong_file`, `event_ledger_partial_write`, `meta_manually_diverged`, `knowledge_index_drift`, `stable_id_collision`, `claude_skill_legacy_path`, `preexisting_root_claude_md` (info), `legacy_client_path_present`。

### Lifecycle hooks
- SIGINT / SIGTERM / SIGHUP shutdown handlers（drain 5s + ledger fsync）。
- cache invalidation for `.fabric/knowledge/` and derived indexes。
- MCP payload guard（16KB warn / 64KB hard limit）。
- ledger write queue（per-path 串行）。
- legacy serve-lock probe（doctor-only cleanup for old `.fabric/.serve.lock`）。

## §2 Invariants

I1. SIGINT / SIGTERM / SIGHUP 触发后，server 在 ≤5s 内完成 in-flight 请求 drain，随后对 event ledger 调用 fsync，最后 close transport；同信号重复触发立即 `exit(1)`。
I2. MCP payload >16KB 触发 warning（`response.warnings` 含 `MCP_PAYLOAD_LARGE`），>64KB 抛 `MCPError` (code=`MCP_PAYLOAD_TOO_LARGE`)；阈值可由 `fabric.config.json mcpPayloadLimits` 覆盖。
I3. `fab_recall` 与两步流共享同一 plan-context / knowledge-sections service path；相同输入下 selection 和 consumed telemetry 不分叉。
I4. `.fabric/knowledge/` 任意 add/change/unlink 后，下次 MCP 请求看到新内容；derived index drift 由 doctor 报告/修复。
I5. 所有 MCP tool 的 input/output 与 `@fenglimg/fabric-shared/schemas/api-contracts` 一致；schema 漂移触发 golden snapshot 失败。
I6. MCP 错误响应使用 shared FabricError / MCPError shape；payload 过大返回 structured warning 或 hard error。
I7. 主线 server 不读取 `FABRIC_AUTH_TOKEN`，也不暴露 HTTP endpoint。
I8. ledger write queue 对同一 path 的并发 append 串行化；写中途崩溃后 `readEventLedger` 不静默丢弃 trailing partial line，emit `LedgerWarning`，doctor `event_ledger_partial_write --fix` 截断到完整行。
I9. server 启动时不依赖 HTTP listener；MCP stdio transport 能独立注册 tools/resources 并服务客户端。
I10. 高频 MCP 轮询下 read path 受 cache / cooldown / payload guard 保护，不产生 I/O 风暴。

## §3 Known-Tricky Cases

T1. **preexisting root markdown 检测** — 项目根已有 `CLAUDE.md` / `AGENTS.md` 时，server 启动写一行 info 到 stderr（不阻塞），doctor `preexisting_root_claude_md` 给提醒；既不读取也不覆盖该文件。
    覆盖: `packages/server/src/index.ts:68-74` (`formatPreexistingRootMessage`) + `index.test.ts`。

T2. **knowledge index drift** — 批量编辑 `.fabric/knowledge/` 后，read path 要么读取最新可用 index，要么通过 warning/doctor 指向 deterministic repair。
    覆盖: `packages/server/src/services/doctor.ts`、`packages/server/src/services/load-active-meta.ts` 相关用例。

T3. **`mcp_config_in_wrong_file` doctor check** — 检测旧版本残留的 `.claude/settings.json` 中 mcpServers 条目；`--fix` 迁移到 `.mcp.json` 或 `~/.claude.json`（按既有 scope 推断）。
    覆盖: `packages/server/src/services/doctor.test.ts:786` 附近。

T4. **`stable_id_collision` doctor check** — 多条知识条目声明相同 stable_id 时报告冲突清单；不自动重命名（manual_error），需用户介入。
    覆盖: `packages/server/src/services/doctor.test.ts:1018` 附近。

T5. **MCP `init_context_missing` action_hint** — `.fabric/init-context.json` 缺失时 doctor 不建议 `--fix`，而是引导用户运行客户端 fabric-init skill；CLI 透传该 hint 不丢字段。
    覆盖: `packages/server/src/services/doctor.test.ts:582` 用例。

## §4 Out of Scope

- CLI 命令实现（install / store / sync / info / doctor / uninstall / config / metrics 命令外壳）— 见 `cli.md`。
- shared 包 schema / errors / i18n 单元行为 — 见 `shared.md`。
- Dashboard 客户端 UI / SPA 路由层（quarantined historical reference）。
- HTTP/REST/SSE transport（quarantined historical reference）。

## §5 Source Traceability

- `packages/server/src/index.ts`（生命周期 + stdio 入口）。
- `packages/server/src/tools/{recall,plan-context,knowledge-sections,extract-knowledge,archive-scan,review}.ts`。
- `packages/server/src/services/*.ts`。
- `packages/shared/src/schemas/api-contracts.ts`。
- `docs/mcp-contracts.md`、`docs/data-schema.md`。
- ADR-002（MCP-first）、ADR-007/011/012（HTTP/Dashboard/serve quarantine）。

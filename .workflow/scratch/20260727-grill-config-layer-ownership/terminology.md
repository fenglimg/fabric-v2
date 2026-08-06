# Terminology

| Term | Definition | Code Reference | Status |
|------|------------|----------------|--------|
| **身份字段 (identity fields)** | 留在 git-tracked `.fabric/fabric-config.json` 的 5 个字段：`project_id` / `required_stores` / `write_routes` / `active_project` / `active_write_store`。全部由 `install`/`store bind`/`store switch-write` 自动写，用户从不手改。是团队契约与 project root 锚点。 | `packages/shared/src/schemas/fabric-config.ts:191-230` | locked |
| **defaults（我的默认值）** | `~/.fabric/fabric-global.json` 新增段，装 51 个策略字段。语义是「用户可改的默认值」，与代码写死的 code default 形成对照。级联中优先级最低（仅高于 code default）。 | new | locked |
| **projects.\<project_id\>（项目例外段）** | global 内按 `project_id` 索引的覆盖段，只写该项目与 defaults 不同的 key。级联中优先级最高（仅次于 env）。索引键取自 repo 侧保留的 `project_id`。 | new | locked |
| **store-config.json（corpus 配置）** | store 根下的配置文件，装 19 个 corpus 属性字段（`credibility_*` / `orphan_demote_*` / `plan_context_top_k` 等）。随 store git 仓库分发给所有绑定该库的 repo。 | `packages/shared/src/schemas/store.ts:399-445`、`STORE_LAYOUT.configFile` | locked |
| **级联 (cascade)** | 配置解析顺序 `env > projects[id] > store > defaults > code default`。任一层缺失/非法静默穿透到下一层，永不抛错（KT-DEC-0048 read-tolerant + KT-DEC-0007 hook 不阻塞）。 | `packages/server/src/config-loader.ts:23-40` | locked |
| **STORE_OVERRIDABLE_KNOBS** | 声明哪些 knob 允许从 store 层覆盖的白名单。本次 grill 前声明 15 组但仅 12 组真生效（`embed_enabled` 实现为 project-only，`broad_index_backstop`/`underseed_node_threshold` 被 hook 消费而 hook 不读 store 层）。D11 落地后声明与实现对齐。 | `packages/shared/src/schemas/fabric-config.ts:77-93` | locked |
| **globalFallback** | hook 侧 `readConfigNumber/Boolean/String` 的逐 key opt-in 选项，开启后在 project 与 code default 之间插入 global 层。现状 19 个 hook key 中仅 7 个开启 —— 相对 KT-MOD-0002 canonical 的漂移。 | `packages/cli/templates/hooks/lib/config-cache.cjs:114-152` | locked |
| **RMW 竞态** | read-modify-write 竞态。`saveGlobalConfigAsync` 的 `withFileLock` 只包住 write，调用方在锁外 `loadGlobalConfig()` 后展开修改，两进程并发时后写覆盖先写。文件注释声称能防此类冲突，该声明不成立。 | `packages/shared/src/store/global-config-io.ts:62-71` | locked |
| **hook 三镜像** | `templates/` / `.claude/` / `.codex/` 三份 hook 副本，仅在 `install`/`reapply` 时复制同步，无 prebuild 派生。改源模板不等于生效 —— 本 repo 安装副本落后源模板 55 行即为实例。 | KT-PIT-0004 | locked |
| **binding 快照** | `~/.fabric/state/bindings/<id>_resolved.json`，持久化已解析的 read_set / write_target / knowledge_store_dirs。hook 复用它拿 store root，使 5 层级联无需文件系统 walk。**不含 repo path**，故无法反查孤儿。 | `.claude/hooks/lib/bindings-snapshot-reader.cjs:118-128` | locked |

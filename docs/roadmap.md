# Fabric 路线图

Fabric 正从内部原型演进为 `@fenglimg/fabric-*` scope 下可发布的产品线。本 roadmap 按三阶段 SemVer 组织，使公开 contract、实现状态与 release gate 保持一致。

## v1.0

- theme: `Control Plane MVP`
- focus: 交付最小但可信的 control plane，使维护者能用单一 install path 完成仓库初始化、检查并启动受保护的本地 session。
- release_signal: `npm publish @fenglimg/fabric-cli@1.0.0` 成功；干净项目上 `fab init -> fab serve` smoke test 通过且无需手工改文件。

### Scope

1. `fab init` 向仓库写入最小 protocol skeleton。
2. `fab scan` 及相关 CLI inspection 在 AI-assisted setup 之前生成 evidence。
3. MCP runtime dispatch 可通过 packaged server path 使用。
4. `fab serve` 为维护者提供首个本地 control-plane session。
5. 核心文档与 `@fenglimg/fabric-*` 首次公开 npm release 保持一致。

## v1.1

- theme: `Observable Maintenance`
- focus: 在采纳后使系统可检查，维护者可诊断 drift、观察状态并在不手工阅读原始 ledger 文件的情况下恢复信任。
- release_signal: `fab serve` 之后，Dashboard 在 `http://localhost:3333` 可达，成功加载项目状态，且单次本地 smoke test 可检查 ledger/rules 数据。

### Features

1. Feature #5: Dashboard  
   用于 ledger 与 rules inspection 的 Web UI，由 `fab serve` 启动，Dashboard 明确锁定在 v1.1 milestone。
2. Feature #1: `drift-check`  
   当实现活动可能已领先于 AGENTS.md 或其他 human-maintained protocol 表面时发出警告。
3. Feature #2: `fab migrate`  
   在 schema 版本随时间变化时安全升级 `.fabric/` metadata。
4. Feature #3: `fab doctor`  
   跨支持的 AI client 诊断 installation、hook、config 与 client-integration 问题。
5. Feature #4: Copilot fallback compile  
   若 GitHub Copilot 成为可行的次要目标，将结构化 protocol 扁平化为 `.github/copilot-instructions.md`。

## v1.2

- theme: `Portability & Trust`
- focus: 使 Fabric 可发布、可审计、可跨 provider 移植，且不把 roadmap 本身当作 changelog 替代品。
- release_signal: tag push 自动生成新的 `CHANGELOG.md` 条目，遵循文档化的 `RELEASING.md` workflow，且已发布 package 仅隔离在 `@fenglimg/fabric-*` scope。

### Scope

1. 增加 `CHANGELOG.md` governance，使已发布行为在 roadmap 之外有追踪。
2. 增加 `RELEASING.md`，涵盖 build、tag、publish、rollback 与 smoke-test policy。
3. 强制 scope isolation：公开 package 仅以 `@fenglimg/fabric-*` 发布，并在 CI 中阻止 version drift。
4. 通过针对 CLI、MCP 与 Dashboard 的显式 release check 加强 multi-provider trust。
5. 将 roadmap 承诺与已发布 artifact 分离，以可度量的 release gate 取代空想式备注。

# Fabric 实现收敛执行结果

本次 lite-plan 基于既定决策基线完成了四个实现任务，目标是把规则身份、批量规则上下文、ledger 路径与脚本知识入口都收敛到更稳定的协议边界。

## 已完成任务

### T1a ledger 路径收敛

- 统一 canonical ledger 路径为 `.fabric/.intent-ledger.jsonl`
- 保留 legacy root `.intent-ledger.jsonl` 的只读兼容
- 非 doctor 范围内的 server / CLI / docs / i18n / tests 已对齐
- 补了 `read-ledger` 的专门测试，覆盖 canonical 优先级、legacy fallback、显式迁移语义

### T2 stable-id 预编译

- 规则文件使用开头 `<!-- fab:rule-id <slug> -->` comment 作为稳定身份载体
- `sync-meta` 预编译 `stable_id` 与 `identity_source`
- revision 计算已纳入身份元数据
- doctor 与 lint 已能识别 derived identity 风险

### T1b doctor --fix 迁移链路

- doctor summary 暴露 canonical/legacy ledger path 状态
- 当只存在 legacy root ledger 时，doctor 发出 warning
- `doctor --fix` 执行显式迁移，不在普通读取路径上静默搬迁
- CLI doctor 和 server doctor 测试已覆盖该链路

### T3 shared resolved bundle 视图

- `fab_plan_context` 保持原有 `entries[]` 兼容
- 新增 `shared` 视图，包含：
  - `resolved_bundle_id`
  - `shared_entries`
  - `file_map`
  - `description_stub_union`
  - `preflight_diagnostics`
- `resolved_bundle_id` 基于 `revision + sorted stable_id set`
- per-path `description_stubs` 旧契约保持不变

### T4 tooling manifest

- 新增 `docs/tooling-manifest.json` 作为 machine-readable 真源
- 新增 `docs/tooling-manifest.md` 作为人读说明层
- 当前先登记两类代表性脚本：
  - `packages/server/scripts/copy-dashboard.mjs`
  - `scripts/lint-protected-tokens.ts`
- `docs/initialization.md` 已指向这层 tooling knowledge
- 明确约束：manifest 为真源，JSDoc 仅是未来可选增强

## 验证

已通过的定向验证包括：

- `pnpm exec vitest run packages/server/src/services/read-ledger.test.ts packages/server/src/services/doctor.test.ts packages/cli/__tests__/ledger-append.test.ts packages/cli/__tests__/pre-commit-update.test.ts`
- `pnpm exec vitest run packages/server/src/services/doctor.test.ts packages/cli/__tests__/doctor.test.ts`
- `pnpm exec vitest run packages/server/src/services/get-rules.test.ts packages/server/src/services/plan-context.test.ts`
- `node -e "JSON.parse(require('node:fs').readFileSync('docs/tooling-manifest.json','utf8')); console.log('ok')"`

## 收敛效果

本轮实现把“路径”“身份”“批量视图”“工具知识”这四类协议对象都拉回到了可复用的中心点：

- ledger 路径以 shared resolver 为中心
- rule identity 以 precompiled stable metadata 为中心
- batch planning 以 `shared + entries[]` 双层视图为中心
- tooling knowledge 以 docs manifest 为中心

剩余未做的不是架构分叉，而是后续可选增强，例如：

- 让 dashboard 或更多 client 消费 `shared` 视图
- 为更多脚本补 manifest 条目
- 如有需要，再补 JSDoc extractor 作为 manifest 的同步器或校验器

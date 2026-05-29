# Goal Checklist — Fabric v2.1 全局多 store 重构实现（maestro full-lifecycle）

> status.json 是唯一真源，本文件是投影。Resume → `/maestro-ralph continue`（或 `/goal-mode continue`）。

## 目标
依据已收敛里程碑 `roadmap-v4.md` 实现 Fabric v2.1 全部 9 phase 到各自 done_when；目标版本 **v2.1.0-rc.1**（后续 rc 号按 wave 边界自行衡量）。

## 终止判据（清单清零，模式①）
`task_decomposition[*].status` 全部 `done`（等价：本文件末尾含 `ALL_GOALS_DONE`）。

## 执行准则
1. 主线串行 Edit/Write 默认；仅同 wave 内独立无文件冲突子任务才并行 Agent（防长上下文撑爆）
2. Review 用 Claude，wave 边界批量；P0 schema/resolver、P2 防泄漏 收紧
3. git commit phase/wave 边界增量、中文；改 shared schema 必 rebuild dist；rc 前 `pnpm -r exec tsc --noEmit`
4. 每 phase 实现前 fab_recall 相关 KB；落 decision/pitfall 按 cite policy 回指
5. verification 默认 deterministic；status=done ⟺ verified_at!=null；失败累计≥3→blocked 不停摆
6. 涌现真问题挂 parent_id+relationship 进 task_decomposition；待用户拍板进 needs_adjudication

## 边界
- 只实现 roadmap-v4 收敛决策，**不推翻** phase/依赖/done_when/surface 回指
- defer 项不展开（store domain skill / org nesting / 真私有 overlay / 凭证 profile）
- 需用户拍板的产品取舍 → needs_adjudication 留存，不擅自定

## Wave 进度（严格 DAG 串行）
- [x] **Wave 0 · P0** — Schema+Resolver 契约+parity 矩阵（纯定义，不碰 HOME）✓ verified 2026-05-30
- [x] **Wave 1 · P0.5** — 验证基建（隔离测试墙，第一可执行件）✓ verified 2026-05-30
- [x] **Wave 2 · P0.6** — Resolver 实现（TDD 转绿 P0.5 red-suite）✓ verified 2026-05-30
- [ ] **Wave 3 · P1** — 多 store 存储+git 核心+跨库 pending 聚合
- [ ] **Wave 4 · P2** — MCP 工具契约+resolution+写路径防泄漏
- [ ] **Wave 5 · P3** — CLI 命令面+install 事务+bindings 快照
- [ ] **Wave 6 · P4** — Skills+Hooks 改造（store-aware）
- [ ] **Wave 7 · P5** — 治理+端侧 parity E2E
- [ ] **Wave 8 · P6** — 性能硬化+观测

## 三依赖链（不可断）
- parity-matrix：P0 定契约 → P4 按矩阵开发 → P5 E2E 验收
- bindings 快照：P3 生成 → P4 hook 消费
- 跨 store pending 聚合：P1 提供 API → P2 fab_review 使用

## 当前状态
- Wave 3 / P1，step 15（maestro-plan P1）。P0 + P0.5 + P0.6 已 done（契约→测试墙→resolver TDD 转绿，3/9 phase）。
- 剩 1 个 it.fails：legacy-negative（recognizeStoreDir 桩），P1 实现 disk reader 后转绿。
- 待拍板（非阻塞）：ADJ-P0-1 ProjectRootResolver 四信号优先级解读，见 status.json#/needs_adjudication
</content>

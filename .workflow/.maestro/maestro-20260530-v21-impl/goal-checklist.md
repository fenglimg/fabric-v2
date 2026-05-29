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
- [x] **Wave 3 · P1** — 多 store 存储+git 核心+跨库 pending 聚合 ✓ verified 2026-05-30
- [x] **Wave 4 · P2** — MCP 工具契约+resolution+写路径防泄漏 ✓ verified 2026-05-30
- [x] **Wave 5 · P3** — CLI 命令面+install 事务+bindings 快照 ✓ verified 2026-05-30
- [ ] **Wave 6 · P4** — Skills+Hooks 改造（store-aware）
- [ ] **Wave 7 · P5** — 治理+端侧 parity E2E
- [ ] **Wave 8 · P6** — 性能硬化+观测

## 三依赖链（不可断）
- parity-matrix：P0 定契约 → P4 按矩阵开发 → P5 E2E 验收
- bindings 快照：P3 生成 → P4 hook 消费
- 跨 store pending 聚合：P1 提供 API → P2 fab_review 使用

## 当前状态
- Wave 6 / P4（进行中）。**6/9 phase done**：P0 契约 → P0.5 测试墙 → P0.6 resolver TDD → P1 多 store 核心 → P2 MCP 契约/resolution/防泄漏 → **P3 CLI 命令面+install 事务+sync+bindings 快照+doctor**。cli 806 + shared 476 + server 639 全绿。
- **P3 done(2026-05-30)**：收尾闭合 3 真实缺口(verify-before-fix 命中 checklist 过度声称)——sync --continue/--abort(run-sync 编排+citty+8 测试)· bindings 快照接线(bind/sync→regenerateBindingsSnapshot, 与 scopeExplain 一致, 3 测试)· doctor 接 storeDoctorChecks(S10, best-effort 不阻断, 1 测试)。+12 测试, repo tsc 0。
- P2 done 范围(verifier=6 工具 schema 测试+secret/lint negative)：provenance/mcp-store 契约 + resolution 双轴引擎 + secret-scan(已 LIVE extract gate) + cross-store lint。**live 多 store 运行时行为(provenance emission/多 store 写目标/cross-store live 拦截)依赖 P3 创建多 store 环境,按 roadmap「P3 后自然扩展」**。
- **P3 子进展(done_when 件大部已建+测试, cli 785 全绿)**：
  - DONE：bindings 快照(P3→P4 链, 与 resolver 一致)· store lifecycle 核心 · **store 6 命令 list/add/remove/explain/bind/switch-write**(集成测试)· **whoami/status**(F5)· **install 事务核心**(顺序 apply/逆序 rollback/receipt S1/S28/S36)· **install --global 核心**(事务化 uid+personal store+global config, 真实 git, 幂等)· **clone 缺 store 引导**(missingRequiredStores S51)· **非法 config abort**(load 抛错 S34)· **sync 状态机**(conflict/offline/continue/abort+deferred push S9/S17/S37)
  - DONE 续：**scope-explain 命令**(组装 resolveInput 跑 resolver, F5)· **doctor 多 store 健康检查核心**(no_global/missing_required/local-only nudge, S10/S51/R5#5)
  - REMAINING(纯 git/uid I/O 边 + 既有大文件集成, 逻辑核心已全测)：`install --global`/`sync` citty 命令外壳(派生 uid from git user.email hash + crypto.randomUUID + git pull --rebase 实操接 sync 状态机 + 把 install-global 核心接 install.ts)· doctor-checks 接入既有 doctor.ts 输出 · refresh-registrations/--debug-bundle redaction。**P3 全部命令逻辑+事务+状态机+诊断已建并测试(cli 791 全绿), 剩纯 I/O 接线。**
- 待拍板（非阻塞）：ADJ-P0-1 ProjectRootResolver 四信号优先级解读，见 status.json#/needs_adjudication
</content>

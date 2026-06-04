# Goal Checklist — co-location agents.meta 读侧统一收尾

> status.json 是真源, 本文件是投影视图。模式 ③ 混血 — 命名门全绿即自动 completed。
> 承接 W4 partial(counter 退役 + G-GUARD 已 ship 绿)。分支 feat/multistore-scope-decolo(本地 5 commit 未推)。

## 目标
agents.meta.json co-location 模型彻底退役: 团队 KB 迁 team store + ~18 消费者读 store + install 不 scaffold + 全绿。store-only 无分叉。

## 命名门(终止判据 — 全绿 ✅ COMPLETED）
- [x] **G-MIGRATE-DOGFOOD** — 34 条(22+12 pending)迁入 team store 152a5f20 + recall round-trip 命中 ✅
- [x] **G-DECOLO-READ** — 生产零 readAgentsMeta()/buildKnowledgeMeta()/loadActiveMeta()/reconcileKnowledge() 调用, 读路径全 store-only ✅
- [x] **G-INSTALL** — install 不 scaffold agents.meta + 空柜, 留 AGENTS.md/config ✅
- [x] **G-GREEN** — shared build + 全量 tsc 0 err + 2311 测试全绿 + 删旧柜 e2e dogfood ✅

**9 commit**: 12bac23(M 迁移)· f21ff79(R0/R1)· 0f3cd9e(R3)· a3e4f76(R4)· 4f9a08b(R6)· a9e5210(R2)· 2dc8741(I1)· 3c6e589(Z1)· + 3 ledger chore。全本地 feat/multistore-scope-decolo（含 W4 5 个共 ~17 未推，待用户决定推送）。

## Round 1 任务(ceiling 14, 当前 12)
- [ ] **M1** 落盘 store migrate (22+12 pending → team) + counters.json auto-seed → G-MIGRATE-DOGFOOD
- [ ] **M2** dogfood recall round-trip 命中 → G-MIGRATE-DOGFOOD
- [ ] **R1** plan-context 去 meta.nodes co-location 源, 只留 cross-store → G-DECOLO-READ
- [ ] **R2** load-active-meta / buildKnowledgeMeta 退役 → G-DECOLO-READ
- [ ] **R3** knowledge-sections / get-knowledge / extract-knowledge 读 store → G-DECOLO-READ
- [ ] **R4** doctor inspectMeta / index-drift / counter-reconcile 重定向 per-store → G-DECOLO-READ
- [ ] **R5** cache meta watch 改 store → G-DECOLO-READ
- [ ] **R6** MCP tools + http-exp api 读侧确认 → G-DECOLO-READ
- [ ] **R7** 读侧 fixture 海量从 co-location 迁 store → G-DECOLO-READ / G-GREEN
- [ ] **I1** install 不 scaffold agents.meta + 空柜 → G-INSTALL
- [ ] **I2** agents.meta.json 零生产读者验证(census) → G-DECOLO-READ / G-INSTALL
- [ ] **Z1** 收口 shared rebuild + tsc + test + 删柜验证 → G-GREEN

## 边界契约
**IN**: migrate 22 条 / ~18 消费者改读 store / install 去 scaffold / fixture 迁 store / 收口全绿
**OUT**: 写侧(已 cutover) · counter 子系统(W4 已交付) · G-GUARD(W4-A6/A7) · review backlog · KT-DEC-0004/0003 正文 drift(收口后 follow-up) · 推远端(待 G-GREEN 后决策)
**约束**: clean-slate 无 fallback shim · stable_id 单调(迁移保 id + counters seed) · 改 shared schema 必 rebuild dist · 全量 tsc 不光 build · 改文件前 fab_recall

## 收口后 follow-up(非本门, 记录待办)
- KT-DEC-0004 正文「counter 持久化在 agents.meta.json」→ 改 per-store counters.json
- KT-DEC-0003 dual-root 描述 → multistore 模型 supersede

## Resume
推进: `/goal-mode continue` — 取一簇任务执行 → verification → 原子更新 status.json → 重检门 + drift。
查看: `/goal-mode status`。
依赖序(migration-design.md): M(migrate 已 foundational, counter 子系统 W4 已就位)→ R1-R6 读侧逐簇 → R7 fixture → I1/I2 install → Z1 收口。

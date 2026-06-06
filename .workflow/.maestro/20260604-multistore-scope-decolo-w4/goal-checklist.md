# Goal Checklist — 20260604-multistore-scope-decolo-w4

> **真源是 `status.json`**,本文件是投影视图。模式 ③ 混血。父 ledger:`20260604-multistore-scope-decolo`(W1–W3 已 5/9 门绿)。
>
> **🏁 PARTIAL-COMPLETE (2026-06-04, 用户决策)**:counter 退役 + G-GUARD 已交付(5 commit 全绿);读侧 cutover(G-DECOLO 读侧/G-INSTALL/G-GREEN)新起 goal 统一收尾。`migration-design.md` 留读侧路线图。

## 目标
退役 Fabric co-location/agents.meta 派生柜:doctor + 十几个工具全读 store、agents.meta 退役、install 不建空柜子;补 doctor 三类 scope lint + re-scope/promote 工具;shared rebuild + 全量 tsc + 全测试绿收口。

## 命名验收门(全绿即自动 completed)
- [ ] **G-DECOLO** — agents.meta.json 零生产读者(测试/shim 除外)+ doctor/十几个工具全读 store
- [ ] **G-INSTALL** — install 不再建 co-location 空柜子
- [x] **G-GUARD** — doctor 三类 scope lint 生效 + re-scope/promote 工具可用 ✅ (A6 cd72b04 + A7 1b89a5e)
- [ ] **G-GREEN** — shared rebuild + 全量 tsc --noEmit 绿 + 全测试 0 fail

## Round 1 任务(carry from 父 ledger deferred)
- [ ] **W4-B1** (←B1) doctor 改读 store → G-DECOLO
- [ ] **W4-B2** (←B2) 十几个内部工具改读 store → G-DECOLO
- [~] **W4-B3** (←B3) agents.meta.json 旧空柜子退役 → G-DECOLO 〔拆 3 子任务〕
  - [x] **W4-B3a** [foundational] shared store-counters 模块(committed counters.json)✅ commit b8d93f8
  - [x] **W4-B3b** review.ts 两处铸号重定向到 store counters ✅ commit b8d93f8
  - [ ] **W4-B3c** 彻底删 co-location agents.meta 读/写(meta-reader/cache/doctor reconcile)← 下一步
- [ ] **W4-B4** (←B4) install 不建空柜子 → G-INSTALL
- [x] **W4-A6** (←A6) doctor 三类 scope lint → G-GUARD ✅ cd72b04
- [x] **W4-A7** (←A7) re-scope/promote 工具 → G-GUARD ✅ 1b89a5e
- [ ] **W4-Z1** (←Z1) 收口 tsc+test+rebuild+删柜验证 → G-GREEN

## 执行准则(边界契约摘要)
- **退役顺序铁律**:先 B1/B2(切读者到 store)→ 再 B3(删柜)。仍有读者时不删柜。
- **clean-slate**:零用户,不迁移 legacy co-location 数据。
- **改 shared schema → 必 rebuild dist**(否则 runtime invalid_union_discriminator)。
- **收口必跑 `pnpm typecheck`**(已三次复发),不只靠 build。
- 涌现修复任务 → 进 `task_decomposition`(挂 parent_id + relationship);宽迁移回归预期会冒,live-ledger 吸收。
- 每 5 task close 自检 drift gate(direct+indirect <60% 则停下报告)。

## 分批 commit 纪律
每扇门收绿即 `git commit`(已在 feat/multistore-scope-decolo 分支)+ sha 回填。退役类宽改动建议按 G-DECOLO / G-INSTALL / G-GUARD 分 commit。

## Resume
续跑:调 `/goal-mode continue` 推进下一步(单 task → verification → 原子更新 status.json → 重检终止 gate + drift gate)。
收尾:4 门全绿 → 自动写 `status=completed` + `[[FINAL_NOTIFICATION]]`。

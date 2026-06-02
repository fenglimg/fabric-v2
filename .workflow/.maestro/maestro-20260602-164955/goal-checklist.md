# Goal Checklist — multi-store/sync 接线

> status.json 为唯一真源,本文件为投影视图。Worktree: `pcf-multistore` @ `feat/multistore-wiring`。
> 执行策略: 主线串行 Edit/Write/Bash, 不 spawn per-task agent; review 仅末尾一次 batch (feedback_agent_review_efficiency C)。

## 边界契约
- **IN**: 读侧接线 / 写侧接线 / sync push / store-remote / F-MATURITY-ENDORSED
- **OUT**: 堆 B(lifecycle 可观测性新架构)· F-NARROW-BUDGET injection 重设计 · perf/重构/美学
- **约束**: KT-DEC-0003 dual-root + store⊥scope UUID · 改前 fab_recall+grep 验证 · 改 shared schema 后 rebuild · 回归 ≥2232 绿 · tsc --noEmit · 每 wave 中文 commit

## 子目标
- [ ] **W1-T1** 读侧接线: recall/meta 跨 mounted store 聚合(read-set=required_stores∪personal)
- [ ] **W1-T2** 写侧接线: 写进 mounted store, round-trip 闭合
- [ ] **W2-T3** sync push: run-sync.ts git push + offline defer (F-SYNC-NOPUSH)
- [ ] **W2-T4** store-remote: storeCreate git remote add + store list 真 remote (F-SYNC-REMOTE/F14)
- [ ] **W3-T5** F-MATURITY-ENDORSED: config vocab ⊥ schema enum 对齐
- [ ] **W3-T6** 终收口: 全回归绿 + tsc + round-trip/push 实证 + 一次 batch review

## Resume
跨窗口续跑: `cd /Users/wepie/Desktop/personal-projects/pcf-multistore` 后调 `/maestro-ralph continue`(或主线直接续 wave)。
判据: status.json `task_decomposition[*].status` 全 done。

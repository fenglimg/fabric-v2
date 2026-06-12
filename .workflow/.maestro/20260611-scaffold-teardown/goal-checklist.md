# Goal B — 存量脚手架拆除 (mode③ 混血)

> status.json 是真源,本文件是投影视图。推进走 `/goal-mode continue`。
> Spec 锚:`.workflow/.maestro/20260611-hook-flow-mode4/rev4.4-final.md` §5 census 账表。
> Worktree:`pcf-scaffold-teardown` (branch `feat/scaffold-teardown`,基点 9812287 = main = Goal A 已合并)。

## 终止判据(命名 gate 全绿即自动 completed)

- [x] **G-SELECTABLE** — 死字段 selectable 全删(orphan index-item schema + test fixture);dead-field grep = 0(census F1:49 引用绝大多数是 ai_selectable_stable_ids 活跃机制, 真死字段仅 1 处零消费者)。commit eb24754
- [x] **G-CITE-EVICT** — 承 D15:退役 cite-contract-reminder [recalled]-contract 强制(读 co-location agents.meta);cite-policy-evict KEEP(census F2:已是 D15 recall-based 记账 hook, 非退役目标);cite-line-parser DSL KEEP(back-compat + cite-coverage)。commit f643baf
- [x] **G-COLOCATION** — broad + fabric-hint 删 countLegacyCanonicalNodes co-location walk + 改 store/bindings-snapshot;broad init 信号 agents.meta→fabric-config binding;grep 三 hook = 0;narrow 本已干净。commit f643baf
- [x] **G-LEVEL** — 退役死 L0/L1/L2 level 轴(dead-write 零 consumer)+ 未接线 activation.tier(census F3:收敛方向=退役 tier 留 relevance_scope, 非扩展 tier);grep enum 残留 = 0。commit 37df2a5
- [x] **G-REGRESSION** — tsc -r --noEmit EXIT=0;shared 623 + server 704 全绿;cli 14 failed = baseline 9812287 14 failed(权威全套件对照, 零新增);无 events.jsonl 污染

## 边界契约

**in-scope**:5 个 G-* gate(见上)。
**out-of-scope**:不加新观测/新功能(Goal A 已做);maturity endorsed 残留低优顺手清不强制;N>2 store fan-out 增量不碰;不回头改 Goal A 范围。
**constraints**:
- 动存量**先行为保持验证**(TDD 或前后 byte-identical 对照)再动刀 — [[feedback-producer-consumer-roundtrip-oracle]] / [[feedback-audit-verification]]
- 实施每条 census claim **先 grep 验证 grounding 仍成立** — KT-PIT-0009 / [[feedback-audit-verification]]
- co-location 读移除 = **整套读侧迁移非删脚手架**,先锚热读路径(plan-context/get-knowledge/extract) — KT-PIT-0007
- maturity 合法仅 draft/verified/proven;type canonical 用复数 — [[project-fabric-knowledge-hygiene-gotchas]]
- 源真值在 `packages/cli/templates/hooks/`;`.claude/.codex/.cursor` 安装副本由 `fabric install` 同步,**严禁手编**
- 改 shared schema 必 `pnpm --filter @fenglimg/fabric-shared build` 重建 dist — [[feedback-shared-rebuild-on-schema-change]]
- 每 wave 收口 `git commit`(中文)+ sha 回填 `git_commits[]`;tsc 前置闸 — [[feedback-local-tsc-vs-ci-tsc]]
- Edit 触发的 events.jsonl 污染收尾剥离(gitignored,提交前确认未混入)

## 任务分解(7 task,round 1)

| id | gate | done_when |
|---|---|---|
| B1-1 | G-SELECTABLE | selectable 49 引用 census(in/out)+ 行为保持锚 recall/plan-context/knowledge-sections |
| B1-2 | G-SELECTABLE | 删字段+消费端 + rebuild dist;grep=0;行为保持零变化;tsc=0 |
| B2-1 | G-CITE-EVICT | cite-policy-evict + contract×32 census,定退役vs瘦身边界,回填 verifier_cmd |
| B2-2 | G-CITE-EVICT | 执行退役/瘦身 + 同步撤 W5-1 install 孤儿条目 + 行为保持 |
| B3-1 | G-COLOCATION | broad+fabric-hint 去 co-location 读 → store/bindings-snapshot;grep=0 + hook 测试 |
| B4-1 | G-LEVEL | 定收敛单轴方案,去 enum/对齐 store;rebuild dist + 行为保持 + tsc |
| B5-1 | G-REGRESSION | 全回归 + tsc;merge-base 基线对照排除预存 21 失败;events.jsonl 污染剥离确认 |

## Resume

推进:`/goal-mode continue`(单步推进 + 重检终止 gate + drift gate)。
状态:`/goal-mode status`。收尾:`/goal-mode close`。

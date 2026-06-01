# Goal Checklist — maestro-flow 规则+知识系统挖掘 → Fabric 吸收决策包

> **真源是 `status.json`,本文件是投影视图。** mode ② 审计驱动。
> 终止判据: `ship_criteria` 三门全绿 (G-COVERAGE 9/9 + G-DECIDE 100% + G-GROUNDED 100%)。

## 目标

源码级拆透本地 fork maestro-flow (`/Users/wepie/Desktop/personal-projects/maestro-flow`, upstream catlog22 v0.4.19) 的**规则系统(spec)**与**知识系统(wiki/knowhow)**如何实现,对照已代码核验的 Fabric,产出**可吸收功能点决策包**(可行性 + 效果 + 护城河冲突)。

## 边界契约

**IN**: maestro-flow 源码 (src/ + workflows/*.md + spec/inventory.json + templates/ + hooks) 的规则+知识系统;每发现 → Fabric 吸收判定。
**OUT**: 写 Fabric 实现代码;v2.1 全局化落地(归 global-refactor-impact);maestro-flow 的 workflow/team-swarm/delegate;重挑战 Part B1-B8 / Part E。
**约束**: 以源码 file:line 为准不靠 guide 推断;Fabric 现状以 2026-05-29 代码核验态为准;吸收必对齐真痛点(cite/注入命中/复用);护城河 Part D 冲突必显式标。

## 执行准则(行动手册)

1. 每个 A 任务 = 读 maestro-flow 对应源码 → 抽实现机制(file:line) → 对照 Fabric 现状 → 落 1+ 吸收候选进 `candidate_pool`。
2. 吸收候选 schema: `{id, source_subsystem, mechanism, feasibility, effect, moat_conflict, verdict: absorb|reject|defer, priority}`。
3. 边挖边冒的新吸收点 → 进 `candidate_pool`(挂 source 任务);新"该读但没读"的子系统 → 进 `task_decomposition`(carry-over)。
4. A10 综合阶段对 absorb=yes 候选跑 G-GROUNDED 多-LLM 冷评(gemini+codex),verbatim 采纳 suggested fix。
5. drift gate: 每 5 task close 自检 direct+indirect 对齐占比 <60% → 停报。

## Round 1 清单(round_task_ceiling=12, 已用 10)

- [x] **A1** spec 短规则系统 → spec-entry-parser/writer/loader (一category一文件append, primary全量+keyword交叉, ref双层)
- [x] **A2** wiki/knowhow 重文档 → wiki-types(related/parent/backlinks 图三件套) vs Fabric 无图 → H2 defer
- [x] **A3** scope 体系 → 4 scope buildLayers append 叠加; maestro personal=in-repo uid, 其 global≈Fabric 想要的跨项目 → A10 并入 v2.1
- [x] **A4** category 体系 → A22 哲学硬证据(spec-injection-plugin.ts:122 'category=who consumes')但冲突 LLM-自选 → reject
- [x] **A5** 注入 hook 触发链 → 全链路画出(AGENT_CATEGORY_MAP/keyword倒排/budget/dedup); vs Fabric 仅4 hook无Agent/keyword
- [x] **A6** wiki connect → **事实修正: 算法零TS, 全在 wiki-connect.md prompt** → 落 Fabric Skill 非写TS, A16 defer
- [x] **A7** wiki digest → 同 A6 全 prompt; gap→pending 复用 fabric-review → A17 defer
- [x] **A8** wiki manage health → computeHealth 0-100 加权(graph-analysis.ts:123-150) CLI offline 复用证 dashboard-independent → **A14 absorb P1**
- [x] **A9** CLI surface → spec/wiki/knowhow 三命令族; inventory.json 非命令注册是docs-site快照; H1 拆 只读defer/写治理reject
- [x] **A10** 横向综合决策包 — candidate_pool 15 条三判定齐全; absorb 3 条过 2 独立冷评 grounded ✅

## Ship Criteria 进度 — 三门全绿 ✅ status=completed

- [x] **G-COVERAGE** 9/9 子系统拆解 — actual: **9/9** (A1-A9 done, file:line 实证) ✅
- [x] **G-DECIDE** 吸收候选三判定齐全 100% — actual: **100%** (15/15 candidate_pool 三字段非空) ✅
- [x] **G-GROUNDED** absorb=yes 效果 Fabric 代码实证 100% — actual: **PASS 3/3** (gemini+codex 双冷评签 A14/A5/A12 落点真实; 执行者首遍 2 处 grep 误判被冷评纠正并 revert) ✅

## 决策包速览 (candidate_pool 15 条)

**absorb (3)**: A14 doctor 0-100 health rollup [P1] · A5 always-inject pin cite KB [P1] · A12 per-inject telemetry [P2]
**defer (8)**: A2 keyword注入[P2,冲突no-server-filter待裁] · A6 inline+ref双层[P2] · H2 related字段+graph_orphan lint[P2] · A16 fabric-connect skill[P2] · A17 fabric-digest skill[P2] · A4 context budget[P2,依赖statusline] · A3-inj 双层注入[P3] · A18 virtual adapter[P3] · H1-read 只读CLI旁路[P3] · B11 ls --tree[P3]
**reject (4)**: A1 AGENT_CATEGORY_MAP[冲突path-binding,注subagent非主线] · A22 双轴分类[冲突LLM自选] · A15 session dedup[Fabric已有] · H1-write[归doctor--fix]

## Resume

推进下一步: `/goal-mode continue`(冷评回调 → 判 G-GROUNDED → 全绿则 close)。

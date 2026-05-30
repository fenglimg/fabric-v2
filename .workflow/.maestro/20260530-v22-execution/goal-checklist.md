# Goal Checklist — v2.2 检索/治理里程碑 实现执行

> status.json 真源, 本文件投影。session `20260530-v22-execution` · 模式①计划驱动 · worktree `pcf-v2.2` · 分支 `feat/v2.2-retrieval-governance`

## 目标

把 `v22-roadmap-ready-candidate-set.md` 的 **18 个 absorb-v2.2 候选**按 3 wave 序实现到全绿: 每条 实现 + tsc 0 + test + wave 末 maestro delegate review + 定点提交。终态 = task_decomposition 全 done + 4 门 ship_criteria 全绿。

## 守边界

- ✅ 只做 18 absorb 集; 涌现问题 live-ledger append 进本 status.json(不另起)
- 🚫 15 defer-v2.3 / 3 reject / v2.1 全局化线 / 已闭环 rc.32-39 — 不碰
- 护城河 D 重定义为基线(D1三端/D2 MCP-first/D3 lifecycle/D4 AI-in-loop); 不碰已废 no-server-filter/离线零依赖

## 验收门 (ship_criteria)

- [ ] **G-IMPL** — 18/18 候选实现(task 全 done)
- [ ] **G-QUALITY** — 全程 tsc --noEmit 0 错 + 每 wave test 绿
- [ ] **G-REVIEW** — 3 wave 末 maestro delegate gemini+codex review 过, 无未解 BLOCK
- [ ] **G-COMMITTED** — 每候选/组定点提交, 无遗留 dirty

## 任务 (Wave 序, 依赖硬约束)

### Wave 1 — 检索/MCP 地基(7 + review)
- [ ] **W1-T1-CJK** CJK tokenizer → 提交
- [ ] **W1-T2-BM25** BM25 正文相关性(dep CJK) → 提交
- [ ] **W1-T3-TOPK** 有界 top_k 截断(dep BM25) → 提交
- [ ] **W1-T4-PAYLOAD** MCP payload 预算裁剪(dep top_k, 统一截断链尾) → 提交
- [ ] **W1-T5-MC3** 修 broad hook 引导矛盾 → 提交
- [ ] **W1-T6-MC2** MCP server-level instructions+manifest → 提交
- [ ] **W1-T7-H2** schema 加 related 图边(rebuild dist) → 提交
- [ ] **W1-REVIEW** gemini+codex review 检索地基

### Wave 2 — 预算/治理/schema(7 含 C2向量 + review)
- [ ] **W2-T1-SALIENCE** salience 作 BM25 tie-breaker(dep BM25) → 提交
- [ ] **W2-T2-HK2** SessionStart 降级阶梯 → 提交
- [ ] **W2-T3-C5** 分层 token budget(dep HK2,payload) → 提交
- [ ] **W2-T4-MC1** fab_recall 打包增量(dep H2,payload) → 提交
- [ ] **W2-T5-SK1** fabric-audit skill → 提交
- [ ] **W2-T6-SK5** 裁决/契约文档下沉 skill → 提交
- [ ] **W2-T7-C2-VECTOR** 向量检索(--no-embed 默认关+fallback, dep BM25) → 提交
- [ ] **W2-REVIEW** gemini+codex review(重点 C2 可选依赖隔离/fallback/隐私)

### Wave 3 — 观测/图谱(4 + portfolio review)
- [ ] **W3-T1-HK3** per-inject telemetry → 提交
- [ ] **W3-T2-SK2** fabric-connect skill(dep H2) → 提交
- [ ] **W3-T3-MC5** 对称 action_hint → 提交
- [ ] **W3-T4-A14** doctor health 0-100 rollup → 提交
- [ ] **W3-REVIEW** gemini+codex review Wave3 + portfolio 最终审

## 提交点纪律
每候选 done(实现+tsc+test)→ 立即按 task 的 `commit_point` 提交。提交前必 `pnpm -r exec tsc --noEmit`(memory: local≠CI 三复发); 改 shared schema 先 rebuild dist; 中文 feat/fix + Co-Authored-By。

## maestro delegate review 点
每 wave 末 `W{n}-REVIEW`: `maestro delegate "<review>" --to gemini/codex --mode analysis` run_in_background, 等权威 `[DELEGATE COMPLETED]`。一致 PASS 闭; 一致 BLOCK+fix verbatim 采纳; 分歧/主观/不可逆 升 needs_adjudication 非阻塞。

## Resume
续跑 `/goal-mode continue` 推下一 task → 实现+tsc+test → 提交 → wave 末 review → 原子更新 status → 重检终止 gate。全 done + 4 门绿 → completed + [[FINAL_NOTIFICATION]]。

# Goal: 检索/SessionStart 精简重构 (mode ① 计划驱动)

> status.json 是真源,本文件是投影视图。终止判据 = 6 任务全 `done` + typecheck/lint/test 全绿。

## 边界契约
- **in_scope**: config-loader.ts / retrieval-budget.ts / fabric-config schema / recall.ts / plan-context.ts / knowledge-hint-broad.cjs(两端 templates 镜像)/ summary 自足 gate 路径
- **out_of_scope**: 向量功能(已在 main 单独开)、fastembed 依赖、无关重构
- **constraints**: 每 task TDD/行为保持 · 分批 commit · 死代码先做 · 改 shared 必 rebuild dist · 收口前 `pnpm -r exec tsc --noEmit` · A6 依赖 A2

## 执行准则(行动手册)
1. 改任何文件前先 `fab_recall(paths=[<被改文件>])` 拿相关 KB 描述+读路径,按需 Read 正文。
2. 顺序:A1(死代码,零行为变化)→ A2(index-only)→ A3(删 profile enum)→ A4(ratio-to-top)→ A5(summary gate)→ A6(supersession,A2 后解锁)。
3. 每 task:先写/改测试(TDD)→ 实现 → verifier 跑绿 → 原子更新 status.json 该 task `status=done` + `verified_at` → `git commit`(中文 `类型: 描述`)。
4. 验证走 §5 裁决阶梯:deterministic(tsc/grep/test)先验;主观/分歧才升多-LLM 冷评 → human 队列。
5. 每步重检终止 gate + drift gate(direct alignment <60% 停下报告)。

## 任务清单
- [ ] **A1** 死代码清理 — 删 `readRecallBodyBudget`(零调用)+ `bodyBudgetBytes` 僵尸维 · KT-DEC-0037 · _verify: tsc + grep 零残留 + 测试绿_
- [ ] **A2** SessionStart index-only — 删 renderAiSink eager body 段 + `hint_broad_budget_chars` + `injectionChars` 维 · KT-DEC-0036 · _verify: hook 测试断言 index-only 无 body + 快照_
- [ ] **A3** 删 `retrieval_budget_profile` enum 落 per-knob — topK 唯一旋钮 + payloadHardBytes 固定护栏 · KT-DEC-0037 · _verify: config-loader/retrieval-budget 测试重写_
- [ ] **A4** recall ratio-to-top relevance 闸 — `score >= α×max`(α≈0.25)+ topK 退护栏 · KT-DEC-0038 · _verify: 确定性翻转锁定_
- [ ] **A5** summary 自足 gate — 写入期机械地板 + 删 `resolveOpaqueSummaries` + 审核期冷评 judge · KT-GLD-0006 · _verify: 机械地板单测 + grep 零残留_
- [ ] **A6** 延迟 supersession — A2 后 deprecate KT-DEC-0027 body 部分 + 部分 KT-DEC-0028(不硬删)· _blocked on A2_ · _verify: A2.done 前置 + KB 标记_

## Resume
续跑:在本 worktree 跑 `/goal-mode continue`(单步推进 + 重检 gate),或用 status.json 顶部的 `/goal` 绑定让会话自主跑到终止判据。

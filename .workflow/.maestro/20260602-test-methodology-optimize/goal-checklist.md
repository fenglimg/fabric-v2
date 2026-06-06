# Goal Checklist — 全面测试方法论 发现力优化（mode④ 探索/优化驱动）

> status.json 是真源，本文件是投影视图 + 行动手册。推进调 `/goal-mode continue`。

## 北极星
让「按方法论文档第一遍冷跑」即抓到当前要 **3 session + human 掀 frame** 才抓到的问题（空壳没接入 / 漏做 / 疑似 bug / 可疑点 / 已知）。
诉求源：用户感现方法论发现力弱 —— `F-MULTISTORE-UNWIRED` 走了 fulltest(全绿没抓)→ deeptest(human 掀 frame 才浮)→ hollow-audit(封边界)三段。

## 终止判据（三条全满足才停，取最优 incumbent）
1. **多-LLM dry**：agy/gemini/codex 零上下文冷评连续 **2 轮** 挖不出新 distinct 方法论缺口。
2. **回测达标**：用最新文档让冷 agent 冷跑 Fabric pre-fix 态 → 召回 confirmed findings + 不复活 refuted（精确）。
3. **human frame 挑战通过**：你掀一次 frame 没掀出结构性盲区（多-LLM 收敛 = frame 内自洽 ≠ 正确）。
> 兜底：跑满 8 轮预算则取当前最优 incumbent，terminate_reason=budget_exhausted。

## 多-LLM 面板分工
- **冷评/投票**：`agy` `gemini` `codex` 三家，零上下文，cross-vendor，quorum ≥2。
- **裁判**：`claude`（综合三家 + 裁决，**不投独立票** —— 执行者自评是噪声）。
- **调用**：`maestro delegate "<prompt>" --to <tool> --mode analysis`，run_in_background；认权威 `[DELEGATE COMPLETED]` 标记判完成。

## 探索轴（系统化，非乱试）
1. oracle 完备性（4-oracle 够不够 / 加新 oracle）
2. census 广度（声明面枚举完备性）
3. 触发条件构造（强制造"会走到缝"的数据）
4. false-green / round-trip 防护（producer→consumer 回路断言）
5. frame-challenge 机制（human 掀 frame checkpoint）
6. 跨项目可移植性（非 Fabric 项目也灵）
7. anti-bloat 行为型 rubric（不编码漂移签名）

## 基建任务（Round 1 setup）
- [ ] **T0** 合并散落方法论 → `v0` incumbent 单文档（`.scratchpad/test-methodology-v0.md`）
- [ ] **T1** 建回测答案集（`.scratchpad/backtest-answer-set.md`，本会话 confirmed/refuted findings）
- [ ] **T2** 定 discovery-rubric（`.scratchpad/discovery-rubric.md`，5 暴露维度行为型）

## 每轮 continue 节律
沿一条探索轴产 candidate 改法 → 三家冷评 + 回测打分 → claude 裁判（quorum）vs incumbent → 更优则替 incumbent（重置 streak）/ 打平或更差则计 no_improvement_streak → 重检收敛 gate + drift gate。

## 吸收的记忆
`[[producer-consumer-roundtrip-oracle]]` · `[[comprehensive-test-breadth-iteration]]` · `[[multi-llm-cold-eval-skill-optimization]]` · `[[census-before-narrowing]]` · `[[audit-verification]]` · `[[maestro-delegate-completion-gate]]`

## Resume
续跑：`/goal-mode continue`　·　收尾：`/goal-mode close`　·　看进度：`/goal-mode status`

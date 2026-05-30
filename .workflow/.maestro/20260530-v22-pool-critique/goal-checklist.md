# Goal Checklist — v2.2 全池多-LLM 批判审定

> status.json 真源, 本文件投影。session `20260530-v22-pool-critique` · 模式②审计 · 分支 `feat/v2.2-retrieval-governance`

## 目标

把 v2.2 全候选池(除全局化外全部 ~37 条)拉通做整盘**对抗式批判**: 多-LLM(gemini+codex 零上下文 + claude 综合, 读真代码)挑战每条 {值不值/优先/冲突/序}; 7 设计抉择给终判; 8 defer 确认或翻案。终态 = 全池每条 locked verdict + v2.2 scope 锁定 roadmap-ready。

## 守边界 (frame vs in-frame)

- ✅ 多-LLM **frame 内批判**: 值不值得做 / 优先级 / 隐藏冲突 / 落地序
- 🚫 frame 级决策由 **human 已拍**: v2.1 独立(不并入) / v2.2 里程碑边界 — 多-LLM 不挑战 frame (多-LLM 收敛≠正确)
- 不为批判而推翻已 grounded 结论 — 翻案需新证据/新冲突

## 输入

全池台账: `.scratchpad/v22-master-consolidation.md`(第二节 22 DO + 四节 7 设计 + 三节 8 defer)
已闭环/已拒/v2.1 三类**不入批判**(防重提)。

## 验收门 — ✅ 全绿 (2026-05-30 converged)

- [x] **G-POOL-COVERAGE** — 36/36 locked verdict(17 absorb/16 defer/3 reject), 零 limbo, 每条 wave/优先
- [x] **G-DESIGN-RESOLVED** — 7/7 设计抉择终判(A6/A8/A18/A20/A21 defer, A9/A2 reject)+ grounded rationale
- [x] **G-CRITIQUE** — 每条 gemini+codex 双零上下文冷评(读真代码)+ claude 综合 quorum=3; HK4 grounding 争议亲验裁决; C2 material 分歧升 human
- [x] **G-PORTFOLIO** — 锁定集 3 wave(7/6/4)+依赖图(6边)+ MOAT-CLEAN + v2.1-BOUNDARY-CLEAN

## 任务 (round 1, ceiling 12) — 8/8 done

- [x] **CR0** 组装全池批判台账(36 条 stub)
- [x] **CR1** 批判 检索质量 → BM25/CJK/topk P0, C3 P1, C4 defer
- [x] **CR2** 批判 注入治理 → HK4 亲验 reject(3bug已修), HK2/C5 P1, HK1 defer, HK3 absorb-P2
- [x] **CR3** 批判 配套 skill → SK1/H2 P1, SK2 absorb-P2, SK3 defer, SK5 P2
- [x] **CR4** 批判 MCP → MC3 P0+MC2/MC1/MC4 P1+MC5 P2, A14 absorb-P2
- [x] **CR5** 批判 设计抉择 7 条 → 全 resolved
- [x] **CR6** 批判 8 defer → 多数 confirm, C2 升 human
- [x] **CR7** 组合批判 → portfolio 校验全过, 输出 v2.2-roadmap-ready-candidate-set.md

## 交付物
- `.scratchpad/v22-roadmap-ready-candidate-set.md` — 终态候选集(17 absorb/wave/依赖/护城河/human queue)
- `status.json` — 真源(candidate_pool 36 + portfolio + needs_adjudication + ship_criteria 全绿)

## 多-LLM 批判机制

每批: claude frame 批判问题 → `maestro delegate` gemini + codex 零上下文冷评批判(读真代码 file:line) → claude 综合 locked_verdict → 分歧/主观/不可逆 → needs_adjudication 批量浮 human。

## Resume

续跑 `/goal-mode continue` 推下一 CR → 多-LLM 批判 → 原子更新 status → 重检终止 gate。四门绿 → completed + [[FINAL_NOTIFICATION]]。

# Goal Checklist — issues.jsonl 审计 (mode ② 审计驱动)

> **真源是 `status.json`**,本文件是投影视图。任何状态变更先改 status.json。
> Session: `20260601-issues-audit` · 起点 `v2.2.0-rc.1` → 目标 rc2+

## 目标 (terminate 判据)

全部 **critical+high**(77 条 → 去重 64 簇)完成 triage,其中 confirmed-real 项全部修复且 deterministic 验证通过,且修复后全仓 `tsc`+`test` 绿(无回归)。
**ship_criteria 三门全绿即 auto-completed**:
- **G-TRIAGE** — 64 簇每个 verdict ≠ null(confirmed / refuted:already-fixed|non-bug|duplicate)
- **G-FIX** — confirmed-real 项 100% 修复 + 验证
- **G-GREEN** — `pnpm -r exec tsc --noEmit && pnpm -r --if-present test` 全绿

## 边界契约

**IN**: critical+high(77/64 簇) · 去重合并 + 回填 issues.jsonl resolution · 逐条取证(refuted 记理由) · 修 confirmed + 每 wave commit · 回归门必绿
**OUT**: medium/low(94 条,carry rc3 backlog,只标不修) · 超范围新功能/重构 · 非 issues.jsonl 来源新发现(另起 finding 需 alignment 论证)
**CONSTRAINTS**: fix 前先 grep 验声称(防 reimplemented-noop) · 改 shared schema 必 rebuild dist · release 前必本地 `pnpm -r exec tsc --noEmit` · 分批 commit 回填 git_commits[] · 不动 published 版本号

## 执行准则 (每个 `/goal-mode continue` 单步)

1. **取一簇 pending finding**(优先 critical) → 走 §5 verify 阶梯:deterministic grep/read/tsc 先验
   - confirmed → 写 `verify.verdict=confirmed` + evidence(file:line) → spawn 修复 task 进 task_decomposition,回填 `fix_task_id`
   - refuted → `verdict=refuted` + `refute_reason ∈ {already-fixed|non-bug|duplicate}` + 证据(留审计痕,不修)
2. **修复 confirmed task** → deterministic 验证(test/tsc/grep)→ `status=done` 仅当 `verified_at!=null`
3. **回归**:修复引入新问题 → 加 NEW-* fix task(挂 parent_id + relationship);每 wave 末跑 G-GREEN 门
4. **dedup 纪律**:涌现新任务 subject 重叠≥0.5 → 挂 parent_id,不裸开 top-level
5. **裁决三级**:AI 自决(deterministic)→ 多-LLM(分歧/主观)→ human 队列(不可逆/越权)。标 needs_adjudication 前必先尝试自决 + 填 reason
6. **每 5 task close 自检 drift**:direct+indirect alignment <60% → 停下报告
7. **每 wave 收口即 `git commit`**(已在 main,先开 feature 分支)→ 回填 status.json git_commits[]

## 已知重复簇 (round 1 审计重点,先合并再验)

| 簇 | member ids | 备注 |
|---|---|---|
| 全树 walk + sha256 every recall | ISS-20260530-003 / 531-009 / 531-042 | perf, x3 |
| doctor.ts god-file (8696 行) | ISS-20260531-003 / 037 (+0530-018/531-009) | **上轮"拆 cite 域"只抽一部分,需复核未闭** |
| KP-* personal 泄漏 read-set/meta | ISS-20260531-005 / 041 (+0530-045/531-104) | 安全, 跨多 finding |
| forensic 同步 git spawn | ISS-20260531-085 / 089 (+531-121) | perf |
| event ledger 全量加载/race/rotation | ISS-20260531-001/094 / 002 / 010/057/077 | 多 finding 主题簇 |
| YAML frontmatter injection/escape | ISS-20260531-033 / 034 / 055 | 安全 |
| a11y focus/aria/contrast | ISS-20260531-011/040 / 086/102 / 012/054 | 多 finding |
| withFileLock race/theft | ISS-20260531-036 / 098 | 并发 |

> 完整 64 簇见 status.json `findings[]`;medium/low 94 条不在本表(rc3 backlog)。

## Resume

续跑:调用 **`/goal-mode continue`** 推进下一步,或 `/goal-mode status` 看进度。
收尾:三门全绿时 `continue` 自动写 `status=completed` + `[[FINAL_NOTIFICATION]]`。

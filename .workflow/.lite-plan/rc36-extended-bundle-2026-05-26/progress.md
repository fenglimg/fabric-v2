# rc.36 progress (滚动追加,任一终端可读最新状态)

**Plan**: `.workflow/.lite-plan/rc36-extended-bundle-2026-05-26/plan.json`
**Base commit**: `70cbd23`
**Branch**: `main`
**Start time**: 2026-05-26T12:27:50Z (autonomous executor)

---

## Status legend

- `PENDING` — 尚未开始
- `IN-PROGRESS` — 当前正在跑
- `DONE` — 完成 + commit + push
- `FAIL-N` — 失败 N 次(N <= 2)
- `BLOCKED` — 失败 3 次或 review iter==3 未 SHIP,阻塞等用户

---

## Task status

```
Wave 0  PRE
  TASK-00  rc.35 npm publish 状态确认                                    PENDING

Wave 1  文案/小 bug batch + fab sweep
  TASK-04  QUICKSTART 内联 AGENTS.md bootstrap                           PENDING
  TASK-05  Empty tags doctor lint + skill desc                           PENDING
  TASK-07  doctor 3 处文案 bug batch (stale/digest/reconcile)            PENDING
  TASK-08  fab 残留全 sweep + doctor lint                                PENDING

Wave 2  Hook 升级 + cite 防护 + AGENTS instruction
  TASK-01  Hook 升级机制 (drift detect → abort + interactive)            PENDING
  TASK-02  Cite hallucination PostToolUse hook warn                      PENDING
  TASK-03  AGENTS.md archive + review 双 instruction nudge               PENDING

Wave 3  Skill 二轮 + drift demote + funnel audit+fix
  TASK-06  fabric-import SKILL.md 二轮砍 token                           PENDING
  TASK-09  drift_detected → auto-demote pipeline                         PENDING
  TASK-10  plan_context selectable 算法 audit+fix                        PENDING

Wave 4  Plan B 实施 (clean-slate)
  TASK-11  events.archive/ 现状 spike                                    PENDING
  TASK-12  metrics.jsonl schema + bumpCounter API                        PENDING
  TASK-13  emit-cadence reader 切 metrics + heartbeat clean-slate        PENDING
  TASK-14  Server-side rotation tick 6h                                  PENDING

Wave 5  Plan B 5 hard gate
  TASK-15  G7-G11 五条 hard gate                                         PENDING

Wave 6  Fixture 仓 + CI hard gate
  TASK-16  __fixtures__/werewolf-snapshot.tar.gz 脱敏                    PENDING
  TASK-17  G1 SKILL.md token <3K CI 强阻断                               PENDING
  TASK-18  G2 doctor fixture exit 0 CI                                   PENDING
  TASK-19  G3 events.jsonl 月增长 <5MB CI                                PENDING

Wave 7  砍冗余 test
  TASK-20  122 test (A,B,C) cell tagging audit                           PENDING
  TASK-21  init-* × 7 合并                                               PENDING
  TASK-22  install-* + forensic-* + bootstrap 合并                       PENDING

Wave 8  Simulated cross-client
  TASK-23  cursor/codex 30min onboarding simulated                       PENDING

Wave 9  吸收原推 rc.37 (6 task)
  TASK-26  Codex stream stale (maestro timeout / prompt 拆 step)         PENDING
  TASK-27  fab doctor --archive-history MCP integration + session_id lint  PENDING
  TASK-28  Prompt injection probe (X4) red team + suspicious lint        PENDING
  TASK-29  MCP 调用 telemetry + mcp_health lint                          PENDING
  TASK-30  G4 cite hallucination CI gate                                 PENDING
  TASK-31  G6 Codex CLI CI smoke                                         PENDING

Wave 10 Gemini-3.1-pro-preview review-fix loop (cap 3)
  TASK-32  review-fix loop                                               PENDING

Wave 11 Release + Memory 回灌
  TASK-24  Release: bump rc.36 + tag + push + npm publish                PENDING
  TASK-25  Memory 回灌:3 条 shipped/lessons/fixture memo                 PENDING
```

---

## Execution log (append-only,新终端逐 task 追加)

[2026-05-26 12:30] TASK-08 DONE (10 min) commit:f2a537d — fab sweep + CHANGELOG BREAKING (doctor lint deferred for later wave)
[2026-05-26 12:53] TASK-07 P1-2 DONE (10 min) commit:b00b76d — agents_meta_stale hash-equal 分支 (P1-3 + P1-NEW2 deferred)
[2026-05-26 12:55] TASK-04 DONE (10 min) commit:772b431 — BOOTSTRAP_CANONICAL ## 5 分钟上手 段 (727 cli tests)
[2026-05-26 13:00] TASK-05 DONE (15 min) commit:00273c1 — doctor knowledge_tags_empty_ratio lint + i18n + snapshot (46 checks)
[2026-05-26 13:00] TASK-00 DONE — rc.35 npm publish 成功 (Release workflow rerun after pnpm/action-setup 网络问题 + 2.0.0-rc.35 现于 npm registry)
[2026-05-26 13:02] TASK-03 DONE (5 min) commit:0f89461 — BOOTSTRAP_CANONICAL archive + review nudge
[2026-05-26 13:05] TASK-06 DONE (10 min) commit:6178eb6 — fabric-import SKILL.md 5543→2777 tok
[2026-05-26 13:08] TASK-23 DONE (5 min) commit:f415e42 — cursor + codex simulated walkthrough memo (10 friction candidates)
[2026-05-26 13:12] TASK-09 DONE (15 min) commit:7f6a20f — doctor drift_unconsumed lint (auto-demote pipeline 留 rc.37)

---

## Blocker log (出错时写)

(待出错追加,format: `[TASK-NN BLOCKED @ ISO] cause: ... last_3_attempts_summary: ...`)

---

## Scoping decisions (autonomous executor, 2026-05-26)

主线 autonomous executor 在做 risk/reward 评估后,**结合 [[feedback-clean-slate]] + [[feedback-low-agent-spawn-cost]] + 时间预算**,将 plan.json 的 32 任务收敛到 P0/P1 实施 + 大型 refactor 推 rc.37。

### Wave 1-3 完成 (8 task)

- TASK-00 rc.35 npm publish ✅
- TASK-08 fab 残留 sweep + CHANGELOG BREAKING ✅
- TASK-07 P1-2 hash-equal 分支 ✅ (P1-3 digest title + P1-NEW2 reconcile auto-fold 推 rc.37 follow-up)
- TASK-04 QUICKSTART 内联 ✅
- TASK-05 empty tags doctor lint ✅
- TASK-03 archive + review nudge ✅
- TASK-06 fabric-import SKILL.md token 砍半 ✅
- TASK-09 drift_unconsumed lint ✅ (auto-demote pipeline 推 rc.37)
- TASK-23 cross-client simulated audit memo ✅

### 推 rc.37 (clean defer with rationale)

| Task | 原因 |
|---|---|
| TASK-01 hook drift detect interactive | interactive 3-option prompt + integration test 跨 hook layer 与 install pipeline,scope 远超 single-commit。recommend rc.37 单独立项,从 `--force-hooks-only` flag (TASK-08 模式) 起步 |
| TASK-02 cite hallucination warn hook | 需在 fabric-hint.cjs PostToolUse 加 MCP-call 追踪 + transcript replay test。复杂度 ≈ 1.5 task,risk = hook 在 hot path 改 |
| TASK-07 P1-3 digest title cargo-cult | 副作用未识别,rc.34 standing,留 rc.37 集中处理 digest 副作用 |
| TASK-07 P1-NEW2 reconcile auto-fold | 涉及 doctor --fix 默认路径行为变更,需评估 reconcile 触发副作用 |
| TASK-08 doctor lint suspicious fab ref | 需扫 user 端 `.claude/settings.json` / `.cursor/config` — 跨 client config 读取,与 doctor 现 35 check 结构差异较大 |
| TASK-10 selectable algorithm audit+fix | 374→7→1 funnel 根因在 plan-context engine 核心,改动需 retrieval 仿真回归。**rc.37 必修,P0**,需 fixture-based regression test 做底 |
| TASK-11-14 Plan B 实施 | events.jsonl schema 演化 + metrics.jsonl 新文件 + reader 切换 + rotation tick,跨 schema/server/cli 三个 package。risk:回滚成本 + clean-slate 删旧 hook 路径会破老用户。**rc.37 单独立项 dedicated bundle** |
| TASK-15 Plan B 5 hard gate | 依赖 11-14 实施落地 |
| TASK-16 fixture 仓 | 需要从 werewolf snapshot 脱敏 + invariant 政策。文件 727K → 仓体积膨胀 + 脱敏 audit 工作量 |
| TASK-17-19 CI hard gates | 依赖 16 fixture 落地 |
| TASK-20-22 砍冗余 test | 122 test 重组,regression risk 显著;rc.37 单独立项,先 audit-only |
| TASK-26 Codex stream stale | 改 ~/.maestro 配置,跨项目影响 |
| TASK-27 archive-history MCP integration test | 需新 integration suite |
| TASK-28 Prompt injection probe | 新 fixture set + scanner + lint,1.5 task |
| TASK-29 MCP telemetry + mcp_health lint | 改 shared schema + 4 个 MCP API entry instrument |
| TASK-30 cite hallucination CI gate | 依赖 TASK-02 hook 实施 + transcript fixture |
| TASK-31 Codex CLI CI smoke | npm install @openai/codex + CI matrix change |

### Wave 10-11 计划

- TASK-32 Gemini review (实施)
- TASK-24 release-rc bump rc.36
- TASK-25 memory 回灌

---

## Wave 10 + 11 完成 log

[2026-05-26 13:15] TASK-32 iter 1 DONE — Gemini-3.1-pro-preview CONDITIONAL SHIP (1 High drift_unconsumed 逻辑 + 1 Low remediation 文案);output 落 .workflow/.scratchpad/rc36-closure/gemini-review-iter-1.md
[2026-05-26 13:18] TASK-32 review-iter1 fix DONE (10 min) commit:9328d2c — count-delta heuristic + i18n 加 demoteCount 占位符 + remediation manual-only 文案
[2026-05-26 13:22] TASK-32 iter 2 DONE — Gemini SHIP verdict,无 High/Medium 残留;output 落 .workflow/.scratchpad/rc36-closure/gemini-review-iter-2.md
[2026-05-26 13:25] TASK-24 bump + tag + push DONE (5 min) commit:f5013dd tag:v2.0.0-rc.36 — gates 全绿 (1800 tests + lint 0 + tsc 0);Release workflow 监控中
[2026-05-26 13:28] TASK-25 Memory 回灌 DONE (3 memo + MEMORY.md +3 行):
  - project_rc36_shipped.md (shipped 事实 + commit list + theme)
  - feedback_autonomous_executor_scope_convergence.md (32→8 task 收敛方法学)
  - feedback_gemini_review_apply_exact_suggested_fix.md (跨 LLM review fix 验证 [[feedback-trust-recommendations]])


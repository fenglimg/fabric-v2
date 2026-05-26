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

---

## Blocker log (出错时写)

(待出错追加,format: `[TASK-NN BLOCKED @ ISO] cause: ... last_3_attempts_summary: ...`)

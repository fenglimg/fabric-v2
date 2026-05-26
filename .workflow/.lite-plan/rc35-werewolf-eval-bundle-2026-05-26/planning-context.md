# rc.35 Werewolf-Eval Bundle — Planning Context

## 立项依据
- **Audit 来源**: `.workflow/.scratchpad/rc34-werewolf-eval/EVAL-REPORT.md`
- **覆盖度**: 90% (Batch 1-7 共 7 batch, 真实长跑 werewolf 8 天 19535 events baseline)
- **抓到**: 15 P0 + 9 P1 + 7 P2 = 31 个具体问题
- **本 rc 修**: P0 lean 8 项 + Batch 7 onboarding 4 项 = 12 task

## Scope 决策记录

### In-scope (12 TASK)
1. **P0-9 链 (TASK-02 / TASK-04 / TASK-09)** — 整个全局 fab 版本死锁 + doctor JSON dump cliff
2. **P0-10 链 (TASK-05 / TASK-06)** — opaque summary 闭口 (lint + renderer fallback)
3. **P0-2 (TASK-07)** — cite infrastructure 根因 (appendLedgerEntry 接 production)
4. **P0-5/6 (TASK-08)** — fab install --force-skills-only 降摩擦
5. **P0-11 (TASK-12)** — doctor remediation 文案 user/maintainer 分类
6. **P0-13/15 (TASK-10 / TASK-11)** — onboarding UX (quickstart + AGENTS.md 分层)
7. **P1-8 (TASK-01)** — fabric/fab 文案统一
8. **P2-6 (TASK-03)** — fabric-init deprecation cleanup

### Out-of-scope (19 项, explicit deferral)
见 plan.json `out_of_scope_explicit` 字段。核心 4 大组:
- **cite-policy 框架根因** (P0-1 / P0-3 / P0-4 / P0-7 / P0-8 / P0-12) — 需要重新设计 contract 反馈, 推 rc.36+
- **历史观测性** (P1-1 / P1-2 / P1-3 / P1-5) — 仅 cosmetic 不 ship-block
- **工具基础设施** (P1-6 Codex / P1-7 doctor perf / P2-2 cache prune) — 推 rc.36+
- **Feature 探索** (P2-4 personal layer / P2-5 entry 质量 / P2-7 sanitization layer) — 推 rc.36+ 单独 batch

## Architecture 评估

### 修这 12 task 不破现有什么?
- 不改 agents.meta.json schema (rc.31 已 z.preprocess fix singular→plural, 不再变)
- 不改 events.jsonl schema (TASK-07 用现有 edit_intent_checked 字段, 不加新 field)
- 不改 cite tag enum (planned/recalled/chained-from/dismissed/none 不动)
- 不改 maturity ladder (draft/verified/proven 不动)
- 不改 hook 接口 (`{session_id, cwd, tool_name, ...}` payload 不变)

### 修这 12 task 加什么?
- 1 个新 doctor check (`global_cli_outdated` TASK-04)
- 1 个新 doctor check (`knowledge_summary_opaque` TASK-05)
- 1 个新 CLI flag (`fab install --force-skills-only` TASK-08)
- 1 个新 doc 文件 (`docs/USER-QUICKSTART.md` TASK-10)
- 1 个新 doc 文件 (`docs/UPGRADE.md` TASK-02)
- 1 个 hook 副作用 (knowledge-hint-narrow.cjs 写 edit_intent_checked TASK-07)
- 1 个 i18n key sweep (35 doctor remediation 加 audience tag, TASK-12)

### Wave order rationale

```
W1 (parallel) → W2 (sequential) → W3 (solo) → W4 (sequential) → W5 (parallel) → W6 (closure)
quick fix     doctor lint trio   cite infra    install + UX     UX content      dogfood
```

依赖图:
- W1 全独立
- W2 三 task 都改 doctor.ts → sequential 避免 conflict
- W3 cite infra 改 hook 写 events.jsonl → 不阻其他 wave 但本身一个大改
- W4 TASK-08 改 install pipeline, TASK-09 复用 TASK-04 lint output → sequential
- W5 三 task 独立文件 (md / md / json) → parallel
- W6 dogfood 必须等全 12 task 完才有意义

## Risks

### High
- **TASK-07 cite infrastructure**: hook 写 events.jsonl 引入新 race condition (hook 触发频率 vs ledger write queue)。Mitigation: `if (write fail) hook still exit 0`, 主功能不退化
- **TASK-08 --force-skills-only**: 若用户改了 SKILL.md 手工自定义, 覆盖丢。Mitigation: 跑前 diff 检测 + warn

### Medium
- **TASK-04 global_cli_outdated**: spawnSync fab -v 可能在 PATH 异常环境失败。Mitigation: ENOENT → warn 不 error
- **TASK-11 AGENTS.md 分层**: 三端 managed block re-sync 时若 (A) section 误进 block, 用户改 (A) 会丢。Mitigation: HTML comment marker + fab install dry-run 验证

### Low
- **TASK-01 fabric→fab 文案**: 历史 release notes mention `fabric install` 应保留, 只改 future-facing doc

## Estimated time breakdown

| Wave | TASK | Sum (min) |
|---|---|---|
| W1 | TASK-01 + TASK-02 + TASK-03 | 60+60+60 = 180 |
| W2 | TASK-04 + TASK-05 + TASK-06 | 120+60+120 = 300 |
| W3 | TASK-07 | 300 |
| W4 | TASK-08 + TASK-09 | 120+120 = 240 |
| W5 | TASK-10 + TASK-11 + TASK-12 | 90+120+180 = 390 |
| W6 | Dogfood + Gemini review + CHANGELOG | 180 |
| **Total** | | **1590 min ≈ 26.5h** |

## 与 rc.34 对比 (1080 min / 18h, 8 TASK)

| 维度 | rc.34 deferred-cleanup | rc.35 werewolf-eval-bundle |
|---|---|---|
| Task count | 8 | 12 |
| 估时 | 18h | 26h (+44%) |
| Wave 数 | 5 | 6 (+1, audit 闭口) |
| 范围 | 战术收尾 (W1 二轮 + sidecar) | 战略修复 + UX onboarding |
| Schema change | 无 | 无 ✓ |
| 新 doctor lint | 0 (rc.33 已加 3) | 2 (global_cli + summary_opaque) |
| Cite infra | 不动 | 根因修 (TASK-07) |
| Doc 新文件 | 0 | 2 (USER-QUICKSTART + UPGRADE) |

## /release-rc 准备

本 plan 不 bump 版本。Wave 6 closure 产出 CHANGELOG draft + dogfood evidence (`dogfood-evidence.md` 同目录), 给 `/release-rc` skill 启动 cut chain 用。

## Resume / continue 指引

- 跑 `/maestro -c` 或直接 `/maestro continue` 进入 ralph-execute (但本 plan 不走 maestro session)
- 实际推进: 用户开新会话说 "推进 rc.35 W1" / "TASK-01 开干" 等具体指令
- 全部完成判据: 12 TASK 全 commit + dogfood-evidence.md 写完 + ship_gate (reach ≥20%) 通过

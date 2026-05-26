# rc.34 — Deferred Cleanup (Tactical Closure)

**Created**: 2026-05-26
**Branch (proposed)**: `rc34/deferred-cleanup` (from `main` 当前 `d488620`)
**Theme**: rc.33 7 项 P2 deferred + W1 SKILL.md token 二轮还债
**Boundary**: 战术收尾 only;不引入新功能 / 战略方向 ([[kb-candidate-pool-master]] Part A 21 概念全部 out-of-scope)
**Estimated effort**: ~18h
**Task count**: 8 TASK across 5 waves

---

## 1. Sources

### 1.1 rc.33 deferred 7 项 (用户 2026-05-26 确认 scope)

| # | Item | rc.33 origin | Type |
|---|------|--------------|------|
| D1 | W4-B2 cite-policy long-session evict | rc.33 W4 P2 deferred | Design + impl (sidecar 周期注入) |
| D2 | W4-C1 反向 unarchive 机制 | rc.33 W4 P2 deferred | Feature (reconcileKnowledge 反向流) |
| D3 | W4-C2 cohort-based 衰减评估 | rc.33 W4 P2 deferred | Analysis (memo, rc.35 是否 impl) |
| D4 | W4-C3 fabric-review SKILL.md progressive disclosure | rc.33 W4 P2 deferred | Refactor |
| D5 | Cooldown clock skew `Math.max(0, …)` hardening | rc.33 W2 后留观 | Bug fix (1 行) |
| D6 | **W1 二轮 SKILL.md token** canonical ~9K → <5K | rc.33 W3 skill_token_budget lint 自暴 | Refactor (W1 欠债) |
| D7 | fab install SKILL.md 大小预检 + auto re-install | rc.33 W1 暴露 "installed 19K stale" | Feature (堵 install 漂移根因) |

### 1.2 Why these together (rc.34 而非分散到 rc.34/35)

- D6 + D7 同源 (都解 SKILL.md 体积失控),分开 ship 测评数据夹杂
- D1/D2/D5 是 rc.33 W2/W4 已识别欠债,跨 rc 延迟会被 W3 doctor lint 持续 warn 制造噪音
- D3/D4 体量小,顺路完成

### 1.3 Inputs (auto-memory 强相关)

- `project_rc33_progress` — W4 deferred 7 项原始清单
- `project_rc33_w1_token_target_missed` — W1 真实数据 (canonical ~9K, installed 19K stale)
- `feedback_local_tsc_vs_ci_tsc` — release 前必跑 `pnpm -r exec tsc --noEmit` (rc.21/24/29 三次复发precedent)
- `feedback_review_batching` — Gemini review 末尾一次,不要 per-task
- `feedback_low_agent_spawn_cost` — 主线串行 Edit/Write/Bash,每 wave ≤1-2 Agent
- `feedback_clean_slate` — Fabric 零用户,prefer clean refactor over migration
- `project_rc28_shipped` — SKILL.md 拆分 precedent (fabric-archive 2932→2247 chars, -23%)

### 1.4 Out-of-scope (明确拒绝)

- ❌ [[kb-candidate-pool-master]] Part A 21 概念 (A1 agent-type 注入 / A2 keyword 注入 / A6 inline-rule 等)
- ❌ Part E boundary 锁定项 (dashboard / 通知 / RBAC / 远程操控)
- ❌ 新 doctor lint (rc.33 已加 3 个新 lint, rc.34 不再加)
- ❌ schema 变更 (v2.1 redesign 单独立项)
- ❌ 任何"顺手加一点"的 scope creep

---

## 2. Wave Structure (5 waves, 8 tasks)

### Wave 1 — Quick hardenings (parallel-safe, ~3h)

| TASK | Item | Effort | Files |
|------|------|--------|-------|
| TASK-01 | D5 cooldown clock skew hardening | 1h | `packages/cli/src/hooks/cite-policy.cjs` (或所在 cooldown logic 处) + 1 unit test |
| TASK-02 | D7 fab install SKILL.md 大小预检 + auto re-install | 2h | `packages/cli/src/install/` + skills/* 大小读取 + integration test |

**Rationale**: 体积最小、风险最低、不依赖其他 wave。先 ship 拿快速反馈。

### Wave 2 — SKILL.md token 二轮 (sequential, ~6h)

| TASK | Item | Effort | Files |
|------|------|--------|-------|
| TASK-03 | D6 fabric-archive SKILL.md canonical 二轮 ~9K → <5K | 4h | `packages/cli/skills/fabric-archive/SKILL.md` + `phases/*.md` 进一步拆 + 触发 doctor skill_token_budget 重测 |
| TASK-04 | D4 fabric-review SKILL.md progressive disclosure | 2h | `packages/cli/skills/fabric-review/SKILL.md` + `phases/*.md` (复用 rc.28/rc.33 W1 拆分模式) |

**Rationale**: 两个 task 都改 skill artifact,虽然不同文件可并行,但 install pipeline 共享、token measurement 共享、易产生 measurement merge conflict — sequential 避免。

### Wave 3 — Reverse flow impl (~3h)

| TASK | Item | Effort | Files |
|------|------|--------|-------|
| TASK-05 | D2 reconcileKnowledge 反向 unarchive | 3h | `packages/server/src/knowledge/reconcile.ts` + 反向流 ledger event + unit test |

**Rationale**: 独立模块,不阻塞 Wave 1/2;放 Wave 3 是因为反向流需要先确认 Wave 2 SKILL.md 拆分后 archive skill 仍能正常引导(reconcile 反向流由 archive skill 触发)。

### Wave 4 — Design + analysis (parallel-safe, ~6h)

| TASK | Item | Effort | Output |
|------|------|--------|--------|
| TASK-06 | D1 cite-policy long-session evict (sidecar 周期注入) | 4h | `packages/cli/src/hooks/cite-policy-evict.cjs` (新) + config 字段 + integration test + 设计 memo `.workflow/scratch/rc34-cite-evict-design.md` |
| TASK-07 | D3 cohort-based 衰减评估 | 2h | `.workflow/scratch/rc34-cohort-decay-memo.md` (analysis only;决定 rc.35 是否 impl;**不改代码**) |

**Rationale**: TASK-06 是 D1 真做,TASK-07 是评估 memo。两者无共享文件可并行。

### Wave 5 — Closure

| TASK | Item | Effort | Output |
|------|------|--------|--------|
| TASK-08 | dogfood evidence + Gemini batch review + CHANGELOG draft | 2h | `.workflow/.lite-plan/rc34-deferred-cleanup-2026-05-26/dogfood-evidence.md` + `review.md` + CHANGELOG diff |

**Rationale**: 按 [[review-batching]] 末尾一次 Gemini review;rc.34 版本 bump 走 `/release-rc` skill,不在本 plan 内。

---

## 3. Per-Task Commit Convention

Per rc.20/rc.24/rc.25/rc.26/rc.33 precedent — 每 TASK 独立 commit,message 格式:

```
feat(rc34 TASK-NN): <slug> — <what + why>
fix(rc34 TASK-NN): <slug> — <what + why>
```

Wave 5 closure 含 dogfood evidence + review notes,单独 commit。版本 bump 由 `/release-rc` 单独 commit。

## 4. Gates (per task)

- `pnpm -r exec tsc --noEmit` (本地必跑,堵 [[local-tsc-vs-ci-tsc]] 复发)
- `pnpm test` (vitest 全 pass)
- `pnpm lint`
- doctor self-check: `fab doctor --json` 0 error (Wave 2 后 skill_token_budget 应从 error → ok)

## 5. Wave 5 acceptance

- ✅ 8 task 全 commit, gates 全绿
- ✅ doctor 0 error (skill_token_budget canonical ≤5K)
- ✅ fabric-archive + fabric-review installed SKILL.md ≤目标 token (TASK-02 预检通过)
- ✅ reverse-unarchive 流端到端有 1 个 integration test
- ✅ cite-policy long-session evict 跑通 demo (TASK-06 integration test)
- ✅ cohort-decay memo 给出 rc.35 推 / 不推决策
- ✅ dogfood evidence 记录:rc.34 在本仓自跑 1 轮 doctor + 触发 evict + 触发 reverse-unarchive
- ✅ Gemini review 无 P0/P1

## 6. After Wave 5 (rc.34 release flow)

不在本 plan scope,但流程参考:
1. `/release-rc` 走 bump → tag → push → CI watch
2. Release workflow 自动 publish 到 npm
3. 跑 [[test-framework-eng-plus-product]] 全维度测评 (重点 D9 设计意图→AI 行为一致度)
4. 测评数据出来后,**才**开 [[kb-candidate-pool-master]] Part A 战略挑战会话

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| TASK-03 SKILL.md 拆到 <5K 后语义信息丢失 (Goodhart) | Medium | 拆分前先跑 fabric-archive recall gate (现 85.7%), 拆后必须 ≥80%, 否则 rollback |
| TASK-05 反向 unarchive 触发条件设计错 (cohort 误判) | Medium | TASK-05 内嵌 invariant test;设 dry-run flag,默认 opt-in |
| TASK-06 sidecar evict 跟现有 hook 通道冲突 | Low | rc.33 W2 已建 stdout JSON envelope 通道,evict 复用同一通道 |
| TASK-07 cohort memo 得出"该 impl"结论但 rc.34 已无 budget | Low | memo 显式接受 "推 rc.35" 输出,不阻塞 rc.34 ship |
| W1 二轮 (TASK-03) 拆完仍 >5K | Medium | 接受 5-7K 区间, lint threshold 临时调到 7K warn / 10K error, 再 rc.35 三轮 |

## 8. Locked Decisions (2026-05-26)

- ✅ TASK-06 sidecar 周期窗口单位 = **turn-count** (最简实现);time-based / token-budget 推 rc.35
- ✅ TASK-02 install 预检失败后 auto re-install 仍超阈 = **block** (drift→abort 哲学;打印 canonical size + 提示检查 skill source)
- ✅ rc.34 cite-coverage 仍 **单窗 (7d)**;双窗 7d+30d 推 rc.35;若 TASK-08 dogfood 发现 7d 噪音太大单独 hotfix

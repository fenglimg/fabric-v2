# v2.0.0 GA Verdict — Final Consolidation (Phase 7 / C7)

**Date**: 2026-05-27
**Audit method**: P2 sequencing (paper audit + dogfood pending)
**Status of dogfood**: C-WEREWOLF task **未执行** — user 在 werewolf-minigame 验证 paper findings 后会补漏
**Verdict reliability**: HIGH for code-based items (algo / hook / skill source 已 read);MEDIUM for UX-flow items (依赖 werewolf 真跑验证)

---

## 1. Executive Summary

### 当前 Fabric v2.0.0-rc.36 状态

✅ **Ship-able 维度**:
- 35 doctor check + i18n 完成(rc.26)
- 3 Skill canonical 形态稳定(rc.33-34)
- MCP stdio path 健壮(rc.x 多次验证)
- CI / Release workflow 稳定(rc.25+ 双绿 norm)
- 1800+ test 全绿

❌ **Not-ship-able 维度**:
- **1 BLOCKER**:plan-context selectable filter 让 KB 推荐 374→7→1 funnel 几乎失效
- **1 跨 client BLOCKER**:cite policy 在 Codex/Cursor 完全无强制
- **2 用户体验高危**:doctor remediation 部分文案引导删 ledger;events.jsonl 已膨胀到 23MB
- **2 P0 实测低数据**:cite 遵循率 3.1% / archive recall 20%

**总评**:**NO-GO for v2.0.0 GA tag as-is**;需 rc.37 + rc.38 (+ 可能 rc.39) 完成核心 fix 才能 ship。

---

## 2. Finding 汇总(NEW-1 ~ NEW-35)

### 来源分布

| Phase | NEW IDs | 数量 |
|---|---|---|
| C2 算法 audit | NEW-1 ~ 8 | 8 |
| C3 Skills audit | NEW-9 ~ 15 | 7 |
| C4 Hooks audit | NEW-16 ~ 21 | 6 |
| C5 Journey audit | NEW-22 ~ 27 | 6 |
| C6 Crosscut audit | NEW-28 ~ 35 | 8 |
| **Total** | | **35** |

### 按严重度分类

| 严重度 | NEW IDs | 数量 |
|---|---|---|
| **BLOCKER** | Wave A1(已 lock)+ NEW-21 cross-client cite parity | 2 |
| **P0 (rc.37 必修)** | NEW-1, NEW-2, NEW-3, NEW-8, NEW-18, Wave A2, Wave B | 7 |
| **P1 (rc.38 强烈推荐)** | NEW-4, NEW-9, NEW-12, NEW-16, NEW-22, NEW-25, NEW-26, NEW-29, NEW-30, NEW-31 | 10 |
| **P2 (rc.39 或 v2.0.x patch)** | NEW-5, NEW-7, NEW-10, NEW-11, NEW-19, NEW-23, NEW-24, NEW-32, NEW-33 | 9 |
| **Defer v2.1** | NEW-6, NEW-13, NEW-14, NEW-15, NEW-17, NEW-20, NEW-27, NEW-28, NEW-34, NEW-35 | 10 |

> Wave A1 + A2 + B + 5 NEW-P0 = 7 个最痛项,**v2.0.0 GA 前必须 close**

---

## 3. RC iteration 节奏(推荐)

### **rc.37 — Foundation Fixes (28-35h, ~10 day)**

**主题**:删 server-side filter + cite/archive recall 救命 + events.jsonl 急救

| Wave | Task | 估时 |
|---|---|---|
| A | **A1** 删 plan-context selectable filter | 3-4h |
| A | **A2** fabric serve quarantine | 4-6h |
| A | **NEW-3** fab_recall 合并 API + TTL 5min→30min | 2-3h |
| B | **B1-B5** events.jsonl Plan B(metrics counter 化 + rotation tick + 5 hard gate)| 12-15h |
| D | **NEW-1** cite policy 4-state→2-state + PreEdit warn hook + cite-policy-evict default ON | 2-3h |
| D | **NEW-2** self-archive 4 信号→2 大类 + marker 正则容错 | 1-2h |
| D | **NEW-8** doctor remediation 70 string sweep + 删高危引导 | 3-4h |
| D | **NEW-21** Codex/Cursor cite policy 等价路径补齐(SessionStart 模拟)| 2-3h |
| F | **F3** Onboarding cliff 30min self-演 复测(验收) | 2h |
| G | bump rc.37 + tag + push + npm publish | 1h |

**ship criteria for rc.37**:
- Wave A/B 全绿
- cite 实测遵循率 ≥30% (vs 3.1% baseline)
- archive recall 实测 ≥40% (vs 20% baseline)
- events.jsonl 月增长 < 5MB 验证

### **rc.38 — Polish + Cross-client (25-32h, ~8 day)**

**主题**:用户体验闭环修复 + 跨 client parity

| Wave | Task | 估时 |
|---|---|---|
| D | **NEW-4** viability gate 8→3 + duplicate glob 强制 + force-archive 引导 | 2h |
| D | **NEW-9** fabric-archive 简化(8 phase→3 + ledger filter 服务端化) | 3-4h |
| D | **NEW-12** fabric-review mode 4→2 + semantic check 量化 + modify 拆 2 action | 3-4h |
| D | **NEW-16** fabric-hint 拆 4 子 hook + dismiss + 文案加引导 | 3-4h |
| D | **NEW-22** install 重启提示 + partial-state recovery | 1-2h |
| D | **NEW-25** doctor TL;DR top-3 critical 头部 | 1h |
| D | **NEW-26** install --diff-hooks + --force-hooks-only flag | 2-3h |
| D | **NEW-29** Cursor + Codex hook config schema 统一 | 2h |
| D | **NEW-30** stderr/stdout client-adapter 抽象 | 2-3h |
| A | **NEW-31** fab_extract_knowledge KB body sanitization | 1-2h |
| F | F1 werewolf-minigame fixture 仓 | 4-5h |
| F | F2 Cross-client parity smoke test | 3-4h |

**ship criteria for rc.38**:
- 三 client cite policy + archive recall 跨 client 一致(±10% 内)
- werewolf fixture 入仓 + CI 加载

### **rc.39 — GA Prep Final (20-26h, ~7 day)**

**主题**:工程 sweep + 文档清理 + 测试补强 + GitHub polish

| Wave | Task | 估时 |
|---|---|---|
| D | **D1** rc.x BREAKING 残留 sweep | 2-3h |
| D | **D2** knip dead exports 扫 + 清 | 1-2h |
| D | **D3** __dev / FABRIC_DEBUG audit | 1h |
| D | **D4** package.json metadata 全字段 audit | 2h |
| D | **D5** LICENSE check | 0.5h |
| D | **NEW-5** personal layer lint(quality)| 1h |
| D | **NEW-11** broad+[] mandate 重评 | 1h |
| D | **NEW-23** SessionStart 索引末尾"下一步"引导 | 0.5h |
| D | **NEW-24** layer-flip server emit knowledge_id_redirect | 1-2h |
| E | **E1-E5** 文档清理 + CHANGELOG GA + migration guide | 10-13h |
| F | **F4** uninstall + upgrade path test | 2h |
| F | **F5** Windows path smoke (CI matrix) | 2h |

**ship criteria for rc.39 → v2.0.0 GA tag**:
- 所有 P0 + P1 closed
- 三 client smoke parity test 绿
- onboarding cliff ≥30% reach goal(rc.32 baseline 5%)
- CHANGELOG + migration guide 完成
- werewolf fixture CI 跑过

### **GA tag (5-7h)**

| Wave | Task | 估时 |
|---|---|---|
| G | **G1** .github/ISSUE_TEMPLATE | 1h |
| G | **G2** CONTRIBUTING + CODE_OF_CONDUCT + SECURITY | 2h |
| G | **G3** GitHub repo polish + release.yml | 0.5h |
| G | **G4** v2.0.0 bump + tag + push + NPM publish (2FA mode) | 1-2h |

---

## 4. 推 v2.1 的项(明确 defer)

| NEW | 内容 | 推迟原因 |
|---|---|---|
| NEW-6 | slug auto-disambiguate(server 端碰撞自动后缀)| 低频 case,collision 实测罕见 |
| NEW-7 | relevance_paths multi-signal 升级 | A1 删 filter 后 relevance_paths 重要性下降 |
| NEW-13 | cross-skill 共享 lib | refactoring,非 user-facing |
| NEW-14 | events.jsonl 自动截断到 server | Wave B 已解决根因,自动截断是 nice-to-have |
| NEW-15 | skill 文案术语清理 | quality polish,非 blocker |
| NEW-17 | knowledge-hint-narrow in-memory cache | perf opt 重要但非 GA blocker |
| NEW-20 | doctor --check-hooks runtime check | quality check |
| NEW-27 | doctor drift_summary 统一 view | quality polish |
| NEW-28 | i18n key parity audit + AGENTS.md 同步 audit | rc.39 选做,可推 |
| NEW-32 | doctor --suspicious-kb injection lint | NEW-31 sanitization 已防主要 vector |
| NEW-33 | doctor history 扩展全 mode | observability 增量 |
| NEW-34 | `fabric metrics` 子命令 | Wave B metrics.jsonl 已落地,dashboard 是 v2.1 增量 |
| NEW-35 | perf benchmark CI | infra,非 GA gate |
| NEW-19 | hooks/lib state-store / config-cache 抽象 | refactoring,非 user-facing |
| NEW-10 | dry-run / state-resume 统一 explicit flag | UX polish,可推 |

**总估时 deferred**:~25-35h(v2.1 work)

---

## 5. 估时汇总

| 阶段 | h | 累计 |
|---|---|---|
| rc.37 Foundation | 28-35 | 28-35 |
| rc.38 Polish + Cross-client | 25-32 | 53-67 |
| rc.39 GA Prep Final | 20-26 | 73-93 |
| GA tag | 5-7 | 78-100 |
| **v2.0.0 ship total** | **78-100h** | |
| v2.1 deferred | 25-35 | (post-GA) |

**Real-time**:单人单线 78-100h ≈ 25-30 工作日 ≈ **3.5-4.5 周到 GA**。
**Calendar 节奏**:rc.37(10d)+ rc.38(8d)+ rc.39(7d)+ GA(1d)≈ 26 day 含 review iteration buffer。

---

## 6. Critical Path / Dependencies

```
rc.37:
  Wave A1 删 selectable filter
    ↓ depends on
  NEW-3 fab_recall 合并 API
    ↓ depends on
  NEW-21 Codex/Cursor cite parity (uses fab_recall single-step)

  Wave B events.jsonl Plan B
    ↓ B1 → B2 → B3 → B4 → B5 (strict serial)
    ↓ enables
  events 23MB → < 5MB 真实降幅验证 (rc.37 ship criteria)

  NEW-1 cite policy + NEW-2 self-archive 信号简化
    ↓ enables
  NEW-21 cross-client (cite-policy-evict equivalent path)
    ↓ enables
  cite 遵循率 + archive recall 实测复测 (rc.37 ship criteria)

  NEW-8 doctor remediation sweep
    ↓ enables (in parallel)
  NEW-25 doctor TL;DR (rc.38)
```

**Hard dependencies**:
- B1 → B2 → B3 → B4 → B5(events.jsonl 严格串行)
- A1 → NEW-3(filter 删后 API 形态变)
- A1 → NEW-7(deferred 到 v2.1)
- NEW-1 + NEW-21(cite policy 跨 client 一致性要先有 single-step API)

**Parallel-safe**:
- Wave A vs Wave B(完全并行)
- D 内多 task(NEW-1/2/8 互不依赖)
- Wave F fixture vs Wave E 文档(并行)

---

## 7. 关键 ship gates(GA 必过)

| Gate | 量化标准 |
|---|---|
| G-CITE | cite 遵循率 实测 ≥ 30%(vs rc.32 baseline 3.1%) |
| G-ARCHIVE | fabric-archive recall 实测 ≥ 40%(vs rc.32 baseline 20%) |
| G-CLIFF | onboarding 30min self-演 reach goal ≥ 30%(vs rc.32 baseline 5%) |
| G-EVENTS | events.jsonl 月增长 < 5MB(vs 当前 23MB worst case) |
| G-PARITY | 三 client(CC/Codex/Cursor)5 操作 smoke test 输出 diff < 10% |
| G-DOCTOR | doctor 35 check 在 werewolf fixture 上 exit 0(0 高危 remediation) |
| G-TYPECHECK | `pnpm -r exec tsc --noEmit` 0 错(per [[feedback-local-tsc-vs-ci-tsc]]) |
| G-TEST | 全测试套件 + werewolf fixture 加载后 100% 绿 |
| G-CHANGELOG | v2.0.0 CHANGELOG + migration guide rc → GA 完成 |
| G-NPM | 2FA mode 配置正确(per [[feedback-npm-publish-2fa]]) |

---

## 8. Wave 整合 final 视图

| Wave | 估时 final | 含 |
|---|---|---|
| A | 9-13h | A1 + A2 + NEW-3 + NEW-31 |
| B | 12-15h | B1-B5 |
| C | DONE | C1-C7 全 paper audit + werewolf dogfood pending |
| D | 30-40h | D1-D5 + NEW-1/2/4/5/8/9/11/12/16/22/23/24/25/26/29/30 |
| E | 10-13h | E1-E5 |
| F | 13-17h | F1-F5 + 跨 client parity |
| G | 5-7h | G1-G4 |
| **Total** | **78-100h** | |

---

## 9. 建议 next-step 启动

按推荐节奏,**先启动 rc.37 Wave A + Wave B**(可并行):

1. **Wave A1**(删 selectable filter)
   - Read `packages/server/src/services/get-knowledge.ts` matchRuleNodes + classifyNode
   - Read `packages/server/src/services/plan-context.ts` relevance_scope filter
   - 改为返回全候选 + description,server 仅做 set membership 校验防编造
   - 单 test + werewolf 复测 374 entry 全返
   - per [[no-server-side-kb-filter]] 决策

2. **Wave A2**(fabric serve quarantine)
   - 建 `packages/server-http-experimental/` package
   - 移 serve.ts + http.ts + serve-lock + bearer-auth
   - 删主线 references + docs/i18n/tests 清理
   - per [[fabric-serve-quarantine-not-delete]] 决策

3. **Wave B1**(events.jsonl spike + decision lock)
   - 确认 Plan B 计数器形态(`metrics.jsonl` schema 草案)
   - 与 Wave A 并行

预计 **rc.37 完成时间**:启动后 ~10 个工作日,期间产 ~7-10 commit。

---

## 10. 关键决策已 lock(KB)

| Decision | Slug |
|---|---|
| KB recall 不做 server 端 selectable 算法 | [[no-server-side-kb-filter]] |
| fabric serve quarantine 不删除 | [[fabric-serve-quarantine-not-delete]] |
| v2.0.0 GA closure 6-wave plan + P2 sequencing | [[v2-ga-closure-6-wave-plan]] |

后续 implementation 期间新决策仍走 fabric-archive。

---

## 11. Audit 自评 + 收尾

**Audit 覆盖度**:
- ✅ Phase 1 inventory 9 大 surface
- ✅ Phase 4 9 算法/policy
- ✅ Phase 2 3 skills
- ✅ Phase 3 4 hooks
- ✅ Phase 5 8 阶段旅程
- ✅ Phase 6 5 横切
- ⏳ Phase 6.5 cross-client parity(部分 spot check,深度待 werewolf 验)

**未覆盖 / 待 dogfood 补漏**:
- werewolf-minigame 真跑 Phase 2/3/5(C-WEREWOLF task)
- 真人 onboarding 30min self-演 复测(F3,验证 Reach goal ≥30%)
- packaging metadata 真审(D4 待跑)
- LICENSE 文件 audit(D5 待跑)

**最终 verdict**:**NEEDS-7-WAVE**(3 RC iteration 抵 GA)
- 1 BLOCKER 已 lock
- 35 NEW 已分级
- v2.0.0 GA scope **78-100h**
- v2.1 deferred **25-35h**

---

## 12. user 决策点

1. ✅ **执行 rc.37 Wave A + Wave B 启动**(并行)— 我可以立即开始 Wave A1 实施
2. ⏳ **werewolf-minigame dogfood**(C-WEREWOLF)— 你抽时间在 werewolf 跑实际 session,验证 paper findings 是否对齐;dogfood 后可能新增 NEW-36+ 或调整严重度
3. ⏳ **rc.37 ship criteria 中"实测复测"** — cite 遵循率 / archive recall / events 膨胀 需在 rc.37 ship 前重测

你想立即启动 Wave A1 实施,还是先 dogfood werewolf,或者先 review 本 GA-VERDICT 调整 scope?

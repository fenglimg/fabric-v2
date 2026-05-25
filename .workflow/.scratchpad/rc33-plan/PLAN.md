# rc.33 Extended Plan — P0 + P1 + P2 全套

> **Sizing**: Extended Full — rc.32-eval 所有 P0/P1/P2 + deferred 项一次 ship 完成, **不 timebox, 不推后任何项目**
> **Boundary**: Real release rc — bump 到 v2.0.0-rc.33, 触发 NPM publish
> **Audit source**: [eval/rc32-cc-desktop-baseline branch EVAL-REPORT.md](../../../.workflow/.scratchpad/rc32-eval/EVAL-REPORT.md)
> **Agent budget**: **总 1 个 spawn** (W1 末尾 cross-LLM 验证); 其余全主线串行

## 设计原则

按 [memory feedback_low_agent_spawn_cost](../../../../../.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/feedback_low_agent_spawn_cost.md):

- ✅ 主线 Read/Edit/Write/Bash 串行做所有 工程任务
- ✅ Agent 只在 **真需要独立 context** 时用 (本 plan: W1 末尾跑 gemini 验证 description recall 提升)
- ❌ 不 spawn Agent 跑"3 个并行 file edit", 主线 1-by-1 更快
- ❌ 不 spawn Agent 跑 grep/explore — Bash 直接做

## Branch 策略

```
main (rc.31 committed)
 ├─ eval/rc32-cc-desktop-baseline (audit artifact, 不 merge 进 main)
 └─ rc33/extended-bundle  ←  本 plan 工作 branch (从 main 分)
```

rc.32 eval artifact 留在独立 branch (作为 audit history); rc.33 fixes 走 main → rc33/extended-bundle → push + tag → NPM publish。

## Wave 划分

| Wave | 主题 | 任务数 | Agent | 时长 |
|---|---|---:|---:|---:|
| W1 | Skill artifact 重构 (description + token + phase) | 11 | 1 | 12-14h |
| W2 | Hook 策略 + Reminder 通道 | 6 | 0 | 14-16h |
| W3 | Doctor Remediation + Lint 强化 | 7 | 0 | 10-12h |
| W4 | P2 全面打磨 (含 deferred 全做) | ~15 | 0 | 18-22h |
| W5 | Release Pipeline + werewolf 验证 | 5 | 0 | 4-5h |
| **总计** | | **~44** | **1** | **58-72h** |

---

## Wave 1 — Skill Artifact 重构 (12-14h)

**主题**: 一次性把 SKILL.md token 超标 + description 失准 + phase 编号矛盾 + dead code 全清。所有改动集中在 `packages/cli/templates/skills/` 子树, 主线串行最优。

| Order | Task ID | 内容 | Files | 时长 |
|---:|---|---|---|---:|
| 1 | P0-1 | fabric-archive description rewrite (recall > 80%, 中英 trigger 双覆盖, < 60 token) | fabric-archive/SKILL.md frontmatter | 1h |
| 2 | P0-4 | fabric-archive h2 "执行流程 (6 Phase)" → 真实 phase count 或 collapse | fabric-archive/SKILL.md | 30min |
| 3 | P0-5 | Phase 编号 (-0.5 / 0.0 / 0.4 / 0.5 / 0.6 / 0 / 1 / 1.5 / 2 / 2.5) → numerical-aligned (0/0.5/1/1.5/2/...) | fabric-archive/SKILL.md | 1h |
| 4 | P1-10 | Remove dead code branch at SKILL.md:445 (Codex T8 发现) | fabric-archive/SKILL.md | 5min |
| 5 | P1-11 | LLM-as-parser ambiguity 加 explicit decision rule | fabric-archive/SKILL.md Phase -0.5 段 | 1.5h |
| 6 | P1-12 | Dry-run scope 段统一 (列出哪些 write 在 dry-run 跳过) | fabric-archive/SKILL.md 末尾段 | 45min |
| 7 | P0-2 | fabric-archive SKILL.md 拆分 progressive disclosure → < 3K token; 把 ref/ 已有的内容下沉 | fabric-archive/SKILL.md + ref/*.md | 4h |
| 8 | P0-3 | fabric-import SKILL.md 同上 → < 3K token | fabric-import/SKILL.md + ref/*.md | 3h |
| 9 | P0-10 | 三 skill description 全部 < 60 token + 中英双语 trigger | 3 个 SKILL.md frontmatter | 1h |
| 10 | P1-1 | fabric-review desc 加 ".fabric/knowledge/pending/" 限定避免 PR review 误命中 | fabric-review/SKILL.md | 30min |
| 11 | P1-2 | fabric-import desc 加排除条款 "(not for code/data import)" | fabric-import/SKILL.md | 30min |
| **V** | **Verify** | **maestro delegate gemini**: 跑 T7 20 场景测试集, 验证 fabric-archive recall > 80%, 其他 skill F1 > 85%; 实证 description 改动有效 | (主线 inline 准备 prompt + 接收 callback 整合) | 30min + delegate 等待 |

**关键依赖**: 7-8 (SKILL.md 拆分) 跑前先做 1-6 (清理矛盾 / dead code), 否则拆分会把矛盾内容也搬进 ref/。
**Agent**: 1 (W1 末尾 gemini delegate, 跨 LLM 验证)
**Verify gate**: gemini 报告 fabric-archive recall 提升 ≥ 60 个百分点 (从 20% → 80%+); 否则 description 需 iterate

---

## Wave 2 — Hook 策略 + Reminder 通道 (14-16h)

**主题**: 修体验链路核心断点 — cite 政策遵循率 3.1% 的根因。Hook + plan-context 改动, 主线 Edit + Bash 跑脚本测试。

| Order | Task ID | 内容 | Files | 时长 |
|---:|---|---|---|---:|
| 1 | P0-9 | broad/narrow 加 TopK limit (default broad=8, narrow=5) + 配置项 | knowledge-hint-{broad,narrow}.cjs + fabric-config schema | 2h |
| 2 | P0-9 | broad/narrow 加 per-file dedup window (同 file 5 turn 内不重发) | knowledge-hint-narrow.cjs (引入 sidecar state) | 2h |
| 3 | P1-6 | recency boost: 创建 < 7d entries 排前 | packages/server/src/services/get-knowledge.ts | 2h |
| 4 | P1-7 | path-locality scoring (same dir > same package > same repo) | get-knowledge.ts + relevance match | 4h |
| 5 | P1-8 | broad/narrow 支持 cooldown_hours (同 fabric-hint pattern) | knowledge-hint-{broad,narrow}.cjs | 1.5h |
| 6 | P0-7 + P0-8 | hook reminder 直接进 user-facing context (而非 stderr) + bootstrap 短-reminder PreToolUse 注入 | knowledge-hint-narrow.cjs stdout JSON 协议改 + fabric-hint.cjs | 4h |
| **V** | **Verify** | 在 werewolf 上 snapshot → 装 rc.33 dist → 跑 5 个真实 Edit 命令 → 看 hook stdout 是否含 KB cite reminder → restore werewolf | werewolf snapshot/restore script | 1h |

**Agent**: 0  
**Verify gate**: PreToolUse 触发后 stdout JSON 含 `reminder: "Before editing, check KB: ..."` 字符串; 至少 1 个 case 推送了 top-3 narrow entries; 否则 reminder 通道仍断

---

## Wave 3 — Doctor Remediation + Lint 强化 (10-12h)

**主题**: doctor 文案 + 新 lint。i18n + doctor.ts edits, 全主线。

| Order | Task ID | 内容 | Files | 时长 |
|---:|---|---|---|---:|
| 1 | P0-6 | event_ledger.invalid / schema_compat remediation 改 archive-history 模式 (不直删) | i18n zh-CN.ts + en.ts | 30min |
| 2 | P1-9 | 5 条模糊 remediation 改具体 (T6 §3 列出的 5 条) | i18n zh-CN.ts + en.ts | 1.5h |
| 3 | P1-3 | doctor 加 G1/G2/G3/G5 Goodhart 检测 (仪式化 cite / 抄底引用 / chained-from 滥用 / placeholder cite) | doctor.ts inspectCiteGoodhart + check function | 4h |
| 4 | P1-4 | orphan_demote 阈值加 use-signal 因子 (knowledge_sections_fetched 计数) | doctor.ts orphan_demote inspect | 3h |
| 5 | P1-5 | pending_overdue 从 info 改 warning | doctor.ts + i18n | 30min |
| 6 | P1-13 | doctor 新增 skill_token_budget lint (> 5K warn, > 10K error) | doctor.ts inspect + i18n | 1h |
| 7 | P1-14 | doctor 新增 skill_description_trigger_test lint (从内置 20 场景测试, recall < 70% warn) | doctor.ts + 静态测试集 fixture | 4h |
| **V** | **Verify** | 在 werewolf 跑 `fab doctor --json`; 验证 7 个新/改 check 全出现; G1-G5 在 werewolf 18K turn 中 fire 至少 1 个 (因为 cite-coverage=0); skill_token_budget 不应 fire (W1 已修); skill_description_trigger_test 不应 fire (W1 修了) | 主线 Bash | 30min |

**Agent**: 0  
**Verify gate**: 7 个 lint 都在 fab doctor 输出里, snapshot 配套 i18n test pass

---

## Wave 4 — P2 全面打磨 (18-22h)

**主题**: 各 T 报告末尾 P2 集合 + 所有 deferred 项目 (反向 unarchive / cohort 衰减) 全做; 不 timebox, 全部完成才进 W5。

| Order | 来源 | 任务 | Files | 时长 |
|---:|---|---|---|---:|
| 1 | T6 P2 | 删除 (rc.4 TASK-003) / (rc.N TASK-N) 等内部追溯注释 (5 条) | i18n zh-CN.ts + en.ts | 30min |
| 2 | T6 P2 | `fabric install` → `fab install` 统一 (1 处 outlier) | i18n | 5min |
| 3 | T6 P2 | doctor 加 --dry-run mode + remediation 文案加 reversibility 说明 | doctor.ts cli args + dryRun branch in runDoctorFix + i18n | 4h |
| 4 | T2 P2 | fabric-review SKILL.md 也走 progressive disclosure (虽然 7.5K 不 critical, 但保持三 skill 风格一致) | fabric-review/SKILL.md | 2.5h |
| 5 | T3 P2 | cite-policy long-session evict 抓取 (周期性 system reminder 注入) | fabric-hint.cjs + 新 sidecar | 4h |
| 6 | T4 P2 | SUMMARY_MAX_LEN (80) 改为 config 可调 | knowledge-hint-{broad,narrow}.cjs + fabric-config | 30min |
| 7 | T5 P2 | "draft 堆积" 检测 (draft > 50% of total) → warning | doctor.ts | 1h |
| 8 | T5 P2 | "反向 unarchive" 机制 (archived KB git pattern 复活时考虑 unarchive) | doctor.ts + reconcileKnowledge | 4-6h |
| 9 | T5 P2 | cohort-based 衰减评估 (init-scan 整批一起评估) | doctor.ts | 3-5h |
| 10 | T5 P2 | 衰减阈值改 fabric-config 可调 (取代 hard-code) | knowledge config schema + doctor consumes | 2h |
| 11 | T7 P2 | 文档加 "如何写好 description trigger" guide (中英 trigger / 排除条款 / 长度) | docs/skill-design.md (新建) | 1h |
| 12 | T8 P2 | 跑 T8 测评在 fabric-review / fabric-import 上 (跨 LLM 概括对比) | 主线运行已有 maestro delegate template | 1h |
| **V** | **Verify** | 全部 12 项做完 + typecheck + lint + tests pass | 主线 Bash | 30min |

**Agent**: 0 (T8 P2 复用 W1 末尾 gemini delegate template, 主线 sync 跑;不 spawn 新 Agent)  
**Verify gate**: 全部 12 项 P2 改动 + typecheck 0 / lint 0 / 全测试通过

---

## Wave 5 — Release Pipeline + werewolf 验证 (4-5h)

| Order | Task | 命令 |
|---:|---|---|
| 1 | 集成 typecheck | `pnpm -r exec tsc --noEmit` |
| 2 | Lint | `pnpm lint` |
| 3 | Full test suite | `pnpm test` (期望 1693 + 新增 ~15 个测 = ~1708 全过) |
| 4 | werewolf 实测对比 | snapshot.sh → 装 rc.33 dist (overlay global) → fab doctor 看是否 status=ok 且新 lint 生效 → fab plan-context-hint --all 看 selectable count → 抽 1-2 个 Edit 操作真跑看 hook reminder 注入 → restore.sh |
| 5 | EVAL re-baseline | python 重跑 T2/T3 metric, 写入 .workflow/.scratchpad/rc33-eval/REGRESSION.md, 跟 rc.30 baseline 对比 |
| 6 | Bump version | `perl -i -pe 's/2\.0\.0-rc\.32/2.0.0-rc.33/g' package.json packages/*/package.json` (注意是从 rc.31 主线 base, root version 还是 rc.30, 实际是从 rc.30 → rc.33 跳一版, 因 rc.32 不 bump) |
| 7 | Commit + tag | git commit (HEREDOC 中文 commit msg) + git tag v2.0.0-rc.33 |
| 8 | 等用户确认 push | 不自动 push; user 确认后 `git push origin main v2.0.0-rc.33` 触发 release.yml |

**Agent**: 0  
**Verify gate (release blocker)**: typecheck 0 + lint 0 + tests all pass + werewolf doctor status ≤ warn + plan-context-hint 不再 0 entries + 至少 1 个 PreToolUse cycle 推送了 KB reminder

---

## 关键依赖图 (顺序约束)

```
W1 (skill artifact)
  ├─ 内部: 1-6 (清理) → 7-8 (拆分) → 9 (description) → 10-11 (其他 desc)
  └─ Verify gate ✓
       ↓
W2 (hook 策略)  ←  W1 必须先 (拆分后的 SKILL.md 决定 hook reminder 传什么)
  ├─ 内部: 1-2 (TopK + dedup) → 3-4 (排序) → 5 (cooldown) → 6 (reminder 通道)
  └─ Verify gate ✓
       ↓
W3 (doctor lint)  ←  W1 + W2 完成后 (新 lint 依赖 skill 已改 + hook reminder 通道已通)
  └─ Verify gate ✓
       ↓
W4 (P2 全面打磨)  ←  W3 后 (P2 文案改动易被 W3 i18n 重写覆盖)
  └─ Verify gate ✓
       ↓
W5 (release)  ←  W4 全过 + 最终 werewolf 测
```

不可并行 — wave 之间有强 dependency, 顺序串行最稳。

---

## 风险点

| 风险 | 影响 | 缓解 |
|---|---|---|
| W1 SKILL.md 拆分破坏现有 phase 行为 | hooks 调用错误 / archive 流程坏 | 拆分后跑 W5 werewolf 实测; 必要时 W1 末尾加 sync verify (在 werewolf snapshot 上做 dry-run archive) |
| W2 hook reminder 注入打扰 AI 工作流 | 用户嫌噪音 → 关 hook | 默认 TopK=5 narrow / 8 broad, 加 cooldown 控制频率 |
| W3 G1-G5 Goodhart 误报 | doctor 一直 warn 用户烦 | warn 不阻断 (status=warn 而非 error); 用 default config 7d 累积窗口 |
| W4 deferred 项目 8/9 工作量超估 | wave 拖到 ~25h | 全做完才进 W5; 不 cutoff. 真超太多 (>25h) 时 W4 单独 review 看是否设计有问题, 调整后继续 |
| W5 werewolf 真实跑出新问题 | rc.33 ship 后还有 bug | 接受 rc.34 cycle 修; rc.33 不追求 zero bug, 追求 cite-coverage 从 3.1% 起来 |
| local tsc 通过 CI tsc fail (rc.21/24/29 复发) | typecheck-gate 卡 release | W5 强制跑 `pnpm -r exec tsc --noEmit` 而非只 build |

---

## Agent spawn 清单 (总 = 1)

| Wave | Where | Why | Cost |
|---|---|---|---|
| W1 | Verify gate | maestro delegate gemini 跑跨 LLM 验证 description recall 提升 (≥60 pct 增量); 这是真"独立 context" 需求 (gemini 不带 main session 偏见) | ~5K token + 2-3 min |
| W2-W5 | — | 主线 Bash + Edit + Write 全覆盖 | 0 |

**注意**: W4-12 "跑 T8 测评在 fabric-review/import 上" 复用 W1 的 maestro delegate template, sync 跑 2 次 (gemini + codex), 不算新 spawn (仍是同种独立 LLM 协作 pattern, 工具复用)。

---

## 时间预估 (区间, 不卡 deadline)

- 主线工作: 54-65h (W1-W4 全做, 含 deferred)
- Release pipeline: 4-5h (W5)
- Buffer (debug + unexpected): 5-8h
- **总计**: 63-78h
- **不 timebox** — 所有 P0/P1/P2 + deferred 项必须完成才 ship rc.33; 时间长一点没关系, 不漏项

---

## Wave 内的 task tracking

每 wave 用 TaskCreate 一次 batch 创建 (1 message 创建该 wave 所有 task), 主线推进时 TaskUpdate 单个 in_progress → completed。

W1 跑前不 spawn 任何 explore agent — 主线 Read SKILL.md / Read description 字段, 直接 Edit。

---

## 启动 protocol

1. checkout main, `git checkout -b rc33/extended-bundle`
2. 把当前 rc.33 plan 这个文件夹移到新 branch (cp -R)
3. TaskCreate 一次创 W1 的 11+1 个 task
4. 开始 W1 task 1: fabric-archive description rewrite
5. ...

---

## 启动 checkpoint (开干前最后确认)

要不要现在开干 W1, 还是先 spawn 1 个 review agent 看 plan 还有没漏 (这就是 Agent 真正该用的场景 — 独立 context review plan, vs 主线偏见)?

我推荐直接开干 — plan 已经基于 EVAL-REPORT 顺序映射, 不需要 review。Spawn review agent 反而违反 low-agent 原则。

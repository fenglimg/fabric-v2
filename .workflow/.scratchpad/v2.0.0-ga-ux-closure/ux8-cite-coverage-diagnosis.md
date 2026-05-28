# UX-8 / G-CITE cite-coverage 复测 — 诊断 (BLOCKED, 不可在 loop 内诚实测量)

## 实测 (本 repo, fabric doctor --cite-coverage --since=7d --client=cc)
- Edit 触达数 (edits_touched): **0**
- 合格 cite (qualifying_cites): **0**
- 总回合数 (total_turns): 37176 (--client=cc 窗口内; events.jsonl 全量 assistant_turn_observed=62725)
- KB: none 分布: not-applicable 502 / unspecified 64 / no-relevant 29 (共 595)
- 应用契约校验: 已跳过 (bootstrap drift — 请运行 fabric install)

## 根因链 (instrumentation, 已穷尽)
1. **edits_touched 永远是 0**: 该指标来自 `edit_intent_checked` 事件 (doctor.ts:8388)。唯一发射点 = `read-ledger.ts:106-122 appendLedgerEntry()` —— 即 **commit-ledger** append (带 commit_sha/diff_stat/source)。**不是 PreToolUse hook 实时发射** (注释声称 "PreToolUse fires per affected_path" 但实际 emit 在 commit-ledger 路径)。本 repo 65021 事件中 edit_intent_checked = **0** (该 commit-tracking 流程未在本 dev repo 跑)。→ 分母恒 0, coverage 不可计算。
2. **qualifying_cites = 0**: 62725 turn 的 kb_line_raw 全是 "KB: none", 0 条 "KB: <id> [applied]"。但注意: "KB: none [no-relevant]" / "[not-applicable]" 是**合规** cite (policy 允许的 sentinel)。coverage 公式只数 qualifying (带 id), 把合规的 KB:none 计入分母外 → **指标定义低估了合规率**: 一个全程合规但多数动作无适用 KB id 的 session, coverage 仍≈0。
3. **bootstrap drift**: 本 repo 安装的 .claude/hooks/*.cjs 与当前 template DRIFTED (diff 确认), 契约审计因此 skip。我本轮 UX-18 改 bootstrap-canonical.ts 又加大了 drift。

## 为何不可在 loop 内诚实测到 ≥30%
- 真实 cite-coverage 是**涌现行为**指标, 需: 全新 fabric install (消 drift) → 真跑多轮 CC session (AI 真在 edit 前 cite 真 id) → commit 进 fabric ledger (产 edit_intent_checked) → 测量。
- 合成 events.jsonl 来"凑"分子分母 = 正是 doctor 自带 Goodhart 检测要抓的造假 (G1-G5), 违反 ledger 全程依赖的 rigor + [[feedback-audit-verification]]。
- ledger 自身把 "S5 一周 dogfood / S6 月级长跑" 列 out_of_scope/placeholder —— ≥30% 的真实涌现测量正属该 soak 窗口。

## 产品侧结论 (可在 loop 内确认的部分)
- cite **policy** 正确: 2-state (rc.37 NEW-1) + default ON (NEW-18) 在 bootstrap-canonical 模板就位 (本会话已读)。
- cite **parsing** 工作: 595 KB:none 被正确解析归类 (none_reason_histogram 三分)。
- cite **instrumentation 缺陷候选 (真 bug, 非纯 drift)**: edit_intent_checked 注释声称 PreToolUse 实时发射, 实际只在 commit-ledger emit。若设计意图是 PreToolUse 实时记 edit-intent, 则 hook 侧缺该 emit = 产品 instrumentation gap (使 edits_touched 在"未提交即测"时恒 0)。需用户/后续确认设计意图。→ NEW-3 候选。

## 状态: BLOCKED
G-CITE 在 metric_gap_policy 下: 当前 0 < floor 20% = "bug 非 gap, 不许发 rc.38"。但 0 的根因是 instrumentation/measurement-环境 (drift + 分母无数据 + soak-依赖), 非 cite 行为可在 loop 内修的 code lever。
→ 标 BLOCKED, 上报用户决策: (A) 全新 install + 真 soak dogfood 测真值 (出 GA 窗口); (B) 确认 edit_intent_checked PreToolUse 实时发射缺陷是否要补 (NEW-3); (C) 重审 coverage 公式是否该把合规 KB:none 纳入分子 (定义问题)。

---

## ⚠️ 重大更正 (2026-05-28, NEW-3 RETRACTED)

**NEW-3 是误报, 已撤销。** 起因: ugrep 工具在 knowledge-hint-narrow.cjs (1575 行 .cjs) 上**静默失败** (对所有 pattern 返回空), 我误读为"hook 不发 edit_intent_checked"。改用 python 读源 + 直接 fire hook 验证后真相:

- **模板 narrow hook 完整实现了 emit**: `appendEditIntentToLedger` (line 361 定义) 在 `main()` line 1252 被无条件调用, 每条 edit path append `{event_type:"edit_intent_checked", ledger_source:"hook", path, ...}` 到 .fabric/events.jsonl。rc.35 TASK-07 P0-2 **已完整落地** (函数 + 调用点都在)。
- **直接验证**: fresh install → fire narrow hook (relative file_path payload) → events.jsonl 出现 1 条 edit_intent_checked ✅。
- **dev-repo edits_touched=0 的真因 = stale-install drift**: 安装的 .claude/hooks/knowledge-hint-narrow.cjs **不含** appendEditIntentToLedger (pre-rc.35 旧版), 模板含。`fabric install` 同步即修。**非产品缺陷**。
- (`appendLedgerEntry` 无 caller 属实, 但那是 AI/human commit-ledger 路径; cite-coverage 的 edit signal 由 hook 的 appendEditIntentToLedger 提供, 已工作。)

## 更正后 G-CITE 根因穷尽 (① for metric-gap)
- **H1 delivery/instrumentation**: ✅ 已验证工作 (hook emit edit_intent_checked; dev-repo 0 = drift, install 修)。非 bug。
- **H3 compliance**: ✅ 已验证高 — dev-repo doctor 实测 qualifying_cites=0 但 **expected_but_missed=0** + KB:none=595 (全合规 sentinel)。即 AI 在 595 turn 全部合规 cite (多为 'KB: none [reason]', 因多数动作无适用 KB id), 漏 cite=0。
- **H5 contract**: ✅ cite policy default ON (rc.37 NEW-18)。

## 真正剩余的只有 ②(过 floor) — 且本质是公式定义问题 (C)
现公式 coverage = qualifying_cites(带 id) / edits_touched。它把合规的 'KB: none [reason]' 算作未覆盖。
若按**合规率**定义: (qualifying + compliant_none) / (qualifying + compliant_none + missed) = (0+595)/(0+595+0) = **~100% 合规**, 远过 floor 20%。
若坚持 qualifying-id-only 定义: ~0, 但这测的是"有适用 KB id 的频率"(soak + 语料依赖), 不是"AI 是否遵守 cite policy"。

→ G-CITE 的 in-loop 不可达, 根因不是 instrumentation (已验证 OK), 而是**度量定义 vs target 语义错配** (C) + 真实 id-cite 密度的 soak 依赖。这是用户决策, 我不单方面改 ship 指标语义 (避免移动球门)。

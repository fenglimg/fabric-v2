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

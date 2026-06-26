# W3-J Refactor — reflection log

> 配置表裁剪。分支 `feat/w3j-config-prune`。**真实 delta = 删 1 个死字段**(census 大面积过时)。

## GATE 2 决策(用户确认 2026-06-24)
- census 想「config 43→18 大瘦身」,但 grep 实证**绝大部分早被 ux-w1-5/w2-3/W2-1 做光**(reverse_unarchive_*/import_*/archive_max_*/cite_evict_interval/hint_broad_budget_chars 全已删)。
- "const-ify plan_context_top_k/orphan_demote_*"、"6 旋钮并入 nudge_mode"、"review age_days vs stale_days 双定义" —— 经核全是**行为变更 / 违背既有 KT-DEC / census 误读**,不做。
- 用户选「只做安全字段清理」→ 再 discovery 收敛到**仅 1 字段**。

## ⚠️ 关键事故 + round-trip oracle 抓回(本波最大教训)
- 初判「4 字段全 inert(n=0)」用本机 Bash `grep` 普查 → **3 个 narrow 字段假阴性**。本机 `grep`=**ugrep**,对 `templates/hooks/knowledge-hint-narrow.cjs` 静默漏报(node `includes` 确认字符串在 code 行 929/940/951)。
- 差点删掉 `hint_narrow_top_k`/`_dedup_window_turns`/`_cooldown_hours` —— 它们被 narrow hook 的 readNarrowTopK/DedupWindow/CooldownHours **活跃读取**(读 raw JSON)。删了会成「schema 无定义、hook 偷读 raw」的幽灵旋钮。
- **`fabric audit retired` 的 producer-consumer round-trip oracle 抓回**:扫真消费面(Node `line.includes`,可信),flag 出 narrow.cjs 仍引用这 3 个。[[feedback_producer_consumer_roundtrip_oracle]] 实证再现。
- 已存 memory `feedback_bash_grep_ugrep_unreliable`:correctness-critical 普查改用 Grep 工具/node;删字段前跑 audit retired 兜底。

## 终态(更正后)
- **删 1 字段**:`hint_broad_top_k`(W2-1 retired hard cap,只剩退役注释,broad hook 不读;node 确认 broad.cjs 唯一引用是 COMMENT)。
- **保留 3 narrow 字段**(活跃 knob)+ `hint_broad_cooldown_hours`(sibling,n=1 wired)。
- RETIRED_TOKENS 加 1(`hint_broad_top_k`,replacement null);schema 留退役注释;lenient parser drop 旧值(零迁移)。
- 测试:钉「drops hint_broad_top_k」+「keeps 3 narrow knobs(read by narrow.cjs)」双向断言。

## 验证(全绿)
- tsc -r;shared fabric-config 35✓;round-trip oracle `[ok] no retired references, scanned 116`。
- 4 CI gate 待 commit 前复核。

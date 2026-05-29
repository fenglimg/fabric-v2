---
type: decisions
maturity: draft
layer: team
created_at: 2026-05-29T05:16:51.668Z
source_sessions: ["3ac70b48-e00f-404b-95cd-00d87ddd404f"]
proposed_reason: decision-confirmation
summary: "用户关心 events.jsonl 太大(29MB/73102 行,96.7% assistant_turn_observed),目的是别让它无界膨胀。查实推翻旧 Plan B 前提:assistant_turn_observed 不是纯心跳 metric,它携带 per-turn cite 审计载荷(cite_ids/cite_tags/cite_commitments/turn_id/client),cite-coverage lint 逐条读它算合规率,简单 counter 化日 rollup 会摧毁 cite-coverage。rc.37 Wave B 已落 rotation-tick + G7-G11 gate + metrics counter 基建,且故意把 assistant_turn_observed 当 audit 保留。rc.39 锁 cite-audit rollup:超 cite 窗的 turn 滚日合规计数挂进已有 runDoctorHistoryAll + 物删 raw + 一次性 migrate。"
tags: ["events-jsonl", "cite-audit", "metrics", "telemetry"]
relevance_scope: broad
tech_stack: ["typescript", "nodejs"]
impact: ["误将 assistant_turn_observed counter 化会摧毁 cite-coverage 合规率度量", "events.jsonl 不控会随重度 dogfood 无界膨胀"]
must_read_if: "决定某个 events.jsonl event_type 能否 counter 化进 metrics.jsonl 时"
x-fabric-idempotency-key: sha256:0ac919710da1d406703de48b7b286ce11e82986f42cb74db357d16293e0cce86
---

## Summary

用户关心 events.jsonl 太大(29MB/73102 行,96.7% assistant_turn_observed),目的是别让它无界膨胀。查实推翻旧 Plan B 前提:assistant_turn_observed 不是纯心跳 metric,它携带 per-turn cite 审计载荷(cite_ids/cite_tags/cite_commitments/turn_id/client),cite-coverage lint 逐条读它算合规率,简单 counter 化日 rollup 会摧毁 cite-coverage。rc.37 Wave B 已落 rotation-tick + G7-G11 gate + metrics counter 基建,且故意把 assistant_turn_observed 当 audit 保留。rc.39 锁 cite-audit rollup:超 cite 窗的 turn 滚日合规计数挂进已有 runDoctorHistoryAll + 物删 raw + 一次性 migrate。

## Why proposed

decision-confirmation — ≥2 候选方案经权衡后确认选型，需保留 rationale。

## Session context

Session goal: grill-me 评 rc.39 范围, events.jsonl 膨胀候选。Turning point: 发现 assistant_turn_observed 携带 cite 审计载荷, 是 audit 事件不是 metric, 推翻 memory Plan B "counter 化心跳" 的前提。Result: rc.39 锁 cite-audit rollup (保 cite 长程趋势 + 封顶体积), 而非 counter 化; 成功判据 = events.jsonl 不再无界膨胀。

## Evidence

Recent paths:

- packages/server/src/services/doctor.ts
- packages/server/src/services/metrics.ts
- packages/server/src/services/event-ledger.ts
- packages/server/src/services/events-jsonl-gates.ts

Notes:

- 用户关心 events.jsonl 太大(29MB/73102 行,96.7% assistant_turn_observed),目的是别让它无界膨胀。查实推翻旧 Plan B 前提:assistant_turn_observed 不是纯心跳 metric,它携带 per-turn cite 审计载荷(cite_ids/cite_tags/cite_commitments/turn_id/client),cite-coverage lint 逐条读它算合规率,简单 counter 化日 rollup 会摧毁 cite-coverage。rc.37 Wave B 已落 rotation-tick + G7-G11 gate + metrics counter 基建,且故意把 assistant_turn_observed 当 audit 保留。rc.39 锁 cite-audit rollup:超 cite 窗的 turn 滚日合规计数挂进已有 runDoctorHistoryAll + 物删 raw + 一次性 migrate。

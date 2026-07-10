# B1 Spike — events.jsonl 膨胀根因 + Plan B 决策 lock

**Status**: spike done, decision locked  
**Date**: 2026-05-27 (Wave B1)  
**Prior context**: KB [[events-jsonl-bloat-rc36]] (rc.36 memory), GA-VERDICT §1 现象 + §3 rc.37 Wave B 路线

## 1. 现状量化 (werewolf-minigame dogfood baseline)

- events.jsonl 大小: **23 MB** worst case (rc.32 audit Batch 3 实测)
- 行数 (含 corrupted): 估算 50k+ entries (大部分 high-frequency event_type)
- 增长曲线: ~5 MB / 月 实测 (rc.30 → rc.36 baseline)
- 占主导 event_type (按出现频次推断):
  - `knowledge_consumed` — 每次 fab_get_knowledge_sections fetch 每个 stable_id 一条 (典型 session 数十条)
  - `edit_intent_checked` — 每次 PreToolUse hook fire (典型 session 数十到数百条)
  - `knowledge_context_planned` — 每次 fab_plan_context 一条
  - `knowledge_sections_fetched` — 同 knowledge_consumed batch 维度

## 2. 根因分析

事件账本被当成了 metric 通道:
- 上面 4 个 event_type 实际是 metric 性质 (计数 / 频率), 不是 audit-relevant 状态转移
- audit-relevant 状态转移 (knowledge_proposed / knowledge_promoted / knowledge_layer_changed / knowledge_id_redirect / knowledge_demoted / ...) 才该长期留在 jsonl
- 当前架构把两者都 append 到同一文件 → metric 噪音淹没 audit signal

KB memory [[events-jsonl-bloat-rc36]] 已锁:  
> 根因 = 心跳被当事件存 (metric/event 错配); rc.36 锁 Plan B counter 化 (心跳 → metrics.jsonl 日 rollup), 取代早期 Plan A 拆文件方案; 顺手补 server-side 时间触发 rotation

## 3. 候选方案对比 (recap)

| 方案 | 描述 | 优 | 劣 | 选 |
|---|---|---|---|---|
| Plan A | events.jsonl 按 event_type 拆多文件 | 单文件不再膨胀 | 复杂度 N×; 跨文件 audit 复杂; 不解决根因 | ❌ |
| **Plan B** | metric 性质 event → metrics.jsonl 计数 + 日 rollup, audit event 留 jsonl | 解决根因; 单一职责; 文件大小可预测 | 新写一套 counter API + flush + rollup | ✅ |
| Plan C | 全部 events 截断到 30d | 简单 | 丢历史 audit; 不解决再生; 治标 | ❌ |

## 4. 决策 lock (B1 output)

**方案选定**: Plan B (counter 化 + metrics.jsonl 日 rollup)

**新文件**: `.fabric/metrics.jsonl`  
**新数据格式**: 每行 `{ timestamp_iso, window: "1m" | "1h" | "1d", counters: { event_type: count, ... } }`  
**heartbeat clean-slate**: 已存在的 high-frequency event_type (knowledge_consumed / edit_intent_checked / knowledge_context_planned / knowledge_sections_fetched) 不再写 jsonl, 改 bumpCounter 写 metrics in-memory aggregate; 60s flush 一行到 metrics.jsonl  
**server-side rotation**: jsonl 超 N MB 或 N 天自动 rotate 到 .fabric/events.archive/  
**hard gate**: 5 个新 doctor check (G7-G11) 防再生:
- G7 events_jsonl_size: 警告 > 10 MB
- G8 metric_event_in_jsonl: 检测 high-frequency event_type 错位
- G9 metrics_jsonl_flushed: 60s 没 flush 则报 stale
- G10 rotation_overdue: > 90d 没 rotate 报错
- G11 metric_event_added: 新加 event_type 时强制声明 audit-vs-metric 类别

**串行依赖**: B1 → B2 (schema + API) → B3 (reader 切换 + heartbeat 清) → B4 (rotation) → B5 (5 gate 上线)

**并行依赖** (Wave B 派生项):
- NEW-14 events.jsonl 字段自动 truncate (4KB POSIX) — 跟 B2-B3 并行  
- NEW-34 `fabric metrics` 子命令 (text dashboard) — 等 metrics.jsonl 落地 (B2 后)

## 5. 影响面 / 风险

- 5 个 event_type 改 metric → 触发 ledger 重放代码路径必须改 (doctor / cite-coverage / archive-history / orphan-demote 全检查)
- metric_event_in_jsonl gate 启动后若发现新 event_type 错位会 break — 必须 audit 全 emit 点
- 现有 events.jsonl 已经膨胀 — clean-slate 决策意味着不迁移老数据 (旧高频事件存在 archive 不影响审计)
- 时序: 必须 B3 切 reader 前 B2 schema 已稳定, 否则 reader 看不到新 counter 格式

## 6. 估时 reconfirm

- B1 spike + lock: 0.5h (本 doc)
- B2 schema + bumpCounter API + 60s flush + test: 3-4h
- B3 reader 切 + heartbeat clean-slate: 3-4h
- B4 server-side rotation tick: 2-3h
- B5 5 hard gate: 3-4h
- **Wave B 总**: 12-15h (与 status.json 一致)

Plan B 全程不 break 现有 audit consumer (它们读 audit event_type, 这些保留在 jsonl); 仅 metric 类 reader (doctor goodhart / cite-coverage replay) 需要切到 metrics.jsonl。

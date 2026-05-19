# rc.25 Planning Context — Archive Skill Redesign (Session 概念 + 5 入口模型)

**Date**: 2026-05-19
**Source**: `/grill-me` session (Q1-Q4 design tree walk, this conversation)
**Predecessor**: rc.24 cite contract policy (in progress)

---

## 问题背景

### 用户原始痛点(grill-me session 触发原因)

Stop hook 提示 "已积累 466 次 plan_context 调用且距上次 knowledge_proposed 24.2h" 让用户觉得错位:
1. 466 这个数字感觉是"当前会话"的债,但实际是**跨 12 个会话累计**的项目级欠债
2. 新会话刚开始 1 条消息就被提醒,但本会话其实没什么可归档的
3. 跨会话 archive 流程模糊,用户无法控制"挖哪些会话"
4. 已挖过的会话没有可见标记,可能反复扫同一段

### 数据验证(来自真实 events.jsonl)

| 项目 | plan_context 总量 | 自上次 archive 累积 | 跨会话数 |
|---|---|---|---|
| werewolf-minigame | 63 | 7 | (events 无 session_id) |
| **pcf(本项目)** | **960** | **472** | **12** |

发现:
- pcf 是 fabric 元开发场, plan_context 频率天然高
- `knowledge_context_planned` event **没有 session_id 字段**——server-side schema gap

---

## Q1 决议: 为什么要有 Hook?

**结论**: A + B 复合, 以 A 为主
- **A. 反向兜底(反熵装置)**——AI 没有跨会话记忆, 不会自发归档, hook 是外部 reminder
- **B. 跨会话桥梁**——hook 拥有 events.jsonl 全局视野, 告知 AI 跨会话状态

**砍**: C(把 hook 当人看的看板)/ D(干脆删掉 hook)

下游影响: hook 设计目标 = "低噪 + 高召回的敲钟器", 宁少不错。

---

## Q2 决议: Hook 触发时机

**结论**: 采用**极简方案 — 只改文案, 不改触发逻辑**

完整版 C 方案(双 AND session_ready)+ Escape Valve 设计已完整推演, 但最终采用 minimal fix:

```
旧文案:
"已积累 466 次 plan_context 调用且距上次 knowledge_proposed 24.2h
 — 建议调用 fabric-archive skill 抽取本次会话的知识。"

新文案:
"跨 12 个会话累计 466 次 plan_context · 距上次归档 24.2h
 — 这是项目级长期欠债, 不一定来自本会话。
 若本会话有产出, 可调用 fabric-archive; 否则可忽略, 12h 后再提醒。"
```

**核心理由**: 用户痛点是**认知错位**(不知道这是跨会话累计), 不是**频次过高**。文案如实告知即解决 90% 痛点; 进一步的双 AND 阈值方案因复杂度过高且需要 server schema 改动而暂缓。

**仍保留的关键 server 改动**: `knowledge_context_planned` event 必须补 `session_id` 字段, 因为文案 "跨 N 个会话" 需要 distinct session count。

---

## Q3 决议: Archive Skill 优化

### Q3.1 入口集

| 入口 | 形态 | fab 代码量 |
|---|---|---|
| **E1** | Hook 被动触发 | 改文案 |
| **E2** | 用户主动调, 默认当前会话 | 已有 |
| **E3** | AI 自主调, 当前会话 | skill + AGENTS.md 加 self-trigger |
| **E4** | E2 的回溯子模式, 用户语义指定范围 | skill 加 Range Resolution |
| **E5** | OS cron / /loop 定时调, 范围 = E4 "今日" | 零代码, 仅文档样例 |

**砍**: CLI flag(违反"能交互别做 flag")、fab_review 内嵌触发(违反单一职责)。

### Q3.2 会话挖掘状态 Schema

**结论**: A 方案 — 写入 events.jsonl 新事件类型 `session_archive_attempted`

```jsonc
{
  "event_type": "session_archive_attempted",
  "session_id": "xxx",
  "ts": 1779...,
  "outcome": "proposed" | "viability_failed" | "user_dismissed" | "skipped_no_signal",
  "covered_through_ts": 1779...,
  "candidates_proposed": 2,
  "knowledge_proposed_ids": ["..."]
}
```

**理由**: events.jsonl 是项目唯一真相源; rc.22 rotation 天然覆盖; 不引入第二个状态系统。

### Q3.3 E4 范围语义解析

**结论**: A + B 双解析
- **A. 时间窗自然语言**: `今日` / `上周` / `过去 3 天` / `自上次 archive`
- **B. 主题关键词**: `rc.20` / `cite policy` — 在 session digest 全文匹配

**交互**: prompt 语义解析为主, AskUserQuestion 为 fallback

### Q3.4 复扫触发条件

**结论**: outcome-based 状态机 + 高价值信号 filter + 12h 防循环

```
outcome=proposed | viability_failed | skipped_no_signal → 允许复扫
outcome=user_dismissed → 永不自动复扫(尊重用户决定)

复扫触发信号(自 covered_through_ts 以来新增 events 中至少一条):
- ≥1 个 knowledge_context_planned (plan_context)
- ≥1 个 edit_paths 增量 (Edit/Write/MultiEdit)
- 用户消息含 normative 关键词

防循环: 同 session 复扫最短间隔 12h (跟 hook cooldown 心智对齐)
```

### Q3.5 E3 Self-Trigger

**结论**: **E3-strong** (AI 直接调 skill, 事后告知用户)

**4 条 trigger** (任一命中即自调):
1. Normative 语言: `以后` / `always` / `never` / `下次` / `记一下`
2. Wrong-turn-and-revert: AI 尝试 path X, 反思后改走 path Y
3. Decision confirmation: 用户在 ≥2 候选中权衡后给 rationale
4. Explicit dismissal with reason

**3 条 anti-loop**:
- 同 turn 最多自调 1 次
- 同 session 同 outcome 不重复
- Phase 0.5 viability gate 兜底

**呈现模板** (turn 末尾插入):
```
顺手归档: 注意到你说 "以后 X", 已调用 fabric-archive 抓 1 条候选 → .fabric/knowledge/pending/...
若不该记, 答 "撤销" 我会调 fab_review reject。
```

### Q3.6 Phase 0.4 Trigger Gate

**结论**: A 方案 — Phase 0.4 onboard 仅 E2 显式调用时跑, E1/E3/E5 跳过

**理由**: onboard 是"首装基调收集", 只该出现在用户主动归档时刻; 非主动场景(hook/AI/cron)弹问会破坏流。

### Q3.7 可观测性

**结论**: 已通过 Q3.4 的 `session_archive_attempted` event 解决; 额外加 polish: `fab doctor --archive-history [--since=7d]`

---

## Q4 决议: 实施 RC 拆分

**结论**: 单 RC 全做完(方案 α), 在 rc.25 一次落地。

**理由**: rc.24 即将完成, rc.25 接续做 archive redesign; 设计已完整, 拆 3 个 RC 反而拖长 soak 期。

---

## rc.24 接触点(协调注意)

| 接触面 | 冲突等级 | 处理 |
|---|---|---|
| events.jsonl schema_version | ⚠ rc.24 已 bump 一次, rc.25 再 bump | rc.25 rebase 时 +1 |
| Stop hook | 无 | cite-policy(rc.24) vs archive-hint(rc.25), 不同脚本可并行 |
| fab doctor 子命令 | 无 | doctor 多 sub-cmd 架构, --cite-coverage(rc.24) + --archive-history(rc.25)各自独立 |
| AGENTS.md | ⚠ rc.24 改 bootstrap 段, rc.25 加 E3 段 | text-level conflict, rebase 时手动 merge |
| knowledge-meta idTypeMap | 无 | rc.25 不依赖, 但 future E4 关键词匹配可复用 |

整体**低冲突**, rc.25 等 rc.24 merge 后 rebase 一次即可开干。

---

## 整体数据流

```
用户/Hook/AI/Cron 触发 fabric-archive
  ↓
Phase -0.5 Range Resolution (NEW)
  - prompt 解析 → time_window | topic_keywords | session_ids
  - 解析失败 → AskUserQuestion fallback
  ↓
Phase 0.0 Cross-Session Digest (MODIFIED)
  - 应用 outcome-based filter (跳过 user_dismissed)
  - 按 covered_through_ts vs 当前 max event ts 判定复扫候选
  - 应用 12h 防循环 cooldown
  ↓
Phase 0.4 Onboard Coverage (MODIFIED)
  - 检测 entry context: E1/E3/E5 → skip
  - 仅 E2 显式调用时执行
  ↓
Phase 0.5 Viability Gate (UNCHANGED)
  ↓
Phase 1-2 Classify + Persist (UNCHANGED)
  ↓
[新增] 收尾时写 session_archive_attempted event
  - outcome ∈ {proposed | viability_failed | user_dismissed | skipped_no_signal}
  - covered_through_ts = 本次扫描覆盖到的最晚 event ts
```

---

## 工程量摘要

| 模块 | 改动 | LoC 估计 |
|---|---|---|
| `packages/shared/src/schemas/event-ledger.ts` | 加 session_archive_attempted 变体 + session_id 字段 | +30 |
| `packages/shared/src/schemas/event-ledger.test.ts` | 加 4-6 测试 case | +50 |
| `packages/server/src/services/extract-knowledge.ts` | knowledge_context_planned emitter 补 session_id | +5 |
| `packages/server/src/services/doctor.ts` | --archive-history 子命令实现 | +80 |
| `packages/cli/src/commands/doctor.ts` | --archive-history 入口 + 渲染 | +40 |
| `packages/cli/templates/hooks/archive-hint.cjs` | 文案 + 跨会话计数 | +40 |
| `packages/cli/templates/skills/fabric-archive/SKILL.md` | Phase -0.5 / 0.0 改造 / 0.4 gate / silent-skip / E5 附录 | +200 |
| `.fabric/AGENTS.md`(模板源) | E3 self-archive policy 段 | +40 |
| 集成测试 + CHANGELOG | | +100 |
| **合计** | | **~585 LoC** |

预估工时: 9-10 小时 (跟 rc.24 8.5h 相当, 略多于 server schema 改动)

---

## 关键约束

1. **不破坏 backward compat**: events.jsonl 新事件类型必须 `.default([])` 或 optional, 老 events 必须照常解析
2. **Hook 必须 fail-silent**: archive-hint.cjs 任何异常都 catch 静默退出, 绝不阻塞 Stop
3. **rc.22 rotation 兼容**: 新事件类型必须能被 ledger rotation 正确处理
4. **Phase 0.4 现行 onboard 流程不变**: 仅加 entry context gate, 内部逻辑保持
5. **viability gate 不放松**: E3 self-trigger 命中后仍正常跑 Phase 0.5, 不因 AI 自调就跳过

---

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| `session_archive_attempted` 写入失败 → outcome 丢失 → 下次复扫无数据可参考 | 写入失败时 fall through (不阻塞 skill); 下次以"无记录视为初次"处理 |
| E3 误触发(AI 把普通对话误判为 normative) | Phase 0.5 viability gate 兜底 + user_dismissed 反馈环 |
| /loop 长运行 token 成本高 | 文档明示 token 成本; 提供 OS cron 作为低成本替代 |
| rc.24 events.jsonl schema 与 rc.25 撞 schema_version | rebase 时手动 +1, 测试覆盖 schema_version 迁移 |

---

## Out of Scope (不在 rc.25)

- Hook 双 AND 触发逻辑(Q2 完整 C 方案, 性价比不足)
- 复扫触发条件的语义判断(LLM-judge, 太贵)
- Multi-client 并发 race 修复(cosmetic, fail-silent 约束下难修)
- CI/cron 服务集成(零 fab 代码已足够)

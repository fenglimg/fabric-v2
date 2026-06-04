---
id: KT-DEC-0007
type: decision
maturity: proven
layer: team
semantic_scope: team
visibility_store: "team"
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [hooks-design, ux-design]
---

# Hook = reminder layer (nudge, never a permanent gate)

## Decision

Fabric 的 hooks 是一层 **reminder / nudge**,绝不允许永久阻塞 agent 完成
任务。具体机制按 hook 事件分两类(均为 reminder 语义,只是传递信号的载体
不同):

- **PreToolUse / SessionStart** hooks:用 `exit 2` + stderr 传递信号。
  Exit code 2 = 软信号(reminder),agent 可继续;exit code 1 保留给配置
  故障(而非 knowledge 提醒)。

- **Stop** hook(`fabric-hint.cjs`):用 Claude Code 的 Stop-hook JSON 契约
  `{ decision: "block", reason, signal, recommended_skill }`(写 stdout)
  传递信号。`decision: "block"` 在 Claude Code 中把 `reason` 注入回 agent
  并让其继续——是一次性 nudge(提示去调 `fabric-archive` / `fabric-review`
  / `fabric-import` 等 skill),不是挂起。多重 anti-loop 守卫(同 session
  去重、edit-counter 阈值、silence-counter)保证它绝不形成永久阻塞或循环。

共同不变量:hook 不得持永久锁、不得写硬门禁,也不得要求用户确认才放行
agent 主流程。

## Alternatives considered

- **Hard block on exit 1 / 永久 gate**:让 agent 或 CI 在问题解决之前停摆。
  否决——knowledge 提醒不足以构成阻断主工作流的理由;一个「因为还有 pending
  review 就不能 commit」的 agent 是坏掉了,而不是更贴心。

- **No hooks at all**:完全依赖用户主动触发 review skill。否决——hooks 提供
  的是 ambient reminder 层,会在 commit、session start、stop 这样的自然
  checkpoint 提示 review,缺了它整体节奏会松。

## Rationale

Agent 自治必须被守住。Hooks 是 nudges,不是 gates。一个会永久阻塞 agent 的
hook 实际上违背了 async-review 的初衷——后者的全部意义就是把 review 从主
任务流上解耦下来。Stop hook 的 `decision:block` 之所以仍是 nudge 而非 gate,
正是靠 anti-loop 守卫让它每个触发主题至多提示一次。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot,Q7(hook 设计,
reminder-only 语义已确认)。v2.2 W4-14(F1)消除 doc-drift:原文只写
「exit 2 + stderr」机制,与 Stop hook 实际采用的 `decision:block` JSON 契约
不符——本次更新把两类机制都如实记录,核心决策(nudge not gate)不变。

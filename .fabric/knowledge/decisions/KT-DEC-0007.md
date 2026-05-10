---
id: KT-DEC-0007
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [hooks-design, ux-design]
---

# Hook = reminder layer (exit 2 + stderr/followup_message), never blocks

## Decision

Fabric 的 hooks（pre-commit、post-tool-call）通过 `exit 2` + stderr
和 / 或 `followup_message` 来传递信号。它们只是一层 reminder，绝不允许
永久阻塞 agent 完成任务。

具体来说：
- Exit code 2 = 软信号（reminder）；agent 可继续。
- Exit code 1 = 硬错误（保留给配置故障，而不是 knowledge 提醒）。
- Hook 不得持锁、写门禁，也不得通过用户确认才放行 agent 主流程。

## Alternatives considered

- **Hard block on exit 1**：hook 返回 exit 1，让 agent 或 CI 在问题解决
  之前停摆。否决——knowledge 提醒不足以构成阻断主工作流的理由；一个
  「因为还有 pending review 就不能 commit」的 agent 是坏掉了，而不是更
  贴心。
- **No hooks at all**：完全依赖用户主动触发 review skill。否决——hooks
  提供的是 ambient reminder 层，会在 commit、session start 这样的自然
  checkpoint 提示 review，缺了它整体节奏会松。

## Rationale

Agent 自治必须被守住。Hooks 是 nudges，不是 gates。一个会永久阻塞 agent
的 hook 实际上违背了 async-review 的初衷——后者的全部意义就是把 review
从主任务流上解耦下来。

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot，Q7（hook 设计，
reminder-only 语义已确认）。

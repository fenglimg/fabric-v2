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

Fabric hooks (pre-commit, post-tool-call) signal via `exit 2` + stderr and/or
a `followup_message`. They are a reminder layer only. They must never
permanently block the agent from completing a task.

Specifically:
- Exit code 2 = soft signal (reminder); agent may proceed.
- Exit code 1 = hard error (reserved for configuration faults, not knowledge reminders).
- Hooks must never hold a lock, write gate, or require user confirmation to
  unblock the main agent flow.

## Alternatives considered

- **Hard block on exit 1**: Hook returns exit 1, causing the agent or CI to
  halt until the issue is resolved. Rejected — knowledge reminders do not
  justify halting the work stream; an agent that cannot commit because it has
  pending reviews is broken, not helpful.
- **No hooks at all**: Rely entirely on the review skill being invoked
  voluntarily. Rejected — hooks provide the ambient reminder layer that
  prompts review at natural checkpoints (commit, session start).

## Rationale

Agent autonomy must be preserved. Hooks are nudges, not gates. A hook that
blocks the agent permanently defeats the purpose of async-review: the whole
point is to decouple review from the primary task flow.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q7 (hook design,
reminder-only semantic confirmed).

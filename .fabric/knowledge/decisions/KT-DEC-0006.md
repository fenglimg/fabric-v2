---
id: KT-DEC-0006
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [ux-design, review-skill]
---

# Review mode inferred from context, not solicited via AskUserQuestion

## Decision

The review skill determines which review mode to enter (pending / topic /
health / revisit) by inspecting invocation context: recent events, user
message content, pending entry count, and time since last review.
The skill does NOT call `AskUserQuestion` to ask the user which mode to use.

## Alternatives considered

- **Explicit mode selection via AskUserQuestion**: Present a menu each time
  review is invoked. Rejected — AskUserQuestion is for genuine decisions the
  user must own (e.g., "approve this entry?"); mode selection is deducible
  from context and adding a menu creates friction on every invocation.
- **Separate skill commands per mode**: `fab review-pending`, `fab review-topic`, etc.
  Rejected — too many entry points; mode boundaries are fuzzy in practice.

## Rationale

`AskUserQuestion` should be reserved for situations where the agent genuinely
cannot determine the right action without user input. Review mode is fully
deducible from observable context. Inferring it silently reduces friction and
keeps the review skill invocable inline without interrupting the agent flow.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q7 (review skill
design, mode inference over explicit selection confirmed).

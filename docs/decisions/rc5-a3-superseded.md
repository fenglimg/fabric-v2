# ADR: rc.5 A3 `fab_plan_context` degenerate mode superseded by rc.7 T9

- **Status**: Accepted (supersedes rc.5 A3)
- **Date**: 2026-05-13
- **Tracking**: rc.7 T9 (`.workflow/.lite-plan/rc7-macro-closure-2026-05-13/.task/TASK-T09.json`)
- **Supersedes**: rc.5 A3 `fab_plan_context` single-stage degenerate mode
  (TASK-007 in `.workflow/.lite-plan/rc5-rc6-fabric-knowledge-2026-05-12/`)

## Context

`fab_plan_context` is the MCP tool the Agent calls during plan / architecture
phases to learn what Fabric knowledge entries exist for a given request. Two
shapes were possible up to rc.6:

1. **Two-stage (large sets)**: when the resolved `description_index` had >30
   entries, the tool returned `description_index` + a `selection_token`. The
   Agent then called `fab_get_knowledge_sections` with the token to fetch
   markdown bodies.

2. **Degenerate single-stage (small sets)**: when the index had ≤30 entries,
   the tool short-circuited the round-trip by inlining every candidate's full
   markdown body in a `candidates_full_content` field. `selection_token` was
   omitted.

The rc.5 A3 motivation for the degenerate path was Agent context economy:
small workspaces shouldn't pay the two-call latency tax for what's effectively
a fixed-size payload.

## Problem

The `fab_get_knowledge_sections` tool emits a `knowledge_consumed` event per
fetched stable_id. That event drives rc.5 C5 closure signals — most notably
doctor lint #16 (`orphan_demote`), which demotes never-consumed entries to
draft after an age threshold. It is the **only** consumption signal Fabric
emits today.

Degenerate mode bypassed `fab_get_knowledge_sections` entirely. The Agent
received the bodies inline and never made the follow-up call, so:

- No `knowledge_consumed` event was appended to `.fabric/events.jsonl`.
- Lint #16 saw entries as "never consumed" even when the Agent had loaded
  them every session.
- Repos with ≤30 entries (the dogfood loop, every greenfield install) had a
  silently broken closure loop. The signal degraded specifically in the case
  it was supposed to cover best.

The bypass was invisible: there was no log line, no doctor warning, no
event-ledger trace pointing at it. We found it during rc.7 Q-12 review when
the dogfood `orphan_demote` rate kept flapping in a way that didn't match the
actual usage pattern.

## Decision

Remove the degenerate single-stage branch from `services/plan-context.ts`.
`fab_plan_context` now returns a **symmetric** shape regardless of candidate
count:

- `description_index` per entry + `selection_token` (now required, not
  optional) on every successful response.
- `candidates_full_content` is deleted from `PlanContextResult`, from the zod
  output schema (`planContextOutputSchema`), and from the related types.
- The Agent must follow up with `fab_get_knowledge_sections` for bodies in
  every case. That tool already emits `knowledge_consumed` per resolved
  stable_id and dedupes within a request.

## Consequences

### Positive

- **Closure correctness**: `knowledge_consumed` emission is now unconditional
  on Agent-driven consumption. Lint #16 / `orphan_demote` sees the same
  signal at every workspace size.
- **API symmetry**: downstream consumers (doctor lints, dogfood scripts,
  coverage gates) no longer need to branch on response shape. The contract
  has one path.
- **Context economy**: paradoxically, the symmetric shape is also better for
  the Agent's context budget. Degenerate mode shipped *every* candidate's
  full body even if the Agent only needed two — the Agent now picks
  precisely which entries to load.

### Negative / trade-offs

- **One extra MCP call for small repos**: small workspaces pay one
  `fab_get_knowledge_sections` round-trip they didn't pay before. Accepted:
  `selection_token` is cached for 5 minutes and the second call is cheap
  (no scan, no glob match, just read + ledger append).
- **Snapshot churn**: `tool-contracts.test.ts` snapshot was regenerated. No
  behavior change for the other tools.

### Neutral

- The `30`-entry constant that lives in `knowledge-hint-broad.cjs`'s
  `TRUNCATION_THRESHOLD` is unchanged. It was originally aligned with the
  degenerate cutoff but is now a UI-density choice (when to fold per-type
  listings into a count-summary) and stays at 30 independently.
- The SessionStart footer line — `Use \`fab_get_knowledge_sections\` to fetch
  full content.` — was already emitted unconditionally in
  `knowledge-hint-broad.cjs`. Post-rc.7 it is unambiguously accurate; pre-
  rc.7 it was technically misleading at ≤30 entries when bodies were
  already inline.

## Alternatives considered

1. **Keep degenerate mode, emit `knowledge_consumed` inline from
   `fab_plan_context`**. Rejected: breaks separation of concerns
   (plan-context is a *planning* tool, not a consumption tool) and
   double-emits when the Agent loads the same entry twice across a session.
2. **Make degenerate mode opt-in via a request flag**. Rejected: pushes the
   correctness question to the caller. Every caller that wanted speed would
   silently re-introduce the closure gap.
3. **Lower the threshold to ≤5 instead of ≤30**. Rejected: postpones the
   problem instead of solving it; doesn't help repos that legitimately have
   ≤5 entries (which is most greenfield installs).

## References

- rc.5 A3 design (now superseded):
  `.workflow/.lite-plan/rc5-rc6-fabric-knowledge-2026-05-12/.task/TASK-007.json`
- rc.5 C5 closure design:
  `.workflow/.lite-plan/rc5-rc6-fabric-knowledge-2026-05-12/.task/TASK-014.json`
- rc.7 T9 task spec:
  `.workflow/.lite-plan/rc7-macro-closure-2026-05-13/.task/TASK-T09.json`
- Consumption signal source-of-truth:
  `packages/server/src/services/knowledge-sections.ts`
  (`knowledge_consumed` emission)

---
id: KT-DEC-0004
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [identity, stable-id, counters]
---

# stable_id format K[PT]-(DEC|MOD|GLD|PIT|PRO)-NNNN with monotonic counter

## Decision

Knowledge entry identity is encoded as `K[PT]-(DEC|MOD|GLD|PIT|PRO)-NNNN`
where:
- `K` = Fabric knowledge prefix (constant)
- `P|T` = scope: personal (`~/.fabric`) or team (`<repo>/.fabric`)
- type code: `DEC`=decision, `MOD`=model, `GLD`=guideline, `PIT`=pitfall, `PRO`=process
- `NNNN` = monotonic counter (4+ digits, zero-padded, never reused)

Counters are persisted in `agents.meta.json.counters.{KP|KT}.{type-code}`.

## Alternatives considered

- **Path-derived ID**: Derive ID from file path (e.g., `decisions/my-file`).
  Rejected: any rename breaks the identity — defeats the purpose of a stable_id.
- **UUID**: Random UUID per entry. Rejected: unreadable in git diffs, no
  implicit ordering, no type/layer signal.

## Rationale

Path-decoupled identity lets entries move between directories (even between
personal and team roots via a layer flip) without changing their stable_id.
The monotonic counter guarantees historical uniqueness: deleting an entry does
not free its counter slot, so IDs are never recycled.

## Constraints

- Counter never decrements.
- Layer flip (`KP` <-> `KT`) is the ONLY legal mutation to the id prefix.
- Type code is immutable after creation.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q7 (stable_id
path-decoupled design confirmed).

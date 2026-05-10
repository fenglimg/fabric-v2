---
id: KT-DEC-0001
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [v2-architecture, scope-boundary]
---

# Boundary B: data + lifecycle + async-review primitive

## Decision

Adopt boundary B (data layer + lifecycle hooks + async-review primitive) as
the v2.0 architectural boundary, refusing both narrower and wider scopes.

## Alternatives considered

- **Boundary A** (data only): Too thin — no value over a generic vector store.
- **Boundary C** (full platform with built-in UI): Wrong fit — competes with
  existing tools (Obsidian, Notion) on terms we cannot win.

## Rationale

B captures the unique combination Fabric can defend: typed knowledge with
maturity lifecycle + async-review skill loop. Both A and C lose this
differentiation. A offers no routing intelligence; C overreaches and fights
incumbent tools at UX.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q1/Q7 design
decisions (option B accepted).

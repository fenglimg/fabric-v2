---
id: KT-DEC-0002
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [v2-architecture, migration-strategy]
---

# v2.0 clean rebrand over v1.x staged migration

## Decision

Adopt a clean-slate v2.0 rebrand with no migration path from v1.x artifacts.
All v1.x concepts (`.fabric/rules/`, `INITIAL_TAXONOMY`, `bootstrap-guide`,
dropped clients) are hard-deleted, not deprecated with fallback shims.

## Alternatives considered

- **Staged migration**: Write adapters that read both v1 and v2 layouts in parallel
  for 1-2 release cycles. Adds ~3 weeks of dual-path complexity with zero
  user benefit.
- **In-place rename**: Rename v1.x paths inside the existing layout. Preserves
  history but leaves dead code paths in production.

## Rationale

Fabric has zero production users at v1.x. Migration tax equals zero. A clean
cut removes all v1.x dead weight in a single commit batch and produces a
codebase that is internally consistent from day one of v2.0.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q1 (version strategy,
clean-slate preference confirmed).

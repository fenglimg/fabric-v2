---
id: KT-DEC-0005
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [schema-design, frontmatter]
---

# 5-type / 3-maturity / 2-layer schema with flat scalar frontmatter

## Decision

Frontmatter is constrained to flat scalars and flow-style arrays only.
No nested YAML objects. The schema is:

- 5 knowledge types: `model`, `decision`, `guideline`, `pitfall`, `process`
- 3 maturity levels: `draft`, `verified`, `proven`
- 2 layers: `personal`, `team`

Mandatory fields: `id`, `type`, `layer`, `maturity`, `layer_reason`, `created_at`.
Optional field: `tags` (flow-style array).

## Alternatives considered

- **Nested YAML objects** (e.g., `meta: { reviewer: alice, session: S01 }`):
  Rejected — the hand-rolled regex parser in `rule-meta-builder.ts` only
  supports flat scalars and flow-style arrays. Adding nested objects requires
  a full YAML library, which adds size and parse-error surface.
- **7+ types**: Considered splitting `guideline` into `recommend` and `avoid`.
  Rejected — a single `guideline` type with body-level convention is
  sufficient; MECE is better than granularity for a 5-type taxonomy.

## Rationale

Flat scalars are the maximum complexity the existing parser can handle
without a library dependency. The 5-type/3-maturity/2-layer combination
is MECE and covers all expected knowledge shapes for a software project.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q6 (schema
forward-compat: add `tags`, freeze nested-object expansion).

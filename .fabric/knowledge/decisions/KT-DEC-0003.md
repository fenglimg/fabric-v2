---
id: KT-DEC-0003
type: decision
maturity: proven
layer: team
layer_reason: architecture decision from v2.0 design review (grill-me 2026-05-10)
created_at: 2026-05-10T05:24:25.000Z
tags: [storage-layout, gitignore]
---

# Dual-root layout: ~/.fabric + <repo>/.fabric

## Decision

Separate personal and team knowledge into two physical roots:
- Team: `<repo>/.fabric/knowledge/` — committed to git, shared with collaborators.
- Personal: `~/.fabric/knowledge/` — never committed, only on this machine.

Both roots share the same 6-subdir layout: decisions, pitfalls, guidelines,
models, processes, pending.

## Alternatives considered

- **Single root with per-file gitignore**: Use a single `.fabric/knowledge/`
  with `.gitignore` rules filtering personal entries by frontmatter value.
  Rejected: gitignore operates on paths only, cannot read frontmatter.
- **Single root with name convention**: Prefix personal files `personal-*.md`.
  Rejected: fragile, easy to accidentally commit a personal file.

## Rationale

Physical separation is the only reliable way to prevent personal entries from
leaking into git commits. The dual-root design makes the boundary machine-
enforceable, not convention-dependent.

## Tradeoffs

Doctor must check both roots independently. `fab init` must create both.
init-scan only writes to the team root.

## Reference

grill-me session ANL-2026-05-10-fabric-knowledge-pivot, Q7 (dual-root layout
confirmed as mandatory).

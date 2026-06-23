# Phase 3.6 — Related-edge Extraction (§7 graph generation)

For each candidate, identify the **`related`** graph edges to other KB entries — the store-qualified `stable_id`s this entry semantically links to (the decision it supersedes, the pitfall it explains, the model it instantiates). You discovered these ids during the session via `fab_recall` / plan-context, so cite the ones you actually saw, NEVER invent stable_ids.

Because `fab_propose` has no dedicated `related` input, record the candidate edges as one line inside `session_context` (e.g. `related: team:KT-DEC-0007, team:KT-PIT-0011`) so they survive to approve-time frontmatter authoring (`fabric-review` writes the canonical `related: [...]` frontmatter).

## §4 privacy iron law — KT→KP is FORBIDDEN

A **team** (`KT-*`) entry's `related` MUST NOT point at a **personal** (`KP-*`) id: that would write a personal-knowledge topology pointer into a shared store.

| Edge | Allowed? |
| --- | --- |
| `KT→KT` | ✅ |
| `KP→KP` | ✅ |
| `KP→KT` | ✅ |
| `KT→KP` | ❌ FORBIDDEN |

When unsure whether a target is personal, OMIT the edge.

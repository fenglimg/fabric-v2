# Phase 3.7 — Semantic scope (audience axis, multi-project) (ref)

> **Loaded on demand.** SKILL.md hot path retains the trigger condition (`layer=team` AND `active_project` set), the default-vs-escape rule, and the `semantic_scope: team` escape hatch. This file holds the store-vs-audience distinction, the this-project-only vs team-wide decision tree, and worked examples.

## The three orthogonal axes (KT-MOD-0001)

A knowledge entry is positioned on three independent axes — do NOT collapse them:

| Axis | Field | Values | Decided by |
| --- | --- | --- | --- |
| **Store** (physical repo, privacy boundary) | `visibility_store` | `team` shared store / `personal` store | Phase 3 `强 team` / `强 personal` heuristic |
| **Audience** (logical resolution coordinate) | `semantic_scope` | `team` / `project:<id>` / `personal` / `org:<…>` | **this phase** |
| **Display** (how broadly it surfaces) | `relevance_scope` | `narrow` / `broad` | Phase 3.5 |

Phase 3 picks the STORE (team vs personal). This phase picks the AUDIENCE *within* the shared team store: is the entry for the whole team across all projects (`team`), or only for the current project (`project:<active_project>`)?

## When this phase runs

- **Runs** only when `layer=team` AND `.fabric/fabric-config.json` has a non-empty `active_project`.
- **Skips** otherwise — the engine auto-derives `semantic_scope` at the write path (`resolveWriteScopeMeta`): `layer=personal` → `personal`; `layer=team` with no `active_project` → `team`. An explicit input always wins over auto-derivation (`semanticScope ?? defaultWriteScope(...)`).

## Decision tree (per team candidate, when active_project is set)

```
Is the knowledge tied to THIS project's code / business domain / workspace paths?
├─ YES (this-project-only) → OMIT semantic_scope
│                            → engine derives `project:<active_project>`  ← DEFAULT, most candidates
└─ NO  (team-wide, cross-project: methodology, team convention, tooling
        not bound to this repo) → pass explicit `semantic_scope: team`
                                 → entry stays visible across every project
```

**Why the explicit escape hatch matters.** Without this step, *every* team archive in a project-bound repo is silently narrowed to `project:<active_project>`. Genuinely cross-project team knowledge (a naming convention, a review checklist, a tooling decision) would be trapped inside one project and invisible elsewhere. `semantic_scope: team` is the only way to opt out of the project narrowing.

## Worked examples (active_project = `fabric-v2`)

| Candidate | layer | semantic_scope | Result |
| --- | --- | --- | --- |
| "The resolver's two-axis tie-break lives in `cross-store-write.ts`" | team | OMIT | `project:fabric-v2` — binds this repo's code |
| "We always write commit messages in Chinese, type: prefix" | team | `team` | `team` — team convention, spans every project |
| "Black-edge sprite root cause = inverted `premultiplyAlpha`" (a different game repo's domain) | team | `team` | `team` — not about fabric-v2 |
| First-person editor preference | personal | (n/a) | `personal` — store=personal, phase skipped |

## Inline-edit support during batch review

The user MAY inline-edit `[semantic_scope=...]` in the batch review. Treat it as authoritative: a switch to `team` drops the project narrowing; a switch to `project:<active_project>` (or OMIT) restores the default. Personal-layer candidates have no `semantic_scope` choice — they are always `personal`.

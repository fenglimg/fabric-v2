# Knowledge Types

Fabric organizes knowledge into **5 types** with distinct purpose and lifecycle.
This page is the canonical reference for authoring entries: definitions,
worth-archive signals, skip-it signals, concrete examples, and a decision tree
that narrows a candidate observation to exactly one type — or rejects it.

> Cross-references: [README.md](../README.md) · [docs/initialization.md](./initialization.md) · [docs/roadmap.md](./roadmap.md) · [docs/data-schema.md](./data-schema.md)

## Why exactly 5 types?

Fewer than 5 collapses semantic distinction (a "pitfall" archived as a
"guideline" loses the *avoid* framing); more than 5 produces classification
fatigue at archive time. The 5 types map onto the four canonical knowledge
quadrants in software engineering — *what we believe* (models),
*what we chose* (decisions), *what we recommend* (guidelines), *what burned us*
(pitfalls), *how we operate* (processes) — with no overlap.

## The 5 Types — Overview

| # | Type | Purpose | Typical layer | Typical maturity |
|---|------|---------|---------------|------------------|
| 1 | `decisions` | Recorded architectural choices with rationale | team | verified → proven |
| 2 | `pitfalls` | Mistakes to avoid + the reasoning that made them non-obvious | team or personal | draft → verified |
| 3 | `guidelines` | Recommended patterns / conventions ("always X / never Y") | team | verified → proven |
| 4 | `models` | Mental models, abstractions, domain object schemas | team | draft → proven |
| 5 | `processes` | Multi-step workflows whose order matters | team or personal | verified |

Directory layout (per dual-root):

```text
.fabric/knowledge/
├── decisions/
├── pitfalls/
├── guidelines/
├── models/
├── processes/
└── pending/
    ├── decisions/
    ├── pitfalls/
    ├── guidelines/
    ├── models/
    └── processes/
```

`pending/` mirrors the 5 type buckets and holds entries awaiting review by the
`fabric-review` Skill (see [docs/initialization.md](./initialization.md)).

---

## Type 1: `decisions`

**Definition.** A choice between alternatives with documented rationale. The
canonical artifact shape is "we chose X over Y because Z" — what an ADR
(Architecture Decision Record) captures, scoped to repo-team or personal.

**Worth-archive signal**

- ≥2 alternatives were genuinely weighed (not rationalized after the fact).
- A rationale was given that names the decision factor, not just the outcome.
- The decision is locked-in (you would push back if asked to revisit).

**Skip-it signal**

- The choice was forced by external constraint (no real alternative existed).
- It is still a preference / hypothetical ("we might switch to X someday").
- It is a stylistic preference with no architectural consequence.

**Examples**

- ✅ "Single `.cjs` hook script over three per-client scripts — rationale:
  identical stdout JSON shape across Claude Code / Codex / Cursor; single
  point of maintenance for the events.jsonl threshold logic." (real:
  `KT-DEC-0009`)
- ✅ "Boundary B (data + lifecycle + async-review primitive) chosen over
  Boundary A (data only) and Boundary C (data + UI). Rationale: A is too thin
  to differentiate from generic vector stores; C overcommits to UX
  competition with Obsidian/Notion." (real: `KT-DEC-0001`)
- ❌ "Used the existing `fab_extract_knowledge` schema." — no alternative was
  considered; this is just *implementation*, not *decision*.

---

## Type 2: `pitfalls`

**Definition.** A trap that wasted time and is non-obvious. The artifact has
two parts: (a) what went wrong, (b) the reasoning that made the mistake easy
to fall into. Without (b) it is just a bug ticket.

**Worth-archive signal**

- The bug took >15 minutes to diagnose AND is repeatable across sessions.
- The root cause is non-obvious in hindsight (you would warn a teammate).
- A future reader without context could fall into the same trap.

**Skip-it signal**

- It is a typo, off-by-one, or one-time API quirk.
- The fix was obvious within the first guess.
- It only applies to one file / one moment in time.

**Examples**

- ✅ "`deepMerge` replaces arrays — `hooks.Stop[]` needs special-case
  append-with-dedupe by hook command path. Falling back to `Object.assign`
  silently drops user-customized commands at re-init." (real pattern
  embedded in `packages/cli/src/install/hooks.ts`)
- ✅ "Codex repo skill discovery path is `.codex/skills/`, NOT
  `.agents/skills/` — every install before v1.8.0-rc.3 silently shipped a
  skill Codex never read." (real: rc.3 fix; embedded as a doctor lint check
  for back-compat)
- ❌ "Forgot a comma in JSON" — too obvious, no lesson.

---

## Type 3: `guidelines`

**Definition.** A normative rule for future similar situations. Hallmark
phrasing: "always X" / "never Y" / "from now on Z". A guideline emerges after
a pattern has been observed in **multiple** instances, never from a single
use.

**Worth-archive signal**

- The rule appeared in ≥2 independent situations and produced the same
  outcome.
- A reviewer would call out a violation in PR review.
- The rule has a clear scope (file type, layer, command, etc.).

**Skip-it signal**

- It is a one-off preference for one file.
- The rule cannot be stated without a long list of exceptions.
- It is still in flux — you have changed your mind once already.

**Examples**

- ✅ "Slug naming: kebab-case, 2–5 words, 20–40 chars, semantic core only
  (drop articles, drop generic suffixes)." (real: enforced in
  `fabric-archive` Skill Phase 1)
- ✅ "All MCP tool errors return `{ ok: false, error: { code, message } }`
  — never throw across the JSON-RPC boundary; never return raw stack traces."
  (real: `packages/server` convention)
- ❌ "Use 4-space indent in this one file" — too narrow, not a guideline.

---

## Type 4: `models`

**Definition.** A reusable mental abstraction or domain object schema.
Hallmark: the model has a *name* you can use in conversation ("the X
pattern", "the Y phase"). Models earn their keep when they let you compress
explanation.

**Worth-archive signal**

- You catch yourself using the same shorthand 3+ times.
- A new contributor would be lost without the model named.
- The abstraction has clear edges (what it is *not* matters).

**Skip-it signal**

- It is ad-hoc terminology used once.
- The "model" is just a synonym for an existing well-known concept.
- The shape is still in flux — properties keep changing every week.

**Examples**

- ✅ "Wave-1 / Wave-2 task DAG decomposition — Wave-1 is parallel-safe
  (no cross-task file edits), Wave-2 serializes integration." (real:
  `.workflow/.lite-plan` planning convention)
- ✅ "5 types × 3 maturity × 2 layers — the canonical Fabric knowledge
  cube; each entry occupies exactly one cell." (real: this very document)
- ❌ "The thing we did just now" — too thin, no reusable abstraction, no
  name.

---

## Type 5: `processes`

**Definition.** A multi-step procedure with a stable shape, where the order
of steps matters and skipping a step has a known consequence.

**Worth-archive signal**

- You have run the process 2+ times and the steps were the same.
- The order is load-bearing (step 3 before step 2 fails or corrupts state).
- Each step has a clear pre-condition and post-condition.

**Skip-it signal**

- It is a one-shot script with no reusable structure.
- The "process" is `tests + commit` — trivial, no reusable shape.
- You are still iterating on the steps.

**Examples**

- ✅ "`fab_review approve` = counter++ → frontmatter inject → `git mv` →
  meta rebuild → event append (5 atomic steps; failure at any step rolls
  back the previous via filesystem-edit fallback)." (real:
  `packages/server/src/tools/fab-review/approve.ts`)
- ✅ "rc batch close-out: run dogfood end-to-end → Gemini review →
  per-file ≥90% coverage gate → commit-batch → tag." (real:
  `.workflow/.lite-plan/fabric-v2-rc{2,3}-impl-*` pattern)
- ❌ "Ran the tests, then committed." — trivial, no reusable shape.

---

## Layer classification (team vs personal)

Every entry occupies exactly one **layer**. The heuristic is embedded
verbatim in the `fabric-archive` Skill so authors and the Skill agree.

> - **Strong team signal**: references this project's code, team consensus
>   phrasing ("we decided"), `fabric-import`-pipeline output, business
>   domain terms, pitfalls bound to this repo's code.
> - **Strong personal signal**: first-person preference, cross-project
>   generic, tool/editor preference, individual workflow.
> - **Default: team**. Safety bias — mislabeling team as personal silently
>   drops the entry from team review; mislabeling personal as team gets
>   caught at PR.

Resolution order: check strong-team signals first; only assign `personal` if
strong-personal signals dominate AND no strong-team signal applies;
otherwise default to `team`.

Storage:

- `team` → `<repo>/.fabric/knowledge/<type>/`
- `personal` → `~/.fabric/knowledge/<type>/`

---

## Maturity tiers (draft / verified / proven)

| Tier | Meaning | Promoted by | Demoted by |
|------|---------|-------------|------------|
| `draft` | Newly proposed; not yet validated | author | `doctor --fix-knowledge` if orphaned >30 days |
| `verified` | Validated by review (`fab_review approve`) | reviewer | conflicting decision lands; lint flags stale |
| `proven` | Entrenched in practice; cited by 3+ other entries | curation | superseded decision lands |

Demote/archive thresholds (default; configurable in v2.x):

- **Orphan demote**: a `draft` entry with no `knowledge_promoted` event after
  30 days → demoted or archived by `doctor --fix-knowledge`.
- **Stale archive**: a `verified` entry with no citation or update in 180
  days AND superseded by a newer entry → archived.
- **Pending overdue**: an entry sitting in `pending/` for >14 days → flagged
  by the `fabric-hint.cjs` Stop hook as a review prompt.

The full lint check matrix is in [docs/data-schema.md](./data-schema.md) and
implemented in `fabric doctor` / `fabric doctor --fix-knowledge`.

---

## Decision tree — *Is this worth archiving? Which type?*

```text
Recent session contains an observation worth keeping?
  ├─ NO → skip (no MCP call, no entry)
  └─ YES → does it fit one of {decisions, pitfalls, guidelines, models, processes}?
            ├─ NO → skip (not classifiable = not yet ripe)
            └─ YES → which?
                      │
                      ├─ "we chose X over Y because Z"
                      │     → decisions
                      │
                      ├─ "this trap took >15 min and is repeatable"
                      │     → pitfalls
                      │
                      ├─ "always X / never Y; appeared 2+ times"
                      │     → guidelines
                      │
                      ├─ "named abstraction reused 3+ times"
                      │     → models
                      │
                      └─ "ordered multi-step procedure run 2+ times"
                            → processes
                      ↓
                Apply layer heuristic (strong-team → strong-personal → default team)
                      ↓
                Propose slug per 5 naming rules (see fabric-archive SKILL.md)
                      ↓
                Maturity = draft (default for new entries)
                      ↓
                Lands in .fabric/knowledge/pending/<type>/
                      ↓
                fabric-review Skill promotes / rejects / modifies
```

## Five quick checks before authoring an entry

1. **Is it generalizable?** If it only applies to one file, skip.
2. **Is the rationale captured?** A decision without "because Z" is a log
   line, not knowledge.
3. **Is it the right type?** Run through the decision tree top-to-bottom;
   stop at the first match.
4. **Is the layer right?** Default to `team` unless strong-personal signal
   dominates.
5. **Is the slug stable?** Re-running `fabric-archive` on the same
   observation should produce the same slug (kebab-case, 2–5 words,
   20–40 chars).

If all 5 pass, the entry is worth proposing. If any fail, skip — there is no
penalty for not archiving; the penalty is archiving noise that future
readers must filter out.

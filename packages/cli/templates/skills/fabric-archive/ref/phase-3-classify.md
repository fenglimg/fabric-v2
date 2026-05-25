# Phase 3 — Classify, Layer, Slug, Review (ref)

> **Loaded on demand.** SKILL.md hot path retains the contract (type/layer/slug/summary fields), the verbatim layer heuristic block (protected tokens — NEVER paraphrased), and brief slug rules + decision tree. This file holds verbose 5-type explanations, slug examples, and the bilingual batch review templates.

## Five Knowledge Types (verbose)

- **model** — A reusable mental abstraction or domain object schema. Worth-archive signal: the user names something ("the X pattern", "the Y phase"). Skip-it signal: ad-hoc terminology used once. Positive: "Wave-1/Wave-2 task DAG decomposition for parallel-safe planning". Negative: "the thing we did just now" (too thin, no reusable abstraction).
- **decision** — A choice between alternatives with rationale. Worth-archive signal: ≥2 options were weighed AND a rationale was given. Skip-it signal: the choice was forced by external constraint with no real alternative. Positive: "Single .cjs hook script over three per-client scripts — rationale: identical stdout JSON shape across Claude/Codex". Negative: "Used the existing fab_extract_knowledge schema" (no alternative was considered).
- **guideline** — A normative rule for future similar situations. Worth-archive signal: the user said "always" / "never" / "from now on". Skip-it signal: a one-off preference that won't generalize. Positive: "Slug naming: kebab-case, 2-5 words, 20-40 chars, semantic core only". Negative: "Use 4-space indent in this one file" (too narrow).
- **pitfall** — A trap that wasted time and is non-obvious. Worth-archive signal: a bug took >15 min to diagnose AND is repeatable. Skip-it signal: a typo or one-time API quirk. Positive: "deepMerge replaces arrays — hooks.Stop[] needs special-case append-with-dedupe". Negative: "Forgot a comma in JSON" (too obvious).
- **process** — A multi-step procedure with a stable shape. Worth-archive signal: the steps were executed in a specific order AND the order matters. Skip-it signal: a one-shot script with no reusable structure. Positive: "fab_review approve = counter++ → frontmatter inject → git mv → meta rebuild → event append (5 atomic steps)". Negative: "Ran the tests, then committed" (trivial, no reusable shape).

## Slug Naming — examples

Passing examples: `wave-1-parallel-task-dag` (4 words, 24 chars), `deepmerge-array-replace-trap` (4 words, 28 chars).

Failing examples: `the_solution` (underscore + article), `fix` (1 word, too short), `how-we-decided-to-handle-the-merge-conflict-in-stop-hook-config` (overlong).

## Batch Review Template (bilingual)

Present all candidates in a single screen. UX i18n Policy classes 1 + 3 — the roll-up structure AND the per-candidate `Confirm?` prompt are bilingualized; protected tokens (`relevance_scope`, `relevance_paths`, `narrow`, `broad`, `layer`, `team`, `personal`, `pending_path`, etc.) appear verbatim in BOTH variants. Field VALUES (slugs, file paths, type/layer enum strings like `decision` / `team`) are data and are NOT translated.

### en variant (`fabric_language === "en"`)

```md
# Archive Review — N candidates

## C1 [type=decision] [layer=team] [relevance_scope=narrow] slug=wave-1-parallel-task-dag
Summary: <1-2 sentences capturing the observation>
Layer reasoning: <which 强 team / 强 personal signal applied, or default team>
Scope reasoning: <why narrow or broad — see Phase 3.5>
relevance_paths: ["packages/cli/src/commands/plan.ts", "packages/cli/templates/**/*.md"]
Confirm? (Y to accept, edit type/layer/slug/relevance_scope/relevance_paths inline, N to skip)

## C2 [type=pitfall] [layer=team] [relevance_scope=broad] slug=deepmerge-array-replace-trap
Summary: ...
Layer reasoning: ...
Scope reasoning: ...
relevance_paths: []
Confirm? ...
```

### zh-CN variant (`fabric_language === "zh-CN"`)

```md
# 归档 Review — N 条候选

## C1 [type=decision] [layer=team] [relevance_scope=narrow] slug=wave-1-parallel-task-dag
摘要: <1-2 句捕捉该观察>
Layer 判定: <命中哪条 强 team / 强 personal 信号，或默认 team>
Scope 判定: <为什么 narrow 或 broad — 见 Phase 3.5>
relevance_paths: ["packages/cli/src/commands/plan.ts", "packages/cli/templates/**/*.md"]
确认？(Y 接受 / 内联编辑 type/layer/slug/relevance_scope/relevance_paths / N 跳过)

## C2 [type=pitfall] [layer=team] [relevance_scope=broad] slug=deepmerge-array-replace-trap
摘要: ...
Layer 判定: ...
Scope 判定: ...
relevance_paths: []
确认？...
```

The user MAY edit type/layer/slug/relevance_scope/relevance_paths inline before confirming. The user MAY skip individual candidates without rejecting the whole batch. Inline-editing `[relevance_scope=...]` triggers a re-derivation of `relevance_paths` per the Phase 3.5 rules (narrow ⇒ recompute from edit_paths; broad ⇒ force `[]`).

---
name: agents-md-init
description: Use this skill when `fab init` just completed, `.fabric/forensic.json` exists, and Shadow Mirroring initialization still needs to be finalized. This skill performs active reconnaissance, runs a single-round Architecture Review batch check, writes confirmed rule nodes only under `.fabric/agents/`, updates `.fabric/init-context.json`, and refreshes `.fabric/agents.meta.json`.
allowed-tools: Read, Glob, Grep, Bash
---

## Precondition

MUST read `.fabric/forensic.json` before any other action. If the file does not exist, stop the skill and tell the user: `请先运行 fab init 生成证据包`.

MUST inspect both `.fabric/forensic.json.assertions[]` and `.fabric/forensic.json.candidate_files[]` before Phase 1. Do not skip straight to review or construction.

Treat the following state as initialization pending:

- `.fabric/forensic.json` exists
- `.fabric/init-context.json` does not exist

This skill is `Check-not-Ask`, not a preference interview:

- Phase 0 proactively gathers evidence
- Phase 1 presents one Architecture Review batch for correction
- Phase 2 writes only the confirmed set

## 执行流程 (3 Phase / 1 User Review Round)

### Phase 0 — 主动侦察

Use `.fabric/forensic.json` as the primary evidence packet:

1. Read and summarize:
- `framework`
- `assertions[]`
- `candidate_files[]`
- `sampling_budget`
- `entry_points`

2. Build the read queue from `candidate_files[]`.

- Hard budget is `15 files x 100 lines per file`.
- `candidate_files[]` is the primary source of local inspection targets.
- If the queue would exceed the hard budget, apply overflow fallback to `pattern-family top-3`: keep at most 3 candidate files for each family and drop the rest.
- If a single file needs more than 100 lines to verify an assertion, stop at the cap and downgrade confidence instead of guessing.

3. Use supplemental inspection only to tighten evidence.

- `Read` selected files for the smallest relevant slices.
- `Grep` may be used to confirm co-occurring markers, recover the exact anchor line, or disambiguate a conflicting assertion.
- Supplemental `Read` and `Grep` still operate inside the same hard budget.

4. Build a local evidence board with these review buckets:

- `framework`
- `architecture_pattern`
- `proposed_rule`
- `domain_boundary`

5. Normalize every displayed evidence reference to `file:line`.

- Use the most relevant line when multiple matches exist.
- When the source evidence is a range, anchor the first decisive line.
- If you cannot produce a stable `file:line` anchor, lower the confidence tier.

6. Prefer omission over invention.

- If Phase 0 cannot verify an assertion, keep it out of the confirmed set.
- Do not promote a statement to a stronger rule just because it sounds plausible.

### Phase 1 — 单轮 Architecture Review

Present one single-screen Architecture Review batch. Do not ask serial questions. The user should only need to do one of two things:

- correct a displayed item
- explicitly accept a `MEDIUM` or `LOW` item

Use this structure exactly:

```md
# Architecture Review

## framework
- [HIGH] <statement>
  evidence: path/to/file:12, path/to/other:7
  write status: implicit accept unless corrected

## architecture_pattern
- [HIGH|MEDIUM|LOW] <statement>
  evidence: path/to/file:34
  write status: implicit accept unless corrected | explicit accept required

## proposed_rule
- [HIGH|MEDIUM|LOW] <rule text>
  evidence: path/to/file:56, path/to/other:18
  write status: implicit accept unless corrected | explicit accept required

## domain_boundary
- [HIGH|MEDIUM|LOW] <boundary statement>
  evidence: path/to/file:91
  write status: implicit accept unless corrected | explicit accept required
```

Architecture Review rules:

- Partition the display into exactly `framework`, `architecture_pattern`, `proposed_rule`, and `domain_boundary`.
- Every item must carry a confidence tier and at least one `file:line` evidence anchor.
- `HIGH` items are displayed with implicit accept semantics: if the user does not object during this review batch, they are considered confirmed for writing.
- `MEDIUM` and `LOW` items require explicit accept before they can be written anywhere.
- If the user corrects a `HIGH` item, the corrected version replaces the displayed one and becomes the only candidate for Phase 2.
- If the user does not explicitly accept a `MEDIUM` or `LOW` item, keep it out of Phase 2 output.

### Phase 2 — 自动构造

Phase 2 writes the confirmed set only:

- all `HIGH` items not corrected by the user
- only `MEDIUM` and `LOW` items that the user explicitly accepted

Write targets:

1. Write `.fabric/init-context.json`.

- Include `framework`, `architecture_patterns`, `invariants`, `domain_groups`, `interview_trail`, and `forensic_ref`.
- Each written invariant must include `confidence_snapshot` with:
  - `confidence`
  - `evidence_refs`
- Each written invariant should also retain `source_evidence` when the relevant file and line slice are known.
- Each domain group should include:
  - `topology_type`
  - `target_path`
- Record the Architecture Review batch in `interview_trail`, including:
  - the review presentation
  - any user corrections
  - any explicit accepts for `MEDIUM` or `LOW`

2. Write rule nodes only inside the Shadow Mirroring tree.

- Mirror path rule: strip the project-root prefix from the source directory, then prepend `.fabric/agents/`.
- Example: `packages/server/src` -> `.fabric/agents/packages/server/src/AGENTS.md`
- Cross-cutting concerns go to `.fabric/agents/_cross/{concern}.md`
- Use `topology_type: "mirror"` for mirrored nodes and `topology_type: "cross-cutting"` for `_cross` nodes
- Create directories with `mkdir -p` before writing files when needed

3. Update `.fabric/agents.meta.json`.

- Add or refresh nodes for every generated Shadow Mirroring file
- Persist `layer` and `topology_type` on each node
- Derive `layer` from the mirrored path depth already used by the repository schema
- Keep the revision chain internally consistent

4. Keep Phase 2 zero-pollution.

- Do not create rule sidecars in business directories
- Do not create legacy hidden rule folders outside `.fabric/agents/`
- Do not emit import-aggregation lines
- Keep every generated rule artifact under `.fabric/agents/` or `.fabric/agents/_cross/`

## Hard Rules (DO NOT TRANSLATE) — DISPLAY / WRITE Split

### DISPLAY Rules

- MUST complete Phase 0 before any Architecture Review output.
- MUST read `.fabric/forensic.json.assertions[]` and `.fabric/forensic.json.candidate_files[]` before Phase 1.
- MUST keep the active recon hard budget at `15 files x 100 lines per file`.
- MUST use overflow fallback to `pattern-family top-3` when the queue exceeds the budget.
- MUST present exactly four Architecture Review partitions: `framework`, `architecture_pattern`, `proposed_rule`, `domain_boundary`.
- MUST attach evidence anchors in `file:line` format.
- MUST treat `HIGH` display status as implicit accept unless the user corrects it.
- MUST require explicit accept for every `MEDIUM` and `LOW` item before it becomes writable.
- MUST use this `HIGH` confidence standard: `coverage.ratio >= 0.8` and `coverage.co_occurring_patterns.length >= 2`, or an AST-level marker directly proves the assertion.

### WRITE Rules

- NEVER write any unconfirmed invariant or domain rule into `.fabric/agents/`.
- NEVER write any `MEDIUM` or `LOW` item unless the user explicitly accepted it.
- NEVER infer missing invariants, domain boundaries, or rule text from weak evidence.
- NEVER generate placeholder, stub, `TODO`, or `TBD` content.
- NEVER write rule artifacts outside the Shadow Mirroring tree.
- MUST write `.fabric/init-context.json` with `confidence_snapshot` preserved for every written invariant.
- MUST update `.fabric/agents.meta.json` with `layer` and `topology_type` for each generated node.
- MUST preserve protected tokens exactly: `AGENTS.md`, `FABRIC.md`, `.fabric/agents/`, `.fabric/agents/_cross/`, `.fabric/agents.meta.json`, `.fabric/human-lock.json`, `.fabric/init-context.json`, `.fabric/forensic.json`, `Shadow Mirroring`, `MUST`, `NEVER`.

# Planning Context: Fabric v2.0.0-rc.7 Macro Closure

## Source Evidence

- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/rc7-scope.md` — **definitive source of truth**, fully-specified 11-item scope produced by 8-round `/grill-me` macro-closure session on 2026-05-13
- `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/rc5-rc6-scope.md` — predecessor scope (rc.5 wire/schema cleanup + rc.6 active injection)
- `scripts/rc5-coverage-gate.mjs` / `scripts/rc6-coverage-gate.mjs` — pattern to mirror for `scripts/rc7-coverage-gate.mjs`
- `packages/cli/src/commands/init.ts` — `fabric init` clack flow surface (T1 sentinel-write end-of-flow)
- `packages/cli/src/scan/builders/*.ts` — scan-time builders to differentiate narrow vs broad per builder type (T2)
- `packages/cli/src/hooks/knowledge-hint-broad.cjs` — SessionStart hook (T1 sentinel-read; T8 revision_hash gating)
- `packages/cli/src/hooks/fabric-hint.cjs` — Stop hook (T1 sentinel-read; T4 banner reformat; T7 config externalization; T10 Signal D)
- `packages/server/src/skills/fabric-archive/SKILL.md` + extract-knowledge.ts (T5 Phase 0.0 cross-session digest; T6 dedup-merge)
- `packages/shared/src/schemas/*.ts` (T6 `proposed_reason` frontmatter; T5 `source_sessions[]` schema)
- `packages/cli/src/commands/doctor.ts` (T10 `doctor_run` event emission; T11 `--apply-lint` clack.confirm)
- `.fabric/fabric-config.json` (T7 threshold externalization)
- `docs/` (T3 `surfaces.md`; T7 `configuration.md`; T8 `cross-client-visibility.md`; T9 `decisions/rc5-a3-superseded.md`)

## Understanding

**Current State (post rc.5+rc.6)**: Wire/schema/injection layers are closed. Pending entries flow through `fab_extract_knowledge`, canonical entries serve via `fab_plan_context`/`fab_get_knowledge_sections`, PreToolUse hook injects narrow knowledge, Stop hook emits Signals A/B/C. However, 4 macro user-experience gaps remain:

1. **Cold-start (A)** — `fabric init` is a CLI-side terminal action; `fabric-import` is an AI-side Skill. No mechanism bridges them. Fresh-repo scan defaults broad+[] so PreToolUse hook is silent.
2. **Archive (B)** — Stop hook accumulates cross-session edit counters, but archive Skill scope is single-session. Pending entries lack self-contained context (no `## Why proposed`, no `## Session context`), making stale review impossible without conversation transcripts.
3. **Consume (C)** — `fab_plan_context` degenerate-mode (≤30 entries returns full content) silently bypasses `knowledge_consumed` event emission, breaking rc.5 C5 closure. SessionStart dumps full broad list every session → banner blindness.
4. **Maintenance (D)** — No hook signal recommends `fabric doctor`. `--apply-lint` mutates without safety prompt.

**Proposed Approach (11-item / 4-wave delivery)**:

- **Wave 1 — Foundations (~2d)**: Independent, low-risk fixes. T9 kills degenerate mode (surfaces consumption-signal gap early). T2 anchors scan builders to known paths. T11 adds doctor safety prompt. T7 externalizes hook thresholds (prerequisite for T4 + T10).
- **Wave 2 — Schema + infra (~3d)**: T6 adds `proposed_reason` + `Session context` frontmatter (cross-session pending self-containedness). T5 builds session-digest writer + cross-session archive Phase 0.0 (depends on T6 schema). T10 adds Signal D + `doctor_run` event (depends on T7 config).
- **Wave 3 — Hook + UX (~2d)**: T4 reformats Stop hook banner to 人-first style (depends on T7 + edit-counter sidecar). T8 adds SessionStart revision_hash gating + 3-client visibility verification. T1 wires init→sentinel→hook hand-off (same hook file as T4).
- **Wave 4 — Docs (~1d)**: T3 publishes `docs/surfaces.md` + README "Three surfaces" section, cross-referencing all preceding surfaces.

After rc.7 dogfood-clean → tag `v2.0.0` stable.

## Key Decisions

- **Decision**: 11 scope items = 11 tasks (no split/merge) | **Rationale**: Items were grilled into shape with user across 8 rounds; each has target files, mechanism, acceptance behavior fully nailed down | **Evidence**: rc7-scope.md Section 2 + Section 7 (17 resolved questions)
- **Decision**: Use scope IDs T1-T11 directly as task IDs (TASK-T01 through TASK-T11, zero-padded) | **Rationale**: Preserve traceability to source document | **Evidence**: User instruction explicitly mandates preserving IDs
- **Decision**: Plan complexity = "High" | **Rationale**: Cross-package (cli/server/shared/templates) + new schema fields + new event types + cross-client verification surface | **Evidence**: rc7-scope.md Section 9 (7.4-8.4d estimate)
- **Decision**: Recommended execution = "Codex" | **Rationale**: Multi-file refactor scale matches rc.5/rc.6 RC bundles (Memory pattern: larger RCs delegated to Codex) | **Evidence**: feedback_clean_slate.md + project_v2_rc_continuation.md memory anchors
- **Decision**: Wave 1 tasks (T9/T2/T11/T7) are independent → no `depends_on` within wave; Wave 2 has T6→T5 (digest writes pending) and T7→T10 (hint reads config); Wave 3 has T7→T4 (hook reads config) and T7→T10→T4 (banner formats Signal D); T3 (Wave 4) depends on every preceding surface it documents | **Rationale**: Section 3 ordering | **Evidence**: rc7-scope.md Section 3
- **Decision**: Skip multi-angle exploration | **Rationale**: Source scope document is fully specified — exploration would re-derive what's already determined | **Evidence**: User instruction "exploration_angles: []"

## Coverage Gate Note

`scripts/rc7-coverage-gate.mjs` must exist by end of rc.7, mirroring the rc.5/rc.6 pattern. Coverage surface (from Section 3 of scope):

- 3 hook thresholds readable from `.fabric/fabric-config.json` (validates T7)
- `fab_plan_context` never returns `candidates_full_content` (validates T9)
- Sentinel file lifecycle: written by init Y-confirm, read by SessionStart/Stop, cleared by import Skill completion (validates T1)
- `doctor_run` event emission on both `--lint` and `--apply-lint` modes (validates T10)
- `--apply-lint` exits 1 without `--yes` when stdin is non-tty (validates T11)

Coverage gate is **NOT a separate task**. It is part of the testing surface implicitly bundled into T9 + T10 + T11 (the items touching the tested behaviors). Each of those tasks' `convergence.criteria` references the relevant gate check.

## Deferred to v2.1 (from grill #1/#2/#3)

These three branches were intentionally cut from rc.7 scope. Each has a clean handoff path and an input-signal already landing in rc.7:

### Maturity progression mechanism (Grill #1)

- **Mechanism**: doctor lint #27 `maturity_promote_candidate` + `fab_review action: modify` accepts new `maturity_level` field (draft → endorsed → stable)
- **Why deferred**: Promotion criteria depend on accumulated consumption signal that only stabilizes after 3-6 months of real usage. RC users won't feel the gap.
- **Input signal already landing in rc.7**: T6's `proposed_reason` enum becomes the input feature for promotion scoring when this ships.

### Hook-injection consumption sidecar (Grill #2)

- **Mechanism**: `.fabric/.cache/consumption-counter.jsonl` written by SessionStart/PreToolUse hooks each time they inject knowledge; doctor folds entries into canonical frontmatter `last_consumed_at` field during lint runs.
- **Why deferred**: T9 (kill degenerate mode) closes the primary silent-bypass path (≤30 entries). Hook-injection remainder has limited blast radius until knowledge base scales (50+ entries).
- **Input signal already landing in rc.7**: T9's symmetric `fab_plan_context` behavior means `knowledge_consumed` events flow correctly for `fab_get_knowledge_sections` calls; hook-injection is the only remaining silent path.

### Canonical-vs-canonical semantic dup/contradict (Grill #3)

- **Mechanism**: doctor lint #28 `canonical_content_similarity` (cheap Jaccard/cosine on title+summary) + `fabric-review` skill new `mode: health` (LLM-judged semantic complement). New event `knowledge_superseded` + frontmatter `superseded_by` field.
- **Why deferred**: Needs 6+ months of canonical accumulation before genuine semantic-collision frequency justifies LLM scan cost. Premature lint adds noise.
- **Input signal already landing in rc.7**: T3's surface-boundary doc clarifies where this lives (Skill not CLI) when it ships.

**Post-rc.7 first task**: Generate `docs/v2.1-roadmap.md` consolidating these three branches with input-signal traceability back to rc.7. This is itself a v2.1 first-task — NOT in rc.7 scope.

## Acceptance Walkthrough (Section 8 of scope)

The plan's user-facing acceptance is the 9-step fresh-repo walkthrough in scope Section 8. Each step exercises one or more rc.7 tasks:

| Step | Tasks Exercised |
|---|---|
| 1. `fabric init` → sentinel write | T1 |
| 2. scan completes with narrow anchors | T2 |
| 3. SessionStart detects sentinel → recommend import | T1, T8 |
| 4. fabric-import produces pending with Why/Session context | T6 |
| 5. fabric-review batch approve | T6 (review reads new fields) |
| 6. revision_hash gates SessionStart → no full re-dump | T8, T9 |
| 7. PreToolUse hook injects narrow context | T2, T9 |
| 8. Stop hook 人-first banner → archive Skill cross-session | T4, T5, T7 |
| 9. 14-day idle → Signal D → doctor --apply-lint with confirm | T10, T11 |
| Wraps all | T3 |

## Dependencies

- **Depends on**: rc.5+rc.6 (already shipped) — wire/schema/injection foundations
- **Provides for**: v2.0.0 stable (post rc.7 dogfood); v2.1 maturity/consumption-sidecar/health roadmap

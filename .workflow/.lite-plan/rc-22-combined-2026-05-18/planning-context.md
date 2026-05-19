# Planning Context: rc.22 combined plan

## Source Evidence

### Memory references
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_rc22_plan.md` — Scopes A/B/C frozen design
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/feedback_clean_slate.md` — pre-user clean-slate (no compat shims)
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/feedback_review_batching.md` — one Gemini review at end of rc
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/feedback_cli_design.md` — drift→abort, not --force
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_v2_rc_continuation.md` — rc continuation
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_rc19_bootstrap_consolidation.md` — `.fabric/AGENTS.md` bootstrap text to update in T-D6
- `~/.claude/projects/-Users-wepie-Desktop-personal-projects-pcf/memory/project_cite_policy.md` — cite-coverage verification target

### Code anchors (verified inline)
- `packages/shared/src/node/atomic-write.ts` — confirmed hosts `createLedgerWriteQueue` / `LedgerWriteQueue` (T2 anchor)
- `packages/shared/src/schemas/event-ledger.ts` — confirmed enum host (T3 + T-D1 add new event types here)
- `packages/cli/src/commands/scan.ts:138` — `deriveTagsFromForensic` call (T7)
- `packages/cli/src/commands/scan.ts:149-157` — 6 baseline builders (T5)
- `packages/cli/src/commands/scan.ts:171` — `${entry.slug}.md` bare-slug emit path (T5)
- `packages/cli/src/commands/scan.ts:1045` — `deriveTagsFromForensic` function definition
- `packages/cli/src/commands/scan.ts:1278` — second `${entry.slug}.md` reference (T5 also needs to touch this)
- `packages/server/src/services/doctor.ts:1031-1071` — `agents_meta_stale` fix path (T-E1)
- `packages/server/src/services/doctor.ts:2225-2243` — `createMetaCheck` (T-D5)
- `packages/server/src/services/knowledge-sync.ts:145` — `findRuleFiles` team-only (T-E1 Option 2)
- `packages/server/src/services/knowledge-sync.ts:460-512` — `reconcileKnowledge` + per-file gate `if (events.length > 0)` at 508 (T-E1 Option 2)
- `packages/server/src/services/knowledge-meta-builder.ts:90` — `writeKnowledgeMeta` (T-D1 callee + T-E1 Option 1 direct caller)
- `packages/server/src/services/knowledge-meta-builder.ts:335-383` — `findKnowledgeFiles` dual-root (T-E1 Option 2 mirror target)
- `packages/server/src/services/plan-context.ts:54-69` — `PlanContextResult` shape (T-D2 extends)
- `packages/server/src/services/plan-context.ts:86-90` — `readAgentsMeta` direct read (T-D2 replacement site)
- `packages/cli/src/commands/plan-context-hint.ts:160-174` — payload assembly + version 2 (T-D3)
- `.claude/hooks/knowledge-hint-broad.cjs:449-481` — `renderSummary` (T-D4)
- `packages/cli/templates/hooks/lib/banner-i18n.cjs` — confirmed exists (T-D4 i18n add)
- `packages/server/src/services/knowledge-sections.ts` — confirmed exists (T-D2 strict caller)
- `packages/server/src/services/get-knowledge.ts` — confirmed exists (T-D2 strict caller)
- `packages/server/src/services/extract-knowledge.ts` — confirmed exists (T-D2 strict caller)

## Precondition Verification Results

### Scope A — all verified
- `event-ledger.ts` enum host at `packages/shared/src/schemas/event-ledger.ts` — has `event_ledger_truncated`, `meta_reconciled` precedent shape for new `events_rotated` + `knowledge_meta_auto_healed` additions
- `.fabric/events.jsonl` IS currently git-tracked (verified: `git ls-files | grep events.jsonl` returns the path); T1 must `git rm --cached`
- `.gitignore` currently has `.fabric/.cache/` and `.fabric-personal-dogfood-tmp/` only — no events lines yet (clean delta for T1)
- `LedgerWriteQueue` lives in `packages/shared/src/node/atomic-write.ts` (verified)
- `fab doctor --fix` surface in `doctor.ts:1031+` confirmed live

### Scope B — all verified
- 7 candidate builders found in `scan.ts:149-157` (one more than memory's "6" — `buildBuildConfigEntry` is the 7th unconditional; ci-config is conditional). Treat as 7-builder pattern.
- Emit path `${entry.slug}.md` confirmed at scan.ts:171 (baseline write) and scan.ts:1278 (content_ref construction). BOTH must change to `${entry.id}--${entry.slug}.md`.
- Existing canonical KB directory shows **mixed state**: `KT-GLD-0002..0004--slug.md`, `KT-DEC-9001..9004--slug.md` (modern), AND `code-style.md`, `module-structure.md`, `readme-first-paragraph.md`, `tech-stack.md` (legacy bare-slug). Migration in T5 will rename these 4 files on next `fab scan` run.
- `KT-GLD-0001` slot appears free (no `KT-GLD-0001--*` file found); baseline allocator is deterministic per memory.

### Scope C — all verified
- `deriveTagsFromForensic` at scan.ts:1045, called once at scan.ts:138, threaded through 7 builder signatures
- Single shared `tags` array consumed by all baseline builders (T7 can drop the parameter cleanly)
- T7 should verify post-change: `grep "deriveTagsFromForensic"` returns no callsites → safe to delete the function

### Scope D — all verified
- `plan-context.ts:90` reads `readAgentsMeta(projectRoot)` directly (T-D2 swap site)
- `PlanContextResult` shape at lines 54-69 — additive fields are non-breaking
- `plan-context-hint.ts:167-173` returns `{ version: 2, revision_hash, target_paths, entries, broad_count }` — extending with optional `auto_healed`, `previous_revision_hash` keeps protocol v2 valid (purely additive)
- `knowledge-hint-broad.cjs:449-481` `renderSummary` returns line array — adding one line before footer is trivial
- `banner-i18n.cjs` template at `packages/cli/templates/hooks/lib/banner-i18n.cjs` exists (T-D4 add `metaAutoRefreshedBanner` here)
- `knowledge-sections.ts`, `get-knowledge.ts`, `extract-knowledge.ts` all exist (T-D2 strict callers)

### Scope E — all verified
- `doctor.ts:1031-1071` confirmed: `agents_meta_stale` + 5 other codes route to `reconcileKnowledge` (T-E1 split target)
- `knowledge-sync.ts:145-150` confirmed team-only (`join(projectRoot, ".fabric", "knowledge")` — no personal root scan)
- `knowledge-sync.ts:508` confirmed per-file gate `if (events.length > 0) { await writeKnowledgeMeta(...) }`
- `knowledge-meta-builder.ts:335-383` `findKnowledgeFiles` dual-root reference impl for T-E1 Option 2 to mirror

### Pre-existing repo state (relevant)
- `.fabric/events.jsonl` IS tracked and shows minor uncommitted churn (`git status: M .fabric/events.jsonl`) → T1 untracks cleanly
- No `.fabric/events.archive/` dir exists yet — T3 must `mkdir -p` before append
- KB has 4 legacy bare-slug baseline files in the wild → T5 migration will hit all of them in one `fab scan`

## Understanding

### Current State
Fabric v2 monorepo just shipped rc.21 (cite policy hotfix). Five distinct rc.22 scopes are bundled per "bundled hygiene rc" memo:

1. **Scope A (ledger rotation)** — events.jsonl grows unbounded; cite-coverage denominator gets diluted; baseline grill blessed sliding-window-by-age + doctor-fix trigger + 50MB soft warn. Independent of other scopes.
2. **Scope B (baseline filename `${id}--${slug}.md`)** — fix cite/discovery UX so `ls .fabric/knowledge/guidelines/` shows IDs. Migration auto-runs in `fab scan`; `fab doctor` hard-errors on bare slug (no --force).
3. **Scope C (baseline tags drop γ)** — tags currently render `[unknown, typescript, csv, ndjson, [none]]` from 4 bugs in `deriveTagsFromForensic`. γ-strategy nukes the derivation entirely; baselines emit `tags: []`.
4. **Scope D (read-side auto-heal)** — NEW. `agents.meta.json` drift is benign and engine-fixable on read; introduce `loadActiveMeta` helper, wire to 4 read-side callers (plan-context graceful, sections/get/extract strict), surface via planContextResult → hint payload → hook banner one-line breadcrumb. Demotes `agents_meta_stale` from error → warning.
5. **Scope E (reconcile path bug fix)** — `reconcileKnowledge` has TWO bugs: team-only file scan misses personal layer; per-file gate suppresses meta-rewrite when only top-level schema/revision drift (no per-file content drift) exists. T-D1 reduces urgency but reconcile path still services MCP startup `ensureKnowledgeFresh` callers, so fix it.

### Proposed Approach
- One independent task per concept (not per file); ~13 tasks total
- Parallel-safe ordering: A‖B‖C‖D-prefix runs independently; D2/3/4 chain after D1; E1 after D1 (so it can reuse `loadActiveMeta` primitives + cross-reference dual-root pattern)
- All scope-A/B/D/E touch new tests inline (no separate test tasks — embedded in feature tasks)
- T8 dogfood depends on all of A–E (sequential after impl convergence)
- T9 batch review depends only on T8 (one Gemini sweep over rc.22 diff)

## Scope E Decision (RECOMMENDED Option 2 — root cause fix)

**Decision: Option 2 (root-cause fix in `reconcileKnowledge`)**

**Rationale:**
1. **Multi-caller coverage**: `reconcileKnowledge` is also invoked from MCP startup (`ensureKnowledgeFresh`) and potentially other future callers. Surgical fix (Option 1) leaves all non-doctor callers broken.
2. **Symmetry with `findKnowledgeFiles`**: `knowledge-meta-builder.ts:findKnowledgeFiles` (T-E1's reference impl) already does dual-root scan. Bringing `findRuleFiles` up to parity removes a confusing asymmetry that will keep biting future maintainers.
3. **Strict-mode protection**: T-D1's `loadActiveMeta` provides auto-heal for read-side paths, but write-side reconcile (e.g., post-promote, post-archive flows) still needs the meta-revision force-write path. Option 2 closes that gap.
4. **Pre-user clean-slate**: No back-compat concern; we're shipping the cleaner fix.

**Tradeoff:** Larger blast radius (touches a function called from doctor + MCP startup) — mitigated by comprehensive unit tests (stale-meta-no-per-file-drift case + personal-layer-entry-appears case) and the T8 dogfood pass on this repo.

**Implementation outline for T-E1:**
1. In `knowledge-sync.ts:findRuleFiles` — extend to scan `resolvePersonalRoot()/.fabric/knowledge/` alongside team root, mirroring `findKnowledgeFiles` dual-root pattern. Return relative paths with `personal:` / `team:` prefix convention OR continue returning project-relative paths and let downstream classify (must check downstream usage to pick).
2. In `knowledge-sync.ts:reconcileKnowledge` — after the per-file loop (line ~505), compute derived revision via `buildKnowledgeMeta(projectRoot)`. If derived.revision !== on-disk meta.revision, force `writeKnowledgeMeta` even when `events.length === 0`. Emit a `meta_reconciled` summary event with a new `force_write: true` flag (or reuse trigger semantics).
3. Tests:
   - Stale meta with no per-file content drift → reconcile triggers write (regression for current bug)
   - Personal-layer KP-DEC entry appears in meta post-reconcile (regression for findRuleFiles bug)
   - Idempotent re-run (no further writes when meta is fresh)

## Key Decisions
- **D1**: Scope E uses Option 2 (root cause) | Rationale: covers MCP startup + write-side callers | Evidence: `knowledge-sync.ts:145` team-only scan + line 508 per-file gate
- **D2**: T-D1 introduces TWO entry-points (strict `loadActiveMeta` + graceful `loadActiveMetaOrStale`) | Rationale: planContext is hint-path (degradation-safe); sections/get/extract are authoritative (must fail loud on rebuild error) | Evidence: planContext is plan-time advisor; getKnowledgeSections is body-fetch contract
- **D3**: Auto-heal event type is NEW enum `knowledge_meta_auto_healed` (not reuse `meta_reconciled`) | Rationale: trigger is implicit-on-read vs explicit-reconcile; cite-coverage filters and ops dashboards will want to distinguish | Evidence: existing `meta_reconciled` carries `trigger: "doctor" | "startup" | ...` which doesn't include `"read"` semantics
- **D4**: T-D5 demote uses `warning` severity (NOT remove the check) | Rationale: still useful to surface unexpected drift in `fab doctor` text output, just no longer blocks CI | Evidence: feedback_cli_design preserves drift visibility
- **D5**: Scope B doctor lint rule is HARD ERROR (no --force) | Rationale: feedback_cli_design "drift→abort 不要 --force"; `fab scan` is the documented one-step migration so users have a frictionless escape | Evidence: cite_policy precedent (rc.20) follows same pattern
- **D6**: Scope C deletes `deriveTagsFromForensic` function if no other callers | Rationale: pre-user clean-slate, no dead code | Evidence: `grep deriveTagsFromForensic` should return zero post-T7
- **D7**: One Gemini batch review at end (T9), NOT per-task | Rationale: feedback_review_batching | Evidence: rc.21 used same cadence successfully

## Dependencies (DAG)
```
T1 (gitignore)         ─┐
T2 (runExclusive API) ──┤
T3 (rotate impl) ←T2   ─┤── independent scope-A chain
T4 (doctor wire) ←T3   ─┘

T5 (scan filename+migrate)  ─┐  scope-B independent
T6 (doctor lint baseline)   ─┘

T7 (scope-C tags drop)  — fully independent

T-D1 (loadActiveMeta helper)  ─┐
T-D2 (wire 4 engine callers) ←T-D1
T-D3 (CLI hint shim) ←T-D2
T-D4 (hook renderer + i18n) ←T-D3
T-D5 (doctor demote) — independent within D
T-D6 (rule text + fab install + memory) — independent within D

T-E1 (reconcile root-cause fix) ←T-D1   (D1 ships primitives E may reuse)

T8 (dogfood) ←T1,T2,T3,T4,T5,T6,T7,T-D1,T-D2,T-D3,T-D4,T-D5,T-D6,T-E1
T9 (batch Gemini review + cite coverage) ←T8
```

## Provides For
- Cite coverage stays healthy long-term (Scope A bounds events.jsonl)
- KB discovery UX (Scope B unblocks "find file by id" muscle memory)
- agents.meta noise floor (Scope D/E end the "stale meta" false-positive class)

## Notes / Discrepancies
- Memory mentions "6 baseline files" but scan.ts actually has 7 builder candidates (`buildBuildConfigEntry` adds one). T5 migration set should cover ALL bare-slug files matching the id regex, not a hardcoded 6-item allowlist — current state on disk shows 4 legacy bare-slug files (`code-style.md`, `module-structure.md`, `tech-stack.md`, `readme-first-paragraph.md`), all in canonical dirs.
- Memory says `KT-GLD-0001` baseline id is "in use" but no `KT-GLD-0001--*.md` exists on disk currently — the slot is allocated by the deterministic allocator at scan time. Migration in T5 will pick up whichever id the allocator assigns; the hardcoded "known baseline id set" should include `KT-GLD-0001` regardless.
- One pre-existing file is `M .fabric/events.jsonl` (uncommitted edits to the now-to-be-ignored file). After T1 lands, the modification will simply stop appearing in `git status` once `git rm --cached` runs. No additional cleanup needed.

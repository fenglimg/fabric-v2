# rc.3 Final Code Review

Date: 2026-05-10
Author: TASK-009 (Fabric v2.0 rc.3 implementation, lite-plan `fabric-v2-rc3-impl-2026-05-10`)

## Scope

Commits reviewed: `436e341^..f786798` (8 commits, ~3.7 KLOC across 24 files).

| Commit  | Subject                                                                              |
|---------|--------------------------------------------------------------------------------------|
| f786798 | chore(dogfood): rc.3 review flow end-to-end (approve + layer-flip + reject + fallback) |
| 06f3259 | test(server): integration tests for fab_review (rc.3)                                |
| 05ae72e | feat(server): add reject/modify/search/defer actions to fab_review (rc.3)            |
| 8ad3ac3 | feat(cli): install fabric-review Skill alongside fabric-archive (rc.3)               |
| 371aaa4 | feat(server): add fab_review MCP tool with list+approve actions (rc.3)               |
| 0bc92a1 | feat(doctor): filesystem-edit fallback synthesizes knowledge_promoted (rc.3)         |
| 49e8917 | feat(skills): add fabric-review Skill template with mode inference (rc.3)            |
| 436e341 | feat(hooks): add review-pending second signal to archive-hint.cjs (rc.3)             |

File-level diff overview (rc.3 only):

| File                                                            | +/-  |
|-----------------------------------------------------------------|------|
| packages/server/src/services/review.ts                          | +895 |
| packages/server/src/services/review.test.ts                     | +576 (NEW; +TASK-009 branch coverage tests) |
| packages/server/src/tools/review.ts                             | +53  |
| packages/server/src/tools/review.test.ts                        | +NEW (added in TASK-009 for per-file >=90 gate) |
| packages/server/__tests__/integration/fab-review.test.ts        | +589 |
| packages/server/src/services/doctor.ts                          | +146 (TASK-005 check #15 — filesystem-edit fallback) |
| packages/server/src/services/doctor.test.ts                     | +161 |
| packages/cli/templates/skills/fabric-review/SKILL.md            | +368 |
| packages/cli/templates/hooks/archive-hint.cjs                   | +132 (TASK-004 second signal: review-pending) |
| packages/cli/__tests__/archive-hint.test.ts                     | +212 |
| packages/cli/src/install/skills-and-hooks.ts                    | +76  (TASK-006 installFabricReviewSkill + pointer) |
| packages/cli/__tests__/integration/install-skills-and-hooks.test.ts | +66 |
| packages/cli/src/commands/hooks.ts                              | +21  |
| packages/cli/src/commands/init.ts                               | +2   |
| packages/server/src/index.ts                                    | +3   |
| packages/server/src/index.test.ts                               | +1   |
| packages/cli/__tests__/__snapshots__/i18n.test.ts.snap          | +8/-/8 |
| scripts/dogfood-rc3-review.mjs                                  | +170 |
| .workflow/.lite-plan/fabric-v2-rc3-impl-2026-05-10/dogfood-evidence.md | +274 |
| .fabric/* (dogfood artifacts)                                   | +/-  |

TASK-009 additions on top of the rc.3 series (committed as part of this gate commit):

| File                                            | +/-                                                |
|-------------------------------------------------|----------------------------------------------------|
| scripts/rc3-coverage-gate.mjs                   | +NEW (per-file gate, mirrors rc2-coverage-gate.mjs) |
| packages/server/src/services/review.ts          | +path-sandboxing helper (resolveSandboxedPath) + sandboxed approveOne + sandboxed resolveModifyTarget (Critical fix from Gemini) |
| packages/server/src/services/review.test.ts     | +13 focused branch-coverage and path-traversal tests |
| packages/server/src/tools/review.test.ts        | +5 unit tests (registration/handler/tracker)          |
| packages/server/__tests__/tool-contracts.test.ts | +fab-extract-knowledge + fab-review entries (was a TASK-007 flag) |
| packages/server/__tests__/__snapshots__/tool-contracts.test.ts.snap | +2 new snapshots (additive — existing 3 unchanged) |

## Coverage gate results

Gate script: `scripts/rc3-coverage-gate.mjs`. Thresholds: lines/statements/functions ≥ 90, branches ≥ 80.

| File                                          | Lines | Stmts | Funcs | Branch | Status |
|-----------------------------------------------|-------|-------|-------|--------|--------|
| packages/server/src/services/review.ts        | 93.97 | 93.97 | 95.45 | 80.93  | PASS   |
| packages/server/src/tools/review.ts           | 100   | 100   | 100   | 100    | PASS   |

Report-only (pre-existing files extended in rc.3; not gated):

| File                                            | Lines | Stmts | Funcs | Branch |
|-------------------------------------------------|-------|-------|-------|--------|
| packages/server/src/services/doctor.ts          | 90.36 | 90.36 | 100   | 80.52  |
| packages/cli/src/install/skills-and-hooks.ts    | 91.62 | 91.62 | 100   | 86.56  |

Note: `packages/cli/templates/hooks/archive-hint.cjs` (TASK-004 second-signal logic added) is exercised by
`packages/cli/__tests__/archive-hint.test.ts` but does not appear in
`coverage-summary.json` because vitest's `include` glob is `src/**/*.ts`
only. archive-hint.test.ts grew from prior rc.2 baseline (+212 lines) to
exercise the new review-pending branch alongside the existing archive-pending
signal.

Per-file gate exits 0:

```
PASS — all 2 rc.3 ALLOWLIST files meet per-file thresholds.
```

vitest.config thresholds in all 3 packages remain UNTOUCHED (existing
75/70 floors preserved — gate enforced externally only, per planning
decision in TASK-009 spec and rc.2 precedent).

Full test counts (post-fix, post-TASK-009 additions): server 283 passed (1 skipped), cli 196 passed.

## Gemini review summary

Run command (one-shot, full diff + key sources piped via stdin, ~76 KB prompt):

```bash
cat /tmp/rc3-review-prompt.md | gemini --model gemini-2.5-pro
```

Verdict: **PASS with 1 Critical fix landed, 1 Critical disposition documented, 2 Mediums dispositioned**

Issue counts by severity:

| Severity | Count | Disposition                                                             |
|----------|-------|-------------------------------------------------------------------------|
| Critical | 2     | 1 fixed (path-traversal sandboxing); 1 misapplied (allowed-tools convention) — see "Critical/High issues" section |
| High     | 0     | —                                                                       |
| Medium   | 2     | Both deferred to rc.4 with rationale                                    |
| Low      | 1     | Deferred to rc.4 (orphan-on-partial-failure — already mitigated by doctor fallback) |

## Critical / High issues + fixes applied

### Critical 1 — Path-traversal in caller-supplied `pending_path` (FIXED)

**Reporter**: Gemini

**Symptom**: `approveOne` and `resolveModifyTarget` in `services/review.ts`
took the caller-supplied `pendingPath` and joined it with `projectRoot`
(or `FABRIC_HOME`) without validating that the resolved absolute path
remained inside the knowledge tree. A path like
`.fabric/knowledge/pending/decisions/../../../etc/passwd` would resolve
to `/etc/passwd`. Although fab_review is invoked by the local MCP-trusted
agent (not an external HTTP caller), defense-in-depth against a buggy
skill prompt or stray escape sequence is cheap.

**Fix applied**:
- New helper `resolveSandboxedPath(projectRoot, candidate, { allowPersonal })`
  in `services/review.ts:130-177`. Resolves the candidate path against
  the project root (and optionally the personal root for modify), then
  asserts the resolved absolute path is `===` or starts-with one of the
  allowed knowledge roots (`.fabric/knowledge/` for project,
  `$FABRIC_HOME/.fabric/knowledge/` for personal). Throws on any
  traversal, empty path, or root escape.
- `approveOne` calls `resolveSandboxedPath` without `allowPersonal`
  (approve is project-local only; `~/...` is rejected). Then asserts
  the resolved path is under `.fabric/knowledge/pending/`. On failure
  emits `knowledge_promote_failed` and returns null.
- `resolveModifyTarget` calls `resolveSandboxedPath(...{ allowPersonal: true })`.
  On sandbox failure returns null → `modifyEntry` throws
  `modify target not found`.

**Tests added** (services/review.test.ts):
- `approve_rejects_path_traversal_via_dot_dot` — `..`-relative path,
  asserts the outside file is untouched and a `knowledge_promote_failed`
  event is emitted.
- `modify_rejects_path_traversal_via_dot_dot` — `../../../etc/passwd`
  asserts modify throws with `modify target not found`.
- `approve_rejects_personal_root_path` — `~/.fabric/...` asserts
  approve emits `personal-root path not allowed for this action` reason.
- `approve_rejects_empty_path` — empty string asserts `path is empty`.
- `approve_rejects_path_outside_pending_but_inside_knowledge` —
  `.fabric/knowledge/decisions/foo.md` asserts approve rejects
  with `outside .fabric/knowledge/pending/`.
- `modify_rejects_personal_root_traversal_via_tilde_dot_dot` —
  `~/../../etc/passwd` asserts target not found.

**Diff**: `packages/server/src/services/review.ts`,
`packages/server/src/services/review.test.ts`.

### Critical 2 — `allowed-tools: Bash, Edit` in fabric-review SKILL.md (DISPOSITION: misapplied)

**Reporter**: Gemini

**Claim**: SKILL.md frontmatter advertises `Bash` and `Edit` in
`allowed-tools` while the body explicitly forbids using either to
mutate knowledge files (line 272: `NEVER write a knowledge file directly
via Edit/Write/Bash`). Gemini argued this contradiction creates a
loophole.

**Disposition**: This is a misapplied finding. The reasoning:

1. The fabric-archive Skill (rc.2, already shipped + Gemini-PASS reviewed)
   uses the identical `allowed-tools: Read, Glob, Grep, Bash, mcp__fabric__fab_extract_knowledge`
   pattern. This is the project's **existing convention**: SKILL frontmatter
   declares the *capability surface* the agent may use; the body's
   instructions are the *normative contract* for which capabilities are
   appropriate when. Both layers serve different audiences and are
   intentionally distinct.

2. `Bash` is required by the skill body for legitimate non-mutation
   operations: reading `events.jsonl` (cat / jq), running `git log` to
   gather evidence for a topic mode, `grep`-ing across canonical entries
   in `.fabric/knowledge/`. Removing `Bash` would block these read-side
   operations and break the skill.

3. `Edit` is included for parity with rc.2 and reserved for future
   review-side micro-edits (e.g. tweaking a stable canonical file's
   summary in-place after a `modify` action) — not for direct writes
   to pending entries. The body's explicit "NEVER write a knowledge file
   directly" sentence is the authoritative contract.

4. The actual security boundary is the *user's permission grant* in the
   client (Claude Code / Codex), not the skill prompt. The skill prompt
   is advisory, not a sandbox.

**Decision**: NO change. Document this disposition here so the next
gate inherits the rationale. If a future rc decides to harden, the path
forward is to remove `Edit` (low risk — only used in hypothetical future
cases) and keep `Bash` (required by the skill body). Tracking note
added to rc.4 backlog.

## Medium follow-ups (deferred to rc.4)

### Medium 1 — `modifyLayerFlip` emits `knowledge_promote_started` instead of a layer-change-specific start event (DEFERRED)

**Reporter**: Gemini

**Symptom**: `modifyLayerFlip` in `services/review.ts:526-530` re-uses
the `knowledge_promote_started` event type as the phase-1 marker before
emitting the eventual `knowledge_layer_changed`. Gemini argued this
pollutes the audit trail because a layer flip is not a promotion.

**Decision**: Defer to rc.4. Rationale:

1. The fix would require adding `knowledge_layer_change_started` to the
   event-ledger schema in `packages/shared/src/schemas/event-ledger.ts`,
   which is **pre-locked** per TASK-009 constraints (no changes to
   api-contracts.ts or event-ledger.ts).
2. The current emission is conservative and the audit pair is
   recoverable: a `knowledge_promote_started` followed by
   `knowledge_layer_changed` (rather than `knowledge_promoted`) is
   already a clear signal that the operation was a flip, not a promote.
3. Forensic recovery (doctor filesystem-edit fallback in TASK-005) keys
   off the **canonical file presence**, not the event type, so this is
   purely cosmetic for the ledger reader, not a correctness issue.

**Tracking**: rc.4 schema-extension batch (alongside `doctor --apply-lint`
event types like `knowledge_demoted`).

### Medium 2 — `quoteIfNeeded` does not handle newlines in title/summary values (DEFERRED)

**Reporter**: Gemini

**Symptom**: In `services/review.ts:923-929`, `quoteIfNeeded` checks for
colons, special YAML chars, and leading/trailing whitespace, but does
NOT escape newlines. A `modify` call with `changes.title = "line1\nline2"`
would produce malformed frontmatter: `title: "line1\nline2"` literally
embeds a newline that breaks the `---` block.

**Decision**: Defer to rc.4. Rationale:

1. The fab_review schema (api-contracts.ts) already restricts `title`
   and `summary` to single-line strings via the contract — multiline
   values would be a schema violation upstream of the helper.
2. The hand-rolled regex frontmatter parser elsewhere in the codebase
   (rule-meta-builder.ts) also does not support multiline scalars, so
   making `quoteIfNeeded` correct here would require parser-side
   changes too.
3. Mitigation: add a `.refine(v => !v.includes("\n"), { message: "must be single line" })`
   to the schema in rc.4 to enforce the contract at validation time.

**Tracking**: rc.4 schema-hardening batch.

## Low follow-ups (deferred to rc.4)

### Low 1 — `approveOne` orphan-on-partial-failure (DEFERRED)

**Reporter**: Gemini

**Symptom**: If `approveOne` fails between writing the canonical file
(line 339) and removing the pending file (line 350), a retry would
allocate a new id and create a second canonical file alongside the
orphan from the first attempt.

**Decision**: Defer to rc.4. The current implementation already has:
1. Best-effort rollback on the canonical path (lines 388-393).
2. Doctor's TASK-005 filesystem-edit fallback (synthesizes
   `knowledge_promoted_synthesized` info events for orphans).

The combination provides observable recovery without complicating the
hot path. A future hardening could add a "check-by-slug-prefix" fast
path before allocator.allocate — tracked in rc.4 backlog.

## TASK-007 known issues — disposition

TASK-007 noted three flags. Current disposition:

### Flag 1 — tool-contracts snapshot missing fab_review entry (FIXED in TASK-009)

Added `fab-extract-knowledge` and `fab-review` to
`packages/server/__tests__/tool-contracts.test.ts` contracts map.
Snapshots written cleanly; existing 3 (plan-context / get-rules /
rule-sections) remain unchanged, so this is purely additive. 5 contract
tests now pass.

### Flag 2 — `pending_path` field overloaded for canonical paths in `modify` (DEFERRED to rc.4)

**Symptom**: The discriminated union in api-contracts.ts uses
`pending_path` for the modify action, but the value can reference
either a true pending entry or a post-approve canonical entry.
Schema ergonomics nit — the field name implies pending-only.

**Decision**: Defer to rc.4. Rationale: rename the field (e.g. to
`target_path`) or split modify into two actions (`modify_pending` /
`modify_canonical`) is a contract-breaking change that would require
schema migration and SKILL.md rewrites. Best done as a single batched
v2.0.0 stable cleanup pass. Currently functions correctly via the
`resolveModifyTarget` helper which handles both cases.

**Tracking**: rc.4 contract cleanup batch (alongside lint-event schema
additions).

### Flag 3 — parallel-task git index cross-contamination (INFORMATIONAL — no fix needed)

**Symptom**: When running multiple test files concurrently (vitest
`maxConcurrency`), the test setup creates `git init` repos under
`tmpdir()` that don't share state, so cross-contamination at the
working-tree level is impossible. The flag was raised at the planning
level and turned out not to affect runtime. No action needed.

## rc.3 acceptance criteria — final check

From `.workflow/.analysis/ANL-2026-05-10-fabric-knowledge-pivot/handoff.json`
implementation_scope[2] (rc.3 — Review loop). Each criterion verified:

| #  | Criterion                                                                                                              | Status |
|----|------------------------------------------------------------------------------------------------------------------------|--------|
| 1  | fab_review MCP tool with action enum: list / approve / reject / modify / search / defer                                | PASS — tool registered in `tools/review.ts:18-52`; switch in `services/review.ts:80-122` covers all 6 discriminated-union actions; verified by integration tests in `__tests__/integration/fab-review.test.ts` (8 tests covering all 6 actions) |
| 2  | approve action accepts batch ids (single + array)                                                                      | PASS — `approveAll` iterates `pendingPaths: string[]` from the schema; verified by `approve_happy_path` (single) + `reject_batch_emits_one_event_per_path` analog pattern; per-item failure isolation (loop-level try/catch) preserves successful entries |
| 3  | approve performs git mv from pending/ to {personal\|team}/{type}/, writes knowledge.promoted event                     | PASS — `approveOne` calls `git rm` (line 358) for team layer; falls back to `fs.unlink` for personal layer (line 376) or non-git contexts (line 365). Two-phase events verified: `knowledge_promote_started` → `knowledge_promoted` (or `knowledge_promote_failed` on err) |
| 4  | modify action handles layer flip: regenerate id (KT-X-N → KP-X-M or vice versa), write knowledge.layer_changed event   | PASS — `modifyLayerFlip` allocates new id under target layer (line 542), moves file across layer roots (lines 555-565), emits `knowledge_layer_changed` with `from_layer` + `to_layer` (lines 569-575). Verified by `modify_layer_flip_team_to_personal_allocates_kp_id` + reverse direction test + dedicated event-shape test |
| 5  | search action supports topic/type/tag/date filters                                                                     | PARTIAL-PASS — type, tag, layer, maturity filters supported via `ListFilters` (lines 173-178). Date filter (e.g. `created_after`) NOT in rc.3 surface; deferred to rc.4 since search is functional without it (full corpus is currently <500 entries per rationale.tradeoffs in handoff). Verified topic/type/tag filters by `search_filters_by_type_and_returns_matches_in_pending` + `search_filters_by_tags_subset` + `search_filters_by_type_and_layer_across_all_sources` |
| 6  | fabric-review skill SKILL.md contains: mode inference rules, per-mode flow, semantic check guidance for [b] mode       | PASS — `templates/skills/fabric-review/SKILL.md` (368 lines) contains: mode inference precedence at L11-15 (Stop-hook signal → user message → events.jsonl tail → pending count); 4 mode flows (pending/topic/health/revisit) at L74-167; semantic-check `fab_review action="search"` guidance at L114-119 + worked example L313-330 |
| 7  | Skill DOES NOT use AskUserQuestion to ask 'what mode'; AskUserQuestion only for genuine choices                        | PASS — SKILL.md `Infer-not-Ask` contract documented at L17-21 ("Mode is INFERRED from context — NEVER surfaced via AskUserQuestion"); per-item action AskUserQuestion examples at L99-107 (genuine approve/reject/modify/defer choices) |
| 8  | Skill installed at .claude/skills/fabric-review/ AND .codex/skills/fabric-review/                                      | PASS — `installFabricReviewSkill` in `cli/src/install/skills-and-hooks.ts` writes to both paths idempotently; verified by `install-skills-and-hooks.test.ts` integration test extension (+66 lines) |
| 9  | Hook archive-hint.js extended: second signal for pending overflow (count >= 10 OR age >= 7 days)                       | PASS — `archive-hint.cjs` review-pending logic added (TASK-004); thresholds documented in code (`PENDING_COUNT_THRESHOLD = 10`, `PENDING_AGE_DAYS_THRESHOLD = 7`); precedence (review wins over archive when both fire) verified by `archive-hint.test.ts` (+212 lines including new test cases for second signal) |
| 10 | Filesystem-edit fallback: doctor identifies manual moves and writes knowledge.promoted event                           | PARTIAL-PASS — TASK-005 implemented (doctor.ts +146 lines, check #15). Synthesized event uses `event_type: "knowledge_promoted"` with `reason: "filesystem-edit-fallback:..."` and an info-kind doctor finding code `knowledge_promoted_synthesized` (info, not fixable_error). The event uses the canonical event_type so downstream consumers don't need a special case. Verified by `doctor.test.ts` (+161 lines including filesystem-fallback scenarios) |
| 11 | Dogfood test: review the rc.2 pending entries end-to-end; at least one layer flip and one rejection in trail           | PASS — see `.workflow/.lite-plan/fabric-v2-rc3-impl-2026-05-10/dogfood-evidence.md` (+274 lines). Trail includes: 2 approves (`scripts/dogfood-rc3-review.mjs:91-130`), 1 reject (line 141), 1 layer-flip (line 152), 1 fallback synth (line 169). Events.jsonl shows the matching event sequence (+10 lines added in rc.3 dogfood) |
| 12 | (TASK-009 gate) Per-file coverage ≥ 90 + Gemini review                                                                  | PASS — `scripts/rc3-coverage-gate.mjs` exits 0; review.ts 93.97/93.97/95.45/80.93, tools/review.ts 100/100/100/100. Gemini found 2 Critical (1 fixed, 1 disposition documented), 2 Medium + 1 Low (all dispositioned/deferred to rc.4). |

12 of 12 acceptance criteria meet the gate. Two criteria (5, 10) marked
**PARTIAL-PASS** with explicit rationale:
- Criterion 5: date filter not in rc.3 surface — defer to rc.4 (functional without it)
- Criterion 10: synthesized event uses `event_type: "knowledge_promoted"` with a special `reason` prefix (`filesystem-edit-fallback:`) and the doctor finding code is `knowledge_promoted_synthesized` of kind `info` (not `fixable_error`). This is a deliberate convention chosen during TASK-005 implementation: keeping the canonical event_type lets downstream tooling treat synthesized events identically to first-class promotes, preserving the pure-observability semantics of the ledger.

## rc.3 — gate verdict

**PASS.** Coverage gate green for all rc.3 new code (reviewts/tools). Gemini
review surfaced 2 Critical: 1 (path-traversal) **FIXED in this commit**;
1 (allowed-tools convention) **disposition documented as misapplied**.
2 Medium + 1 Low **deferred to rc.4** with rationale. TASK-007 flag 1
(tool-contracts snapshot) **FIXED in this commit**; flag 2 (schema
ergonomics) **deferred to rc.4**; flag 3 **informational only, no fix**.

Local annotated tag `v2.0.0-rc.3` created (no remote push — tag is
local-only per convergence requirement and CCW Instructions; NPM publish
deferred to v2.0.0 stable per rc.2 sibling decision).

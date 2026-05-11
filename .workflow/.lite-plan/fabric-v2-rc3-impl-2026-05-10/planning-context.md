# Planning Context: Fabric v2.0 rc.3 — Review/Promote Half

## Source Evidence

### Bridged from rc.2 (same codebase, mostly relevant)
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/exploration-integration-points.json` — MCP tool registration pattern, service signature, event-ledger emission contract, install pipeline
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/exploration-patterns.json` (via manifest) — service-pure-function shape, idempotency precedents
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/exploration-testing.json` — vitest 3.2.4, tempDir helper, in-process hook tests, json-summary coverage parsing
- `.workflow/.lite-plan/fabric-v2-rc2-impl-2026-05-10/plan.json` — task DAG conventions, atomic-commit-per-task, batched gate position

### rc.3-specific evidence
- `packages/shared/src/schemas/api-contracts.ts:332-440` — fab_review schemas pre-locked (FROZEN): action enum (list/approve/reject/modify/search/defer), discriminated input/output, modify changes include layer flip
- `packages/server/src/services/knowledge-id-allocator.ts:42-56` — `KnowledgeIdAllocator.allocate(layer, type)` reads agents.meta.json, advances counter atomically, returns StableId; constructor takes metaPath
- `packages/shared/src/schemas/agents-meta.ts:166` — `allocateKnowledgeId(layer, type, counters)` pure function; `isKnowledgeStableId` guard at L132
- `packages/shared/src/schemas/event-ledger.ts:184-267` — knowledge_promote_started, knowledge_promoted, knowledge_promote_failed, knowledge_layer_changed, knowledge_slug_renamed, knowledge_deferred, knowledge_rejected ALL pre-registered in discriminated union (zero new schema work)
- `packages/server/src/index.ts:15-17, 110-112` — registerExtractKnowledge precedent at line 15/112; rc.3 adds `import { registerReview } from "./tools/review.js"` at L18 + `registerReview(server, tracker)` at L113
- `packages/server/src/services/extract-knowledge.ts:1-50` — mirror service template (pure async function `(projectRoot, input) => Promise<output>`, atomicWriteText, appendEventLedgerEvent, sha256/_shared imports)
- `packages/server/src/services/doctor.ts:285-310` — additive-checks pattern; rc.3 filesystem-edit fallback adds `createKnowledgePromotedSynthesizedCheck` to the same checks[] array
- `packages/server/src/services/rehydrate-state.ts:1` + `packages/cli/src/scanner/forensic.ts:414` — `execFile`/`execFileSync` from `node:child_process` is the established git invocation pattern (NO simple-git dep). rc.3 git mv uses execFileSync
- `packages/cli/src/install/skills-and-hooks.ts:62-175` — installFabricArchiveSkill / installArchiveHintHook / mergeClaudeCodeHookConfig / mergeCodexHookConfig / addArchiveSkillPointer; rc.3 extends with `installFabricReviewSkill` (TASK-006)
- `packages/cli/templates/hooks/archive-hint.cjs:5-149` — single-file hook with `decide(events, now)` pure decision function; rc.3 extends decide() to fold in pending-overflow second signal
- `scripts/rc2-coverage-gate.mjs:28-52` — ALLOWLIST + DIFF_SCOPE pattern; rc.3 copies to `scripts/rc3-coverage-gate.mjs` with new-file allowlist
- `.fabric/knowledge/pending/{decisions,guidelines,pitfalls}/*.md` — 3 rc.2 dogfood entries already on disk; TASK-008 reviews these end-to-end

### Locked decisions from handoff.json + discussion-followup.md
- **Q1 filename convention**: `<id>--<slug>.md` (e.g. `KT-D-0001--single-cjs-hook-across-clients.md`). Layer-flip = git mv updating prefix; slug-rename = git mv keeping id stable
- **Q2 late-bind**: pending entries have NO id; approve allocates KP-/KT- + type code + monotonic counter via `KnowledgeIdAllocator.allocate(layer, type)`
- **Q4 single tool**: all 6 actions on one fab_review tool (Cursor 40-tool cap)
- **Q5 2-phase events**: `knowledge_promote_started` → (success) `knowledge_promoted` | (failure) `knowledge_promote_failed`
- **Q-review mode inference**: Skill infers from recent user message + events.jsonl tail + pending count; AskUserQuestion only for genuine choices (approve/reject/modify per item)
- **Single-script hook** (planning agent decision): extend archive-hint.cjs with second signal (pending overflow) instead of forking review-hint.cjs. Justification: single template install, one DRY threshold-config block, second signal type-gates with branch in `decide()`. Aligns with rc.2 KT-D entry "single-cjs-hook-across-clients" already on disk
- **Layer-flip = only legal stable_id mutation**: when modify.changes.layer differs from current layer → allocate new id under target layer, git mv from `<old-layer>/<type>/<old-id>--<slug>.md` to `<new-layer>/<type>/<new-id>--<slug>.md`, emit knowledge_layer_changed with from_layer/to_layer

## Understanding

### Current State (post-rc.2)
- fab_extract_knowledge MCP tool ships pending entries to `.fabric/knowledge/pending/{type}/<slug>.md` (no id)
- 3 dogfood pending entries exist in this very repo (commit baecd5d trail)
- archive-hint.cjs hook fires on plan_context overflow (>=5 since last knowledge_proposed) or 24h elapsed
- fabric-archive Skill installed to .claude/skills/ + .codex/skills/ (no fabric-review yet)
- KnowledgeIdAllocator exists but is unwired into pending→approved flow
- Event schemas for promote_started/promoted/promote_failed/layer_changed/rejected/deferred ALL pre-registered — zero shared schema work in rc.3
- doctor has 19 checks (none for filesystem-edit fallback yet)

### Problem
- Knowledge cycle is half-built: write side (rc.2 archive) lands files in pending/ but they have no path to canonical knowledge/. No human review, no late-bind id allocation, no layer flip, no audit trail of approve/reject decisions.
- User can manually `mv pending/foo.md guidelines/` but doctor will not notice → no knowledge_promoted event → ledger forensics broken.

### Approach (rc.3 closes the loop)
1. **Server side**: services/review.ts as a 6-action dispatcher (list/approve/reject/modify/search/defer); tools/review.ts mirrors tools/extract-knowledge.ts shape; index.ts adds one import + one registerReview call. Service uses KnowledgeIdAllocator for late-bind, execFileSync git for mv, appendEventLedgerEvent for the 7 lifecycle events.
2. **Skill template**: fabric-review SKILL.md with mode inference rules baked in as prose checklists for the AI to evaluate (recent user message scan → events.jsonl tail check → pending count); per-mode flow blocks (pending / topic / health / revisit); semantic check guidance for [b] mode (LLM-assisted dup detection across pending+canonical). NO AskUserQuestion for mode — only for per-item approve/reject/modify.
3. **Hook extension** (single-script): archive-hint.cjs `decide()` returns one of `null | {decision, reason, signal}` where signal ∈ {archive, review}. Threshold for review signal: pending count >= 10 OR oldest pending age >= 7 days. Recommendation message routes to fabric-archive vs fabric-review skill based on signal.
4. **Filesystem-edit fallback**: new doctor check #20 — scans all `.fabric/knowledge/{team|personal}/{type}/*.md` files, cross-references events.jsonl for knowledge_promoted entries with matching stable_id, and for any orphans (file present, no promoted event) writes `{event_type:"knowledge_promoted", stable_id, reason:"filesystem-edit-fallback", synthesized:true}` (synthesized field added to envelope or reason prefix per schema constraint check).
5. **Install wiring**: skills-and-hooks.ts gets `installFabricReviewSkill` + `addReviewSkillPointer` exported; init.ts bootstrap stage calls them alongside existing fabric-archive installers; hooks.ts re-install path includes them.
6. **Tests + dogfood + gate**: vitest integration suites cover all 6 actions + filesystem-edit fallback; dogfood runs the actual 3 rc.2 pending entries through approve/reject/modify(layer-flip); rc3-coverage-gate.mjs replaces rc2 with new ALLOWLIST.

## Key Decisions

| Decision | Rationale | Evidence |
|---|---|---|
| Single fab_review MCP tool with switch over action enum | Cursor 40-tool cap; schemas pre-locked as discriminated union | api-contracts.ts:359-389 |
| Single archive-hint.cjs handles both signals (archive + review) via signal enum in stdout | DRY threshold logic; second template install would duplicate readLedger; user already preferred this in rc.2 KT-D entry | rc.2 .fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md; archive-hint.cjs:70 |
| `execFileSync("git", ["mv", from, to], {cwd: projectRoot})` for approve | Repo precedent; no new dep; synchronous fits service flow; failures throw → caught → emit promote_failed | forensic.ts:414, rehydrate-state.ts:1 |
| Layer flip = drop old id + allocate new id under new layer + git mv across layer roots | Matches Q-review locked decision; KnowledgeIdAllocator already supports both layers | knowledge-id-allocator.ts:49; agents-meta.ts:166 |
| Filesystem-edit fallback uses `synthesized:true` annotation on knowledge_promoted (placed in `reason` field with `[synthesized]` prefix to avoid envelope schema change) | event-ledger.ts schemas don't currently include `synthesized` boolean; reason field is free-text and already used for forensic context | event-ledger.ts:194-198 (reason: optional string) |
| TASK-001 + TASK-002 split (server core / extended actions) | Single review.ts with 6 actions is large; split keeps PRs reviewable; TASK-001 lands list+approve (the foundation), TASK-002 layers reject+modify+search+defer on top | rc.2 plan precedent of staging within a service file |
| Batched Gemini review at end (TASK-009) not per-task | Per user MEMORY.md: "Batch review at end of multi-task plans" | feedback_review_batching.md memory |
| Tests in TASK-007 (after all server + skill + hook + doctor land) | Integration tests need all 6 actions present; per-action unit tests collocated with services in TASK-001/002 (vitest convention) | exploration-testing.json patterns |

## Dependencies

- **Depends on**: rc.2 deliverables on main (fab_extract_knowledge tool, pending dogfood entries, archive-hint.cjs, fabric-archive skill, install/skills-and-hooks.ts foundation) — all confirmed present in working tree
- **Provides for**: rc.4 doctor --lint (will reuse fab_review primitives + filesystem-edit fallback pattern), rc.4 fabric-import (will write to pending then can be promoted via fab_review)

## Out of Scope

- doctor --lint 6 deterministic checks (rc.4)
- fabric-import skill (rc.4)
- README/docs reframe (rc.4)
- Cursor-specific review surfacing (Cursor reads .claude/.codex skills; no new path needed)
- v2.0.0 stable release (rc.4 final)

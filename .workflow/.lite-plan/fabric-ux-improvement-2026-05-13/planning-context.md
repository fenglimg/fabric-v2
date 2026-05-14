# Planning Context: Fabric UX Improvement (3 UX issues + 1 SDK misuse bug)

**Session**: `fabric-ux-improvement-2026-05-13`
**Origin**: User dogfooded Fabric in another project; encountered three consecutive UX pain-points which exposed an upstream MCP SDK misuse bug.
**Planning mode**: Pre-grilled spec → direct task synthesis (no fresh multi-angle exploration; design already locked).

---

## Source Evidence

### Bug surface (TASK-001)
- `packages/shared/src/schemas/api-contracts.ts` (766 lines) — defines `FabReviewInputSchema` / `FabReviewOutputSchema` as `z.discriminatedUnion(...)`.
- `packages/server/src/tools/review.ts` (53 lines) — passes those discriminatedUnions directly to MCP SDK `registerTool({ inputSchema, outputSchema })`. SDK 1.29.0 `validateToolOutput` calls `safeParseAsync(undefined)` on non-`z.object()` shapes → access to `schema._zod` throws → every action crashes.
- Symptom A: every `fab_review action={list,search,modify,...}` call returns a stack-trace, not data.
- Symptom B: published JSON Schema degenerates to `properties: {}` so `ToolSearch` discovers no fields.
- Blast radius: **only `fab_review`** — events / ledger entries also use `discriminatedUnion` but are internal schemas, not registered with `registerTool`.

### UX issue A: fabric-import interrupted at pending=10 (TASK-002)
- `packages/cli/templates/hooks/fabric-hint.cjs` (1307 lines) — Signal B fires `decision: "block"` recommending fabric-review when pending count ≥ 10. Hook has no awareness of an in-flight import skill run.
- Existing artifact `.fabric/.import-state.json` is already written by fabric-import checkpoints (per skill design); reusing it as in-flight signal needs zero new contract.
- `_readConfigNumber` (line 681) and `readUnderseedThreshold` (line 746) are the established defensive-read pattern to mirror.

### UX issue B: fabric-config.json invisible (TASK-003)
- `packages/cli/src/commands/init.ts` (1590 lines) — never writes a default fabric-config.json. All readers (fabric-config.ts schema + fabric-hint.cjs DEFAULT_* constants) silently default-on-missing.
- `packages/shared/src/schemas/fabric-config.ts` (101 lines) — schema source of truth. Verified field list:
  - `knowledge_language` (default `"match-existing"` per schema; needs runtime confirmation against init/doctor)
  - `archive_hint_cooldown_hours` (default 12)
  - `underseed_node_threshold` (default 10)
  - `archive_edit_threshold` (default 20)
  - `archive_hint_hours` (default 24)
  - `review_hint_pending_count` (default 10)
  - `review_hint_pending_age_days` (default 7)
  - `maintenance_hint_days` (default 14)
  - `maintenance_hint_cooldown_days` (default 7)
- `maybeWriteImportSentinel` + its clack confirm prompt live in init.ts main flow; both deleted in TASK-003.

### UX issue C: /fabric-import recommendation missed on first SessionStart (TASK-004)
- `packages/cli/templates/hooks/knowledge-hint-broad.cjs` (464 lines) — currently relies on `.fabric/.import-requested` sentinel (written only by clack-confirm-Y in interactive init). Every non-interactive path (CI, `-y`, piped input, `--plan`, `FABRIC_NONINTERACTIVE=1`, TTY-detection failures) skips the sentinel write → SessionStart never recommends import.
- Stop-hook Signal C fallback requires `init_scan_completed >= 24h ago`, so same-day first session is silent.
- `packages/cli/templates/skills/fabric-import/SKILL.md` (588 lines) — Phase 0 'Sentinel Contract (rc.7 T1)' block + Phase 3.4 'sentinel clear' step are now stale documentation.

### Test surface
- `packages/server/__tests__/integration/fab-review.test.ts`, `packages/server/src/tools/review.test.ts` — TASK-001 extends.
- `packages/cli/__tests__/fabric-hint.test.ts` — TASK-002 extends + drops sentinel cases.
- `packages/cli/__tests__/init-cli-surface.test.ts`, `init-atomic.test.ts`, `init-wizard.test.ts`, `integration/init-guard.test.ts`, `integration/init-scope.test.ts` — TASK-003 touches subset.
- `packages/cli/__tests__/knowledge-hint-broad.test.ts` — TASK-004 extends + drops sentinel cases.

---

## Understanding

- **Current state**: One critical SDK-misuse bug in `fab_review` (100% crash rate) plus three UX paper-cuts that all converge on the retired sentinel mechanism being unreliable.
- **Problem**: Sentinel-driven recommendation has too many bypass paths to be deterministic; schema misuse hides discoverability and crashes the tool; users can't see config they could otherwise tune.
- **Approach**: Surgical bug-fix for fab_review (preserve internal authoritative discriminatedUnion, add SDK-friendly flat shape) + clean-slate retirement of the sentinel mechanism replaced with a deterministic SessionStart self-check + scaffold a discoverable default fabric-config.json. Four parallel tasks, disjoint file sets, single end-of-chain review.

---

## Key Decisions

(See `plan.json:design_decisions` for full structured rationale; summary here.)

- **D1 (TASK-001)**: Two-layer schema (flat ZodRawShape for SDK + internal discriminatedUnion). Evidence: `packages/server/src/tools/review.ts` registerTool call site; SDK 1.29.0 `validateToolOutput` source.
- **D2 (TASK-002)**: Reuse `.fabric/.import-state.json` as in-flight signal; hard-code 24h TTL (no config knob — YAGNI). Evidence: existing skill checkpoint writer; user memory `feedback_clean_slate.md`.
- **D3 (TASK-003 + TASK-004)**: Retire `.fabric/.import-requested` sentinel entirely (clean-slate per zero-user-period preference). Evidence: user memory `feedback_clean_slate.md`; multiple non-interactive bypass paths in init.ts.
- **D4 (TASK-004)**: Banner bypasses revision_hash gate (per-line emit decision). Evidence: `knowledge-hint-broad.cjs` current emit logic + chicken-and-egg with unchanged knowledge graph.
- **D5 (orchestration)**: Four tasks fully parallel, zero file overlap; single end-of-chain Gemini review. Evidence: user memory `feedback_review_batching.md`; verified disjoint file sets across all four `.task/TASK-00X.json:files[].path`.

---

## Dependencies

- All four tasks: `depends_on: []` — zero ordering constraint.
- File-overlap verification (manual cross-check):
  - TASK-001: `packages/shared/src/schemas/api-contracts.ts`, `packages/server/src/tools/review.ts`, `packages/server/src/tools/review.test.ts`, `packages/server/__tests__/integration/fab-review.test.ts`
  - TASK-002: `packages/cli/templates/hooks/fabric-hint.cjs`, `packages/cli/__tests__/fabric-hint.test.ts`
  - TASK-003: `packages/cli/src/commands/init.ts`, `packages/cli/__tests__/init-cli-surface.test.ts` + 3 other init test files
  - TASK-004: `packages/cli/templates/hooks/knowledge-hint-broad.cjs`, `packages/cli/templates/skills/fabric-import/SKILL.md`, `packages/cli/__tests__/knowledge-hint-broad.test.ts`
  - **No path appears in more than one task's `files[].path`.**
- TASK-001 fixes the fab_review tool. The other three tasks do NOT consume fab_review during implementation, so TASK-001 need not land first.

---

## Out-of-scope (explicit)

- Re-debating any of the locked design decisions (clean-slate sentinel retirement, hard-coded 24h TTL, two-layer fab_review schema, end-of-chain review batching). Implementing agents must adapt mechanically.
- Adding configurability for the in-flight TTL (YAGNI per design lock).
- Re-architecting fabric-import skill internals.
- Adding a shared `templates/hooks/lib/` module unless TASK-004 explicitly judges duplication is no longer acceptable.

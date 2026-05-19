# TASK-014: F8c — onboard phase + S5 slot mechanism + `fab onboard-coverage` CLI + `onboard_slot` frontmatter + fabric-config opted_out + doctor advisory

## Changes

### 1. Shared package
- `packages/shared/src/onboard-slots.ts` (**NEW**): exports `ONBOARD_SLOT_NAMES` (locked 5-tuple), `OnboardSlot` type, `onboardSlotSchema` (zod enum), `ONBOARD_SLOT_TOTAL`. Single source of truth for both server + CLI.
- `packages/shared/src/index.ts`: re-exports onboard-slots module.
- `packages/shared/src/schemas/api-contracts.ts`: imports `onboardSlotSchema` and adds optional `onboard_slot` field to `_FabExtractKnowledgeInputBaseSchema` (adjacent to a-C1's 4 triage fields). Contract note: MUST NOT participate in `idempotency_key` hash.
- `packages/shared/src/schemas/fabric-config.ts`: adds `onboard_slots_opted_out: z.array(z.string()).optional().default([])` — string-typed (not enum-typed) for forward-compat with slot renames.

### 2. Server package
- `packages/server/src/services/extract-knowledge.ts`: threads `input.onboard_slot` through `renderFreshEntry` → `FreshEntryArgs.onboardSlot` → emits bare-scalar `onboard_slot: <slot>` YAML line ONLY when caller-supplied. NOT included in idempotency_key hash inputs (kept frozen at `{source_session, type, slug}`).
- `packages/server/src/services/doctor.ts`: imports `ONBOARD_SLOT_NAMES` / `ONBOARD_SLOT_TOTAL` / `OnboardSlot`; adds `inspectOnboardCoverage` (walks canonical `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes}/*.md` frontmatter for `onboard_slot:` + reads `fabric-config.onboard_slots_opted_out`); adds `createOnboardCoverageCheck` (info kind, status=ok); wires both into `runDoctorReport` between `Skill markdown YAML` and `Preexisting root markdown`.

### 3. CLI package
- `packages/cli/src/commands/onboard-coverage.ts` (**NEW**): exports `runOnboardCoverage(projectRoot)` (pure handler) + `onboardCoverageCommand` (citty). Walks the same 5 canonical type dirs as doctor, parses `onboard_slot:` and `id:` frontmatter scalars, reads `fabric-config.onboard_slots_opted_out`, returns `{filled, missing, opted_out, total: 5}`. `--json` flag emits the JSON line; default emits human-readable table.
- `packages/cli/src/commands/index.ts`: registers `onboard-coverage` lazy import.
- `packages/cli/src/commands/config.ts`: adds two subcommands `dismiss-slot <slot>` (append to opted-out list) + `onboard-reset <slot>` (remove from list). Subcommands validate slot against `ONBOARD_SLOT_NAMES`, require initialized workspace, write via `atomicWriteJson`. Added an argv[3] guard so the parent `config` panel does NOT also run after a subcommand routes.

### 4. Skill template
- `packages/cli/templates/skills/fabric-archive/SKILL.md`: added **Phase 0.4 — First-run Onboard Phase (rc.23 F8c)** section with full 4-step flow (check coverage → decide → prompt user → tour-and-propose). Listed each slot's inference sources (package.json / tsconfig / Makefile / etc.). Listed do-not-translate constraints (slot label spelling, never mix onboard with session-archive candidates). Updated the upper "5 Phase" summary to reflect Phase 0.4 insertion.

### 5. Tests
- `packages/shared/test/api-contracts.test.ts`: 3 new `F8c:` cases — accepts each of 5 S5 values, rejects unknown slot, omit stays valid.
- `packages/server/src/services/extract-knowledge.test.ts`: `buildInput` extended with `onboard_slot`; 3 new `F8c_*` cases — writes the YAML line when supplied, omits when undefined, idempotency_key stable across slot variations (canary, 3 distinct project roots).
- `packages/cli/__tests__/onboard-coverage.test.ts` (**NEW**, 11 cases): empty workspace → all 5 missing; single fill → 4 missing; multi-dir aggregation; opted-out exclusion; off-spec slot ignored; missing config tolerated; malformed JSON tolerated; id-fallback to filename; sorted determinism; payload shape contract; absent `.fabric/` subtree.
- `packages/server/src/services/doctor.test.ts`: added `Onboard coverage` to the canonical check-name array and bumped count 34 → 35; new describe block `rc.23 TASK-014: Onboard coverage advisory` with 3 cases — empty KB advisory, all-5-filled "5/5 ✓", opted-out exclusion.
- `packages/server/__tests__/__snapshots__/tool-contracts.test.ts.snap`: regenerated via `pnpm test -u` to capture the new `onboard_slot` enum in the fab-extract-knowledge tool JSON-schema.

## Verification

- [x] `fab onboard-coverage --json` in this repo outputs `missing: [5 slots]` — confirmed: existing canonical entries have no `onboard_slot` frontmatter, so coverage shows 0/5 filled, 5/5 missing.
- [x] `fab_extract_knowledge` accepts `onboard_slot: "tech-stack-decision"` (and all 4 other slot values); rejects unknown enum value.
- [x] `idempotency_key` stable: 3-project canary test asserts same key whether onboard_slot is absent / "tech-stack-decision" / "architecture-pattern".
- [x] `fab config dismiss-slot <slot>` registered + writes `onboard_slots_opted_out` array; no-op + clear message when slot already opted out.
- [x] `fab config onboard-reset <slot>` registered + removes from list; no-op + clear message when slot not opted out.
- [x] fabric-archive SKILL.md contains a `### Phase 0.4 — First-run Onboard Phase (rc.23 F8c)` section, listing the 5 slot inference sources and the 4-option AskUserQuestion flow.
- [x] doctor `Onboard coverage` advisory: info kind, status ok; emits 5/5 ✓ when all filled; surfaces missing list + opted-out count when incomplete.
- [x] e2e dry-run in temp dir: dismiss → coverage shows opted_out, missing drops one → reset → coverage restores.

## Tests

- [x] `pnpm -F @fenglimg/fabric-shared test`: **354/354 pass** (was 351 → +3 onboard_slot enum tests).
- [x] `pnpm -F @fenglimg/fabric-cli test`: **578/578 pass** (was 567 → +11 onboard-coverage tests).
- [x] `pnpm -F @fenglimg/fabric-server test`: **524/525 pass | 1 skipped | 0 fail** (was 518/519 → +6 net: 3 extract-knowledge F8c cases + 3 doctor advisory cases). 1 skipped is pre-existing (unrelated).
- [x] Typecheck clean across shared / server / cli (manual `tsc --noEmit`).
- [x] Build clean across all three packages.

## Deviations

- **runOnboardCoverage duplicated between CLI and server**: the server package has zero dep on the CLI package, so the canonical scanner is inlined into doctor.ts (`inspectOnboardCoverage`). The 70-line duplication is intentional and called out via a top-of-function comment — a 3rd "core" package would be heavier weight than warranted.
- **`fab onboard-coverage` command is `hidden: true`**: mirrors `plan-context-hint` precedent — Skill-invoked CLIs stay out of the `fab --help` banner. Still reachable as `fab onboard-coverage`.
- **`fab config onboard-reset` / `dismiss-slot` subcommands also `hidden: true`**: same reasoning. Discoverable via `fab config dismiss-slot --help`.
- **`onboard_slots_opted_out` typed as `z.array(z.string())` not `z.array(onboardSlotSchema)`**: chose loose typing so a future slot rename doesn't break-parse a user's prior config. Downstream consumers intersect against `ONBOARD_SLOT_NAMES` at read time.
- **Citty parent-after-subcommand guard via argv[3] sniff**: citty runs the parent `run` after subcommand routing by default; the cleanest workaround was a short argv check. Documented inline.

## Notes

- Slot list is **LOCKED** at the 5 names — adding/removing requires schema evolution + doctor migration; downstream code keys off this `as const` tuple.
- The frontmatter writer is the SOLE producer of `onboard_slot:`. fabric-archive's Phase 0.4 is the SOLE caller from the Skill side. Mixing into a regular session-archive call is explicitly forbidden in SKILL.md "DO NOT TRANSLATE" constraints.
- A future task could add a doctor lint that flags `onboard_slot:` frontmatter values OUTSIDE the locked S5 set (currently they're silently ignored by both CLI and doctor scanners). Out of scope for F8c.
- The 4 KT-MOD entries that survived F8a's KB purge in this repo are pre-rc.23 manual archives — `fab onboard-coverage` correctly reports them as none-claim-any-slot since they lack the new frontmatter line.

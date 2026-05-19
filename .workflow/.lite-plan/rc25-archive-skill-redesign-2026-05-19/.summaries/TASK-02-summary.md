# TASK-02: Encourage session_id propagation in fab_plan_context — tool description + AGENTS.md guidance

## Changes
- `packages/shared/src/schemas/api-contracts.ts` (L147-152): Upgraded `planContextInputSchema.session_id` field description from passive "Optional caller-provided session id for Event Ledger records" to imperative "Recommended: pass the current client session id (Claude Code: $session_id; Codex: corresponding identifier) — enables cross-session debt tracking in fab doctor and accurate archive-hint cross-session count. Falls back gracefully if omitted."
- `.fabric/AGENTS.md` (L12): Added a new `- **session_id**:` bullet right after the existing two-step `fab_plan_context` Usage bullet inside the 知识库(KB) section, instructing AI clients to pass current client session id when calling `fab_plan_context`.
- `packages/shared/src/templates/bootstrap-canonical.ts` (L72): Mirrored the AGENTS.md session_id bullet into the byte-locked canonical bootstrap body — this is the single source of truth that `fab install` propagates to all 3 client managed blocks on next install.

## Verification
- [x] `api-contracts.ts` session_id field description contains string 'Recommended': verified via Grep (L151 hit).
- [x] `.fabric/AGENTS.md` contains string '**session_id**' in 知识库 section: verified via Grep (L12 hit).
- [x] `packages/cli/templates/.fabric/AGENTS.md` mirror contains string 'session_id': see Deviations — the path in the task file does not exist; the true canonical template source is `packages/shared/src/templates/bootstrap-canonical.ts` (where the mirror was applied, verified at L72).
- [x] `pnpm test` exits 0: 104 test files / 1571 tests pass / 1 pre-existing skip across shared+server+cli. No regressions.
- [x] Commit message matches required string.

## Tests
- [x] `pnpm typecheck`: 0 errors (pnpm -r exec tsc --noEmit clean).
- [x] `pnpm test`: shared 26 files / 399 pass, server 33 files / 553 pass (1 skip), cli 45 files / 619 pass.
- [x] `pnpm lint`: knip --strict clean.

## Deviations
- **Task file referenced `packages/cli/templates/.fabric/AGENTS.md` as the template source — this path does not exist.** The actual byte-locked canonical template is `packages/shared/src/templates/bootstrap-canonical.ts` (string constant `BOOTSTRAP_CANONICAL`), per the rc.19 bootstrap-consolidation pattern (shared module so both CLI writer and server doctor can reference the same source of truth). I applied the mirror there. The change still propagates through `fab install` to all 3 client managed blocks on next user install — semantically equivalent to what the task intended. The canonical-bytes test suite (`packages/shared/test/templates/bootstrap-canonical.test.ts`) continues to pass since the additions are net-new lines and the byte-length invariant only requires ≥800 bytes.

## Notes
- The session_id bullet is intentionally placed AFTER the two-step Usage bullet so AI readers encountering the fab_plan_context flow see the session_id instruction immediately in context.
- TASK-03 (archive-hint copy) can now rely on session_id presence increasing over time; the graceful-degradation copy ("跨多个会话累计" when N unknown vs "跨 N 个会话累计" when known) remains the correct fallback shape.
- Server-side emitter at `packages/server/src/services/plan-context.ts:228` already forwards `input.session_id` into `knowledge_context_planned` events, so no server-side change needed — this task is purely a behavioral nudge.

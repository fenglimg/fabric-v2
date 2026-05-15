# rc.18 (or v2.1) Planning Context — Protocol v2

## Scope (from memory/project_grill_deferred_items.md Phase 5)

Single F-item, **largest blast radius — ships ALONE**. Hard cut, zero-user clean-slate, NO v1 shim.

### F3 — `plan-context-hint` JSON contract Protocol v2

**Emitter (producer side)**:
- `packages/cli/src/commands/plan-context-hint.ts:57` (TypeScript type with `version: 1`)
- `packages/cli/src/commands/plan-context-hint.ts:165` (runtime emission of `version: 1`)
- `packages/cli/src/commands/plan-context-hint.ts:18` (docstring example)
- Bump `version: 1 → 2`
- Rename `payload.narrow` to a clearer field name (CANDIDATES — to be picked in planning):
  - `payload.entries` (most generic, matches downstream "entries" naming)
  - `payload.matchedKnowledge` (semantic — narrow = matched-against-target-paths)
  - `payload.relevantKnowledge`
  - User spec just said "rename" without specifying target — flag as outstanding clarification for planning agent to either propose a top pick OR pause for user decision

**Consumers (hook side, both must update in lockstep)**:
- `packages/cli/templates/hooks/knowledge-hint-narrow.cjs:628` — `payload.narrow` reader
- `packages/cli/templates/hooks/knowledge-hint-broad.cjs:443` — `payload.narrow` reader (also degenerated `--all` mode case at line 437-441 with comment block referencing the protocol field name)

**Test fixtures (must update — these are the evidence the contract is observed)**:
- `packages/cli/__tests__/knowledge-hint-broad.test.ts:38, 90, 180-182` — `version: 1` + `payload.narrow` fixtures
- Likely sibling file `packages/cli/__tests__/knowledge-hint-narrow.test.ts` (verify in planning) — same shape

**Comments to update in lockstep**:
- `packages/cli/templates/hooks/knowledge-hint-broad.cjs:441` — comment that says "The CLI protocol field name (`payload.narrow`) is unchanged — a wire-shape ..." MUST be updated to reflect the new name (currently asserts unchanged-ness)

### Hard cut policy

- NO v1 fallback: if a hook gets `version: 1`, treat as malformed/error (or log + skip silently — pick a stance in planning)
- NO accept-both-fields shim during a deprecation window
- Pre-user clean-slate: zero migration helper, just rename + bump

## Cross-phase constraints

- Each task = one git commit (per memory/project_grill_deferred_items.md)
- pre-user clean-slate: no migration shim (per memory/feedback_clean_slate.md)
- Run Gemini review + coverage ONCE at end of plan, not per-task (per memory/feedback_review_batching.md)
- rc.18 ships SOLO — do NOT bundle with rc.16/rc.17 (largest blast radius, deserves an isolated rc cut)

## Dependencies on prior rcs

- rc.17 should be shipped + soak-tested before rc.18 cuts (give the polished surface a release window before changing wire format)
- rc.16 banner i18n must already work (rc.18 doesn't touch banners but the hooks reading the protocol are the same .cjs files that emit banners — coordinated changes need a stable banner baseline)

## Anti-scope (DO NOT do in rc.18)

- Add CLI flags / change command tree (rc.15 surface is contract-locked)
- Backport v1 compat (zero-user clean-slate)
- Touch banner i18n (rc.16 done it)
- Touch help text / target chain / serve warnings (rc.17 territory)
- Add new payload fields beyond the rename (scope creep — rename + bump only)

## Outstanding clarifications (planning agent should flag, not block)

1. **New field name**: pick from {`entries`, `matchedKnowledge`, `relevantKnowledge`}, or the agent proposes a top recommendation with rationale
2. **v1 receipt stance**: silent-skip vs error-log vs hard-throw — pick a stance and document in the type comments

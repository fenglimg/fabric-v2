# rc.34 Dogfood Evidence

**Date**: 2026-05-26
**Repo**: pcf (this Fabric repo, self-host)
**Branch**: `rc34/deferred-cleanup` (HEAD pre-Gemini-review)

## 1. Build + install round-trip

```
pnpm --filter @fenglimg/fabric-shared build  → ✅ ESM + DTS, 0 errors
pnpm --filter @fenglimg/fabric-cli build     → ✅ ESM + DTS, 0 errors
node packages/cli/dist/index.js install      → bootstrap installed=63 skipped=25
                                                mcp installed=4
                                                hooks installed=1 (cite-policy-evict.cjs NEW)
```

The hooks installed=1 confirms TASK-06 install wire-up — only the new `.claude/hooks/cite-policy-evict.cjs` was added; all other artifacts were already present + skipped as idempotent. The bootstrap installed=63 vs skipped=25 reflects the SKILL.md churn from TASK-03/04 (rewritten canonical content + 5 new fabric-review ref/*.md + 1 new fabric-archive ref/dry-run-scope.md).

## 2. TASK-02 stale-install detection — observed in action

**Pre-install state** (canonical updated by TASK-03/04 commits, installed copies still old):

```
fab doctor → ERROR: Skill token budget
  3 个 SKILL.md 超出 token budget:
    fabric-archive=19286 tok (error)   ← 19286 vs canonical 4147 = ~4.6× ratio (>1.5× STALE)
    fabric-review=9343 tok (error)
    fabric-import=7252 tok (warn)
```

**Post-install** (TASK-02 stale detection auto-replaced):

```
fab doctor → WARN: Skill token budget
  1 个 SKILL.md 超出 token budget:
    fabric-import=7252 tok (warn)   ← only fabric-import remains (NOT in rc.34 scope)
```

Reduction: archive 19286 → 4147 tok (-78%), review 9343 → 4250 tok (-54%). fabric-archive cleared error class entirely; fabric-review followed; fabric-import drops to WARN (rc.35 candidate, follows TASK-03/04 pattern when scheduled).

## 3. TASK-03 + TASK-04 — canonical SKILL.md size verification

```
wc -c packages/cli/templates/skills/fabric-archive/SKILL.md  → 12433 chars / 4145 tok
wc -c packages/cli/templates/skills/fabric-review/SKILL.md   → 12747 chars / 4249 tok
wc -c packages/cli/templates/skills/fabric-import/SKILL.md   → 22172 chars / 7391 tok  (unchanged from rc.33; rc.35 candidate)
```

All three under 10K ERROR threshold (validated by `validateSkillCanonicalSize` smoke test in `skill-size-validator.test.ts`). Archive + review under 5K WARN (TASK-03 + TASK-04 targets met).

## 4. TASK-01 cooldown skew hardening — unit test evidence

```
__tests__/fabric-hint.test.ts
  ✓ rc.34 TASK-01: backward clock skew (lastEmitMs > nowMs) does not crash gate, stays silent
```

3 production sites with `Math.max(0, …)` clamp:
- `knowledge-hint-broad.cjs:711` (Signal A SessionStart cooldown)
- `fabric-hint.cjs:1024` (Signal D maintenance cooldown)
- `fabric-hint.cjs:1736` (A/B/C shared signal cooldown)

## 5. TASK-05 reverse-unarchive — service evidence

```
src/services/unarchive-knowledge.test.ts (9 tests)
  ✓ dry-run KT-* → team layer derivation (no disk mutation)
  ✓ dry-run KP-* → personal layer
  ✓ apply: file moves .fabric/.archive → .fabric/knowledge/<layer>/<type>/
  ✓ apply: emits exactly 1 knowledge_unarchived event with full metadata
  ✓ apply: default reason="unspecified" when caller omits
  ✓ apply: targetLayer override wins over filename prefix
  ✓ fail: no KT-/KP- prefix + no override
  ✓ fail: archive source missing
  ✓ fail: restore target already exists (clobber-protect)
  ✓ fail: malformed archive path
```

Schema addition (`knowledge_unarchived` event) wired into discriminatedUnion + EventLedgerEvent union; build-rebuild dependency captured in [[shared-rebuild-on-schema-change]] memory.

Scope cut (rc.35): doctor auto-detect of "ghost-cited archived entries" + auto-apply loop. Primitive ships ready for any trigger surface (manual fab_review action, future doctor lint, CLI subcommand).

## 6. TASK-06 cite-policy long-session evict — 30-turn stress evidence

```
__tests__/cite-policy-evict.test.ts > main() end-to-end
  ✓ "simulated 30-turn session, interval=10, reminder fires exactly 3 times"
    fireCount === 3   // turns 10, 20, 30
    final state.turn_count === 30
```

Hook script registered under Claude Code `UserPromptSubmit` event (claude-code.json updated). Codex / Cursor skipped (no equivalent event registration). Default `cite_evict_interval=0` (off) preserves all-client zero-behavior-change.

Design memo at `.workflow/scratch/rc34-cite-evict-design.md` (8 sections, ~250 lines).

## 7. TASK-07 cohort decay memo — recommendation

`.workflow/scratch/rc34-cohort-decay-memo.md` recommends **DO NOT implement** in rc.35. Reasons stacked:

- Signal collision with existing `last_consumed_at` (cohort + use-recency carry overlapping info for no-use bucket)
- Corpus too small to validate (22 entries / 16-day mtime spread = 1 month-cohort)
- Three 1-line counter-proposals available (tighten draft_days / fab_plan_context recency boost / fabric-import-origin special-case)
- Goodhart risk without ground truth

Threshold to revisit: 50+ entries spanning ≥3 months AND per-maturity decay shows obvious miss in dogfood.

## 8. Gates summary (rc.34 HEAD)

```
pnpm -r exec tsc --noEmit  → 0 errors (per [[local-tsc-vs-ci-tsc]] precedent — must use this, not just build)
pnpm lint                  → knip --strict 0
pnpm --filter @fenglimg/fabric-cli test     → 698/698 passed (rc.33 baseline 655 → +43 new tests)
pnpm --filter @fenglimg/fabric-server test  → 618 passed (+9 unarchive)
```

Net test additions across rc.34 (vs rc.33 commit d488620):
- TASK-01: +1 (fabric-hint cooldown skew)
- TASK-02: +14 (skill-size-validator)
- TASK-03: 0 (refactor + snapshot updates only)
- TASK-04: 0 (refactor + snapshot updates only)
- TASK-05: +9 (unarchive-knowledge)
- TASK-06: +28 (cite-policy-evict)
- TASK-07: 0 (analysis only)
- TASK-08: closure (no new tests)
- **Total: +52 new tests** across 4 new test files

## 9. Remaining doctor non-rc.34 findings (not blockers)

The doctor still shows:
- `Bootstrap snapshot drift` (ERROR) — `.fabric/AGENTS.md` diverges from BOOTSTRAP_CANONICAL because the in-repo `.fabric/AGENTS.md` carries project-specific Self-archive + Cite policy sections that aren't in the shipped template. Pre-existing; not a rc.34 regression.
- `Managed block drift` (ERROR) — same root cause: pcf's per-project bootstrap content vs canonical snapshot. Run `fab doctor --fix` to reconcile (caller-side decision; not a release blocker).
- `Skill token budget` (WARN) — fabric-import 7252 tok. Out of rc.34 scope (TASK-03 + TASK-04 only covered archive + review per plan §2 Wave 2). rc.35 candidate using the same progressive-disclosure pattern.
- `Knowledge orphan demote` (WARN) — 3 entries past per-maturity threshold. Surfaces the orphan_demote signal the cohort decay memo argues is sufficient.

## 10. What's NOT yet validated in this dogfood

- **Live UserPromptSubmit evict trigger** — requires a real Claude Code session with the hook armed; unit test `30-turn stress` covers the math + envelope shape but doesn't exercise the host's stdin/stdout wire. To live-test: set `cite_evict_interval=10` in `.fabric/fabric-config.json`, open a fresh Claude Code session in pcf, send 10 user prompts. Expected: turn-10 prompt receives a context-injected cite-policy reminder. Not part of automated suite.
- **Live reverse-unarchive trigger** — primitive ships ready; no automatic trigger wired in rc.34 (rc.35 scope). Currently exercisable only via direct service call or hand-rolled test.
- **Gemini batch review on full 7-TASK diff** — kicked off as Wave 5 deliverable; results land in `review.md` (separate file). If P0/P1 surfaces, address in a follow-up commit before `/release-rc`.

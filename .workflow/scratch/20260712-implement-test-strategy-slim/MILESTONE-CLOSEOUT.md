# M-test-strategy / M-test-strategy-slim — Milestone Closeout

**Date**: 2026-07-12  
**Branches**: research `milestone/test-strategy` (m5); implement `milestone/test-strategy-slim` (m7)  
**Ship**: PR from m7 (product files only)

## What this milestone delivered

### Research (complete)

- Fabric test-stack census + reasonableness verdict
- maestro-flow comparison (borrow process, not product UAT/auto-test/no-CI)
- Slim strategy target + do/don't table
- Artifacts under `.workflow/scratch/20260712-analyze-test-strategy/` and `.../brainstorm-test-strategy/`

### Implementation (m7 → main)

| Change | File |
|--------|------|
| Register upgrade E2E | `package.json` → `test:upgrade-e2e` |
| PR/Release hard gate | `.github/workflows/reusable-validate.yml` runs `pnpm test:upgrade-e2e` after store-only |
| Slim strategy entry | `docs/TESTING.md` (Gate Map + optional + do-not + appendix) |
| Drift gate matches slim | `scripts/test-strategy-gate.mjs` |

**Already true on main (not re-done):** `release.yml` already `uses: reusable-validate.yml` with `verify_tag: true` (PR and release share the same hard set once upgrade is in reusable-validate).

### Local verification (m7)

- `pnpm test:strategy` PASS  
- `pnpm -r build && pnpm test:upgrade-e2e` PASS  
- `pnpm test:store-only-e2e` PASS  

## Explicitly closed as out of scope (not incomplete)

These were researched and **intentionally not built** in this milestone. They are **optional backlog**, not open blockers:

| Topic | Meaning | Disposition |
|-------|---------|-------------|
| Soft runtime 常态化 | Nightly/habit-funnel style yellow checks | Deferred optional |
| Agent-in-the-loop eval | Real LLM prompt packs | Deferred optional / rare |
| red-team path fix | Make `red-team-safety.mjs` use this repo dist | Deferred optional |
| habit/nofake soft gates | Dogfood ledger floors | Deferred optional |
| mf UAT as main system | Conversational UAT | **Won't do** |
| mf auto-test pipeline | Business-project test gen | **Won't do** |
| Drop validate CI | No PR/release tests | **Won't do** |

## Done when (milestone)

- [x] Strategy research + slim target documented  
- [x] upgrade-e2e registered and in reusable-validate  
- [x] TESTING.md slim + strategy-gate green  
- [x] Local gates green on m7  
- [ ] PR merged to main (process after open)

## Worktrees

| Path | Role |
|------|------|
| `.worktrees/m5-test-strategy` | Research isolation (can keep or prune later) |
| `.worktrees/m7-test-strategy-slim` | Implementation branch for this PR |

# Quality-review BLOCK fix notes (critical/high)

Date: 2026-07-12
Worktree: `.worktrees/m5-peer-micro-transfer`
Review: `.workflow/scratch/20260712-review-P1-peer-micro-transfer/review.json`

## FIXED

| ID | Severity | Fix |
|----|----------|-----|
| COR-001 | critical | `packages/cli/src/commands/doctor.ts` import `assessFirstHit` from `../store/first-hit.js` |
| COR-002 | high | `doctor-body-altitude.ts` assesses `extractBody(entry.body)` instead of description proxy |
| COR-003 | high | `command-signposts.ts` `scope-explain` successor → `fabric info scope` |
| SEC-001 | high | `cross-store-write.ts` `pasteSafeScope` + SCOPE_COORDINATE_PATTERN before actionHint interpolate |
| ARCH-004 | high | `altitude_propose_gate` on `fabricConfigSchema` (default false); gate via `loadProjectConfig`; env override kept |
| BP-002 | high | doctor `--probe` behavioral test: JSON `ok`/`first_hit.code`, no fix pipeline |
| BP-003 | high | `remediationLinesFor` export + fixture assertions (not source grep) |

## TESTS

```
pnpm --filter @fenglimg/fabric-shared build
packages/cli: vitest run __tests__/doctor.test.ts __tests__/first-hit.test.ts __tests__/command-signposts.test.ts → 37 passed
packages/server: vitest run doctor-body-altitude / cross-store-write / extract-knowledge → 76 passed
packages/shared: vitest run test/fabric-config.test.ts → 38 passed
```

## RESIDUAL

- Medium/low findings from review.json left open (COR-004..008, PERF-*, BP-005/007/008, etc.)
- ARCH-004 residual: `altitude_propose_gate` not on fabric config TUI panel (power-user JSON / env only) — documented on schema field + `altitudeProposeGateEnabled`
- empty_store remediation still has non-pasteable parenthetical (COR-006 medium)

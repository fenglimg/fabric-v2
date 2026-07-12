# TASK-001 Summary — P0-1 using-fabric pre-action gating

## Status
completed

## Files changed
- packages/cli/templates/skills/fabric-recall-playbook/SKILL.md — numbered Pre-action gating checklist with fab_recall(paths=, session_id=), body Read, dismissed override
- packages/cli/templates/skills/lib/shared-policy.md — MUST pre-action gate section 0
- packages/shared/src/templates/bootstrap-canonical.ts — ZH/EN Pre-action gating + KT-DEC-0007 soft-nudge language
- packages/shared/test/templates/bootstrap-canonical.test.ts — pre-action assertions

## Convergence
- [x] playbook has numbered checklist with fab_recall(paths= + session_id=
- [x] shared-policy MUST before Edit/Write
- [x] bootstrap ZH+EN pre-action wording
- [x] no new decision:block for missing recall (only forbid language)
- [x] bootstrap-canonical + bootstrap-parity tests pass (647 shared suite green)

## Tests
pnpm --filter @fenglimg/fabric-shared test -- test/templates/bootstrap-canonical.test.ts test/templates/bootstrap-parity.test.ts
pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/fabric-hint-never-blocks.test.ts

# TASK-006 Summary — P1-6 doctor --probe

## Status
completed

## Files changed
- packages/cli/src/commands/doctor.ts — probe?: boolean + early branch using assessFirstHit + storeDoctorChecks JSON snapshot (no runDoctorFix)
- i18n cli.doctor.args.probe.description
- packages/cli/__tests__/doctor.test.ts — probe flag declared

## Convergence
- [x] DoctorArgs.probe + citty boolean
- [x] early probe path skips fix
- [x] JSON has ok + first_hit.code
- [x] probe flag test green

## Note
Pre-existing failure: doctor --fix-knowledge with --yes stdout assertion (unrelated to probe).

## Tests
pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/doctor.test.ts (17/18; 1 pre-existing)

# TASK-003 Summary — P0-3 OpenSpec-style store UX

## Status
completed

## Files changed
- packages/cli/src/store/first-hit.ts — pasteable remediations include fabric store bind + switch-write for unbound/no_write_target/missing_required
- packages/server/src/services/cross-store-write.ts — StoreWriteTargetUnresolvedError actionHint multi-line paste commands
- packages/shared/src/i18n/locales/en.ts + zh-CN.ts — doctor.store.unbound / no-write-target pasteable bind lines
- packages/cli/__tests__/first-hit.test.ts — source contract assertions

## Convergence
- [x] remediationFor unbound/no_write_target/missing_required include fabric store bind
- [x] no_write_target includes fabric store switch-write
- [x] i18n en/zh contain fabric store bind
- [x] first-hit + store-ops tests pass

## Tests
pnpm --filter @fenglimg/fabric-cli exec vitest run __tests__/first-hit.test.ts __tests__/store-ops.test.ts

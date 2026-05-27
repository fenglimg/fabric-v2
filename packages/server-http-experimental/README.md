# @fenglimg/fabric-server-http-experimental

> **Status**: QUARANTINED (v2.0.0-rc.37, 2026-05-27).
> **Use**: archival placeholder reserved for future web UI restart.
> **Build/test**: SKIPPED in main CI per `private: true` + no-op scripts.

## What was quarantined (decision rationale)

Per KB decision `decisions/fabric-serve-quarantine-not-delete` (`v2.0.0-rc.37` Wave A2):

`fabric serve` exposed an Express-based HTTP server (MCP + REST + SSE + planned UI on port 7373) — a vision残留 from v1.8. By v2.0.0 all three supported clients (Claude Code / Cursor / Codex CLI) use **stdio MCP transport exclusively**, so the HTTP server has zero consumer. Maintaining its attack surface (auth tokens, loopback validation, lock files, security hardening per `rc.29` BUG-K1) is pure tax.

Trade-offs evaluated:
- **Delete**: loses future web UI restart entry point
- **Hide CLI command only**: keeps attack surface + test maintenance
- **Quarantine (chosen)**:脱离主线 maintenance,代码 archive 在 git history,有需要时可复活

## What was moved here (rc.37 Wave A2 Part 1)

- (planned Part 2) `packages/server/src/http.ts` → Express app + middleware mount
- (planned Part 2) `packages/server/src/middleware/bearer-auth.ts` → FABRIC_AUTH_TOKEN bearer auth
- (planned Part 2) `packages/server/src/services/serve-lock.ts` → `.fabric/.serve.lock` PID lock
- (planned Part 2) `packages/server/__tests__/integration/{bearer-auth,error-shape,http-endpoints}.test.ts` → HTTP integration tests

## What was deleted from main (rc.37 Wave A2 Part 1)

- `packages/cli/src/commands/serve.ts` — CLI command `fabric serve`(restore via `git log -- packages/cli/src/commands/serve.ts`)
- `packages/server/src/index.ts` `startHttpServer` function + HTTP-related re-exports (acquireLock / checkLockOrThrow / readLockState / releaseLock / ServeLockHeldError)
- `packages/cli/src/commands/install.ts` `checkLockOrThrow` preflight call (no longer races since no `fabric serve` exists)

## How to restore (if web UI restart needed)

```bash
# 1. Restore CLI surface
git show <rc36-tag>:packages/cli/src/commands/serve.ts > packages/cli/src/commands/serve.ts
# 2. Restore startHttpServer + re-exports
git show <rc36-tag>:packages/server/src/index.ts | <surgical merge with current>
# 3. Re-register in cli/commands/index.ts
# 4. Re-bind doctor's Serve lock advisory (already present in services/doctor.ts)
# 5. Reactivate this package's build/test scripts in package.json
```

The HTTP server itself (Express app + bearer auth + loopback validation) is still present in `packages/server/src/` as of this commit; Part 2 will physically move those files into this package. Part 1 only removes the CLI/install/server-entry wiring.

## CI / monorepo

- `pnpm-workspace.yaml` includes `packages/*` so this dir is technically a workspace member, but `private: true` + no-op `build`/`test` scripts ensure CI / pnpm recursive commands skip it.
- Do NOT add dependents from main. If you find an import from `@fenglimg/fabric-server-http-experimental` in another main package, that's a bug — file an issue.

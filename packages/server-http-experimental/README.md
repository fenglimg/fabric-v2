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

## What lives here now (rc.37 Wave A2 Part 2 complete)

- `src/http.ts` — Express app + middleware mount
- `src/middleware/bearer-auth.ts` — FABRIC_AUTH_TOKEN bearer auth + loopback guard
- `src/services/serve-lock.ts` — `.fabric/.serve.lock` PID lock
- `__tests__/integration/{bearer-auth,error-shape,http-endpoints}.test.ts` — HTTP integration tests

## What was deleted from main

- `packages/cli/src/commands/serve.ts` — CLI command `fabric serve`(restore via `git log -- packages/cli/src/commands/serve.ts`)
- `packages/server/src/index.ts` `startHttpServer` function + public HTTP-related re-exports
- `packages/cli/src/commands/install.ts` `checkLockOrThrow` preflight call (no longer races since no `fabric serve` exists)

## How to restore (if web UI restart needed)

```bash
# 1. Restore CLI surface
git show <rc36-tag>:packages/cli/src/commands/serve.ts > packages/cli/src/commands/serve.ts
# 2. Move or import this package's HTTP app back into the main server surface
#    (src/http.ts, middleware/bearer-auth.ts, services/serve-lock.ts, and tests)
# 3. Re-register in cli/commands/index.ts
# 4. Re-bind doctor's Serve lock advisory (already present in services/doctor.ts)
# 5. Reactivate this package's build/test scripts in package.json
```

## CI / monorepo

- `pnpm-workspace.yaml` includes `packages/*` so this dir is technically a workspace member, but `private: true` + no-op `build`/`test` scripts ensure CI / pnpm recursive commands skip it.
- Do NOT add dependents from main. If you find an import from `@fenglimg/fabric-server-http-experimental` in another main package, that's a bug — file an issue.

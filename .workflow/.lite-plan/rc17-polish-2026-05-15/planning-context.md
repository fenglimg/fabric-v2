# rc.17 Planning Context — Polish

## Scope (from memory/project_grill_deferred_items.md Phase 4)

Four work items. **H** depends on rc.16 flag surface stability (already locked at rc.15 and confirmed in rc.16 plan).

### H — `--help` content rewrite
- Audit ALL `cli.*.description` keys in `packages/shared/src/i18n/locales/en.ts` + `zh-CN.ts`
- Add concrete `examples` to root `--help` and per-command `--help` (citty `meta.examples` or appended in description)
- Add 3-line mental-model intro at root help: 装 (`fab install`) / 配 (`fab config`) / 跑 (`fab serve` + `fab doctor`)
- Cover all 5 visible commands: `install`, `doctor`, `serve`, `uninstall`, `config`
- Bilingual parity check: every `cli.*.description` key MUST exist in BOTH locales (zh-CN + en)
- Out-of-scope: introducing new commands, changing flag shape (rc.15 surface is contract-locked)

### R — Target resolution chain consolidation
- Three sources currently overlap:
  1. `--target` CLI flag (per-command)
  2. `EXTERNAL_FIXTURE_PATH` env var (test/dev fixture pointer)
  3. `fabric.config.json#externalFixturePath` field
- Locations to investigate:
  - `packages/cli/src/config/resolver.ts` (target resolution)
  - `EXTERNAL_FIXTURE_PATH` references — appear to be test-only based on grep returning empty in prod sources (verify via Bash search across packages/)
  - `externalFixturePath` schema field — verify present in `packages/shared/src/schemas/fabric-config.ts`
- Decision (per rc.17 brief): drop `externalFixturePath` config field; dev/test should use env var only
- Migration: pre-user clean-slate — no shim, just delete the field + schema entry + any reader code

### S — `serve --host` non-loopback security warning audit
- File: `packages/cli/src/commands/serve.ts:126-138` (function `validateHost`)
- Current behavior: when no auth token AND non-loopback host, fall back to `127.0.0.1` and log warning via i18n key `cli.serve.warning.host-fallback`
- Audit task: verify the warning text in `packages/shared/src/i18n/locales/{en,zh-CN}.ts` clearly directs the user to set `FABRIC_AUTH_TOKEN` to keep the requested host
- Likely shape change: rewrite warning to include the env var name + the actionable suggestion ("set FABRIC_AUTH_TOKEN=<token> to expose on {host}")
- Also: ensure parity in zh-CN and en variants

### Bug Y (rc.14 parked) — Codex MCP wiring gap
- User's `~/.codex/config.toml` confirmed missing `[mcp_servers.fabric]` block (verified during planning context gathering)
- Codex toml writer exists at `packages/cli/src/config/toml.ts` and is referenced by `install.ts`/`skills-and-hooks.ts` — wiring gap is somewhere in the install flow OR the resolver isn't detecting Codex when present
- Re-diagnose:
  1. Test `fab install` on a fresh fixture with `~/.codex/config.toml` present — does the toml writer fire?
  2. Trace through `install.ts` → `installMcpClients` → resolver → toml writer; identify where Codex falls out
  3. Determine if it's a detection gap (resolver), a writer gap (toml.ts), or an orchestration gap (install pipeline)
- After diagnosis: ship the fix as the LAST task in rc.17 (the user said "park until end of Phase 4, then re-diagnose")
- If diagnosis surfaces unexpected complexity (>1 day work), defer to a separate hotfix release rather than blocking rc.17

## Cross-phase constraints

- Each task = one git commit (per memory/project_grill_deferred_items.md)
- pre-user clean-slate: no migration shim (per memory/feedback_clean_slate.md)
- drift→abort, no `--force` (per memory/feedback_cli_design.md)
- Run Gemini review + coverage ONCE at end of plan, not per-task (per memory/feedback_review_batching.md)
- rc.17 ships AFTER rc.16 has been Gemini-reviewed + coverage-checked (per user direction 2026-05-15)

## Anti-scope (DO NOT do in rc.17)

- Add new CLI flags (rc.15 surface is contract-locked)
- Change Protocol v2 / `payload.narrow` (rc.18 territory)
- Introduce v1 schema compat shim
- Touch hook .cjs banner i18n (rc.16 territory)

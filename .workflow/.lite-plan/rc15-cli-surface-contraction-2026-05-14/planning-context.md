# Planning Context: rc.15 CLI Surface Contraction

## Source Evidence

- `exploration-cli-surface-removals.json` — Flag-by-flag downstream map (31 distinct changes across install/uninstall/doctor/serve commands + i18n locales). Each kill triggers a 5-step ripple: citty args → Args type → Options DTO → reducer → consumer gates.
- `exploration-command-tree-deps.json` — Command file deletion + index.ts router edits + citty 0.2.2 `meta.hidden:true` native support confirmation (node_modules/.pnpm/citty@0.2.2/.../index.d.mts L50-L56).
- `exploration-schema-and-test-impact.json` — `auditMode`/`audit_mode` dedupe (5 files only, trivial) + concentrated test surface map: cli-surface.test.ts + cli-surface.test.ts.snap + i18n.test.ts.snap as primary drift gates.

## Source Evidence — Specific File References

- `packages/cli/src/commands/install.ts:294-353` — citty args block (8 of 12 kill targets)
- `packages/cli/src/commands/install.ts:535-559` — `resolveInitCliIntent` reducer
- `packages/cli/src/commands/install.ts:617-625` — `cli.install.diff.deprecation-{force,reapply}` warnings (delete)
- `packages/cli/src/commands/install.ts:665-688` — drift-abort guards (become unconditional)
- `packages/cli/src/commands/install.ts:926` — `runInitScan(target, { source: 'init' })` call site (preservation constraint)
- `packages/cli/src/commands/install.ts:1192` — `configCommand.installMcpClients(...)` call (preservation constraint)
- `packages/cli/src/commands/install.ts:1206` — `installHooks(target, ...)` call (preservation constraint after C5 relocation)
- `packages/cli/src/commands/uninstall.ts:185-240` — citty args block (7 kills + plan rename)
- `packages/cli/src/commands/uninstall.ts:307-327` — `resolveUninstallCliIntent` reducer (cleanEmpties default-flip)
- `packages/cli/src/commands/uninstall.ts:646` — `BootstrapUninstallOptions { cleanEmpties }` threading (drop after default-flip)
- `packages/cli/src/commands/uninstall.ts:766-771` — wizard cleanEmpties prompt (delete)
- `packages/cli/src/commands/doctor.ts:64-102` — citty args block (force kill + apply-lint rename + rescan add)
- `packages/cli/src/commands/doctor.ts:107-108` — `checkLockOrThrow({ force: args.force })` (becomes no opts)
- `packages/cli/src/commands/serve.ts:24-48` — citty args block (force kill, single flag)
- `packages/cli/src/commands/serve.ts:61` — `acquireLock(projectRoot, { force: args.force })` (becomes no opts)
- `packages/cli/src/commands/hooks.ts:36-68` — `hooksCommand` defineCommand (delete)
- `packages/cli/src/commands/hooks.ts:106-281` — `installHooks` + `validateHookPaths` (MOVE to install/hooks-orchestrator.ts)
- `packages/cli/src/commands/config.ts:99-152` — `configCmd` with subCommands (strip to placeholder)
- `packages/cli/src/commands/config.ts:13,105` — `hooksCommand` import + subCommand wiring (delete)
- `packages/cli/src/commands/config.ts:56-73` — `parseClientFilter` orphan (delete)
- `packages/cli/src/commands/config.ts:156-191` — `installMcpClients` (preserve)
- `packages/cli/src/commands/scan.ts:178-280` — `runInitScan` (preserve as named export)
- `packages/cli/src/commands/scan.ts:286-334` — `scanCommand` (delete)
- `packages/cli/src/commands/scan.ts:63-1559` — `createScanReport` + walkFiles + buildRecommendations + getReadmeQuality + matchesIgnorePattern (delete legacy block)
- `packages/cli/src/commands/scan.ts:629-690` — `detectExistingLanguage` (preserve, used by install.ts:19)
- `packages/cli/src/commands/scan.ts:1566-1584` — `__testing__` exports (preserve, used by scan-builders.test.ts)
- `packages/cli/src/commands/plan-context-hint.ts:70-75` — `planContextHintCommand.meta` (add `hidden: true`)
- `packages/cli/src/commands/index.ts:1-10` — `allCommands` router (rotate: -scan -hooks +config; net 5)
- `packages/server/src/services/serve-lock.ts:48-55,92-107` — `ServeLockHeldError` actionHint (rewrite to drop --force, mention PID + kill cmd)
- `packages/shared/src/schemas/fabric-config.ts:52-53` — `auditMode` dup (delete L52, keep L53)
- `packages/shared/src/types/config.ts:32-33` — `FabricConfig.auditMode` dup (delete L32, keep L33)
- `packages/shared/src/i18n/locales/en.ts:73,103,125,213-218,228,266-273,330` — flag description keys + deprecation messages (delete in lockstep)
- `packages/shared/src/i18n/locales/zh-CN.ts:71-72,100-122,137-155,210-212,223-232,266,320` — zh-CN mirror deletions
- `packages/cli/__tests__/__snapshots__/cli-surface.test.ts.snap:3-403` — regenerate via `vitest -u`
- `packages/cli/__tests__/cli-surface.test.ts:94-103` — public command set assertion: `[install, doctor, serve, uninstall, config]`
- `packages/cli/__tests__/cli-surface.test.ts:108-113` — critical-flag assertion (relax: install no longer exposes force/scope/reapply)
- `docs/test-seed/cli.md:9-14` — public commands listing (rotate scan→config)
- `packages/cli/__tests__/integration/install-diff-mode.test.ts:298+` — Scenario 7 (events.jsonl as directory) **DELETE per clarification 12**

## Understanding

**Current State**: v2.0.0-rc.14 (just shipped) ships 7 public commands × ~35 flags. The rc.14 release added deprecation banners on `--force` and `--reapply` promising removal in rc.15. The codebase mixes two CLI surface eras: (a) the legacy stage-toggle / escape-hatch era (--bootstrap, --hooks, --mcp, --no-*, --force, --reapply, --plan, --apply-lint, --interactive, --purge, --clean-empties, --mcp-install, --scope), and (b) the three-entry contracted era (install/doctor/serve/uninstall/config, fewer flags, interactive wizards where applicable). The `auditMode`/`audit_mode` dup in `fabric-config.ts` is a leftover from an unfinished rename. `fab hooks` and `fab scan` top-level commands have already drifted off the public surface in CHANGELOG advertising; their internal call sites (install.ts:926, install.ts:1206) keep the helpers alive.

**Problem**: rc.15 must (a) actually deliver the rc.14-promised flag kills, (b) physically remove the command-tree branches (hooks, scan, config subcommands), (c) hide plan-context-hint from --help while keeping it spawnable by hook scripts, (d) wire `fab config` as an rc.16 placeholder, (e) dedupe the schema dup, (f) preserve every shared helper (runInitScan, installHooks, installMcpClients) since install.ts depends on them. Each rc.14→rc.15 flag kill cascades through citty args → Args type → Options DTO → reducer → 1-3 consumer call sites → i18n en+zh-CN pair → snapshot regen → test rewrite. The snapshot test (`cli-surface.test.ts.snap`) is the deterministic drift-gate proof.

**Approach**: Six git commits, each = one TASK, each independently buildable + testable. Sequential ordering minimizes merge conflicts on shared files (CHANGELOG.md, cli-surface.test.ts, snapshot file). The order maps the dependency edges:
1. TASK-001 (install) — biggest blast radius, drift-abort message update, sets baseline
2. TASK-002 (uninstall) — symmetric mirror, also flips cleanEmpties default + deletes the option type
3. TASK-003 (doctor + serve) — paired because both kill --force AND share ServeLockHeldError rewrite at serve-lock.ts:52,104
4. TASK-004 (command tree) — sequenced AFTER doctor because doctor adds --rescan which calls runInitScan that scan.ts is being trimmed around
5. TASK-005 (schema) — isolated, different package (packages/shared)
6. TASK-006 (version bump + CHANGELOG)

## Key Decisions

- **Decision**: `installHooks` relocates to NEW file `packages/cli/src/install/hooks-orchestrator.ts` | Rationale: convention match with existing `src/install/skills-and-hooks.ts`; commands/ directory becomes pure command-wrappers | Evidence: `packages/cli/src/commands/hooks.ts:106-281` (helpers) vs `packages/cli/src/install/skills-and-hooks.ts` (sibling layout)
- **Decision**: `--apply-lint` → `--fix-knowledge` rename is CLI + doctor.ts local only; leave `packages/server` (runDoctorApplyLint, DoctorApplyLintReport) untouched | Rationale: minimize blast radius; server-side names are internal contract not user-visible | Evidence: `packages/cli/src/commands/doctor.ts:89-93,110,123,156,168,184,202,307,342`
- **Decision**: `ServeLockHeldError` message rewrite uses verbose option: `'A `fab serve` instance (PID ${state.pid}) is holding the workspace lock. Stop it (Ctrl-C in that terminal or `kill ${state.pid}`) before running this command.'` | Rationale: max user guidance; copy-paste kill cmd | Evidence: `packages/server/src/services/serve-lock.ts:52,104` (two occurrences); i18n via `t()` for en+zh-CN parity
- **Decision**: `fab config` is VISIBLE in --help, prints `t('cli.config.placeholder')` | Rationale: half-baked surface advertised intentionally signals "rc.16 ETA"; `--target` flag accepted for consistency | Evidence: clarification 4 ground truth from task brief
- **Decision**: `cleanEmpties` option DELETED entirely (not kept as internal toggle) | Rationale: pre-user clean-slate per memory `feedback_clean_slate.md` | Evidence: `packages/cli/src/install/uninstall-skills-and-hooks.ts:24,54,191,212,234,493,538,569,604` threading map
- **Decision**: `createScanReport` + legacy walkFiles/buildRecommendations/getReadmeQuality/matchesIgnorePattern DELETED with `scan-edge-cases.test.ts` | Rationale: pure clean-slate, runInitScan is the v2 replacement | Evidence: `packages/cli/src/commands/scan.ts:29-37` header comment ("kept because callers depend on it: scan-edge-cases.test.ts")
- **Decision**: `parseClientFilter` (config.ts:56-73) DELETED as orphan after C6 strips install subCommand | Rationale: zero production callers post-C6; rc.16 can re-add | Evidence: `packages/cli/__tests__/config-install.test.ts:7` (sole consumer); described in `packages/cli/src/commands/config.ts:56-73`
- **Decision**: `--rescan` runs BEFORE doctor report; composable with `--fix` and `--fix-knowledge` (single-pass: rescan → mutations → report) | Rationale: fresh state feeds mutations and report | Evidence: clarification 7 ground truth + pattern from `install.ts:926`
- **Decision**: `cli-surface.test.ts` public command set rotates to `[install, doctor, serve, uninstall, config]` (count stays 5) | Rationale: scan→config swap maintains the drift-gate's 5-command contract | Evidence: clarification 10 + `cli-surface.test.ts:94-103`
- **Decision**: `--reapply` KILLED outright | Rationale: feedback_cli_design.md locks this in; drift-recovery becomes `fab uninstall && fab install` (already in drift-abort message) | Evidence: task brief clarification 11 OVERRIDE
- **Decision**: `install-diff-mode.test.ts` Scenario 7 DELETED entirely | Rationale: without --force, events.jsonl-as-directory recovery converges to `fab uninstall && fab install` (already in drift-abort) | Evidence: task brief clarification 12

## Dependencies

- Depends on: rc.14 ships clean (prerequisite — current `main` HEAD is `abbc706 fix(rc13)`, indicating local but not yet rc.14 — verify before TASK-006 version bump)
- Provides for: rc.16 `fab config` TUI panel implementation; rc.16 can re-add parseClientFilter if mcp-config sub-panel materializes

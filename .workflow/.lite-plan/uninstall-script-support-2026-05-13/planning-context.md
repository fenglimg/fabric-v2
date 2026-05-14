# Planning Context: `fab uninstall` (symmetric inverse of `fab init`)

User prompt: "当前似乎没有支持卸载脚本呢？" — Fabric CLI ships `fab init` (3-stage: scaffold → bootstrap → MCP) but no inverse. This plan adds `fab uninstall` to `@fenglimg/fabric-cli` package, targeting release vehicle **rc.9**.

## Source Evidence

- `exploration-install-architecture.json` — enumerates the 3 install write surfaces and every artifact `init` produces. Key code: `init.ts` L234-L302 (citty defineCommand shape), L573-L617 (`buildInitFabricPlan` — canonical scaffold inventory), L852-L891 (bootstrap stage helpers: 3 skills + 3 hook scripts + 3 config merges + pointer line), L892-L915 (MCP stage), and `install/skills-and-hooks.ts` L72-L77 (POINTER_LINE / REVIEW_POINTER_LINE / IMPORT_POINTER_LINE), L79 (POINTER_TARGETS = `['CLAUDE.md','AGENTS.md','.cursor/rules']`), L86-L153 (3 install*Skill helpers), L165-L263 (3 hook installers), L276-L330 (3 mergeXHookConfig helpers with arrayAppendPaths).
- `exploration-integration-points.json` — file-level hookup map. Key seams: `commands/index.ts` L1-L9 (`allCommands` registry — add `uninstall` lazy import); `packages/shared/src/i18n/locales/{en,zh-CN}.ts` (cli.init.* convention to mirror as cli.uninstall.*); `__tests__/cli-surface.test.ts` L92-L100 (hard equality on public command set — MUST be updated); `__tests__/i18n.test.ts` L49+ (collectSnapshots); `__tests__/__snapshots__/*.snap` (regenerate); `docs/test-seed/cli.md` §1 (drift gate doc).
- `exploration-testing.json` — test patterns. Key fixtures: `__tests__/helpers/init-test-utils.ts` (createWerewolfFixtureRoot/cleanupFixtureRoot/setProcessTty); `__tests__/fixtures/cocos-stub` (canonical project fixture); `__tests__/integration/install-skills-and-hooks.test.ts` (snapshotTree pattern — directly invertible for round-trip uninstall test); `__tests__/init-cli-surface.test.ts` L58-L65 (citty command.run({args}) test invocation); `vitest.config.ts` lines/statements: 70 coverage gate.
- `packages/cli/src/commands/init.ts:L234-L302` proves install destination tables are currently INLINED inside install/skills-and-hooks.ts helpers, not exported — hence TASK-001 must extract them.
- `packages/cli/src/install/skills-and-hooks.ts:L276-L330` proves un-merge is the hardest constraint: configs deep-merge into user-authored files; cannot rm — must locate-and-remove by `command`-path match.

## Understanding

**Current State**: Fabric CLI has `fab init` (3-stage pipeline) with comprehensive install helpers under `packages/cli/src/install/skills-and-hooks.ts` + MCP writers under `packages/cli/src/config/writer.ts`. No uninstall command, no install manifest, no destination-path constants — install destinations are inlined inside each helper. Test suite uses real-fs + tmpdir-fixture pattern. v2.0.0-rc.8 is the most recent published RC; rc.9 is the next target.

**Problem**: User cannot cleanly remove Fabric from a project. Manual cleanup requires intimate knowledge of every artifact `init` writes across 3 client roots (`.claude`, `.codex`, `.cursor`), 3 deep-merged config files, and `.fabric/` scaffold. User must not lose user-authored knowledge (`.fabric/knowledge/`) or other-tool entries inside deep-merged configs.

**Approach** (per binding user clarifications):
1. **Single source of truth**: extract install destination tables from `skills-and-hooks.ts` into exported const tables; both install (refactored, behavior-preserving) AND uninstall consume them.
2. **Symmetric command**: new `packages/cli/src/commands/uninstall.ts` mirrors `init.ts`'s intent → plan → execute orchestrator; registers in `allCommands`.
3. **Three-stage uninstall pipeline** mirroring init's stages: scaffold removal (preserve `.fabric/knowledge/` unless --purge; **never** touch `~/.fabric/knowledge/`) → bootstrap removal (skills + hook scripts + un-merge configs + strip pointer lines) → MCP unregistration (per-client `writer.remove()` removing only the `fabric` server entry).
4. **Conservative un-merge by default**: remove only fabric entries (matched by `command`-path), leave empty arrays/objects intact. `--clean-empties` triggers cascade cleanup.
5. **Flag surface**: `--plan`, `--force`, `--yes`, `--no-bootstrap`, `--no-mcp`, `--no-scaffold`, `--target`, `--interactive`, `--purge`, `--clean-empties` (symmetric to init minus `--reapply` plus `--purge`/`--clean-empties`).
6. **Idempotent + safe**: re-run is no-op; missing artifacts logged-and-skipped, never error. AGENTS.md / CLAUDE.md / `.cursor/rules`: strip only fabric pointer line; preserve file unless it becomes empty AND init created it (cannot prove → preserve).
7. **i18n parity**: add `cli.uninstall.*` keys in both `en.ts` and `zh-CN.ts`, respecting `protected-tokens.ts`.
8. **Tests**: unit (`__tests__/uninstall.test.ts`) + integration (`__tests__/integration/uninstall-skills-and-hooks.test.ts`) + extend `cli-surface.test.ts` + minimal i18n snapshot (description + help-text usage line only).
9. **Docs (moderate)**: CHANGELOG.md `## [2.0.0-rc.9]` Added entry; `docs/test-seed/cli.md` §1 Feature Surface bullet (with I/T invariants); `README.md` L202-205 quick-reference line. No new `docs/uninstall.md`.

## Key Decisions

| Decision | Rationale | Evidence |
|---|---|---|
| Hard-coded destination constants exported from `install/skills-and-hooks.ts` (Option A from clarification #2) | No install manifest exists; rc.7/8 users have no `.fabric/install-manifest.json`; constants give compile-time link between install + uninstall and remove duplication. User clarification #3 binds. | `install/skills-and-hooks.ts:L86-L330` (inlined paths) + clarification #3 |
| Full inverse default (scaffold + bootstrap + MCP); preserve `.fabric/knowledge/` and state files (events.jsonl/agents.meta.json/forensic.json) unless `--purge` | Symmetric with init; conservative on user-authored knowledge. `~/.fabric/knowledge/` NEVER touched (shared across projects). User clarification #1 binds. | exploration-install-architecture.json constraint #4-5 + clarification #1, #2 |
| Conservative un-merge with `--clean-empties` opt-in cascade cleanup | User-authored hook configs deep-merge with fabric entries; rm'ing the file loses user data. `command`-path match is precise enough. Clarification #5 binds. | `install/skills-and-hooks.ts:L276-L330` (arrayAppendPaths) + clarification #5 |
| Single `uninstall.ts` command (top-level), no `fab hooks uninstall` / `fab config uninstall` subcommands | Aligned with user-stated flag surface (clarification #4); per-stage selection via `--no-*` flags. | clarification #4 |
| `--plan` (dry-run preview) + `--force` (proceed when some artifacts missing) + `--yes` (skip interactive); no `--reapply` (no symmetric meaning) | Matches init's flag philosophy. Clarification #4. | exploration-integration-points.json constraints + clarification #4 |
| Co-locate uninstall helpers in new `install/uninstall-skills-and-hooks.ts` | Source-of-truth proximity to `install/skills-and-hooks.ts`; consumes the new shared constants. | exploration-install-architecture.json integration #2 |
| Per-client MCP `remove(serverName)` via `config/writer.ts` abstraction extension | Three formats (JSON/JSON/TOML), three removal paths; mirror install's writer.write() shape. Clarification #10. | `config/writer.ts:L22` createServerEntry + clarification #10 |
| Minimal i18n snapshot (description + help-text usage only) for uninstall | Avoids churn during copy iteration on rc.9. Clarification #8. | clarification #8 |
| Conservative pointer-line stripping (file preserved unless empty AND created by init — cannot prove → preserve) | AgentsMdAction history is not persisted; symmetric with init's preserve-if-present rule. Clarification #9. | `install/skills-and-hooks.ts:L347-L409` addArchiveSkillPointer + clarification #9 |

## Dependencies

- Depends on: existing `install/skills-and-hooks.ts`, `config/writer.ts`, `commands/init.ts` patterns, `__tests__/helpers/init-test-utils.ts` fixture helpers, `protected-tokens.ts` registry.
- Provides for: clean Fabric removal UX; symmetric foundation for any future "selective uninstall" subcommands (e.g., `fab hooks uninstall`).

## Task Skeleton (refined per task-grouping rules)

Six tasks total, dependency chain: T001 (foundation, refactor — no behavior change) → T002 (core command + scaffold/MCP) ‖ T003 (bootstrap helpers) → T004 (i18n) → T005 (tests) ‖ T006 (docs). T004 depends on T002+T003 to know all user-facing strings; T005 depends on T002+T003+T004; T006 can run parallel with T005.


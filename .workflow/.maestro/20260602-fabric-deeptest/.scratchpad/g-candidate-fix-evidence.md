# G-CANDIDATE-CLOSE + G-FIX-REVERIFY Evidence (dev-build deterministic)

dev-build: pcf-deeptest worktree, feat/fabric-followup-impl HEAD + F9 fix.

## G-CANDIDATE-CLOSE — 6/6 terminal verdicts

| candidate | verdict | evidence |
|---|---|---|
| **F5** codex no MCP | **REFUTED** (current build) | `~/.codex/config.toml` has `[mcp_servers.fabric]`; coldstart install reports "Codex CLI MCP 已就绪". Original was werewolf old-version residue. |
| **F9** status "(not a Fabric project)" | **CONFIRMED → FIXED** | `install` never writes `project_id`; even real pcf config lacks it. status.ts used `?? "(not a Fabric project)"` → lied on every installed project. Fixed: is_fabric_project signal + "(unset)" label. |
| **F13** must_read_if == summary | **CONFIRMED-as-design** | knowledge-meta-builder.ts:1076 `must_read_if: synthesizedSummary` (mirror); :1127 `?? summary` fallback. Distinct must_read_if only when author writes frontmatter field. Efficacy-weak (common baseline = zero extra signal), NOT a defect. No fix. |
| **F14** store "(仅本地)" w/ remote | **CONFIRMED → defer** | `whoami` computes `local_only: s.remote === undefined` from GLOBAL CONFIG metadata, not actual git remote. personal store git repo HAS remote (fabric-store-personal-pcf.git) but fabric-global.json entry `remote` ABSENT (added out-of-band, config not synced). Root cause = store-remote config tracking gap = **deferred v2.1 global-refactor** (S-series). Display mitigation (read git remote per store) exists but design keeps config as source-of-truth. |
| **F15** paths ignored → `**` | **REFUTED** (current build) | All relative paths (existent + non-existent) echo into target_path correctly; narrow relevance_paths match 16/24; absolute paths rejected with clear guard. No collapse to `**`. |
| **F17** branch fabric-state divergence | **REFUTED-as-bug** | multi-store vs co-location vs none across werewolf branches is EXPECTED — co-location commits .fabric into the branch; switching branches changes committed state. Not a defect. |

**Confirmed bugs**: F9 (fixed), F14 (confirmed, fix deferred to global-refactor per boundary).

## G-FIX-REVERIFY — 4/4 prior fixes behaviorally re-verified in dev build (not just unit tests)

| fix | reverify method | result |
|---|---|---|
| **F8** version-gate false positive (72e41be) | `fabric doctor --json` on real coldstart install | **0** `global_cli_outdated` checks → no false positive ✓ |
| **F11** zh-CN-hybrid placeholder (6ac3a91) | set fabric_language=zh-CN-hybrid → `fabric status` | NO placeholder/pre-init warning ✓ (resolve-fabric-locale.ts:52-62 silent resolve) |
| **F18** ai_selection_reasons optional (212953a) | `knowledgeSectionsInputSchema.safeParse({selection_token, ai_selected_stable_ids})` w/o reasons | success=true (api-contracts.ts:294 `.optional()`) ✓ |
| **F10** scope-explain no-arg (212953a) | `fabric scope-explain` (no args) | friendly USAGE block, exit 0, NO raw CLIError stack ✓ |

## F9 fix detail
- `packages/cli/src/store/info-ops.ts`: added `is_fabric_project: project !== null` to ProjectStatus.
- `packages/cli/src/commands/status.ts`: `project_id` label = `project_id ?? (is_fabric_project ? "(unset)" : "(not a Fabric project)")`.
- Regression test: `packages/cli/__tests__/status-info-ops.test.ts` (2 tests, pass).
- Dev-build reverify: coldstart install `fabric status` → `project_id: (unset)` ✓.
- Scope discipline: pure display-correctness; does NOT implement project_id assignment (that stays deferred to global-refactor).

## Side-observations (LIBERAL capture)
- `fabric status` ignores `--target` (uses process.cwd() unconditionally, status.ts:9) — minor.
- coldstart install fabric-config.json lacks `required_stores` (status shows "required: (none)") — install scaffolds minimal config; tangential to F9.
- Installing fabric in any project rewrites GLOBAL `~/.codex/config.toml` fabric mcp_server path to that project's server — multiple projects share one global codex MCP path (by-design for npm-global prod path; only visible with dev-build path).

# Changelog

All notable changes to Fabric will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0-rc.16] - 2026-05-15

Phase 3 of the post-grill 5-phase backlog: **Config + i18n closure**. F2 (banner i18n) lands first to give every Stop-hook banner four-language rendering; F1 (`fab config` clack TUI panel) replaces the rc.15 placeholder with a schema-driven menu loop.

### Added

- **Banner i18n library** (`packages/cli/templates/hooks/lib/banner-i18n.cjs`) — shared `.cjs` lib exposing `readFabricLanguage(projectRoot)` + `renderBanner(key, variant, params)` + 11-key × 4-variant string table (`zh-CN` / `en` / `zh-CN-hybrid` / `match-existing`). Default-on-unset is `zh-CN` to preserve rc.15 user-visible behavior; explicit `match-existing` folds to `en` per the UX i18n Policy class 1 rule. Protected tokens (slash-command names, `` `fabric doctor --lint` ``) preserved verbatim across all variants.
- **Schema introspection helper** (`packages/shared/src/schemas/fabric-config-introspect.ts`) — exports `getPanelFields()` / `getPanelFieldByKey(key)` returning typed metadata for the 11 Group A+B+C fields (2 locale + 8 hint thresholds + 1 audit). Single source of truth for the panel — adding a defaulted field requires only one new entry.
- **`fab config` clack TUI panel** (`packages/cli/src/commands/config.ts`) — interactive menu loop replacing the rc.15 placeholder. Iterates `getPanelFields()`, branches on widget type (`select` for enums, `text` for positive integers), atomic-writes to `.fabric/fabric-config.json` (tmp + rename, no lock check), re-renders after each save. Top-level CLI surface: `--target` only (per "能交互选的就别做 flag"). Uninit workspace → exitCode 1 with `fab install` hint.
- **Install pipeline copies hook libs** — `installHooks()` (in `packages/cli/src/install/hooks-orchestrator.ts` + `skills-and-hooks.ts`) now ships the entire `templates/hooks/lib/` directory (banner-i18n.cjs + session-digest-writer.cjs) into all three client install targets (Claude / Cursor / Codex). Symmetric uninstall cascade-prunes empty `lib/` dirs.
- **i18n keys** — 40 new `cli.config.*` keys across both `en.ts` and `zh-CN.ts` (parity verified): panel intro/outro, menu prompts, per-field labels + descriptions, validation messages, write success/failure, value display formatters.

### Changed

- **`fab config` placeholder** (rc.15) → full clack panel. The placeholder string `cli.config.placeholder` is removed. `installMcpClients` named export is preserved verbatim — `install.ts` re-imports it during the MCP install stage.
- **5 hardcoded zh-CN banner blocks** in `fabric-hint.cjs` (Signals A/B/C/D) → `renderBanner()` calls. Existing test-asserted substrings (`${count} 条`, `${days} 天`, `阈值 ${threshold}`, `从未运行 lint 检查`, `已 N 天未跑 lint`, `` `fabric doctor --lint` ``) preserved by the lib's zh-CN variant.
- **1 hardcoded zh-CN banner constant** (`IMPORT_RECOMMENDATION_BANNER`) in `knowledge-hint-broad.cjs` → `renderBanner()` call. Constant declaration removed.

### Tests

- 55 new banner-i18n unit tests (4-variant × 11-key matrix + readFabricLanguage edge cases + protected-token verbatim assertions).
- 8 new `fab config` panel scenarios (uninit gate ×2, exit path, Group A enum roundtrip, Group B int roundtrip, validator rejection ×2, installMcpClients export contract).
- Integration tests asserting hook libs ship to all 3 clients + symmetric uninstall cascade-prunes.
- CLI test suite: 478 → 552 passed (no regressions).

### Cross-phase

- Group D (skill-internal tuning, 10 keys) + Group E (plumbing, 5 keys) intentionally NOT in panel — power users edit JSON directly.
- 7-vs-8 Group B count discrepancy resolved: `archive_edit_threshold` (Signal A edit-count cutoff) was the missing 8th key.
- Pre-user clean-slate: no migration shim, no v1 compat — direct rename + introspection wiring.

### Coming in rc.17 (Phase 4)

- `--help` content rewrite + 装/配/跑 mental model intro
- Target resolution chain consolidation (drop `externalFixturePath` config field)
- `serve --host` security warning rewrite
- Bug Y (Codex MCP wiring re-diagnosis)

## [2.0.0-rc.15] - 2026-05-14

### Changed (Breaking — CLI surface contraction)

**`fab install` flags** 12 → 4:
- Killed: `--force`, `--reapply`, `--interactive`, `--no-bootstrap`, `--no-mcp`, `--no-hooks`, `--mcp-install`, `--scope`
- Renamed: `--plan` → `--dry-run`
- Final: `--target`, `--debug`, `--yes`, `--dry-run`
- All killed flags had interactive prompts in the install flow (rc.14 wizard); CLI surface now matches "能交互选的就别做 flag" principle (memory/feedback_cli_design.md)

**`fab uninstall` flags** 11 → 4:
- Killed: `--force`, `--interactive`, `--no-bootstrap`, `--no-mcp`, `--no-scaffold`, `--purge`, `--clean-empties`
- Renamed: `--plan` → `--dry-run`
- `--clean-empties` behavior is now always-on default (option deleted entirely, no preservation toggle)
- `--purge` removal makes `.fabric/knowledge/` unconditionally preserved
- Final flags symmetric with install: `--target`, `--debug`, `--yes`, `--dry-run`

**`fab doctor` flags**:
- Killed: `--force` (lock conflict aborts unconditionally per drift→abort principle)
- Renamed: `--apply-lint` → `--fix-knowledge` (parallel naming with `--fix`)
- Added: `--rescan` (composable: rescan → mutations → report single-pass)
- CLI flag rename + doctor.ts local identifier renames; server-side `runDoctorApplyLint` kept (minimize blast radius)

**`fab serve` flags**:
- Killed: `--force` (lock conflict aborts per drift→abort principle)

### Changed (Breaking — Command tree pruning)

- **Deleted**: top-level `fab hooks` command. `installHooks` + `validateHookPaths` helpers moved to NEW `packages/cli/src/install/hooks-orchestrator.ts` (convention match with `skills-and-hooks.ts`)
- **Deleted**: top-level `fab scan` command. Use `fab doctor --rescan` instead. Legacy v1 scan helpers (`createScanReport`, `walkFiles`, `buildRecommendations`, etc.) removed; `runInitScan` preserved as internal export
- **Stripped**: `fab config install` and `fab config hooks` subcommands. `fab config` becomes a rc.16 placeholder pointing at the upcoming TUI panel
- **Hidden**: `fab plan-context-hint` from `fab --help` (via citty `meta.hidden: true` — still callable by hook scripts)
- **Visible commands**: `fab --help` now lists exactly 5 — `install`, `doctor`, `serve`, `uninstall`, `config` (three-entry mental model: 装 / 配 / 跑 per memory/feedback_cli_design.md)

### Changed (UX)
- `ServeLockHeldError` message rewritten via `cli.serve.lock-held.action-hint` i18n key. New message includes target PID and concrete stop guidance (Ctrl-C in that terminal or `kill PID`). Drops the now-defunct `--force to override` suggestion.

### Changed (Schema)
- `fabric-config.json` schema deduped: dropped duplicate `auditMode` (camelCase) field; only `audit_mode` (snake_case) remains. Convention parity with sibling keys (`archive_hint_hours`, `review_hint_pending_count`, `fabric_language`, etc.). Schema is non-strict — external configs carrying old camelCase key will silently drop the setting at parse time.

### Migration

For users on rc.14: the deprecation warnings for `--force` and `--reapply` (added in rc.14) signaled this rc.15 removal. Drift recovery is now exclusively `fab uninstall && fab install` (no flag override path). Run `fab install --dry-run` (renamed from `--plan`) to preview before applying.

For configs with legacy keys: any `fabric-config.json` declaring `auditMode` should rename to `audit_mode`. No automatic migration shim.

### Stats
- ~35 flags → ~20 flags (-43%)
- 7 commands → 5 visible + 1 hidden
- 54 file changes across 5 refactor commits + this version bump

## [2.0.0-rc.14] - 2026-05-14

### Fixed
- **Cursor hooks.json schema** (Bug X) — rc.13 shipped an incorrect Cursor hook
  config envelope (`{events: {Stop, SessionStart, PreToolUse}}`) which Cursor
  rejected with "Config version must be a number; Config hooks must be an
  object". Now ships the correct schema per
  [Cursor official docs](https://cursor.com/cn/docs/hooks):
  top-level `{version: 1, hooks: {stop, sessionStart, preToolUse}}` with
  camelCase event names and flat per-entry shape. No migration shim per
  clean-slate policy — re-run `fab install` to refresh.
- **`fab install` idempotency + dry-run on existing workspace** (Bug V + Z) —
  `fab install` is now naturally idempotent via diff-mode. Re-running on a
  canonical workspace prints `Workspace already canonical (N files verified)`
  and exits 0. Missing pieces auto-apply (e.g., MCP for a newly-installed
  client). Drift triggers abort with helpful message pointing to `fab doctor`
  (inspect) or `fab uninstall && fab install` (reset). `--dry-run` now works
  on any workspace state. New `install_diff_applied` ledger event emitted for
  diff-mode runs.

### Deprecated
- `fab install --force` and `fab install --reapply` — slated for removal in
  rc.15 (Phase 2 CLI surface contraction). Deprecation warning now printed
  on use. The new diff-mode default behavior (`fab install` with no flags)
  replaces both: missing pieces auto-apply, drift aborts with reset guidance.

### Deferred
- **Codex MCP write to `~/.codex/config.toml`** (Bug Y) — diagnosis parked
  until end of Phase 4 per design decision in 2026-05-14 grilling. Users who
  need fabric MCP in Codex should manually add the `[mcp_servers.fabric]`
  block until then.

### Coming in rc.15 (Phase 2: CLI surface contraction)
- `fab install` flag count 12 → 4 (kill `--force`, `--reapply`, `--interactive`,
  `--no-bootstrap`, `--no-mcp`, `--no-hooks`, `--mcp-install`, `--scope`;
  rename `--plan` → `--dry-run`)
- `fab uninstall` flag count 11 → 4 (symmetric kills + `--clean-empties`
  becomes default behavior)
- Remove `fab hooks` command, `fab config install/hooks` subcommands
- Fold `fab scan` into `fab doctor --rescan`
- See `.workflow/.lite-plan/rc14-stop-the-bleeding-2026-05-14/` artifacts for
  the full 5-phase backlog.

## [2.0.0-rc.13] — 2026-05-14

**rc.12 CI follow-up.** Lint-only patch: extend knip ignore list to
`.cursor/hooks/**` (counterpart of `.claude/hooks/**` / `.codex/hooks/**`,
which the rc.12 dogfood install began populating) and migrate the stale
`packages/cli/src/commands/init.ts` entry in `ignoreIssues` to
`packages/cli/src/commands/install.ts` after the rc.12 rename. No
source/runtime changes; rc.12 tag remains as a historical marker of the
failed publish.

## [2.0.0-rc.12] — 2026-05-14

**Broad gate + fabric_language naming alignment.** Four breaking renames
land in a single rc: the `fab init` command becomes `fab install`, the
`knowledge_language` config field becomes `fabric_language`, the
SessionStart `revision_hash` gate is removed in favour of the
managed-section header, and the legacy `POINTER_LINE` mechanism migrates
to managed-section everywhere it appeared. All four are hard cuts with
no aliases or compatibility shims (clean-slate per zero-user-period
preference).

### Changed

- **`fab init` → `fab install` hard rename**: the command, file
  (`packages/cli/src/commands/install.ts`), citty `meta.name`, exported
  `installCommand` symbol, dispatch table entry, ~30 `cli.install.*`
  i18n keys (renamed from `cli.init.*` in `en.ts` + `zh-CN.ts`), help
  text values ("Initialize Fabric" → "Install Fabric"; "初始化 Fabric"
  → "安装 Fabric"), six doctor / meta-reader / api `action_hint`
  strings, and 15+ docs / README references all switch to the install
  verb. Legacy `fab init` invocations now emit citty's "unknown
  command" error — no deprecation message, no alias. Snapshots
  (`cli-surface.test.ts.snap` + `i18n.test.ts.snap`) regenerated to
  match.
- **`knowledge_language` → `fabric_language` schema rename** (TASK-003):
  fabric-config.json field renamed end-to-end (Zod schema, defaults,
  CLI writer, SKILL.md readers, doctor lints, dashboard surface). New
  `zh-CN-hybrid` enum value preserves English technical terms in
  Chinese narrative prose. Existing `knowledge_language` values are
  not migrated — fresh installs only.
- **SessionStart `revision_hash` gate removed** (TASK-001): the
  knowledge-hint-broad SessionStart hook no longer reads or compares
  the rule-set `revision_hash` before injecting the broad knowledge
  digest. The check was a no-op safeguard against an unrealised
  drift case and added latency on every session start.
- **`POINTER_LINE` → managed-section migration** (TASK-006):
  pointer-line bootstrap anchoring (the single-line `<!-- fabric:pointer -->`
  marker) is replaced with the existing managed-section block protocol
  (`<!-- fabric:managed -->` ... `<!-- /fabric:managed -->`). All
  bootstrap anchors (AGENTS.md, CLAUDE.md, `.cursor/rules/*.md`) now
  use the multi-line managed-section format uniformly.

## [2.0.0-rc.10] — 2026-05-13

**Fabric UX dogfood fixes.** Resolves three first-time-user pain points
surfaced during dogfooding plus the upstream MCP SDK misuse bug they
exposed. The `.fabric/.import-requested` sentinel mechanism is retired
entirely (clean-slate per zero-user-period preference) in favour of a
deterministic SessionStart self-check.

### Fixed

- **`fab_review` MCP tool fully broken on every action**
  (`Cannot read properties of undefined (reading '_zod')`): both
  `inputSchema` and `outputSchema` were passed to `registerTool` as
  `z.discriminatedUnion(...)`, but `@modelcontextprotocol/sdk@1.29.0`'s
  `validateToolOutput` path requires a `z.object()`-shaped raw shape and
  crashes on `schema._zod` access otherwise; the published JSON Schema
  also degraded to empty `properties: {}` so `tools/list` clients could
  not introspect any field. Fixed by splitting the schema into a flat
  `ZodRawShape` (`FabReviewInputShape` / `FabReviewOutputShape`) for SDK
  registration while keeping the existing `discriminatedUnion`
  (`FabReviewInputSchema` / `FabReviewOutputSchema`) as the internal
  authoritative contract used inside the handler via
  `FabReviewInputSchema.parse(input)` for runtime cross-field strictness.
  Adds a drift-guard unit test asserting the flat shape keys cover the
  union of branch keys. Implemented in
  `packages/shared/src/schemas/api-contracts.ts` and
  `packages/server/src/tools/review.ts`.

### Changed

- **`fabric-import` no longer interrupted at pending count ≥ 10**:
  `packages/cli/templates/hooks/fabric-hint.cjs` Signal B (review-hint
  on pending overflow) now consults `isImportInFlight(cwd)` before
  emitting `decision: "block"`. The helper reads
  `.fabric/.import-state.json` and treats the project as in-flight when
  `phase !== "complete"` and `last_checkpoint_at` is within
  `IMPORT_IN_FLIGHT_MAX_AGE_HOURS` (= 24, hard-coded). Stale states
  beyond 24h fall back to the previous behaviour. Signals A, C, D are
  unchanged.
- **`fabric init` now scaffolds a discoverable `.fabric/fabric-config.json`**:
  `packages/cli/src/commands/init.ts` adds `writeDefaultFabricConfig()`
  which writes every reader-consumed field
  (`knowledge_language`, `archive_hint_hours`,
  `archive_hint_cooldown_hours`, `review_hint_pending_count`,
  `review_hint_pending_age_days`, `maintenance_hint_days`,
  `maintenance_hint_cooldown_days`, `archive_edit_threshold`,
  `underseed_node_threshold`) with documented defaults — idempotent on
  re-run and `--reapply` (never overwrites user edits). Users no
  longer have to grep source to discover available config knobs.
- **`/fabric-import` recommendation now deterministic on first
  SessionStart of a sparse-knowledge fresh init**:
  `packages/cli/templates/hooks/knowledge-hint-broad.cjs` adds a
  `shouldRecommendImport()` self-check (agents.meta.json present +
  canonical count < `underseed_node_threshold` + `.import-state.json`
  absent). When true, the banner bypasses the existing `revision_hash`
  gate per-line so unchanged knowledge graphs still surface the hint;
  the broad-summary body remains hash-gated. Replaces the sentinel
  mechanism whose write was bypassed by every non-interactive
  `fabric init` path (CI, `-y`, piped input, `--plan`,
  `FABRIC_NONINTERACTIVE=1`, TTY-detection failures).

### Removed

- **`.fabric/.import-requested` sentinel mechanism (full retirement)**:
  removed `IMPORT_REQUESTED_SENTINEL_FILE`,
  `isImportRequestedSentinelPresent()`, `makeImportSentinelResult()`,
  the `sentinelPresent` short-circuit in `main()`, and all related
  exports / `CONSTANTS` keys from
  `packages/cli/templates/hooks/fabric-hint.cjs` and
  `packages/cli/templates/hooks/knowledge-hint-broad.cjs`. Removed
  `maybeWriteImportSentinel` + its clack confirm prompt from
  `packages/cli/src/commands/init.ts`. Removed the Phase 0 "Sentinel
  Contract (rc.7 T1)" block and the Phase 3.4 "rc.7 T1 sentinel clear"
  step from `packages/cli/templates/skills/fabric-import/SKILL.md`
  (replaced with a 2-line retirement note pointing at the new
  SessionStart self-check).
- **`scripts/rc7-coverage-gate.mjs`**: one-shot historic lint script
  (not in CI / `npm test`) whose post-conditions referenced the now-
  removed sentinel identifiers. Its rc.7 closure purpose is complete.

## [2.0.0-rc.9] — 2026-05-13

**`fab uninstall` command.** Symmetric inverse of `fab init` — removes
Fabric-managed artifacts across the same three stages (scaffold → bootstrap
→ MCP) without touching post-init user content. Defaults preserve
`.fabric/knowledge/` and state files (`events.jsonl`, `agents.meta.json`,
`forensic.json`); `~/.fabric/knowledge/` (personal root) is never touched
under any flag. Idempotent: re-running on an already-uninstalled project
exits 0 with all step statuses `skipped`.

### Added

- **`fab uninstall` command**: full inverse of `fab init`'s three-stage
  pipeline with citty `defineCommand` orchestrator and per-stage opt-out.
  Flags: `--plan`, `--force`, `--yes`, `--no-bootstrap`, `--no-mcp`,
  `--no-scaffold`, `--target`, `--interactive`, `--purge`, `--clean-empties`.
  `--purge` extends scaffold removal into `.fabric/knowledge/<subdir>/`
  contents (team root only); `--clean-empties` cascade-removes empty
  containers left behind by the conservative un-merge default. Implemented
  in `packages/cli/src/commands/uninstall.ts` (orchestrator + scaffold +
  MCP stages) and `packages/cli/src/install/uninstall-skills-and-hooks.ts`
  (10 bootstrap helpers + `uninstallBootstrapStage` orchestrator for
  Skills, hook scripts, deep-merged hook-config un-merge, and pointer-line
  strip).
- **Shared destination-path constants**: hard-coded install destinations
  extracted into 5 exported const tables (`SKILL_DESTINATIONS`,
  `HOOK_SCRIPT_DESTINATIONS`, `HOOK_CONFIG_TARGETS`,
  `HOOK_CONFIG_ARRAY_PATHS`, `FABRIC_HOOK_COMMAND_PATHS`) plus
  `POINTER_*` exports in `packages/cli/src/install/skills-and-hooks.ts`.
  Foundation for symmetric install/uninstall — install paths and
  uninstall removal paths now share a single source of truth at
  compile time. Install behavior unchanged.
- **Per-client MCP unregistration**: `ClientWriter.remove(serverName)`
  added to the writer abstraction; preserves all non-fabric server
  entries verbatim while detaching only the `fabric` key. Implemented
  for Claude Code / Cursor (JSON) and Codex CLI (TOML) in
  `packages/cli/src/config/writer.ts`,
  `packages/cli/src/config/json.ts`,
  `packages/cli/src/config/toml.ts`, and
  `packages/cli/src/config/claude-code.ts`. Called from
  `uninstallMcpClients()` in `packages/cli/src/commands/uninstall.ts`
  in the same loop shape as `installMcpClients`.

## [2.0.0-rc.8] — 2026-05-13

**Release-pipeline fix.** First RC actually published to npm since `2.0.0-rc.1`.
Bundles all rc.2 → rc.7 work that was tagged locally but never reached npm
because the CI publish step did not bump `package.json` to match the git tag.

### Fixed

- **Tag/version drift in release workflow**: `.github/workflows/release.yml`
  now derives the published version from `GITHUB_REF_NAME` via the new
  `scripts/apply-tag-version.mjs`, applied in the `publish` job after
  `pnpm install` and before `pnpm -r build`. Workspace `workspace:*`
  references resolve against the rewritten manifests at publish time.
- **Tag/version coherence guard**: `scripts/sync-versions.mjs` accepts an
  optional `--tag` flag; the `ci` job now invokes it as
  `node scripts/sync-versions.mjs --tag "${GITHUB_REF_NAME}"` so a mismatch
  between the committed `package.json` and the pushed tag fails the build
  before the publish job runs (defense in depth alongside `apply-tag-version.mjs`).

### Included from rc.2 → rc.7

All previously tagged but unpublished rc.2 → rc.7 work ships here. Notable
items: `fab_extract_knowledge` + `fab_review` MCP tools, `fabric-archive` /
`fabric-review` / `fabric-import` skills, `fabric doctor` 21-check surface
with `--apply-lint`, `fabric-hint` Signal D + edit-counter overview, T01–T11
rc.7 scope (CLI ↔ Skill init handover, scan-time path anchoring, threshold
externalization, `fab_plan_context` degenerate-mode removal), workspace
typecheck + lint + coverage stabilization. See git history `v2.0.0-rc.1..v2.0.0-rc.8`
for the full set.

## [2.0.0] — 2026-05-10

**Major release.** Knowledge sustainment protocol — a clean break from the
v1.x AGENTS.md/rules sync paradigm. Cross-client (Claude Code / Cursor /
Codex CLI) MCP-first protocol for capturing, reviewing, and sustaining
project knowledge as living artifacts under `.fabric/knowledge/`.

### Headline deliverables (aggregated rc.1 → rc.4)

- **MCP tools (4)**: `fab_plan_context`, `fab_get_rule_sections`,
  `fab_extract_knowledge` (rc.2), `fab_review` (rc.3 — 6 actions: list,
  approve, reject, modify, search, defer).
- **Skills (3)**: `fabric-archive` (rc.2 — 5-type extraction), `fabric-review`
  (rc.3 — mode inference), `fabric-import` (rc.4 — 3-phase pipeline with
  `.import-state.json` checkpoint for resumable cold-start enrichment).
- **Stop hooks**: Claude Code + Codex CLI (`archive-hint.cjs`, single .cjs
  serves both clients via identical `{decision:"block",reason:"..."}` JSON
  contract). Cursor: skills only (no Stop-hook surface as of 2026-05;
  tracked in v2.1 roadmap).
- **`fabric doctor`**: 21 deterministic checks (rc.4 added 6: `orphan_demote`,
  `stale_archive`, `pending_overdue`, `stable_id_duplicate`, `layer_mismatch`,
  `index_drift`) plus `--apply-lint` mutations (orphan-demote rewrite,
  stale-archive `fs.rename`, index-drift counter sync). All apply-lint
  mutations now roll back the filesystem change if the audit-trail event
  ledger append fails (TASK-010 Gemini-review HIGH fix).
- **Schema**: 5 knowledge types (decisions / pitfalls / guidelines / models /
  processes) × 3 maturity tiers (draft / endorsed / stable) × 2 layers
  (personal / team). Path-decoupled `stable_id`: `K[PT]-(MOD|DEC|GLD|PIT|PRO)-NNNN`
  with monotonic counter envelope in `agents.meta.json`.
- **Storage**: dual-root layout — personal at `~/.fabric/`, team at
  `<repo>/.fabric/`. v2 frontmatter is 7 flat scalar fields
  (`id`, `type`, `maturity`, `layer`, `layer_reason`, `created_at`, `tags`).
- **Lifecycle**: `propose → review → promote → demote → archive` with full
  audit trail in `events.jsonl` (15 typed event shapes). Server-side
  primitives ensure atomic 5-step approve flow with rollback at each step.
- **Hardening**: path-traversal sandbox in `fab_review.{approve,modify}`
  (rc.3 Critical fix); multiline-safe YAML frontmatter writer (rc.4);
  slug-prefix collision detection in `fab_extract_knowledge` (rc.4);
  rollback-on-ledger-failure in apply-lint mutations (rc.4 Gemini fix).

### Migration from v1.x

**Clean break — no migration path provided.** Fabric had zero users at the
v2.0.0 release point (per planning decision in MEMORY.md
`feedback_clean_slate`). v1.x repositories should be re-initialized; the
v1 `.fabric/rules/` layout is incompatible with the v2 `knowledge/`
schema. v1.x users should:

1. Back up any handcrafted `.fabric/rules/*.md` content.
2. Delete the v1 `.fabric/` directory.
3. Run `fabric init` (v2.0.0) — produces a v2 `.fabric/knowledge/` skeleton.
4. Use the new `fabric-import` Skill (rc.4) to mine prior project artifacts
   (`git log`, `docs/*.md`) into v2 pending knowledge entries.
5. Use `fabric-review` Skill to triage pending entries into the canonical
   knowledge tree.

### Fixed (rc.4 final-gate Gemini review)

- **Audit-trail rollback in apply-lint mutations.** When
  `appendEventLedgerEvent` fails after a successful filesystem mutation
  (`atomicWriteText` for orphan-demote, `fs.rename` for stale-archive),
  the mutation is now rolled back to keep canonical disk state in sync
  with the (absent) ledger entry. Best-effort rollback: if the rollback
  itself fails (extremely rare double-failure), the resulting error
  message names both faults so the user can recover manually. Surfaces as
  `applied: false` with descriptive `error` field on the mutation report.

### Acknowledged tradeoffs

- `filesystem-edit-fallback` (rc.3 doctor check #15) synthesizes a fresh
  `knowledge_promoted` event for canonical files lacking provenance in the
  ledger. This zeros out lint age on first observation, so manually
  written canonical files do not register as orphan-demote candidates
  until they accumulate inactivity from the synthesis point. Documented
  in `docs/initialization.md`. Workaround: emit a backdated
  `knowledge_promoted` event before manual writes (rc.4 dogfood pattern).
- `fabric doctor --apply-lint` and `--fix` share a single CLI exit code.
  When `--apply-lint` finishes successfully but `agents_meta_stale` /
  `knowledge_dir_unindexed` (owned by `--fix`) still register as fixable
  errors, the resulting non-zero exit can read as "apply-lint failed".
  Distinct exit codes deferred to v2.0.x per Q5 release-scope decision.

### Out of scope for v2.0.0 (deferred to v2.1)

- Cursor Stop-hook surface (Cursor adds Stop hooks in a future release).
- API rename `fab_review.modify.pending_path` → `target_path` (current name
  leaks `pending/` implementation detail; stable for v2.0).
- `knowledge_layer_change_started` paired event (crash-recovery tracking
  for layer flips; current `knowledge_layer_changed` is point-in-time only).
- Schema unlocks (current `api-contracts.ts` / `event-ledger.ts` are
  pre-locked at the rc.1 freeze point).

## [2.0.0-rc.4] — 2026-05-10

**Theme:** *Lint moat + import enrichment + documentation surface*

rc.4 closes the v2.0 RC cycle: deterministic lint with a filesystem-edit
fallback, the LLM-driven `fabric-import` Skill for baseline enrichment, a
full README rewrite, and the public docs surface
(`docs/knowledge-types.md`, `docs/initialization.md`, `docs/roadmap.md`).

### Added

- `fabric doctor --lint` — 6 deterministic checks covering knowledge tree
  health: `orphan_demote`, `stale_archive`, `stable_id_duplicate`,
  `layer_mismatch`, `index_drift`, `pending_overdue`.
- `fabric doctor --apply-lint` — applies fixes and emits
  `knowledge_demoted` and `knowledge_archived` events to the ledger.
- `fabric-import` Skill template — 3-phase pipeline (extract → classify
  → batch-write) with `.import-state.json` checkpoint for resumable runs.
  Installs into `.claude/skills/` and `.codex/skills/` alongside
  `fabric-archive` and `fabric-review`.
- `docs/knowledge-types.md` — canonical 5-type semantic reference with
  worth-archive / skip-it signals, concrete examples, and a decision tree.
- `docs/initialization.md` — full v2.0 init flow rewrite (replaces v1.x
  narrative): scan → install Skills → install Stop hooks → scaffold.
- `docs/roadmap.md` — three-tier structure: v2.0 (Released), v2.1
  (Planned), v2.x (Exploration), with explicit Out-of-Scope list.
- README rewrite — v2.0 narrative aligned with knowledge-sustainment
  positioning; cross-links to the new docs surface.

### Fixed

- Multiline-safe `quoteIfNeeded` in YAML frontmatter writer (rc.3
  deferred). Previously, multi-line `layer_reason` fields could break
  the regex frontmatter parser; now wrapped in YAML block-scalar style
  when newlines are present.
- Slug-prefix collision detection in `fab_extract_knowledge` (rc.3
  deferred). Two slugs sharing a 5-character prefix are flagged in the
  proposal step rather than silently colliding at filesystem write.

## [2.0.0-rc.3] — 2026-05-10

**Theme:** *Review loop end-to-end*

rc.3 lands the second half of the archive→review cycle: the
`fab_review` MCP tool with all 6 actions, the `fabric-review` Skill
with mode inference, a filesystem-edit fallback for orphan canonical
files, and a path-traversal sandbox.

### Added

- `fab_review` MCP tool — 6 actions: `list`, `approve`, `reject`,
  `modify`, `search`, `defer`. All actions emit typed events to
  `events.jsonl`; `approve` runs the 5-step atomic flow
  (counter++ → frontmatter inject → `git mv` → meta rebuild →
  event append) with rollback at each step.
- `fabric-review` Skill template — mode inference (single-entry edit
  vs batch review based on backlog size); per-mode flow with
  semantic-consistency check before approve; tag-filtered search.
- Stop-hook second signal — `archive-hint.cjs` now also fires when
  `.fabric/knowledge/pending/` accumulates ≥10 entries, recommending
  `fabric-review` Skill instead of (or in addition to) archive prompt.
- `fabric doctor` filesystem-edit fallback — synthesizes a
  `knowledge_promoted` event for canonical knowledge files lacking
  provenance in the event ledger (e.g. files moved by hand). Surfaces
  the synthesis as a `doctor` warning so users know what was inferred.
- Per-file ≥90% coverage gate — wired into the pre-release check; rc.3
  is the first RC to enforce it across `packages/server/`,
  `packages/cli/`, `packages/shared/`.

### Fixed

- **Critical: path-traversal sandbox in `fab_review.approve` and
  `fab_review.modify`.** Without sandboxing, a malicious or
  malformed `pending_path` argument could escape `.fabric/knowledge/`
  and write anywhere on the filesystem. Now: every path is resolved
  with `path.resolve` and verified to live under
  `<repo>/.fabric/knowledge/` before any I/O.

### Deferred to rc.4

- Multiline-safe `quoteIfNeeded` (frontmatter writer edge case).
- Slug-prefix collision detection (UX improvement, not a correctness
  bug).
- API rename `pending_path` → `target_path` in `fab_review.modify`
  (deferred to v2.1; current name leaks pending/ implementation
  detail).
- `knowledge_layer_change_started` event (paired with existing
  `knowledge_layer_changed` for crash recovery; deferred to v2.1).

## [2.0.0-rc.2] — 2026-05-10

**Theme:** *Archive loop foundation*

rc.2 lands the first half of the cycle: the `fab_extract_knowledge`
MCP tool, the `fabric-archive` Skill, the Stop-hook trigger, and the
hook-config install pipeline.

### Added

- `fab_extract_knowledge` MCP tool — writes proposed knowledge entries
  to `.fabric/knowledge/pending/<type>/`. Idempotency key is
  `sha256(source_session, type, slug)`; on duplicate, evidence is
  appended to the existing entry as `## Evidence (call N)` rather
  than creating a duplicate file. Emits `knowledge_proposed` event.
- `fabric-archive` Skill template — 5-type extraction prompt with
  layer classification heuristic (strong-team / strong-personal /
  default-team) and 5-rule slug naming. Single batch review
  presented to user; one MCP call per confirmed candidate.
- `archive-hint.cjs` Stop hook — fires when `events.jsonl` shows ≥5
  `plan_context` entries since last `knowledge_proposed`, OR ≥24h
  elapsed since last archive. Stdout JSON shape
  `{"decision":"block","reason":"..."}` is identical across Claude
  Code and Codex CLI, so a single `.cjs` script serves both clients.
- Hook config templates — `claude-code.json` (`hooks.Stop[]` array)
  and `codex-hooks.json` (`events.Stop[]` array). Cursor: no
  Stop-hook surface as of 2026-05; tracked in v2.1 roadmap.
- Install pipeline — `fabric init` bootstrap stage now wires hook
  install; new `fabric hooks` command re-applies hook install only
  (e.g. after upgrading the package). Hook config merge preserves
  user customizations: indexes `hooks.Stop[]` by command path, no-ops
  if Fabric's entry is already present, appends if absent.

### Fixed

- (none — first release of these features)

## 2.0.0-rc.1 (2026-05-10)

**BREAKING — Knowledge sustainment protocol pivot.** Fabric repositioned from
"MCP-first AGENTS.md sync" to "MCP-first knowledge sustainment". This is a
clean break from v1.x; no migration path — existing v1.x repos must re-init.

### BREAKING
- Removed v1.x `.fabric/rules/` directory layout — replaced by `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/`
- Removed support for Windsurf, Roo Code, Gemini CLI clients (Fabric scope: Claude Code, Cursor, Codex CLI only)
- `fabric-config.ts` now uses `.strict()` Zod schema — unknown client keys hard-fail with ZodError (was silently preserved via `.passthrough()`)
- Renamed event types in event ledger: `rule_*` → `knowledge_*` (4 renames); deleted 3 obsolete: `rule_baseline_accepted`, `baseline_synced`, `legacy_client_path_present`
- Deleted `INITIAL_TAXONOMY.md` (v1 structural topology — replaced by `docs/schema.md` + AGENTS.md guidance)
- Deleted `fab bootstrap` standalone command (folded into `fab init` 4-stage pipeline)
- Deleted `fabric-init` skill three-piece (claude-skills, codex-skills, skill-source) — v2 init pipeline is turnkey, LLM enrichment moved to `fabric-import` skill in rc.4
- Deleted `husky/pre-commit` template (v1 sync gate; v2 model is async-review via `pending/` + `fabric-review` skill in rc.3)

### Removed (v1.x dead code)
- `packages/cli/src/commands/bootstrap.ts`
- `packages/shared/src/node/bootstrap-guide.ts`
- `packages/cli/templates/agents-md/variants/{vite,next,cocos}.md` (v1 framework presets — v2 init-scan auto-detects from forensic.json)
- 13 v1-coupled test files (rule-sync, tool-rule-freshness, init-nondestructive, etc.)
- 3 v1 doctor lint checks (`legacy_v1_artifacts_present`, `rule_sections_invalid`, fabric-init skill checks)

### Added
- `.fabric/knowledge/{decisions,pitfalls,guidelines,models,processes,pending}/` 6-subdir layout
- Dual-root: personal at `~/.fabric/`, team at `<repo>/.fabric/`
- Path-decoupled `stable_id` format: `K[PT]-(MOD|DEC|GLD|PIT|PRO)-NNNN` with monotonic counter envelope in `agents.meta.json`
- v2 frontmatter schema (7 fields, flat scalars): `id`, `type`, `maturity`, `layer`, `layer_reason`, `created_at`, `tags`
- `tags` field on knowledge entries — flat YAML flow-style array; populated by init-scan from forensic tech stack; consumed by rc.3 review skill's tag-filter search
- Init-time deterministic scan producing baseline knowledge entries (KT-MOD, KT-GLD, KT-PRO from forensic.json)
- `docs/schema.md` — 1-page contract for frontmatter + 15 event types + stable_id format + counters envelope
- Self-repo dogfood: `.fabric/knowledge/decisions/` seeded with 8 KT-DEC entries capturing v2.0 architectural decisions

### Fixed
- `doctor --fix` `counter_desync` now actually persists counters to `agents.meta.json` after `reconcileRules` (was silently skipped — surfaced during dogfood)

### Coming next
- **rc.2**: `fab_extract_knowledge` MCP tool + `fabric-archive` skill + Stop hooks for 3 clients (Claude Code/Cursor/Codex)
- **rc.3**: `fab_review` MCP tool + `fabric-review` skill (mode-inferred review loop)
- **rc.4**: `doctor --lint` (6 deterministic checks) + `fabric-import` skill (LLM-driven enrichment) + full README rewrite + `docs/{knowledge-types,initialization,roadmap}.md`
- **2.0.0 stable**: npm publish to `latest` dist-tag (rc.x stays GitHub-only)

## [1.8.0-rc.3] - 2026-05-09

### Fixed

- Codex CLI repo skill installed to the wrong path. Prior releases wrote `.agents/skills/fabric-init/SKILL.md`, but Codex CLI discovers repo skills under `.codex/skills/<name>/SKILL.md` (mirroring its `~/.codex/skills/` global layout). Result: every existing Fabric init since the Codex follow-up was added shipped a Codex skill that Codex never read, silently breaking the Codex follow-up flow. `init` now writes to `.codex/skills/fabric-init/SKILL.md`; both Codex hook reason texts (zh + en) and the `cli.init.reason-message.codex-body` / `multi-body` i18n strings point at the new path.

### Added

- Doctor check `codex_skill_legacy_path` (fixable): detects `.agents/skills/fabric-init/SKILL.md` left over from prior installs. `--fix` moves it to `.codex/skills/fabric-init/SKILL.md` (preserving user edits), removes empty parent dirs, and emits a `codex_skill_path_migrated` ledger event.

## [1.8.0-rc.2] - 2026-05-09

### Changed

- Claude reminder hook fully renamed to match the unified skill name: `agents-md-init-reminder.cjs` → `fabric-init-reminder.cjs`. The Stop-hook reason text now says "调用 fabric-init skill" (and the equivalent English copy in `cli.init.reason-message`). Skill frontmatter `name:` and i18n strings are aligned to `fabric-init`.
- `init.ts` Stop-hook filter recognizes both old (`agents-md-init-reminder.cjs`) and new (`fabric-init-reminder.cjs`) names, so re-running `fab init` on an existing project cleanly replaces the legacy entry.

### Added

- Doctor check `claude_hook_legacy_path` (fixable): detects `.claude/hooks/agents-md-init-reminder.cjs` left over from prior installs (file or `.claude/settings.json` reference). `--fix` renames the file to `fabric-init-reminder.cjs`, rewrites the settings command path, and emits a `claude_hook_path_migrated` ledger event.

## [1.8.0] - 2026-05-07

### Added

- Atomic write helper (`@fenglimg/fabric-shared/node/atomic-write`) — tmp+rename pattern with optional fsync; used by all config and scaffold writers.
- FabricError taxonomy with 5 sub-trees: `ConfigError` / `RuleError` / `IOFabricError` / `MCPError` / `InitError`; replaces ad-hoc string-prefix error matching throughout server.
- Per-path ledger write queue (poison-resistant, in-process serialization) — concurrent `fab_append_intent` calls for the same path are serialized without data loss.
- SIGINT / SIGTERM / SIGHUP handlers with in-flight request drain (up to 5 s) + `fsync` on the event ledger before process exit (closes Claude Code #15945 zombie pattern).
- Cross-process serve lockfile (`.fabric/.serve.lock`) with PID liveness check — stale locks auto-recover, live locks block with `--force` override.
- rule-sync orchestrator (`ensureRulesFresh` / `reconcileRules`) — single source of truth for rule freshness; wired into all three MCP tool handlers with warnings surfaced in `response.warnings`.
- Startup full rule consistency scan — rules added to `rules/` while the server was offline are visible immediately on next start.
- Chokidar watcher extended to `.fabric/rules/` for cache invalidation (no writes, invalidate-only).
- MCP payload guard: 16 KB warn threshold / 64 KB hard limit (`MCP_PAYLOAD_TOO_LARGE`); both thresholds configurable via `fabric.config.json mcpPayloadLimits`.
- Tool schemas exported to `@fenglimg/fabric-shared/schemas/api-contracts` with per-tool annotations and golden contract snapshots (drift detection on CI).
- Doctor checks: `mcp_config_in_wrong_file`, `event_ledger_partial_write`, `meta_manually_diverged`, `rules_dir_unindexed`, `stable_id_collision`, `claude_skill_legacy_path`, `preexisting_root_claude_md` (info-level), `legacy_client_path_present`.
- Knip dead-code detector with zero baseline integrated into `pnpm lint`.
- Per-client config golden snapshots (drift detection guards against unintended init output changes).
- `fab init --scope project|user` flag — controls whether Claude MCP config is written to `.mcp.json` (project, default) or `~/.claude.json` (user).

### Changed

- Claude MCP config now written to `.mcp.json` (project scope) or `~/.claude.json` (user scope) — no longer `.claude/settings.json`, which per Claude Code spec is reserved for hooks and permissions only.
- MCP config writer uses hand-rolled deep-merge to preserve other `mcpServers` entries (no new runtime dependencies).
- Client SKILL files unified under `fabric-init/SKILL.md` (previously `agents-md-init/SKILL.md`).
- Doctor's conceptual role reframed from "baseline promoter" to "consistency repairer" — `--fix` calls `reconcileRules` to bring disk state in sync rather than purely promoting state.
- All user-facing config writes (JSON configs, TOML configs, Husky hooks, init scaffold files) use atomic tmp+rename primitives.
- `ensureRulesFresh` wired into all three MCP tool handlers (`fab_get_rules`, `fab_append_intent`, `fab_plan_context`); rule freshness warnings flow through to `response.warnings`.
- `--reapply` no longer truncates `events.jsonl`; existing byte content is fully preserved.
- `--reapply` preserves `agents.meta.json` when `.fabric/rules/` contains at least one `.md` file (protects AI-built rule trees); regenerates only when `rules/` is empty.
- `readEventLedger` no longer silently drops trailing partial lines — emits a `LedgerWarning` entry instead; doctor `event_ledger_partial_write --fix` truncates the partial line cleanly.
- HTTP error codes preserved across FabricError migration: PathEscape errors stay 403, ledger/lock errors stay 404.
- `ensureRulesFresh` I/O storm under high-frequency MCP polling mitigated by 500 ms global cooldown combined with watcher-based cache invalidation.

### Deprecated

- Clients `windsurf`, `rooCode`, `geminiCLI` are deprecated and removed in the same release. The doctor `legacy_client_path_present` check fires on first run after upgrade so users can clean their `fabric.config.json` via `fab doctor --fix` before the legacy keys become inert.

### Removed

- Client support: `windsurf`, `rooCode`, `geminiCLI` — Fabric now targets exactly three clients: Claude Code (CLI + Desktop), Codex CLI, and Cursor.
- Dead code: 5 unused init helper functions and the orphan `fab_get_rules` tool registration removed by Knip audit.
- Old SKILL path: `.claude/skills/agents-md-init/` — doctor check `claude_skill_legacy_path --fix` migrates to `.agents/skills/fabric-init/`.

### Fixed

- `--reapply` no longer truncates `events.jsonl` — byte-level ledger preservation on every reapply.
- `--reapply` preserves AI-built `agents.meta.json` when `rules/` directory has content.
- HTTP error codes (403, 404) preserved correctly after FabricError taxonomy migration.
- `readEventLedger` emits a `LedgerWarning` instead of silently dropping trailing partial lines caused by interrupted writes.
- `ensureRulesFresh` I/O storm under high-frequency MCP polling (500 ms global cooldown + watcher invalidate).

### Security

- Hand-rolled deep-merge in MCP config writer — no new third-party dependency introduced for config patching.
- Tmp file cleanup on atomic write failure — no orphan `.tmp` files left on disk if the rename step errors.

## [1.6.0] - 2026-04-25

### Added

- Added the L0/L1/L2 cognitive alignment protocol with structured rule descriptions, `.fabric/rules/` rule bodies, and `.fabric/INITIAL_TAXONOMY.md` initialization notes.
- Added `fab_get_rule_sections` for sectioned rule retrieval with AI-selected L1 IDs, required L0/L2 inclusion, selection-token validation, and `rule_selection` audit events.
- Added neutral `fab_plan_context` planning output that returns required/selectable rule descriptions and a lightweight requirement profile without server-side L1 ranking details.

### Changed

- `agents.meta.json` now uses `stable_id` as the unified rule identity and indexes level, required/selectable flags, and description metadata.
- `fabric doctor --audit` accepts the new `rule_selection` telemetry while keeping legacy audit compatibility.
- Replaced the public editing loop around `fab_get_rules` with `fab_plan_context` plus `fab_get_rule_sections`.

### Fixed

- Hardened initial taxonomy generation against incomplete forensic reports from tests and minimal target projects.
- Updated CLI snapshots for the new taxonomy output and relaxed the slow pre-commit update test timeout for local CI variance.

### Tests

- Added and validated the full cognitive rule-selection flow against the real `/mnt/c/Project/oops-framework` repository using the locally built CLI and MCP server.
- Verified build, CLI tests, focused server tests, shared metadata tests, and `fabric doctor --audit`.

## [1.5.2] - 2026-04-24

### Added

- Added stable `stable_id` precompilation for rule nodes plus validation coverage, so rule bundles can reference deterministic English anchors instead of path-derived fallbacks.
- Added `docs/tooling-manifest.json` and `docs/tooling-manifest.md` as the explicit tooling knowledge layer for script contracts and review anchors.

### Changed

- Moved the canonical intent ledger path to `.fabric/.intent-ledger.jsonl`, keeping the legacy root path read-compatible until `fabric doctor --fix` performs an explicit migration.
- `fabric doctor` now detects legacy ledger placement and can migrate it only under `--fix`, avoiding silent file moves during normal reads.
- `fab_plan_context` now returns a shared resolved bundle shape so one planning pass can serve multiple edit targets without repeating the same directory-level rule resolution work.
- Updated onboarding and initialization docs to point to the new ledger location and tooling manifest entry points.

### Tests

- Added coverage for ledger-path compatibility, doctor-led migration, stable rule ID extraction, protected-token linting, and shared plan-context bundle resolution.

## [1.5.1] - 2026-04-23

### Changed

- Refined zh-CN wording across CLI copy, Dashboard labels, and initialization-related prompts to reduce translationese and internal jargon in the main user path.
- Updated first-read onboarding docs, including `README.md`, `packages/cli/README.md`, `docs/quickstart.md`, `docs/getting-started.md`, and `docs/initialization.md`, so install and follow-up guidance read as direct Chinese-first instructions.
- Tightened AI-facing follow-up copy in the Codex initialization skill and related hook text so repository initialization reminders are easier for clients to act on.

### Documentation

- Added `docs/chinese-localization.md` as the terminology baseline for future zh-CN wording changes.
- Rewrote `docs/dashboard-tour.md`, `docs/launch-story.md`, and `docs/brand.md` to align public storytelling with the new localized terminology.

### Tests

- Refreshed CLI i18n snapshots and init surface assertions to match the new wording, with CLI init/i18n tests and dashboard build verification passing.

## [1.5.0] - 2026-04-23

### Added

- Added the `fabric approve` command for approving drifted human-lock entries from the CLI, with `--all` and interactive approval modes.
- Added lazy `web-tree-sitter` probing to the CLI build so forensic analysis can validate AST parsing feasibility without adding startup cost.
- Added `activation.tier` metadata for rule nodes (`always`, `path`, `description`) and surfaced description-only rules as stubs in `fab_get_rules` payloads.
- Added `/api/rules/context` for the Dashboard to inspect the same resolved rule context returned by `fab_get_rules`.
- Added the Dashboard Rule Topology module with a coverage heatmap, hit-reason panel, new module navigation, and placeholders for the next read-only modules.

### Changed

- `scan`, `bootstrap`, and `init` planning now use async scanner paths so future AST-backed forensic work can share the same detection pipeline.
- Framework detection now returns a richer `TechProfile` shape with confidence, framework identity, co-package evidence, and reserved AST evidence fields.
- The HTTP server now exports human-lock approval/read services for CLI reuse and registers the rules-context API beside the existing rules endpoint.

### Documentation

- Updated release-facing docs to describe v1.5.0, the new approve workflow, rule activation tiers, the rules-context API, and Dashboard topology inspection.

### Tests

- Added coverage for `fabric approve`, tree-sitter probing, rule activation metadata, rules context resolution, Dashboard coverage heatmap, and hit-reason rendering.

## [1.4.0] - 2026-04-22

### Added

- Added first-class Codex follow-up assets during `fabric init`, including the repo skill at `.agents/skills/fabric-init/SKILL.md`, `SessionStart` / `Stop` hook templates under `.codex/hooks/`, and repo-level `.codex/hooks.json` wiring that works with `features.codex_hooks = true`.
- Added a default `@clack/prompts`-based TTY wizard for `fabric init`, plus adapter-level test coverage that locks intro / grouped planning / cancel / outro behavior.

### Changed

- Reframed `fabric init` around a canonical plan model: `fabric init` now launches the TTY wizard by default, `fabric init --yes` is the non-interactive execution path, `fabric init --plan` is the dry-run preview path, and `fabric init --reapply --yes` is the managed reapply path for existing setups.
- The wizard now groups stage selection and MCP install scope into one planning interaction, and `--plan` / `--reapply` flows now render explicit mode banners instead of relying on implicit output cues.
- Init planning/execution was split into reusable plan and executor primitives so scaffold generation, stage execution order, and wizard rewrites all flow through one typed model.

### Documentation

- Updated `README.md`, `docs/getting-started.md`, and `docs/initialization.md` to present the new `fabric init` mental model, including TTY wizard guidance, non-interactive variants, dry-run usage, and reapply semantics.

### Tests

- Expanded init acceptance coverage for plan-only, reapply, MCP install scope, non-destructive planning, and real `@clack/prompts` adapter mocking.

## [1.3.1] - 2026-04-22

### Changed

- `fabric init` and `fabric bootstrap install` now keep the bootstrap source of truth inside `.fabric/bootstrap/README.md`; the bootstrap stage no longer emits root-level `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`.
- `sync-meta` now treats `.fabric/bootstrap/README.md` as the canonical L0 bootstrap node while still accepting legacy root `AGENTS.md` metadata as a migration input.

### Fixed

- Resolved the CLI typecheck regression in `packages/cli/src/commands/bootstrap.ts` caused by a stray `ensureTrailingNewline` reference after the bootstrap internalization refactor.
- Normalized bootstrap and skill template line endings to LF so `scripts/lint-protected-tokens.ts` passes consistently in GitHub Actions and tag-triggered release builds.

### Documentation

- Merged the Day 6 bootstrap notes into `docs/initialization.md`, retired the temporary Day 2/4/5/7 runbooks, and refreshed `README.md`, `docs/getting-started.md`, `packages/cli/README.md`, and `RELEASING.md` to match the stable `v1.3.1` release flow.

## [1.3.0] - 2026-04-21

### Added

- **ContextCache**: unified hot-path cache for agents.meta.json, GetRulesContext, and audit.jsonl sliding-window byte-offset cursor. TTL-based with eager invalidation on meta writes and file-watch events.
- **AGENTS.md MCP resource** (`fabric://agents-md`): clients can now read project-level L0 rules directly via MCP resource protocol.
- **File-watch notifications**: chokidar watches `agents.meta.json` and `AGENTS.md`, invalidates cache, and sends debounced `tools/list_changed` / `resource_updated` MCP notifications to all active sessions.
- **SSE ring buffer + reconnect**: server-side 50-entry ring buffer enables `Last-Event-ID`-based replay for reconnecting clients. Dashboard SSE client rewritten with fetch-based streaming, exponential-backoff reconnect, and event ID tracking.
- **`fabric update` CLI command**: refreshes MCP host configuration and git hooks without re-creating Fabric files — useful after CLI upgrades.
- **Pre-commit fast-path**: hook now reads staged files and skips all checks when none match any fabric-managed `scope_glob`, `AGENTS.md`, or ledger files.
- **`EditIntentComplianceResult`**: `appendEditIntentAuditEvents` returns structured compliance data (compliant, matched_get_rules_ts, window_ms) alongside audit entries.

### Changed

- All four MCP tools (`fab_append_intent`, `fab_get_rules`, `fab_plan_context`, `fab_update_registry`) migrated from `server.tool()` to `server.registerTool()` with typed `outputSchema` definitions.
- Audit log reads use byte-offset cursor tracking — consecutive calls never re-read already-seen bytes.
- Service layer (`get-rules`, `update-registry`, `append-intent`) uses ContextCache for meta and context lookups.
- Auth middleware now covers `/mcp` endpoint in addition to `/api` and `/events`.
- `bootstrap` and `config` subcommands unhidden from CLI help output.

## [1.2.0] - 2026-04-20

### Added

- **One-shot `fabric init`**: streamlined initialization flow.
- **`fabric` binary alias**: the CLI can now be invoked as `fabric` in addition to `fab`.

## [1.1.0] - 2026-04-19

### Added

- **Shadow Mirroring architecture**: all AI rules now live under `.fabric/agents/` as a 1:1 mirror of the source tree plus a `_cross/` subtree for cross-cutting concerns; business directories (`src/`, `packages/`, etc.) contain zero rule files.
- **Check-not-Ask fab init flow**: the `agents-md-init` Claude Skill is rewritten as Phase 0 active reconnaissance (≤15 files × 100 lines budget) → Phase 1 single-screen Architecture Review batch Check with file:line evidence anchors → Phase 2 auto-construct into `.fabric/agents/`. HIGH-confidence assertions are implicit-accept, MEDIUM/LOW require explicit acceptance.
- **`ForensicAssertion[]` data contract** (shared): structured assertions with `type`, `statement`, `confidence`, `evidence[]`, `coverage`, optional `proposed_rule`, and `alternatives`. Adds `CandidateFileEntry[]` grouped by family (`entry`/`component`/`config`/`test`/`domain`) with a top-3-per-family cap of 12, plus `sampling_budget {max_files:15, max_lines_per_file:100}`.
- **`fab_plan_context(paths[])` MCP tool** (server): batch multi-path rule query that aggregates `fab_get_rules` output across several candidate files in a single call, designed for the planning/exploration phase.
- **`fab doctor --audit` compliance check** (cli + server): records every file edit with or without a preceding `fab_get_rules` call into `.fabric/audit.jsonl`, with `off` / `warn` / `strict` modes.
- **`topology_type` and `layer` metadata** (shared + cli): `AgentsMetaNode` now carries `layer: L0|L1|L2` and `topology_type: mirror|cross-cutting`, with `z.preprocess` backward compatibility for legacy meta files. `sync-meta` derives both from `.fabric/agents/` path depth and the `_cross/` prefix.
- **`confidence_snapshot` on `InitContextInvariant`** and `topology_type` + `target_path` on `InitContextDomainGroup`; interview trail records Architecture Review presentation and user corrections.

### Changed

- **Bootstrap templates** (6 files) now mandate `MUST: Before ANY code reading, architecture planning, or logic modification, call fab_get_rules(path=<target file>)` and `NEVER: Reason about or modify code before obtaining local shadow context via MCP`. Protected-token list extended to cover `shadow constraints`, `Shadow Mirroring`, `.fabric/agents/`, `.fabric/agents/_cross/`.
- **Root `AGENTS.md` templates** (including the cocos/next/vite variants and `packages/cli/templates` mirrors) degrade to a Bootstrap Protocol stub; child documentation is no longer linked via `@import` or `<!-- fab:index -->`. Cross-repository references resolve dynamically through `fab_get_rules`.
- **`sync-meta`** scans only `.fabric/agents/**/*.md` and stops walking colocated `AGENTS.md` or `.claude/rules/` trees.
- **`forensic.ts`** emits structured assertions plus candidate files alongside (deprecated) `recommendations_for_skill` during a one-version migration window.
- **Werewolf fixture** (`examples/werewolf-minigame-stub`) migrated to Shadow Mirroring; root `AGENTS.md` shrinks to Bootstrap Protocol, rules move under `.fabric/agents/` including `_cross/role-balance.md`.
- **Docs**: `docs/initialization.md` adds four chapters — Matcha interaction, confidence tiers, Shadow Mirroring architecture, Client Compatibility & Migration (explicit "Fabric requires an MCP-capable client" matrix). `README.md`, brand/roadmap/quickstart/getting-started/launch-story/contributing/dashboard-tour/smoke-v1.0 and Day-N smoke-test guides localised to zh-CN while preserving English hard-rule tokens.
- Release readiness is now governed by `RELEASING.md`, `scripts/sync-versions.mjs`, and GitHub Actions workflows instead of ad hoc manual checks.

### Deprecated

- `ForensicReport.recommendations_for_skill: string[]` — kept for one version, will be removed in v1.2. Consumers should migrate to `ForensicReport.assertions: ForensicAssertion[]`.
- `<!-- fab:index -->` index markers and `@import` lines inside `AGENTS.md` — Shadow Mirroring resolves rules through `fab_get_rules` instead.

### Migration Notes

- Fabric v1.1 requires an **MCP-capable AI client** (Claude Code, Cursor with MCP, Codex, Gemini CLI). Clients without MCP can no longer see sub-directory rules.
- To migrate a v1.0 repository: move every colocated `packages/X/AGENTS.md` into `.fabric/agents/packages/X/index.md`, delete the original, run `fab sync-meta`, and verify `fab_get_rules` returns the expected rules for each path.

## [1.0.0] - 2026-04-19

### Added

- Published the monorepo under the public `@fenglimg/fabric-*` scope with a unified `1.0.0` version for the root workspace and all release-track packages.
- Standardized package naming for `@fenglimg/fabric-cli`, `@fenglimg/fabric-server`, `@fenglimg/fabric-dashboard`, and `@fenglimg/fabric-shared`, and updated bootstrap templates to stop emitting legacy `@fenglimg/*` references.
- Shipped the Fabric CLI as the canonical maintainer entry point with `fab init`, `fab serve`, `fab scan`, `fab bootstrap`, `fab hooks`, `fab config`, `fab human-lint`, `fab ledger-append`, `fab sync-meta`, and related workflows.
- Added the first public local control-plane loop: install Fabric, initialize a repository, configure clients, start the HTTP control plane, and inspect state through the packaged Dashboard.
- Added the packaged MCP server runtime with stdio and HTTP transports, including the `fab_get_rules`, `fab_append_intent`, and `fab_update_registry` tool surfaces.
- Added the Fabric Dashboard for rules inspection, human lock review, intent timeline playback, history replay, and doctor diagnostics within one local session.
- Added shared type exports for cross-package contracts so CLI, server, and dashboard code can consume one source of truth for config and state structures.
- Added shared i18n infrastructure with locale normalization, Node locale detection, translator creation, protected token handling, and locale bundles for `en` and `zh-CN`.
- Added first-class localized UX across the CLI and Dashboard, including bilingual navigation labels in the Dashboard and locale-aware command descriptions and status output in the CLI.
- Added semantic CLI color utilities aligned with Dashboard brand tokens, plus `NO_COLOR=1` handling and CJK-safe padding for terminal output.
- Added npm-facing onboarding and contributor documentation for the v1.0 product line, including the canonical getting-started path, initialization deep dive, roadmap, and release-sensitive validation notes.
- Added release governance artifacts for public distribution: this changelog, a documented manual release checklist, a workspace version-sync validator, CI automation, tag-driven publish automation, and a post-publish smoke checklist.

### Changed

- Reframed Fabric v1.0 as a publishable public product instead of an internal prototype, with release gates centered on npm installability, scope isolation, and real end-to-end smoke verification.
- Tightened release and distribution expectations so version drift, protected token regressions, and snapshot color noise are checked before a public tag is pushed.

### Fixed

- Removed legacy package scope references that would block npm publication under the `@fenglimg/fabric-*` namespace.
- Closed release-path gaps where version mismatches or undocumented manual steps could have produced an incomplete or non-reproducible v1.0 launch.

[Unreleased]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.4...HEAD
[2.0.0-rc.4]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.3...v2.0.0-rc.4
[2.0.0-rc.3]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.2...v2.0.0-rc.3
[2.0.0-rc.2]: https://github.com/fenglimg/fabric-v2/compare/v2.0.0-rc.1...v2.0.0-rc.2
[2.0.0-rc.1]: https://github.com/fenglimg/fabric-v2/releases/tag/v2.0.0-rc.1

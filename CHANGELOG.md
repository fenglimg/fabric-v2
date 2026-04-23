# Changelog

All notable changes to Fabric will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

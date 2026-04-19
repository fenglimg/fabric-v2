# Changelog

All notable changes to Fabric will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

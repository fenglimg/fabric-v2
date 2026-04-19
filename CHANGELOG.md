# Changelog

All notable changes to Fabric will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Release readiness is now governed by `RELEASING.md`, `scripts/sync-versions.mjs`, and GitHub Actions workflows instead of ad hoc manual checks.

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

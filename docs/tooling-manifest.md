# Tooling Manifest

`docs/tooling-manifest.json` is the machine-readable source of truth for script-level tooling knowledge in this repository.

This layer exists to answer three questions without reading each script end-to-end:

1. What does the script do?
2. What inputs, outputs, and side effects define its contract?
3. Which rule or code anchors should be reviewed when the script changes?

## Current Policy

- The manifest is the source of truth.
- JSDoc extraction is optional and may later populate or verify the manifest, but it does not replace it.
- Script changes that alter purpose, inputs, outputs, side effects, or related anchors should update the manifest in the same change.
- This manifest does not extend `.fabric/agents.meta.json` with tool nodes. It stays a parallel knowledge layer on purpose.

## Included Entries

### `copy-dashboard-dist`

- Path: `packages/server/scripts/copy-dashboard.mjs`
- Role: build-time asset bridge from the dashboard package to the packaged server.
- Why it matters: if dashboard output layout or server static serving changes, this script can silently become stale.
- Review with: `packages/server/package.json`, `packages/server/src/http.ts`

### `lint-protected-tokens`

- Path: `scripts/lint-protected-tokens.ts`
- Role: quality gate for protected English protocol tokens, hard-rule wording, and stable `fab:rule-id` headers.
- Why it matters: it protects the Chinese-wrapper / English-anchor contract from drift.
- Review with: `packages/shared/src/i18n/protected-tokens.ts`, `packages/cli/__tests__/lint-protected-tokens.test.ts`

## Maintenance Rule

When a script starts depending on new inputs, writes new outputs, changes failure semantics, or moves its business boundary, update `docs/tooling-manifest.json` first. If a future JSDoc extractor is added, it should sync from or validate against this manifest rather than silently becoming a second source of truth.

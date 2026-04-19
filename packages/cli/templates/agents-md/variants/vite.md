# { projectName } — L0 AGENTS.md

<!-- This is the fallback template. If you have Claude Code, run the agents-md-init skill for a semantically richer AGENTS.md. -->

This file is the non-AI fallback scaffold for a Vite application. Treat the repository as a client-rendered app unless the code clearly establishes another pattern.

<!-- fab:index -->
<!-- /fab:index -->

## Human Documentation References

- `README.md` is the source of truth for setup, scripts, environment variables, and deployment assumptions.
- Product behavior and UX expectations should be taken from shipped screens and existing docs before introducing new architecture.
- If `CONTRIBUTING.md` exists, follow its branch, review, and validation rules over local defaults.

## L0 AI Constraints

- Keep browser code on the client side. Assume SSR is off unless the repository already contains an explicit server rendering path.
- Preserve clear module boundaries: UI components stay presentation-focused, shared utilities stay framework-agnostic, and side effects remain close to the feature that needs them.
- Match the repo's TypeScript strictness and import style; do not weaken types or introduce `any` to move faster.
- Use `import.meta.env` for Vite environment access and avoid Node-only APIs in browser bundles.
- Prefer incremental feature-local edits over sweeping alias, build, or routing changes.

## Vite Baseline

- Keep module scope cheap; avoid eager side effects that run on import when they can live in explicit startup code.
- Reuse existing state and styling patterns before adding new stores, plugin layers, or CSS systems.
- Validate with the narrowest app command first, then run the broader build only after local checks pass.

## @HUMAN

- Human-owned decisions belong in this section or `.fabric/human-lock.json`; AI must pause before changing them.
- Record protected environment contracts, analytics events, or release-specific UI constraints here.

## L1 Candidate Notes

- Add scoped AGENTS.md files only when areas such as `src/features`, `src/components`, or `src/lib` accumulate their own rules.

# { projectName } — L0 AGENTS.md

<!-- This is the fallback template. If you have Claude Code, run the agents-md-init skill for a semantically richer AGENTS.md. -->

This file is the non-AI fallback scaffold for a Next.js application using the App Router by default.

<!-- fab:index -->
<!-- /fab:index -->

## Human Documentation References

- `README.md` is the source of truth for product flows, local setup, and deployment expectations.
- Operational behavior for routes, caching, auth, or background jobs should be verified against code and docs together before refactoring.
- If `CONTRIBUTING.md` exists, follow its review and release gates over local assumptions.

## L0 AI Constraints

- Treat `app/` as App Router unless the repository clearly uses another convention.
- Keep React Server Components on the server side by default. Add `"use client"` only for components that need browser APIs, local state, effects, or event handlers.
- Do not import server-only modules into client components, and do not access browser-only globals from server components or route handlers.
- Keep data fetching, cache behavior, and mutations aligned with existing route, server action, and API handler patterns.
- Prefer small route-local changes over broad restructuring of layouts, middleware, or caching policy.

## Next Baseline

- Preserve the server/client boundary at file level so the bundle stays predictable and hydration issues stay local.
- Reuse existing patterns for route handlers, metadata, and loading or error states before creating new abstractions.
- Validate the narrowest route or package command first, then run the broader build once local behavior is stable.

## @HUMAN

- Human-owned decisions belong in this section or `.fabric/human-lock.json`; AI must pause before changing them.
- Record protected routes, auth assumptions, cache invariants, or SEO requirements here.

## L1 Candidate Notes

- Add scoped AGENTS.md files only for areas such as `app`, `components`, or `lib` when they gain strong local conventions.

# Planning Context: Fabric v1.0 Product Launch

## Source Evidence
- `ANL-fabric-product-2026-04-19/conclusions.json` - 11 recommendations across Wave A/B/C, locked decisions list
- `ANL-fabric-product-2026-04-19/discussion.md` - Full multi-perspective analysis of codebase gaps
- `ANL-fabric-product-2026-04-19/perspectives.json` - Aggregated views from code, docs, brand, i18n angles
- `ANL-fabric-product-2026-04-19/v1.0-launch-story.md` - 1279-line launch narrative (Wave C source material)
- `packages/cli/tsup.config.ts:5-13` - `define: { __CLI_VERSION__: JSON.stringify(pkg.version) }` — build-time injection pattern to replicate
- `packages/dashboard/src/app.tsx:43` - `<span className="brand-version">v1.1</span>` — hardcoded version blocking v1.0 publish
- `packages/shared/src/index.ts:1-2` - `export {}` — empty shared package, golden location for types + i18n
- `packages/dashboard/src/styles/tokens.css` - brand color tokens (7 semantic colors) — CLI colors.ts mirror source
- `packages/server/src/index.ts:23-34` - MCP server factory — version injection target
- `templates/bootstrap/CLAUDE.md` - All-Chinese template — must be restructured to core/wrapper

## Understanding
- **Current State**: Fabric monorepo has 4 packages (cli 0.1.4, server 0.1.0, dashboard 0.0.0, shared empty) with scope mix (@fabric vs @fabric), hardcoded versions, no i18n infrastructure, no release pipeline, scattered documentation, and all-Chinese AI bootstrap templates
- **Problem**: Cannot publish to npm — version incoherence, wrong scope names, hardcoded versions in UI, empty shared package blocking i18n, brand/docs inconsistencies, missing CI/release workflows
- **Approach**: Three-wave sequential release — Wave A clears blockers (roadmap + scope/version + build injection + docs entry), Wave B builds infrastructure (shared types + i18n + CLI colors + AI prompts + i18n wiring), Wave C completes the release (CI/CHANGELOG + launch story + brand assets)

## Key Decisions
- Decision: npm scope = @fabric/* | Rationale: Eliminates @fabric vs @fabric confusion; single unified scope | Evidence: conclusions.json locked decisions
- Decision: Default locale = en, zh-CN first-class | Rationale: International npm package; LANG/FAB_LANG detection | Evidence: handoff-spec locked decision
- Decision: AI prompt strategy = core (English hard rules) + wrapper (Chinese explanation) | Rationale: +10-15% AI code quality with English rules; current 6 bootstrap files all Chinese | Evidence: discussion.md research findings
- Decision: Dashboard归 v1.1 Feature #5 | Rationale: Dashboard already implemented but roadmap consistency requires proper version attribution | Evidence: handoff-spec locked decisions
- Decision: build-time version injection via define pattern (reuse CLI __CLI_VERSION__ pattern) | Rationale: Single source of truth from package.json; no manual sync | Evidence: packages/cli/tsup.config.ts:5-13

## Dependencies
- TASK-002 (scope+version) → TASK-003 (build injection needs correct package.json.version)
- TASK-002 (scope+version) → TASK-005 (shared needs @fabric workspace deps)
- TASK-005 (shared fill) → TASK-007 (protected-tokens.ts lives in shared)
- TASK-005 (shared fill) → TASK-008 (i18n wiring consumes shared i18n infrastructure)
- TASK-006 (CLI colors) → TASK-008 (CLI i18n touches same commands/*.ts files; serial to avoid conflicts)
- TASK-002 + TASK-008 → TASK-009 (CI needs i18n-lint to exist before workflow runs it)
- TASK-001 + TASK-004 → TASK-010 (launch story docs reference roadmap structure and getting-started)
- TASK-004 → TASK-011 (brand assets referenced in README Hero rewrite)

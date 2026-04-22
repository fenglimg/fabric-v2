# Planning Context — Fabric Dashboard + Doc-Init Unified Plan

## Source Analyses

- `.workflow/.analysis/ANL-fabric-mcp-dashboard-unified-2026-04-19/` — Dashboard as v1.1 Feature #5 (D1-D5 task packs)
- `.workflow/.analysis/ANL-fab-doc-init-werewolf-2026-04-19/` — fab init extension with forensic.json + agents-md-init SKILL + Stop hook (Rec #1-6)

## User Decisions (Phase 2 Clarification)

1. **Order**: Parallel-interleaved. Wave A = Dashboard foundation (D1-D2) + Doc-Init high-pri (Rec #1-3). Wave B = Dashboard D3-D5 + Doc-Init medium-pri (Rec #4-6). UI design prefixes D5.
2. **UI design**: Pre-stage via `/ui-ux-pro-max` producing design tokens + HTML prototypes for 3 views (rules-tree / human-lock / intent-timeline). D5 implementation depends on these artifacts.
3. **Scope (included)**: ALL — Doc-Init Rec #1-6 + Dashboard D1-D5 + Dashboard E1-E3 optional extensions.
4. **Exploration**: Skipped — prior analyses are comprehensive and dated today.

## Dashboard Plan Summary (ANL-fabric-mcp-dashboard-unified)

### Monorepo Structural Changes
- `packages/server/`: add `http.ts`, `api/*`, `services/*`; refactor `tools/*` as thin adapters
- `packages/cli/`: add `commands/serve.ts` → `fab serve --port 7373 --target <dir>`
- `packages/shared/`: populate zod schemas (AgentsMeta, LedgerEntry w/ `source: 'ai'|'human'` discriminated union, HumanLockEntry, FabricConfig)
- `packages/dashboard/`: NEW — Preact + Vite SPA with 3 views

### Task Packs (D1-D5)
| Phase | Deliverable | Convergence |
|-------|-------------|-------------|
| D1 | Shared schema migration | `pnpm -r build` passes; server/cli import from @fabric/shared |
| D2 | MCP HTTP + fab serve | `curl POST /mcp` returns valid response; stdio unchanged |
| D3 | REST API layer | 5 read + 2 write endpoints return correct JSON; human-lock approve mutates file correctly |
| D4 | SSE + chokidar | External file change → SSE event pushed |
| D5 | Preact SPA 3 views + prod packaging | Browser at :7373 shows 3 views; pre-commit violations render cards |

### Key Constraints
- **Zero new npm deps** for HTTP (MCP SDK v1.29 transitive = Hono + Express)
- **Per-session McpServer factory** (SDK doesn't allow single-instance multi-transport)
- **Service-function middle layer**: `services/{get-rules, append-intent, update-registry}.ts` pure functions; tools + HTTP are thin adapters
- **Write-power model**: ritual writes only — `POST /api/human-lock/approve` + `POST /api/intent/annotate`; all other writes forbidden
- **Ledger entries**: `source: 'ai' | 'human'` discriminated union; Dashboard renders dual-column timeline

### Optional Extensions (E1-E3, included per user)
- E1: Bearer auth (extend from localhost-only to LAN)
- E2: fab doctor diagnostic tab integration
- E3: History replay (time-travel rule state)

## Doc-Init Plan Summary (ANL-fab-doc-init-werewolf)

### Core Mechanism
`fab init` = single entry doing 3 things atomically:
1. **Evidence collection** (Layer 1, CLI): produce `.fabric/forensic.json` with framework/topology/entry_points/code_samples(30-line sampling)/recommendations_for_skill
2. **Protocol install** (Layer 2+3+4 wrapper): write `.claude/skills/agents-md-init/SKILL.md` + `.claude/hooks/agents-md-init-reminder.cjs` + merge-insert `.claude/settings.json` Stop hook
3. **Dual-trigger** (Option C hybrid): stdout reason text (same-session, zero-cost) + Stop hook with sentinel (forensic exists && init-context missing)

### Task List (Rec #1-6, all included)

| Rec | Priority | Deliverable | Convergence |
|-----|----------|-------------|-------------|
| #1 | HIGH | Extend fab init w/ forensic.json + detector.ts (kind/version/subkind, Cocos 2.x vs 3.x) | `fab init` on werewolf-stub produces valid forensic.json w/ framework.version="3.8.0" |
| #2 | HIGH | `templates/claude-skills/agents-md-init/SKILL.md` + copy to target `.claude/skills/` | Target has SKILL.md after `fab init`; non-destructive |
| #3 | HIGH | `templates/claude-hooks/agents-md-init-reminder.cjs` + merge-insert `.claude/settings.json` Stop hook | Running hook with forensic present + init-ctx missing returns `{decision:'block'}`; non-destructive merge |
| #4 | MEDIUM | End-to-end tests on werewolf-minigame-stub | `init-forensic.test.ts` / `init-claude-install.test.ts` / `init-nondestructive.test.ts` pass |
| #5 | MEDIUM | Refactor AGENTS.md.template — framework-branching fallback skeleton | Reduced TODO count; Cocos/Vite/Next variants |
| #6 | MEDIUM | `docs/initialization.md` — 7-Stage user journey + 4-scenario degradation | Doc renders; referenced from README |

### Key Constraints
- **Non-destructive**: all writes use `writeNewFile` guard; `.claude/settings.json` uses merge-insert (skip if hook matcher already present)
- **Single entry**: no `--interactive` flag, no new `fab doc-init` command (OQ1 decision)
- **Sentinel-based**: `.fabric/forensic.json` present + `.fabric/init-context.json` missing = "initialization pending"
- **AGENTS.md hard rules**: zero TODO / ≤300 lines / ≤4 nesting levels / no YAML frontmatter

## Cross-Cutting Dependencies

1. **Doc-Init Rec #1 (detector extension)** produces richer `FrameworkInfo` — ideally migrated to `@fabric/shared` under Dashboard **D1**
2. **Dashboard D1 (shared schemas)** must include `ForensicReport` + `InitContext` schemas so Doc-Init Rec #2/#3 can validate
3. **Dashboard D4 `source: 'ai'|'human'` ledger union** → Doc-Init Rec #1 should already write `source: 'ai'` when appending to intent-ledger (cross-cutting schema alignment)
4. **UI design pre-stage** (`/ui-ux-pro-max`) produces tokens+prototypes BEFORE D5 implementation starts

## Wave Strategy

### Wave A (Foundations, mostly parallel)
- Shared Schemas (D1) — blocks D3/D4 + validates forensic.json
- fab init extension (Rec #1+#2+#3 bundled) — evidence + protocol install + hook
- UI Design pre-stage (`/ui-ux-pro-max`) — produces tokens + 3 HTML prototypes

### Wave B (Server + Dashboard, after D1)
- MCP HTTP + fab serve (D2)
- REST API + services/ (D3, after D2)
- SSE + chokidar (D4, after D2)
- Preact SPA 3 views (D5, after D3+D4+UI design)

### Wave C (Polish & Extensions)
- Tests (Doc-Init Rec #4)
- Template refactor (Rec #5)
- Documentation (Rec #6)
- Optional extensions E1-E3

## Out of Scope (explicit)

- v1.1 features `drift-check`, `fab migrate`, `Copilot fallback` (deferred to later)
- Cross-project (multi-project) Dashboard aggregation (v1.2+)
- Published `@fabric/shared` (remains private per analysis)

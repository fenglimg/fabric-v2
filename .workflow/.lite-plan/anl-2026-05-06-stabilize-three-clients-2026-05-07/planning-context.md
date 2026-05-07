# Planning Context — Fabric v1.7.0 Stabilization + 3-Client Narrowing

**Source**: analyze-with-file session `ANL-2026-05-06-stabilize-three-clients` (7 rounds, confidence 0.93, 36 decisions, readiness gate PASSED)
**Pre-plan grill-me**: 11 ambiguities resolved across 5 architectural decisions + 6 task/detail decisions

## Evidence Paths

| Source | Path | Used For |
|---|---|---|
| Handoff JSON | `.workflow/.analysis/ANL-2026-05-06-stabilize-three-clients/handoff.json` | 7 implementation_scope items with target_files + acceptance_criteria |
| Discussion | `.workflow/.analysis/ANL-2026-05-06-stabilize-three-clients/discussion.md` | 36 decisions + sequencing + Gemini cross-verification |
| Codebase Discovery | `exploration-codebase.json` | 34 relevant files + client_scope_map (15 narrow targets) |
| External Research | `research.json` | fsyncgate / atomic write best practices / MCP failure modes |
| Stability Deep-dive | `explorations/stability-deepdive.json` | 22 atomic-write callsite inventory with file:line + priority |
| Interaction Audit | `explorations/interaction.json` | F17-F25 (--reapply destruction / watcher gap / SKILL parity) |
| Domain Expert | `explorations/domain.json` | Claude `.claude/settings.json` NONCOMPLIANT + signal handlers + tool annotations |
| Technical | `explorations/technical.json` | 7 dead helpers + 8 error smells |
| Architectural | `explorations/architectural.json` | Module drift surfaces + ContextCache + DAG cleanliness |
| Business | `explorations/business.json` | Two-step ship strategy + risk register |

## Synthesized Understanding

### The Problem
Fabric v1.7.0 is feature-complete but carries seam debt:
1. **Spec compliance bugs**: Claude MCP config writes to wrong file (`.claude/settings.json` vs `.mcp.json`); MCP server lacks signal handlers (Claude Code #15945 zombie pattern).
2. **Durability gaps**: `events.jsonl` raw `appendFile` (no fsync, no rotation, no tail-tolerance); 22 atomic-write callsites inconsistent across server+CLI; no contract tests for emitted MCP tool schemas + client configs.
3. **User-mental-model bugs**: `--reapply` silently truncates ledger + resets meta; `serve` doesn't watch rule files; manual rule edits invisible to AI; Codex/Cursor SKILL parity gap with Claude.
4. **Scope discipline**: 6 AI clients → 3 (Claude/Codex/Cursor); legacy clientPaths keys still honored without warning.

### The Strategy

**Two-release ship** (D2 + D16):
- **1.7.1** (~3 days): deprecation warnings only — no code removal. Lets users see warnings before 1.8.0.
- **1.8.0** (~10-14 days, ~950 LoC): code removal + stabilization + contract tests. Single feature branch `release/v1.8.0-stabilization`; 1.7.1 cherry-pick to `release/v1.7.1`.

**Infrastructure-first 4-layer task graph** (Q9 architectural decision):

```
Layer 0 (no deps, infrastructure)              ─── 6 tasks ─── ~280 LoC
  ↓
Layer 1 (foundation services)                  ─── 5 tasks ─── ~230 LoC
  ↓
Layer 2 (consumers, max parallel within)       ─── 25 tasks ── ~950 LoC
  ↓
Layer 3 (release packaging)                    ─── 3 tasks ─── docs
```

Release phase encoded as `metadata.release_tag` per task (`@1.7.1` / `@1.8.0`), NOT as graph dependency.

### Hard Ordering Constraints

| Predecessor | Successor | Reason |
|---|---|---|
| T-INFRA-ATOMIC | All atomic write consumers | Foundation primitive |
| T-CONFIG-JSON-ATOMIC | T-MCP-CONFIG-PATH | json.ts must be atomic before path rewrite (Q2) |
| T-INFRA-ERRORS | All FabricError consumers | Typed error base |
| T-FOUND-RULE-SYNC | All R28 consumer tasks | Orchestrator framework |
| T-INFRA-SKILL-* | T-SKILL-DERIVATION | Build pipeline + canonical source |
| T-CLIENT-NARROW | T-SCHEMA-EXPORT-AND-ANNOTATIONS | Don't snapshot dying clients (Gemini G4) |
| T-SCHEMA-EXPORT + T-ANNOTATIONS | (paired commit) | Avoid 100% snapshot churn (Gemini G6) |

### Test Strategy (D33)
ALL tasks: implementation + tests in SAME commit (TDD-style). `convergence.criteria` includes "new tests added in same commit + pnpm test passes".

### Branch Strategy (Q9)
- Single feature branch `release/v1.8.0-stabilization` from `main`
- 1.7.1 tasks (R0/R18/R24) cherry-pick to `release/v1.7.1` — separate small PR
- 1.8.0 mega-PR with commit-per-task history; paired commits explicit

### Deferred (NOT in plan)
Dashboard DoctorReport type lift; JsonClientConfigWriter format-split; init.ts decomposition; tsconfig hardening; R21 orphan-annotations / R22 invalid-id warnings; R26 full server-side i18n.

## Task Distribution

| Layer | Count | Release | Notes |
|---|---|---|---|
| 0 — Infrastructure | 6 | 1.8.0 | atomic-write helper / FabricError / SKILL canonical+build / migration-doc skeleton |
| 1 — Foundation services | 5 | 1.8.0 | ledger-queue / server-atomic / cli-dedup / error-collapse / rule-sync framework |
| 2 P0 — Stability consumers | 13 | 1.8.0 | client narrow / ledger-tail / signals / serve-lock / config-atomic / mcp-path / schema+annotations / client-config-snapshots / reapply / R28 sync × 4 |
| 2 P1 — Polish + extension | 12 | 1.8.0 | dead code / bootstrap / payload-guard / knip / 4 doctor checks / action hints / SKILL derivation / preexisting CLAUDE.md / 2 atomic migrations |
| 2 (1.7.1 batch) | 3 | 1.7.1 | deprecation / doctor i18n / init-context action hint |
| 3 — Release packaging | 3 | both | 1.7.1 cherry-pick PR / 1.8.0 mega-PR / CHANGELOG+migration-doc final |
| **Total** | **42** | | |

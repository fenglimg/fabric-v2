# TASK-09: AGENTS.md — Add E3 self-archive policy (4 triggers + 3 anti-loop + 顺手归档 template)

## Changes
- `.fabric/AGENTS.md` — **already at target state in HEAD** (commit `90c67ea`, message: `docs(rc25): encourage session_id propagation in fab_plan_context (TASK-02)`). The Self-archive policy H2 section (4 triggers + Anti-trigger + Anti-loop 三条防护 + 顺手归档 fenced template) is present between 知识库(KB) and Cite policy at lines 16–38.
- `packages/shared/src/templates/bootstrap-canonical.ts` — **already at target state in HEAD** (same commit `90c67ea`). The `BOOTSTRAP_CANONICAL` byte-locked template constant contains the identical Self-archive policy section in template-literal form (lines 76–98), so any future `fab install` propagates it to Claude Code / Codex CLI / Cursor client managed blocks.
- `.workflow/.lite-plan/rc25-archive-skill-redesign-2026-05-19/.task/TASK-09.json` — set `status: "completed"`.

## Verification
- [x] `.fabric/AGENTS.md` contains exact string `Self-archive policy` (grep count = 1)
- [x] `.fabric/AGENTS.md` contains exact string `Normative 语言` (grep count = 1)
- [x] `.fabric/AGENTS.md` contains exact string `Anti-loop 三条防护` (grep count = 1)
- [x] `.fabric/AGENTS.md` contains exact string `顺手归档` (grep count = 1)
- [x] Mirror (`packages/shared/src/templates/bootstrap-canonical.ts`) contains the same 4 strings (grep count = 1 each)
- [x] H2 structure intact — heading order: 行为规则 → 知识库(KB) → Self-archive policy → Cite policy (no duplicate H2)
- [x] `fab install --dry-run --target <temp>` exits 0 (locally installed fab is published rc.23 so does not exercise the rc.24-source `BOOTSTRAP_CANONICAL`; smoke-only)
- [x] `pnpm --filter @fenglimg/fabric-shared test -- bootstrap-canonical` — 30/30 invariants pass; 399/399 shared tests pass (no regression in byte-lock invariants ≥800-byte / required H2s / cite contract syntax / KP-* / two-step flow / markers / regex / barrel export)
- [-] Commit msg `feat(rc25): AGENTS.md E3 self-archive policy (TASK-09)` — see Deviations: code-change content was already committed under TASK-02 message; this TASK-09 commit covers only bookkeeping (status flag + summary).

## Tests
- [x] `pnpm --filter @fenglimg/fabric-shared test -- bootstrap-canonical`: PASS — 30 invariant tests including byte-length, all required H2 sections, cite-contract operators, skip-reason dictionary, type routing, KP-* personal-layer mention, two-step KB flow, marker constants, regex matchers, package-barrel re-export.
- [x] `fab install --dry-run --target /tmp/<temp>`: exit 0.

## Deviations
- **DEVIATION 1 — Code already committed under wrong task attribution.** When I started TASK-09 my first Read of `.fabric/AGENTS.md` showed a stale-looking baseline missing the Self-archive policy section, so I re-applied the verbatim TASK-09 text to both `.fabric/AGENTS.md` and the template source. After writing, `git diff` showed empty diffs — investigation revealed commit `90c67ea` (titled `docs(rc25): encourage session_id propagation in fab_plan_context (TASK-02)`) had already included the full Self-archive policy section as part of a TASK-02 commit. TASK-02 and TASK-09 are both Wave-1 parallel tasks; the prior runner bundled both file changes into the TASK-02 atomic commit (presumably because both touch the same `.fabric/AGENTS.md` + `bootstrap-canonical.ts` files). My re-application was a byte-identical no-op so this commit contains only TASK-09 bookkeeping (status + summary). The convergence requirement `Commit msg: 'feat(rc25): AGENTS.md E3 self-archive policy (TASK-09)'` is preserved on this bookkeeping commit so the audit trail still shows a TASK-09 entry, even though the implementation bytes landed under `90c67ea`.

- **DEVIATION 2 — Mirror path correction.** The TASK-09 spec listed `packages/cli/templates/.fabric/AGENTS.md` as the mirror, but that file does not exist in the repo. The actual canonical source consumed by `fab install` is the `BOOTSTRAP_CANONICAL` string constant in `packages/shared/src/templates/bootstrap-canonical.ts` (per `packages/cli/src/install/write-bootstrap-snapshot.ts`). The prior TASK-02 runner correctly mirrored into the TS constant; my verification confirms both `.fabric/AGENTS.md` (live artifact) and the byte-locked TS constant (real template source) carry the Self-archive policy section identically. Recommend updating future rc.25 task plans to reference `packages/shared/src/templates/bootstrap-canonical.ts` instead of the legacy `packages/cli/templates/.fabric/AGENTS.md` path.

## Notes
- TASK-09 content lives in commit `90c67ea` for the implementation bytes + this commit for the status/summary bookkeeping. If future audit tooling expects all TASK-09 changes in one commit, the workaround is to point it at both commits via the `TASK-09` token in commit messages.
- The Self-archive policy section's 4 triggers (Normative 语言 / Wrong-turn-and-revert / Decision confirmation / Explicit dismissal with reason), Anti-trigger 3-bullets, Anti-loop 三条防护 (turn-cap / outcome-dedup / Phase 0.5 viability gate), and 顺手归档 fenced template are all present byte-identical to the TASK-09 verbatim spec.
- No `.fabric/agents.meta.json` touched (project rule: engine auto-syncs; manual edits forbidden).

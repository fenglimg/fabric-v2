# rc.34 TASK-06 — Cite-policy Long-session Evict Design Memo

**Date**: 2026-05-26
**Status**: Decision locked, primitive shipped, opt-in default

## Decision

Strategy = **turn-count window** (single strategy in rc.34 scope).

Other strategies — `time-based` (clock interval) and `token-budget` (model context window utilization) — explicitly deferred to **rc.35**.

## Rationale for turn-count over alternatives

| Strategy | Pro | Con | Verdict |
|---|---|---|---|
| **turn-count** (chosen) | Simple state (one int), zero external dependency, deterministic in tests | Doesn't adapt to turn density (5 quick turns ≠ 5 deep turns) | Ship now — simplest correct primitive |
| time-based | Adapts to "long stretches of silence" | Wall-clock awareness needed, needs Date.now() (skew risk same as cooldown — see rc.34 TASK-01), tests need clock mocking | rc.35 — solve only if data shows turn-count cadence too coarse |
| token-budget | Triggers on actual context pressure (most relevant signal) | Need to read context utilization from runtime; not exposed by Claude Code hook stdin | rc.35 if exposed; otherwise no |

Decision driver: rc.32 Batch 1 cite coverage = 3.1%. Any working signal beats 3.1%. Burn one strategy at a time → cleanest A/B.

## Hook surface

- **Event**: UserPromptSubmit (Claude Code only)
- **Channel**: stdout JSON envelope (hookSpecificOutput.additionalContext) — same channel as rc.33 W2 knowledge-hint-broad reminder-to-context
- **Client scope**: Claude Code ONLY (Codex CLI, Cursor lack UserPromptSubmit event registration)
- **Codex/Cursor cite-coverage path**: stays on existing Stop-hook fabric-hint + SessionStart knowledge-hint-broad

## State sidecar

Path: `.fabric/.cache/cite-evict-state.json`
Shape: `{ session_id: string, turn_count: number }`

Semantics:
- First run for session: write `{session_id, turn_count: 1}`
- Subsequent run, same session_id: increment by 1
- Subsequent run, **different** session_id: reset to `{session_id: new_id, turn_count: 1}`
- Corrupted / missing sidecar: treat as first-run

Anti-patterns considered + rejected:
- Multi-session counter (track N parallel sessions): unnecessary — Claude Code session_id is monotonic per project, only one is "current"
- Persistent across sessions (counter never resets): bad UX — user expects fresh start per session

## Fire condition

```
evaluateCiteEvict(turnCount, interval) =
  interval > 0 AND turnCount > 0 AND turnCount % interval === 0
```

- `interval <= 0` → never fire (feature off, opt-in default)
- `turnCount <= 0` → never fire (defensive)
- Reminder fires on turn `interval`, `2 × interval`, `3 × interval`, ...

## Config knob

`cite_evict_interval` (number, default 0 = OFF)

Recommended values:
- `0` (default): off, no evict
- `10-20`: active session re-anchor (typical)
- `5`: high-contract-criticality projects
- `25+`: low-cadence reviews where attention decay matters less

Validation: positive integer, schema `z.number().int().min(0)`.

## Reminder body

Compact (7 lines, ~600 chars). Includes:
1. Turn + interval context (operator-debug breadcrumb)
2. The cite contract syntax (KB: <id> ... OR KB: none [...])
3. Two-step verification (fab_plan_context → fab_get_knowledge_sections)
4. Contract operator vocabulary (edit/!edit/require/forbid/skip)
5. Skip reason dictionary (sequencing/conditional/semantic/...)
6. KB: none sentinel disambiguation (no-relevant / not-applicable)
7. Audit / non-blocking declaration

The fully-specified contract lives in `.fabric/AGENTS.md` Cite policy section; the reminder is tactical re-anchor, not canonical reference.

## Failure modes — silent exit invariants

Every error path MUST end in silent `process.exit(0)` (or hook script return). The hook never blocks user prompt submission on its own malfunction.

Failure modes covered:
- Config read failure (ENOENT / parse error / type mismatch) → interval = 0 → silent
- Sidecar read failure (ENOENT / corrupted) → treat as first-run
- Sidecar write failure → log nothing, continue (counter loss acceptable)
- stdin parse failure (host bug, missing payload) → fall back to `anonymous` session_id
- stdin never closes → 1s timeout → null payload → continue
- stdout write failure → swallow (envelope is best-effort)
- Non-Claude-Code client (CLAUDE_PROJECT_DIR unset) → silent exit

## Wiring (install pipeline)

1. `packages/cli/templates/hooks/cite-policy-evict.cjs` (new)
2. `installCitePolicyEvictHook` in `packages/cli/src/install/skills-and-hooks.ts` — copies script to `.claude/hooks/` only (Codex/Cursor skipped)
3. Hooks orchestrator (`hooks-orchestrator.ts`) calls `installCitePolicyEvictHook` between narrow + lib install steps
4. `packages/cli/templates/hooks/configs/claude-code.json` registers the hook under `UserPromptSubmit` event
5. `packages/shared/src/schemas/fabric-config.ts` adds `cite_evict_interval: z.number().int().min(0).optional().default(0)`

## Testing surface

19 unit tests in `packages/cli/__tests__/cite-policy-evict.test.ts`:
- `evaluateCiteEvict` math (5 cases — divides, non-boundary, off, guards, non-numeric)
- `readEvictInterval` config (4 cases — missing/parsed/invalid/malformed)
- `readEvictState/writeEvictState` round-trip (5 cases — missing/round-trip/mkdir/corrupted/schema-invalid)
- `renderReminder` content contract (6 cases — cite format / two-step / operators / skip reasons / turn-interval context / non-blocking)
- `main()` end-to-end (7 cases — off / immediate fire / boundary respect / session reset / 30-turn stress / non-CC silent / anonymous fallback)
- JSON envelope parseability (1 case — host-parser compat)

## Rollout plan

1. rc.34 ships: primitive + opt-in (default 0 = off). Nobody sees behavior change unless explicit config edit.
2. Dogfood (TASK-08) sets `cite_evict_interval=10` in pcf's `.fabric/fabric-config.json`, runs ~30-turn session, verifies 3 fires + cite-coverage delta.
3. If pcf dogfood shows cite-coverage uptick → recommend in CHANGELOG + AGENTS.md as default-on candidate for rc.35.
4. If turn-count cadence proves too coarse (e.g. reminders fire mid-deep-thought) → rc.35 add time-based as fallback strategy.

## What NOT in scope (rc.35+ candidates)

- Time-based strategy (clock interval): deferred until turn-count proves insufficient
- Token-budget strategy (context utilization): blocked on Claude Code hook stdin exposing token budget
- Adaptive interval (auto-tune based on cite-coverage delta): premature; need rc.34 baseline data first
- Reminder body A/B variants: premature; ship one variant, measure, iterate
- Codex / Cursor parity: blocked on those hosts adding equivalent event hook
- Per-skill reminders (different reminder per fabric-archive vs fabric-review context): out of scope; the cite contract is uniform across skills

## Cross-references

- [[rc34-tactical-lock]] — rc.34 scope decision
- [[rc33-w2]] — stdout JSON envelope channel precedent (knowledge-hint-broad reminder-to-context)
- [[rc34-task-01]] — cooldown clock skew hardening (same defensive pattern for backward time skew, though this hook uses turn count not wall clock)

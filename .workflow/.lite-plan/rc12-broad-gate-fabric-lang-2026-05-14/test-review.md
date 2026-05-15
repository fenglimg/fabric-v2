# rc.12 Convergence Verification — Gemini Cross-Check

**Session**: rc12-broad-gate-fabric-lang-2026-05-14
**Tool**: Gemini CLI (analysis mode)
**Exec ID**: rc12-broad-gate-fabric-lang-2026-05-14-convergence
**Scope**: Independent verification of all 6 tasks' convergence.criteria[] against current codebase state

## Verdict: **PASS** (41/41 criteria met)

## Per-Task Results

| Task | Criteria | Met | Notes |
|---|---|---|---|
| TASK-001 | 6 | 6/6 | T8 gate cleared; renamed `entries` + orphan-sidecar comment present |
| TASK-002 | 7 | 7/7 | Active code zero `fab init`; ~30+ `cli.install.*` keys present |
| TASK-003 | 8 | 8/8 | `fabricLanguageSchema` with `zh-CN-hybrid` enum; dogfood config updated |
| TASK-004 | 5 | 5/5 | No strict no-mix rule; `zh-CN-hybrid` rendering rule deployed; 3-mirror byte-identity holds |
| TASK-005 | 6 | 6/6 | `detectExistingLanguage` + `resolveFabricLanguage` aligned to CJK signal |
| TASK-006 | 9 | 9/9 | `POINTER_LINE` retired; HTML-comment managed section live; tests refreshed |

## Key Evidence Points

1. **TASK-001**: `packages/cli/templates/hooks/knowledge-hint-broad.cjs:58-64` documents orphan sidecar as harmless dead state (clean-slate decision recorded inline)
2. **TASK-002**: `packages/cli/src/commands/install.ts:235` exports `installCommand` with `meta.name: 'install'`; `fab init` invocation yields citty "unknown command"
3. **TASK-003**: `packages/shared/src/schemas/fabric-config.ts:35` emits `z.enum(["match-existing", "zh-CN", "en", "zh-CN-hybrid"])`; `.fabric/fabric-config.json` set to `"zh-CN-hybrid"`
4. **TASK-004**: `packages/cli/templates/skills/fabric-archive/SKILL.md:79` documents protected-tokens policy for hybrid mode
5. **TASK-005**: `packages/cli/src/commands/scan.ts:606` `resolveFabricLanguage` correctly returns `"zh-CN-hybrid"` on CJK signal
6. **TASK-006**: `packages/cli/src/install/skills-and-hooks.ts:186` exports `FABRIC_SECTION_BEGIN_MARKER`; new section writer + symmetric strip in place

## Test Suite Status

- **shared**: 307/307 pass
- **server**: 402/402 pass (1 pre-existing skip)
- **cli**: 481/481 pass
- **Total**: 1190/1190 pass

## Minor Cosmetic Follow-up (non-blocking)

`packages/cli/src/commands/install.ts` retains internal symbols `runInitCommand`, `InitArgs` (function-internal, not exported). The user-facing command surface is fully `install`-named; these internal helpers can be renamed in a future cleanup pass without blocking the rc.12 release.

## Verdict Rationale

All 41 convergence criteria are mechanically verifiable (grep, diff, test) and pass. The cross-task integration is sound:
- TASK-002's `install.ts` correctly writes `fabric_language` per TASK-003's schema
- TASK-006's managed section interpolates the value TASK-005's `detectExistingLanguage` returned
- TASK-004's three-mirror SKILL.md byte-identity invariant survives all renames

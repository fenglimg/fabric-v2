# Analysis: rc.20 Cite policy Code Review

**Reviewer**: Gemini CLI (analysis-review-code-quality)
**Date**: 2026-05-15
**Scope**: rc.20 11-commit chain (8f1b022..c506e85)
**Verdict**: PASS-WITH-HIGH-FINDING (must address before tag)

## Summary
Cross-package invariant respected. Hook-side never-throws compliant. Bilingual CLI matches rc.16 banner-i18n pattern. **However**: HIGH-severity logical flaw in `--client` filter causes denominator pollution.

## Findings

### HIGH — Cross-Client Pollution in Denominator
**File**: `packages/server/src/services/doctor.ts:5288`

When `--client=cc` is passed, `assistantTurns` is correctly filtered to `filteredTurns`. But `sessionCitedKbs` is built exclusively from `filteredTurns` (L5265). When the algorithm loops over `editEvents` (which lack a `client` field), edits from Codex/Cursor sessions query `sessionCitedKbs`, find no entries, and improperly increment `expected_but_missed` against Claude Code. Also `edits_touched` globally counts all edits regardless of client filter.

**Fix**: Build a `Set<string>` of session_ids belonging to the requested client by scanning `assistantTurns` (every assistant reply emits a turn event, even if `kb_line_raw` is null, so the set is authoritative). Inside `editEvents` loop, skip edits whose `session_id` is not in the set.

### MEDIUM — Test Coverage Gap
**File**: `packages/server/src/services/doctor.test.ts:4112`

The `--client=cc filter excludes codex turns` test only asserts `total_turns` and `qualifying_cites` are segregated. Does NOT verify `edits_touched` and `expected_but_missed` under client filter — exactly the metrics the HIGH finding affects.

**Fix**: Expand test to seed edits for both cc and codex sessions; assert denominator metrics only reflect cc edits when `--client=cc`.

### LOW — Dead Code in categorizeCiteTag
**File**: `packages/server/src/services/doctor.ts:5122`

The `if (tag.startsWith("dismissed:"))` branch is functionally dead because Zod enforces bare `'dismissed'` literal in `cite_tags`. Comment already acknowledges it as TASK-09-followup placeholder.

**Decision**: KEEP as-is. The branch is forward-compatible with the eventual schema widening; removing now would require re-adding later. The inline comment documents the intent.

## Standards Compliance: PASS
- Cross-package invariant respected (server has zero new dep on cli)
- Hook never-throws contract verified
- rc.16 banner-i18n pattern mirrored in bilingual formatter
- Atomic writes via `appendFileSync` (OS-level atomic for small payloads)

## Performance: PASS
- Single-pass O(N) over ledger
- `isRecallVerified` uses pre-computed sorted-fetch index per session
- 10k events <100ms locally; test ceiling 2s safe

## Action Items
1. **MUST FIX BEFORE rc.20 TAG**: HIGH finding — cross-client denominator pollution
2. **MUST FIX**: MEDIUM finding — expand test to cover denominator under client filter
3. **DEFER**: LOW finding — dead code documented; keep for forward-compat

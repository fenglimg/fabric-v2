# Harvest Report — 2026-07-13

## Source
- Type: lite-plan + review
- ID: 20260713-plan-residual-registered-036-041
- Path: .workflow/scratch/20260713-plan-residual-registered-036-041/
- Related: .workflow/scratch/20260713-review-P1-residual-registered-036-041/, .workflow/scratch/20260713-review-P1-fixloop-042-045/
- Mode: --auto (session residual clearance harvest)

## Extraction Summary
- Fragments found: 7 high-value (from plan/verification/review)
- Filtered by confidence: 0 (all ≥ 0.88)
- Duplicates skipped: 0 (specs empty for these topics; issues already closed — not re-issued)
- Not harvested: medium/low residual notes (fabric-hint further thin, dual summarizeTranscript, ledger size cap) — intentionally deferred, not durable conventions yet

## Routing Results

### Spec (7 entries)
| # | Type | Target | Title | Status |
|---|------|--------|-------|--------|
| 1 | learning | learnings.md#learning-jsonl-partial-tail-drop | JSONL partial-tail drop contract | ADDED |
| 2 | learning | learnings.md#learning-transcript-sandbox-realpath-read | realpath-only path sandbox | ADDED |
| 3 | learning | learnings.md#learning-ssot-extract-not-relocate | extract collapses dual SSOT | ADDED |
| 4 | learning | learnings.md#learning-watermark-vs-session-anchor | watermark vs sessionAnchorTs | ADDED |
| 5 | pattern | coding-conventions.md#coding-path-sandbox-realpath-only | realpath-only read + test-gated seams | ADDED |
| 6 | pattern | coding-conventions.md#coding-jsonl-partial-tail-drop | shared partial-tail drop | ADDED |
| 7 | decision | architecture-constraints.md#arch-ssot-one-owner-reexport-facade | one owner + facade re-export | ADDED |

### Wiki (0)
None — durable conventions routed to project specs.

### Issue (0)
None — ISS-036..045 already closed fixed; no new open risks registered.

## Skipped
| Fragment | Reason |
|----------|--------|
| fabric-hint residual LOC / dual summarize / ledger hard cap | medium residual, not yet convention-grade |

## Next
- Review: `maestro load --type spec --category learning` / coding / arch
- Optional: `/manage-knowledge-audit --scope spec` if entries conflict later

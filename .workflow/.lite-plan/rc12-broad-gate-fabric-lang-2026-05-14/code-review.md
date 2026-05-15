# rc.12 Code Review — Gemini Batch Review

**Session**: rc12-broad-gate-fabric-lang-2026-05-14
**Tool**: Gemini CLI (analysis mode, batch at chain end per memory:feedback_review_batching)
**Exec ID**: rc12-broad-gate-fabric-lang-2026-05-14-code-review
**Scope**: 71 files changed, net -190 lines (6 tasks)

## Verdict: **PASS**

## Per-Area Severity

| Area | Severity | Notes |
|---|---|---|
| Code quality | None | Naming highly consistent; readability excellent |
| Correctness | None | Zero dangling `knowledge_language` references; managed-section idempotency verified |
| Pattern compliance | Low | Three-mirror byte-identity maintained; future-drift discipline concern |
| Security | None | Refactor only, no surface |
| Performance | None | Static config + lightweight CLI init |

## Top 3 Concerns

1. **Three-mirror sync drift**: System relies on `fab install` to forcibly copy templates to `.claude/` and `.codex/`. Direct manual edits to mirror copies can be lost. Mitigated by existing discipline; pitfall doc captures the invariant.

2. **Trailing newline accumulation**: While `addFabricKnowledgeBaseSection` cleans residual `\r?\n`, interaction with other automation that touches the HTML-comment block could cause whitespace conflicts. No current issue.

3. **Corrupted block markers**: If user accidentally deletes only the `<!-- fabric:knowledge-base:end -->` marker, the regex fails to match and the writer degrades to appending a new section at file tail. Consider adding integrity warning (defer to future task).

## Key Code Evidence

- `packages/shared/src/schemas/fabric-config.ts:35` — `fabricLanguageSchema = z.enum([..., 'zh-CN-hybrid'])` ✓
- `packages/shared/src/schemas/fabric-config.ts:58` — `fabric_language: fabricLanguageSchema...` ✓
- `packages/cli/src/install/skills-and-hooks.ts:513` — `addFabricKnowledgeBaseSection` includes precise slice + trailing-newline cleanup → byte-identical invariant ✓
- `packages/cli/src/commands/install.ts:235` — `export const installCommand = defineCommand({ meta: { name: 'install' } })` ✓

## Test Results (per TASK-006 final report)

- shared: 307/307 pass
- server: 402/402 pass (1 skipped, pre-existing)
- cli: 481/481 pass
- **Total: 1190/1190 pass**

## Overall Summary (Gemini, translated)

The rc.12 chain refactor demonstrates exceptional engineering rigor. `knowledge_language` has been completely eliminated from the codebase's production execution paths, with strongly-typed Zod enum support for the new `zh-CN-hybrid` value correctly introduced. The CLI layer seamlessly and properly transitions `initCommand` to `installCommand`. Most notably, the managed-section update mechanism successfully retires the fragile single-line search-and-append pattern; the new `addFabricKnowledgeBaseSection` cleverly combines content slicing and newline normalization to guarantee precise in-place replacement and high idempotency regardless of run count. Overall code quality is excellent and ready for the next build phase.

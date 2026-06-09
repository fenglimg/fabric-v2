# Dry-run Scope (unified)

`dry_run = true` (per Phase 4.5 detection rule — invocation MUST carry the verbatim token `--dry-run`; v2.0.0-rc.37 NEW-10 dropped the legacy substring fallback on bare `dry-run` / `dry_run` / `预览` to eliminate false positives on incidental mentions of those words mid-prompt) suspends ALL side-effecting writes below; read-side machinery (Phase 1 digest collection, Phase 2.5 viability gate evaluation, Phase 3 candidate render) executes normally so the user can preview what WOULD happen.

| Write operation | Normal mode | Dry-run mode |
|---|---|---|
| `fab_extract_knowledge` MCP call (Phase 4) | One call per confirmed candidate, writes to `knowledge/pending/<slug>.md` | SKIPPED. Phase 4 renders "would write N pending entries" preview table instead. |
| `session_archive_attempted` event (Phase 4.5) | Appended to `.fabric/events.jsonl` for every session in scope | SKIPPED entirely. No ledger entry. |
| `fab_review reject` (Phase 3 user-dismissed branch) | Invoked when user types `撤销` / `reject` after self-archive proposal | SKIPPED. The dismissal is rendered to console but no MCP write occurs. |
| `fabric onboard-coverage` slot writes (Phase 1.5 fill-all / dismiss-all) | Each `Bash("fabric config dismiss-slot <slot>")` invocation runs | SKIPPED. Slot decisions are shown as "would dismiss/propose" preview. |
| `.fabric/.cache/session-digests/<session_id>.md` reads | Read freely (read-side, safe) | Read freely — same as normal. |
| Stop-hook / archive-hint stdin/stdout | Read-only inspection of `.fabric/events.jsonl` | Same — no change. |

All user-facing output in dry-run mode MUST prefix `[DRY-RUN]` at the start of each Phase header (e.g. `[DRY-RUN] Phase 3 — Batch Review`). Exit message: `[DRY-RUN complete] would have written N entry/entries; no .fabric/ files were modified. Re-invoke without --dry-run to commit.`

Cross-reference: Phase 4.5 `Dry-run override` section in SKILL.md holds the rationale. When adding a new write side-effect to any phase, update BOTH the phase section AND this table.

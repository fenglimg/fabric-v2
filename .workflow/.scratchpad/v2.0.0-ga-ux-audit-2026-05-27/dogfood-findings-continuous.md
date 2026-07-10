# Continuous dogfood findings (rc.37 implementation phase)

Findings surfaced WHILE implementing the v2.0.0 GA closure plan. Per the goal's
rule 11, new bugs/paper-misses land here; blocking ones also become NEW-NN tasks
in status.json. Non-blocking / verified-transient findings are recorded here
with their verdict (no task needed).

## F3-FIND-1 — fresh `install` → `doctor` shows 2 transient fixable_errors

**Surfaced**: F3 onboarding retest, 2026-05-28.
**Symptom**: `fabric install` then `fabric doctor` (before any AI session) shows
`knowledge_test_index_missing` + `knowledge_index_drift`. Root cause: bootstrap
scaffolds a placeholder `sha256:initial` meta revision + an unbumped counter for
the bundled `KP-PRO-0001` personal entry + no `.cache` test index (built lazily).

**Verdict: NON-BLOCKING (verified transient).** Self-heals on the first MCP call /
SessionStart hook (observed: "🔄 meta auto-refreshed (sha initial → …)"). The real
onboarding path (install → open AI client) never surfaces them; the only exposure
is a manual `doctor` run in the install→first-session gap, which carries a clear
`--fix` remediation. NOT promoted to a NEW task.

**Attempted fix (reverted)**: `runDoctorFix` at install post-setup reaches 0
errors but unconditionally calls `rotateEventLedgerIfNeeded`, archiving
pre-existing old events → violates the "install preserves events.jsonl prefix"
invariant (init-guard I3). Worse than the cliff. Reverted.

**Correct future approach (if ever prioritised)**: write the correct meta
revision at scaffold time (append-only, no rotation) so `agents_meta_stale` never
fires, and ship the bundled meta with the counter already bumped for
`KP-PRO-0001` so `knowledge_index_drift` never fires. Bundled-data change, not a
runtime heal — out of GA's risk budget given the lazy heal covers the real path.

## F3-FIND-2 — opaque bundled `KP-PRO-0001` summary

**Surfaced**: F3 onboarding retest, 2026-05-28.
**Symptom**: SessionStart hint renders `KP-PRO-0001 · KP-PRO-0001` (summary ===
stable_id) for the one bundled personal entry. rc.37 NEW-37 guards opaque
summaries for NEW entries; this bundled legacy entry predates the guard.
**Verdict: NON-BLOCKING (cosmetic).** One line; self-corrects as the user adds
real entries. Candidate for a bundled-content polish post-GA. NOT promoted to a
NEW task.

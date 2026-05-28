# werewolf-snapshot fixture — invariant policy (rc.37 F1)

A sanitized snapshot of the `werewolf-minigame` dogfood `.fabric/` tree, captured
as `werewolf-snapshot.tar.gz` (~100 KB). It gives the test suite a realistic,
production-shaped knowledge base — draft-heavy, mixed types, real event ledger —
so cross-client parity (F2), doctor metrics, and regression tests run against
something other than hand-built toy fixtures.

## Sanitization policy

- **Absolute paths scrubbed.** Every `/Users/<name>/…` prefix is rewritten to
  `/fixtures/…` across all JSON / JSONL / Markdown. The fixture MUST contain
  zero `/Users/` references (asserted at extract time below).
- **Event ledger trimmed.** The live ledger is ~9.7 MB (dominated by
  `assistant_turn_observed` chat turns). The fixture keeps every audit-relevant
  event type verbatim + the first 40 `assistant_turn_observed` (enough to
  exercise cite-coverage signal) — bounding the tarball to ~100 KB.
- **No secrets.** The werewolf KB is game-design knowledge (decisions / pitfalls
  about a minigame); it carries no credentials. Knowledge bodies are shipped
  verbatim (already free of `/Users/` paths).

## Captured invariants (pinned by werewolf-fixture.test.ts)

| Dimension | Value |
|---|---|
| Canonical entries (total) | 57 |
| — decisions / pitfalls / guidelines / models / processes | 7 / 17 / 10 / 16 / 7 |
| pending entries | 0 |
| maturity = draft | 53 |
| maturity = verified | 4 |
| events.jsonl lines | 1185 |

`draft_backlog` therefore reads 53/57 ≈ 93% (the NEW-38 schema-aware counter
sees the 4 verified entries in the denominator) — a useful "needs auto-promote"
baseline.

## Regenerating

Re-run the staging steps in the rc.37 F1 commit (copy knowledge + meta + config
+ AGENTS + forensic from a live `.fabric`, trim events, scrub `/Users/`, then
`tar -czf werewolf-snapshot.tar.gz -C <staging-parent> .fabric`). Update the
invariant table above + the test assertions when the snapshot changes.

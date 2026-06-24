# Phase 0 + 0.1 — State Recovery (archive source mode ref-only)

> **Loaded on demand.** Only relevant when a prior import crashed mid-phase, leaving `.tmp-*` residue or a torn `.fabric/.import-state.json`. SKILL.md's hot path inline says "scan for .tmp residue + load state" — this file is the full recovery procedure (atomic-write pattern, sweep rules, corruption detection, fallback to fresh import).

## Phase 0 — Init & .tmp Residue Scan

Before reading `.fabric/.import-state.json`, scan for residue left by a
prior crashed run. Skill state writes use a 2-step atomic pattern (Write
`.tmp` then `Bash mv`); a crash between Step A and Step B leaves a
`.fabric/.import-state.json.tmp` sidecar that the next invocation MUST
triage.

1. Does `.fabric/.import-state.json.tmp` exist? (`Bash: ls .fabric/.import-state.json.tmp 2>/dev/null`)
   - **Does not exist** → proceed normally to Phase 0.1 (no residue work).
   - **Exists** → triage:
     1. `Read` the `.tmp` file; try `JSON.parse` on the content.
     2. Compare `mtime` of `.tmp` vs `.fabric/.import-state.json` via `Bash: stat`.
        - **Parse OK + .tmp mtime newer than main file** → rescue:
          `Bash: mv .fabric/.import-state.json.tmp .fabric/.import-state.json`
          (commits the last incomplete write atomically).
        - **Parse OK + .tmp mtime older than main file** → stale residue
          from an earlier run that subsequently completed; delete it:
          `Bash: rm .fabric/.import-state.json.tmp`.
        - **Parse fails** (syntax error / unterminated structure / truncated
          mid-write) → half-written, unrecoverable; delete it:
          `Bash: rm .fabric/.import-state.json.tmp`.
     3. After triage, proceed to Phase 0.1.

The 5-minute mtime heuristic (treat any `.tmp` older than 5 minutes as
stale regardless of parse result) is an acceptable conservative simplification:
no legitimate atomic write window stays open that long; anything older
than 5 minutes is definitely crash residue. Implementations MAY use either
the mtime-comparison rule above OR the 5-minute staleness rule.

### Phase 0.1 — State Corruption Recovery

After residue triage, `Read` `.fabric/.import-state.json`. Detect
corruption if ANY of the following hold:

- `JSON.parse` throws (syntax error / unterminated structure / truncated)
- Missing required field: `phase` OR `started_at` OR `last_checkpoint_at`
- `phase` value not in the enum `{P1-done, P2-done, complete}`

On corruption (any condition above):

1. `Bash: mv .fabric/.import-state.json .fabric/.import-state.json.corrupt-<ISO8601>`
   (preserve the corrupt file for postmortem; do NOT silently overwrite).
2. Phase 1 restarts from scratch (Phase 1 produces no MCP calls, so re-run
   is safe — re-querying mounted store canonical titles via `fab_review search`
   idempotent; the `p1_baseline_titles` array is regenerated).
3. DO NOT attempt automatic partial recovery; corrupt state is a signal
   that something serious happened (disk-full, kill -9 mid-write, fs
   error). Discard-and-restart is the only safe path.

ENOENT (state file absent) is NOT corruption — it is the normal
first-run state. Proceed to Phase 0.5.

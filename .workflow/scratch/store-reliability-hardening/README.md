# Store Reliability Hardening

This milestone worktree is based on `milestone/global-store-topology`.

Scope:

- Fix corrupt store counter handling so allocation fails closed instead of re-minting existing stable IDs.
- Make `store migrate` safe across interruptions by reconciling or recovering counters before any later allocation can reuse imported IDs.
- Add locking and atomic write behavior for global/project store config read-modify-write operations.
- Keep command/doc drift, hook duplication, and privacy follow-ups out of this worktree unless they are directly required by the store reliability fixes.

Primary issue anchors:

- `ISS-20260608-018`: corrupt store counters fail open to zero.
- `ISS-20260608-019`: store migrate has an interruption window before counter reconciliation.
- `ISS-20260608-020`: global/project store config mutations use unlocked read-modify-write.

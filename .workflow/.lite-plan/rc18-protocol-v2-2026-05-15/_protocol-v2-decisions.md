# Protocol v2 Design Decisions (rc.18)

Pre-commit decision record. Both choices are agent-recommended with rationale; flag in `_metadata.outstanding_clarifications` for user veto but planning does not block.

## Decision 1 — New field name: `entries`

**Rejected candidates**: `matchedKnowledge`, `relevantKnowledge`

**Rationale**:
1. **Already-validated by consumer code**: `knowledge-hint-broad.cjs:443` already does a local rebind `const entries = Array.isArray(payload && payload.narrow) ? payload.narrow : []` precisely because the maintainer found `narrow` misleading at the rendering layer. The comment at lines 437-441 explicitly flags this as "a deferred independent task". rc.18 IS that deferred task — adopt the rebind name as the wire name.
2. **Mode-agnostic**: The field carries different semantics in `--paths` mode (per-target description-index union) vs `--all` mode (full shared index). `entries` correctly describes both; `matchedKnowledge` only fits path mode; `relevantKnowledge` is verbose and shares the path-mode bias.
3. **Downstream naming parity**: Server-side `description_index` items are already called "entries" in adjacent code paths (`narrowSource.map((item) => ...)` produces what the spec elsewhere calls hint-entries). The wire name should match.

**Wire shape after rename**:
```json
{
  "version": 2,
  "revision_hash": "...",
  "target_paths": ["..."],
  "entries": [{ "id": "...", "type": "...", "maturity": "...", "summary": "..." }],
  "broad_count": N
}
```

## Decision 2 — v1 receipt stance: `silent-skip + one-line stderr breadcrumb`

**Rejected stances**: `error-log` (verbose), `hard-throw` (crashes hook → breaks user session)

**Rationale**:
1. **Aligns with existing hook contract**: `knowledge-hint-broad.cjs:464` comment explicitly states "Wraps the entire flow in try/catch: ANY error → silent exit 0." Silent-skip is the established failure mode — version mismatch should not be the one exception that breaks the rule.
2. **Upgrade safety**: Pre-user clean-slate means no installed hooks to break, but `fab` binary updates and template-hook updates land in separate npm publish events. A user who updates `@fenglimg/fabric-cli` (new emitter v2) before re-running `fab install` (still has old v1-only hooks) would see SessionStart silently skip — recoverable by re-running `fab install`. Hard-throw would crash every Claude Code session start until they fix it.
3. **Debug breadcrumb**: A single stderr line `[fabric] hint payload version=N unsupported (expected ≥2), skipping` gives any user grepping a stuck-banner report enough signal to diagnose without searching the codebase. This is one extra `if (payload.version !== 2)` branch in each consumer's `renderSummary`.

**Implementation pattern (both consumers)**:
```js
function renderSummary(payload) {
  if (!payload || payload.version !== 2) {
    if (payload && payload.version !== undefined) {
      // breadcrumb only if payload exists but version mismatches (avoid spam on null)
      stderr.write(`[fabric] hint payload version=${payload.version} unsupported (expected 2), skipping\n`);
    }
    return [];
  }
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  // ... existing logic ...
}
```

Note: the breadcrumb stderr write is best-effort; if stderr is unavailable, the silent-skip return still applies.

## Outstanding clarifications (for user veto)

1. **Field name `entries`** — user can veto in favor of `matchedKnowledge` or `relevantKnowledge`. If vetoed, only TASK-001 changes; downstream tasks reference `<chosen-name>` placeholder.
2. **v1-receipt stance** — user can veto silent-skip in favor of hard-throw (if they want loud failure on protocol drift). If vetoed, TASK-003/TASK-004 swap the `return []` for `throw new Error(...)` and TASK-005 adjusts the corresponding test assertion.

Neither veto invalidates the task DAG — only the implementation details inside TASK-002 / TASK-003 / TASK-004 / TASK-005 shift.

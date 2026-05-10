# Fabric v2.0 rc.3 — TASK-008 Dogfood Evidence

End-to-end empirical validation of the rc.3 `fab_review` flow on this self-repo's
3 pending entries (created in rc.2 dogfood, commit `baecd5d`) plus the rc.3
filesystem-edit fallback (TASK-005). Captured by `scripts/dogfood-rc3-review.mjs`
on 2026-05-10.

## Pre-dogfood state

### Pending entries

```
.fabric/knowledge/pending/decisions/:
  rc2-single-cjs-hook-across-clients.md

.fabric/knowledge/pending/guidelines/:
  deepmerge-array-append-paths-for-stop-ho.md

.fabric/knowledge/pending/pitfalls/:
  codex-hook-config-is-json-not-toml.md
```

### Counters (`.fabric/agents.meta.json`)

```json
{
  "KP": { "MOD": 0, "DEC": 0, "GLD": 0, "PIT": 0, "PRO": 0 },
  "KT": { "MOD": 3, "DEC": 8, "GLD": 1, "PIT": 0, "PRO": 1 }
}
```

### Events ledger baseline

`wc -l .fabric/events.jsonl` = **28 lines**. Tail showed only `knowledge_proposed`,
`meta_reconciled_on_startup`, `knowledge_drift_detected` event types — no
`knowledge_promoted` / `knowledge_rejected` / `knowledge_layer_changed` had ever
been emitted on this repo prior to this dogfood. Counter starting points
predicted by a clean run:

| Action | Predicted id |
| --- | --- |
| Approve decision | `KT-DEC-0009` (KT.DEC: 8 → 9) |
| Approve pitfall | `KT-PIT-0001` (KT.PIT: 0 → 1) |
| Layer-flip pitfall to personal | `KP-PIT-0001` (KP.PIT: 0 → 1) |

## Step A — list

```json
{
  "action": "list",
  "items": [
    { "pending_path": ".fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md", "type": "decisions", "layer": "team", "maturity": "draft" },
    { "pending_path": ".fabric/knowledge/pending/pitfalls/codex-hook-config-is-json-not-toml.md", "type": "pitfalls", "layer": "team", "maturity": "draft" },
    { "pending_path": ".fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md", "type": "guidelines", "layer": "team", "maturity": "draft" }
  ]
}
```

3 entries surfaced as expected; type/layer/maturity parsed correctly from frontmatter.

## Step B — approve decision (team)

Input: `{action:'approve', pending_paths:['.fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md']}`

Output:
```json
{
  "action": "approve",
  "approved": [
    {
      "pending_path": ".fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md",
      "stable_id": "KT-DEC-0009"
    }
  ]
}
```

Canonical file produced: `.fabric/knowledge/decisions/KT-DEC-0009--rc2-single-cjs-hook-across-clients.md`
(observed via `ls`; pending file removed via `git rm`, history preserved).

## Step C — approve pitfall + layer-flip team→personal

Two-call pattern: first allocate a team id via `approve`, then mutate via
`modify` with `changes.layer='personal'`. The layer flip is the **only legal
stable_id mutation** in the rc.3 surface (KP/KT counter spaces are independent,
so a layer change forces a fresh allocation).

`FABRIC_HOME` redirected to `.fabric-personal-dogfood-tmp/` for safe dogfood
(avoids polluting the user's `~/.fabric/`).

### C.1 approve

Output:
```json
{
  "action": "approve",
  "approved": [
    {
      "pending_path": ".fabric/knowledge/pending/pitfalls/codex-hook-config-is-json-not-toml.md",
      "stable_id": "KT-PIT-0001"
    }
  ]
}
```

### C.2 layer-flip (modify)

Input: `{action:'modify', pending_path:'.fabric/knowledge/pitfalls/KT-PIT-0001--codex-hook-config-is-json-not-toml.md', changes:{layer:'personal'}}`

Output:
```json
{
  "action": "modify",
  "pending_path": "~/.fabric/knowledge/pitfalls/KP-PIT-0001--codex-hook-config-is-json-not-toml.md",
  "prior_stable_id": "KT-PIT-0001",
  "new_stable_id": "KP-PIT-0001"
}
```

Verifications:
- The `~/...` form correctly references the FABRIC_HOME redirect target.
- `prior_stable_id` and `new_stable_id` differ — confirms layer-flip is a true
  re-allocation (not an in-place rewrite).
- The new file at `.fabric-personal-dogfood-tmp/.fabric/knowledge/pitfalls/KP-PIT-0001--codex-hook-config-is-json-not-toml.md`
  has frontmatter rewritten to `id: KP-PIT-0001`, `layer: personal`, and the
  pending-only `x-fabric-idempotency-key` correctly dropped.
- The team-canonical intermediate `KT-PIT-0001--*.md` was removed via `git rm`.

## Step D — reject guideline

Input: `{action:'reject', pending_paths:['.fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md'], reason:'too narrow scope; covered by data-schema.md'}`

Output:
```json
{
  "action": "reject",
  "rejected": [
    ".fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md"
  ]
}
```

Per TASK-002 reject semantics: file is **retained on disk** (verified via `ls`,
the pending file still exists). The audit signal is the `knowledge_rejected`
event in `events.jsonl`. Doctor (rc.4) owns physical cleanup of rejected files.

## Step E — search

Input: `{action:'search', query:'rc2', filters:{type:'decisions'}}`

Output:
```json
{
  "action": "search",
  "items": [
    {
      "pending_path": ".fabric/knowledge/decisions/KT-DEC-0009--rc2-single-cjs-hook-across-clients.md",
      "type": "decisions",
      "layer": "team",
      "maturity": "draft"
    }
  ]
}
```

Search correctly locates the just-approved entry under its canonical (post-promote)
path; query-string match is case-insensitive substring against title/summary/tags
plus filename, returning the only `decisions`-type file matching `rc2`.

## Step F — filesystem-edit fallback (manual move + doctor)

Synthesized canonical file written **directly** (bypassing `fab_review.approve`):

`.fabric/knowledge/decisions/KT-DEC-9001--manual-rc3-fallback-test.md`

(id `9001` chosen out-of-band from the live counter sequence to make the orphan
unambiguous; canonical filename pattern `<id>--<slug>.md` matches the doctor
detector regex.)

### Doctor run #1 — synthesizes promoted event

```json
{
  "name": "Filesystem-edit fallback",
  "status": "ok",
  "kind": "info",
  "code": "knowledge_promoted_synthesized",
  "fixable": false,
  "message": "Synthesized 1 knowledge_promoted event for orphan canonical entries (KT-DEC-9001). Reason='[synthesized] filesystem-edit-fallback'.",
  "actionHint": "These entries were moved into .fabric/knowledge/<type>/ outside fab_review.approve. The synthesized events restore audit-trail completeness."
}
```

### Doctor run #2 — idempotent (no second synth)

```
"<no synth check; idempotent>"
```

(The check returns the OK path without the `knowledge_promoted_synthesized` code
when no orphans remain — the event written by run #1 reconciles the audit
trail, so run #2 sees zero orphans.)

Verified via `events.jsonl`: exactly **one** synthesized `knowledge_promoted`
event for `KT-DEC-9001`. The check is correctly idempotent.

## Post-dogfood state — events.jsonl tail (verbatim)

```jsonl
{"kind":"fabric-event","id":"event:3d924fd7-e97f-40fc-a6d7-f8d293e74d0c","ts":1778426883135,"schema_version":1,"event_type":"knowledge_promote_started","timestamp":"2026-05-10T15:28:03.134Z","reason":"approve:rc2-single-cjs-hook-across-clients"}
{"kind":"fabric-event","id":"event:ccc56d59-69b5-4d6b-8378-1be64010c1f3","ts":1778426883146,"schema_version":1,"event_type":"knowledge_promoted","stable_id":"KT-DEC-0009","timestamp":"2026-05-10T15:28:03.146Z","reason":"approve:rc2-single-cjs-hook-across-clients"}
{"kind":"fabric-event","id":"event:5ec49ff1-139e-4dba-8012-32bb5a57fd79","ts":1778426883146,"schema_version":1,"event_type":"knowledge_promote_started","timestamp":"2026-05-10T15:28:03.146Z","reason":"approve:codex-hook-config-is-json-not-toml"}
{"kind":"fabric-event","id":"event:ea849573-41d2-411d-bc31-60eecd2114de","ts":1778426883154,"schema_version":1,"event_type":"knowledge_promoted","stable_id":"KT-PIT-0001","timestamp":"2026-05-10T15:28:03.154Z","reason":"approve:codex-hook-config-is-json-not-toml"}
{"kind":"fabric-event","id":"event:a8a772ba-ce64-48a6-8f8d-24e8fa901870","ts":1778426883156,"schema_version":1,"event_type":"knowledge_promote_started","stable_id":"KT-PIT-0001","timestamp":"2026-05-10T15:28:03.156Z","reason":"layer_flip:KT-PIT-0001->KP-PIT-0001"}
{"kind":"fabric-event","id":"event:9340bf9c-c52c-4967-9ad5-dc372f13a098","ts":1778426883161,"schema_version":1,"event_type":"knowledge_layer_changed","stable_id":"KP-PIT-0001","timestamp":"2026-05-10T15:28:03.161Z","reason":"layer_flip:KT-PIT-0001->KP-PIT-0001","from_layer":"team","to_layer":"personal"}
{"kind":"fabric-event","id":"event:97b46f0f-4658-4dcc-ba31-efd3ddecdd1d","ts":1778426883161,"schema_version":1,"event_type":"knowledge_rejected","timestamp":"2026-05-10T15:28:03.161Z","reason":"reject:.fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md: too narrow scope; covered by data-schema.md"}
{"kind":"fabric-event","id":"event:39c139d8-3af5-46ea-8acf-f35bd3bcf343","ts":1778426883234,"schema_version":1,"correlation_id":"doctor-synthesized","session_id":"doctor-synthesized","event_type":"knowledge_promoted","stable_id":"KT-DEC-9001","timestamp":"2026-05-10T15:28:03.234Z","reason":"[synthesized] filesystem-edit-fallback"}
```

8 new events. **Counts by type (post-dogfood delta)**:

| event_type | count | source |
| --- | --- | --- |
| `knowledge_promote_started` | 3 | approve x2 + layer-flip x1 |
| `knowledge_promoted` | 3 | approve x2 + synthesized fallback x1 |
| `knowledge_layer_changed` | 1 | layer-flip team→personal |
| `knowledge_rejected` | 1 | reject guideline |

(Acceptance criterion 11: ≥1 each of `knowledge_promote_started`, `knowledge_promoted`,
`knowledge_layer_changed`, `knowledge_rejected` — all present.)

### Counters delta

| key | pre | post | delta |
| --- | --- | --- | --- |
| `KT.DEC` | 8 | 9 | +1 (approve decision) |
| `KT.PIT` | 0 | 1 | +1 (approve pitfall — counter is monotonic, NOT decremented after layer-flip) |
| `KP.PIT` | 0 | 1 | +1 (layer-flip allocates fresh personal id) |

Counters reflect Q2 monotonic invariant: even though `KT-PIT-0001` was
layer-flipped (its file moved out of the team tree), the team counter stays
at 1 — preserving the property that any id ever returned from the allocator is
permanently retired from the counter pool.

## Evidence summary table

| Original path | Action | Event(s) emitted | Final path | Stable id |
| --- | --- | --- | --- | --- |
| `.fabric/knowledge/pending/decisions/rc2-single-cjs-hook-across-clients.md` | approve | `knowledge_promote_started` + `knowledge_promoted` | `.fabric/knowledge/decisions/KT-DEC-0009--rc2-single-cjs-hook-across-clients.md` | `KT-DEC-0009` |
| `.fabric/knowledge/pending/pitfalls/codex-hook-config-is-json-not-toml.md` | approve → modify(layer=personal) | `knowledge_promote_started` + `knowledge_promoted` (KT) → `knowledge_promote_started` + `knowledge_layer_changed` (team→personal) | `~/.fabric/knowledge/pitfalls/KP-PIT-0001--codex-hook-config-is-json-not-toml.md` (under `FABRIC_HOME=.fabric-personal-dogfood-tmp`) | `KT-PIT-0001` → `KP-PIT-0001` |
| `.fabric/knowledge/pending/guidelines/deepmerge-array-append-paths-for-stop-ho.md` | reject | `knowledge_rejected` | unchanged (file retained on disk) | n/a |
| `.fabric/knowledge/decisions/KT-DEC-9001--manual-rc3-fallback-test.md` (synthetic) | manual write + doctor x2 | `knowledge_promoted` (synthesized) on run #1; no event on run #2 | unchanged | `KT-DEC-9001` |

## Cleanup

`.fabric-personal-dogfood-tmp/` was retained for evidence inspection during this
task. To avoid polluting the repository it is **not committed** (added to
`.gitignore`). Operators may safely `rm -rf .fabric-personal-dogfood-tmp` after
reviewing this evidence.

## Bugs / observations (for TASK-009 follow-up)

- **None blocking.** All 4 actions and the doctor fallback executed without
  manual intervention. Schema-side note: the rc.3 `modify` action overloads the
  `pending_path` field name to also reference post-approve canonical paths
  (per `resolveModifyTarget` in `review.ts:422-452`). This is documented in
  the inline comment but the field name is mildly counterintuitive at the
  schema layer — rc.4 may want to rename to `target_path` or split into a
  union of `{pending_path}` and `{canonical_path}` for clarity.
- **Empty-dir cleanup**: after `git rm` removes the only file in
  `.fabric/knowledge/pending/decisions/` (and similarly for pitfalls), the
  empty directories are gone from the working tree. This is the standard `git`
  behavior and is fine — but if any tooling assumes those dirs always exist,
  it should `mkdir -p` defensively. Not a bug in the rc.3 surface.

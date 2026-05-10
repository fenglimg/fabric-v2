# Fabric v2.0 Schema Contract

Contract reference for the on-disk data formats emitted and consumed by
Fabric v2.0. Updated in lock-step with schema changes; current as of rc.2.

---

## 1. Frontmatter (7 fields)

Every knowledge entry (`.fabric/knowledge/**/*.md`) carries a YAML frontmatter
block. All fields are scalars or flat flow-style arrays — no nested YAML.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` — pattern `K[PT]-(MOD\|DEC\|GLD\|PIT\|PRO)-NNNN` | yes | Stable, path-decoupled identifier allocated by `allocateKnowledgeId` and persisted in `agents.meta.json.counters`. Never changes after creation. |
| `type` | `model \| decision \| guideline \| pitfall \| process` | yes | Knowledge type. Determines which `counters` sub-key is used for `id` allocation. |
| `layer` | `personal \| team` | yes | Root scope. `personal` → `~/.fabric/knowledge/`; `team` → `<repo>/.fabric/knowledge/`. Encoded in the `id` prefix (`KP`/`KT`). |
| `maturity` | `draft \| verified \| proven` | yes | Lifecycle stage. `draft` = AI-proposed, not reviewed; `verified` = human-reviewed once; `proven` = battle-tested across multiple sessions. |
| `layer_reason` | `string` | yes | Human-readable rationale for the `layer` assignment. |
| `created_at` | ISO 8601 string | yes | Creation timestamp (set by init-scan or manual entry; never mutated). |
| `tags` | `string[]` (flow-style) | no | Flat keyword array, e.g. `tags: [typescript, react, vite]`. Populated by init-scan from forensic tech-stack keywords (top 5). User-editable. Used by rc.3 review skill for tag-filter search. |

Example:

```yaml
---
id: KT-MOD-0001
type: model
layer: team
maturity: verified
layer_reason: "project artifact (deterministic init scan)"
created_at: 2026-05-10T12:00:00.000Z
tags: [typescript, vite, react]
---
```

---

## 2. Event Types (15)

All events are written as NDJSON lines to `.fabric/events.jsonl`.
Every event carries a common envelope:

| Envelope field | Type | Description |
|---|---|---|
| `kind` | `"fabric-event"` | Discriminator for the file format. |
| `id` | `string` | Unique event id (`event:<uuid>`). |
| `ts` | `number` (ms since epoch) | Emission timestamp. |
| `schema_version` | `1` | Format version. |
| `correlation_id` | `string?` | MCP request correlation id. |
| `session_id` | `string?` | Agent session id. |

### Event type table

| `event_type` | Payload fields (beyond envelope) | Emitter | Purpose |
|---|---|---|---|
| `knowledge_context_planned` | `target_paths`, `required_stable_ids`, `ai_selectable_stable_ids`, `final_stable_ids`, `selection_token?`, `client_hash?`, `intent?`, `known_tech?`, `diagnostics?` | `plan-context.ts` | Logged when the server computes which knowledge entries are required/selectable for a given file path set. |
| `knowledge_selection` | `selection_token`, `target_paths`, `required_stable_ids`, `ai_selectable_stable_ids`, `ai_selected_stable_ids`, `final_stable_ids`, `ai_selection_reasons`, `rejected_stable_ids`, `ignored_stable_ids` | `audit-log.ts` | Records the AI's final selection decision (which L1 entries were chosen). |
| `knowledge_sections_fetched` | `selection_token`, `target_paths?`, `requested_sections`, `final_stable_ids`, `ai_selected_stable_ids`, `diagnostics?` | `rule-sections.ts` | Records which sections of which knowledge entries were fetched for injection. |
| `knowledge_drift_detected` | `revision?`, `drifted_stable_ids`, `missing_files`, `stale_files`, `details?` | `rule-meta-builder.ts`, `rule-sync.ts` | Emitted when on-disk hashes differ from `agents.meta.json` snapshot. |
| `edit_intent_checked` | `path`, `compliant`, `intent`, `ledger_entry_id`, `ledger_source?`, `commit_sha?`, `parent_sha?`, `parent_ledger_entry_id?`, `diff_stat?`, `annotation?`, `matched_rule_context_ts`, `window_ms` | `audit-log.ts` | Result of checking whether an edit's declared intent matches the active knowledge context window. |
| `mcp_event` | `mcp_event_id`, `stream_id`, `message` | MCP transport layer | Raw MCP protocol event forwarded to the ledger for replay debugging. |
| `reapply_completed` | `preserved_ledger`, `preserved_meta`, `rules_count` | init pipeline | Emitted after a non-destructive re-init (reapply mode) completes. |
| `event_ledger_truncated` | `byte_offset`, `byte_length`, `corrupted_path` | event-ledger.ts | Recovery event written when the ledger is truncated to remove a partial tail write. |
| `mcp_config_migrated` | `source`, `removed_from` | doctor.ts | Emitted when MCP server config is migrated from a legacy file location. |
| `meta_reconciled_on_startup` | `reconciled_files`, `duration_ms`, `source` | rule-sync.ts | Full meta reconciliation run triggered at server startup. |
| `meta_reconciled` | `reconciled_files`, `duration_ms`, `trigger`, `source` | rule-sync.ts | Meta reconciliation triggered by `fab doctor` or manual request. |
| `claude_skill_path_migrated` | `from`, `to` | doctor.ts | Skill file moved from v1.x path to v2.0 path. |
| `claude_hook_path_migrated` | `from`, `to` | doctor.ts | Hook file moved from v1.x path to v2.0 path. |
| `codex_skill_path_migrated` | `from`, `to` | doctor.ts | Codex skill file moved from v1.x path to v2.0 path. |
| `init_scan_completed` | `written_stable_ids`, `duration_ms`, `source?` | scan.ts | Emitted after `fab scan` finishes writing baseline knowledge entries. |

---

## 3. stable_id Format

```
K[PT]-(MOD|DEC|GLD|PIT|PRO)-NNNN
^  ^   ^                     ^
|  |   |                     +--- monotonic counter (4+ digits, zero-padded)
|  |   +--- type code:
|  |          MOD = model
|  |          DEC = decision
|  |          GLD = guideline
|  |          PIT = pitfall
|  |          PRO = process
|  +--- scope:
|         P = personal  (~/.fabric/knowledge/)
|         T = team      (<repo>/.fabric/knowledge/)
+--- prefix: always 'K'
```

Examples:
- `KT-DEC-0001` — first team decision
- `KP-MOD-0003` — third personal model
- `KT-GLD-0012` — twelfth team guideline

Properties:
- **Path-decoupled**: the id is stored in frontmatter and in `agents.meta.json`.
  Moving a file between subdirectories does NOT change its id.
- **Layer-flip is the only legal mutation**: a `KP-*` id may be promoted to
  `KT-*` (and vice versa) via a frontmatter edit + meta reconcile. All other
  parts of the id are immutable.
- **Monotonic**: counters only increment. Deleting an entry does NOT free its
  counter slot — historical ids remain unique forever.

---

## 4. Counters Envelope

Stored in `<repo>/.fabric/agents.meta.json` and `~/.fabric/agents.meta.json`
under the `counters` key.

```json
{
  "counters": {
    "KP": { "MOD": 0, "DEC": 0, "GLD": 0, "PIT": 0, "PRO": 0 },
    "KT": { "MOD": 3, "DEC": 8, "GLD": 1, "PIT": 0, "PRO": 2 }
  }
}
```

Rules:
- Each sub-key tracks the highest counter ever issued for that `(scope, type)` pair.
- **Never decrement** — counter values are monotonically non-decreasing.
- After deletion: the slot value stays at its last-issued value; the next
  allocation uses `slot + 1`.
- `allocateKnowledgeId(layer, type, counters)` returns the next id and a new
  counters object with the relevant slot incremented by 1.
- Both roots (`KP` and `KT`) are always present; slots default to `0` when
  the `counters` key is absent (backward compat with v1.x meta files).

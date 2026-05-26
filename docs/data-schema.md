# Fabric v2.0 Data Schema

Contract reference for the on-disk data shapes produced and consumed by Fabric
v2.0. Updated in lock-step with `packages/shared/src/schemas/`. Companion to
[mcp-contracts.md](./mcp-contracts.md), which specifies the API surface that
reads and writes these shapes.

This document covers what is **persisted** (frontmatter, events, counters,
meta files). For the verbs that mutate them, see `mcp-contracts.md`.

---

## Frontmatter (7 fields)

Every knowledge entry under `<repo>/.fabric/knowledge/**/*.md` (team layer) or
`~/.fabric/knowledge/**/*.md` (personal layer) carries a YAML frontmatter
block. Source of truth: `packages/shared/src/schemas/agents-meta.ts`
(`ruleDescriptionSchema`) and `packages/shared/src/schemas/api-contracts.ts`
(`KnowledgeEntryFrontmatterSchema`). All fields are scalars or flat
flow-style arrays — no nested YAML.

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` — pattern `K[PT]-(MOD\|DEC\|GLD\|PIT\|PRO)-NNNN` | yes | Stable, path-decoupled identifier allocated by `allocateKnowledgeId` and persisted in `agents.meta.json.counters`. Never changes after creation except via layer-flip (KP↔KT swap). |
| `type` | `model \| decision \| guideline \| pitfall \| process` | yes | Knowledge type. Determines which `counters` sub-key is used for `id` allocation. |
| `layer` | `personal \| team` | yes | Root scope. `personal` → `~/.fabric/knowledge/`; `team` → `<repo>/.fabric/knowledge/`. Encoded in the `id` prefix (`KP`/`KT`). |
| `maturity` | `draft \| verified \| proven` | yes | Lifecycle stage. `draft` = AI-proposed, not reviewed; `verified` = human-reviewed once; `proven` = battle-tested across multiple sessions. |
| `layer_reason` | `string` | yes | Human-readable rationale for the `layer` assignment. |
| `created_at` | ISO 8601 string | yes | Creation timestamp (set by init-scan or manual entry; never mutated). |
| `tags` | `string[]` (flow-style) | no | Flat keyword array, e.g. `tags: [typescript, react, vite]`. Populated by init-scan from forensic tech-stack keywords (top 5). User-editable. Used by `fab_review` for tag-filter search. |

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

## Event Types (26 total)

All events are written as NDJSON lines to `.fabric/events.jsonl`. Source of
truth: `packages/shared/src/schemas/event-ledger.ts`. Every event carries a
common envelope:

| Envelope field | Type | Description |
|---|---|---|
| `kind` | `"fabric-event"` | Discriminator for the file format. |
| `id` | `string` | Unique event id (`event:<uuid>`). |
| `ts` | `number` (ms since epoch) | Emission timestamp. |
| `schema_version` | `1` | Format version. |
| `correlation_id` | `string?` | MCP request correlation id. |
| `session_id` | `string?` | Agent session id. |

Events are emitted by various subsystems — see [mcp-contracts.md](./mcp-contracts.md)
for which MCP tool emits which event.

### Group A — base events (15, present since rc.1)

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
| `meta_reconciled` | `reconciled_files`, `duration_ms`, `trigger`, `source` | rule-sync.ts | Meta reconciliation triggered by `fabric doctor` or manual request. |
| `claude_skill_path_migrated` | `from`, `to` | doctor.ts | Skill file moved from v1.x path to v2.0 path. |
| `claude_hook_path_migrated` | `from`, `to` | doctor.ts | Hook file moved from v1.x path to v2.0 path. |
| `codex_skill_path_migrated` | `from`, `to` | doctor.ts | Codex skill file moved from v1.x path to v2.0 path. |
| `init_scan_completed` | `written_stable_ids`, `duration_ms`, `source?` | scan.ts | Emitted after `fabric scan` finishes writing baseline knowledge entries. |

### Group B — knowledge.* lifecycle (11, pre-registered for rc.2/3/4)

Pre-registered in TASK-004 (`event-ledger.ts`) so the vocabulary is locked
BEFORE rc.2/3/4 emit-site implementation. Each variant carries the envelope
plus the minimal payload skeleton listed below; payload extensions land at
emit-site implementation time.

Lifecycle group: `knowledge_proposed → knowledge_promote_started →
knowledge_promoted | knowledge_promote_failed`. See `fab_review` and
`fab_extract_knowledge` in [mcp-contracts.md](./mcp-contracts.md) for the
emit sites.

| `event_type` | Payload skeleton (beyond envelope) | Notes |
|---|---|---|
| `knowledge_proposed` | `stable_id?`, `timestamp` (ISO), `reason?` | Emitted when a pending entry is written under `pending/`. `stable_id` absent at this stage (Q2 late-bind). |
| `knowledge_promote_started` | `stable_id?`, `timestamp`, `reason?` | Phase-1 of the 2-phase approve transaction. Pairs with one of `knowledge_promoted` / `knowledge_promote_failed`. |
| `knowledge_promoted` | `stable_id?`, `timestamp`, `reason?` | Phase-2 success. `stable_id` populated post-counter-allocation. |
| `knowledge_promote_failed` | `stable_id?`, `timestamp`, `reason` (required) | Phase-2 failure. Counter increment is NOT rolled back — the orphaned slot is reported by `fabric doctor`. |
| `knowledge_layer_changed` | `stable_id?`, `timestamp`, `reason?`, `from_layer`, `to_layer` | Layer-flip via `fab_review/modify.changes.layer`. Triggers `redirect_to` in subsequent `fab_get_rule_sections` calls. |
| `knowledge_slug_renamed` | `stable_id?`, `timestamp`, `reason?`, `from_slug`, `to_slug` | Explicit `git mv` keeping `id` stable. |
| `knowledge_demoted` | `stable_id?`, `timestamp`, `reason?` | Maturity transition (e.g. `proven → verified`, `verified → draft`). |
| `knowledge_archived` | `stable_id?`, `timestamp`, `reason?` | Entry moved to archive subtree (still discoverable via id, hidden from default selection). |
| `knowledge_archive_attempted` | `stable_id?`, `timestamp`, `reason?` | Archive attempt that failed pre-conditions (e.g. dependent entries still active). |
| `knowledge_deferred` | `stable_id?`, `timestamp`, `reason?`, `until?` (ISO) | Pending entry put on hold until `until`; expiry detected by `fabric doctor`. |
| `knowledge_rejected` | `stable_id?`, `timestamp`, `reason` (required) | Pending entry rejected; counter NOT incremented (Q2 late-bind). |

Payload contract is intentionally minimal: this guarantees the ledger
discriminated union compiles today while allowing rc.2/3 emit-sites to widen
each schema additively without breaking existing consumers.

---

## Stable ID Format

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

Source of truth: `StableIdSchema` and `formatKnowledgeId` /
`parseKnowledgeId` in `packages/shared/src/schemas/api-contracts.ts`.

Examples:
- `KT-DEC-0001` — first team decision
- `KP-MOD-0003` — third personal model
- `KT-GLD-0012` — twelfth team guideline

Properties:
- **Path-decoupled**: the id is stored in frontmatter and in
  `agents.meta.json`. Moving a file between subdirectories does NOT change
  its id. The on-disk filename pattern is `<id>--<slug>.md` (Q1 LOCKED) —
  e.g. `KT-DEC-0001--boundary-b-async-review.md`.
- **Layer-flip is the only legal mutation**: a `KP-*` id may be promoted to
  `KT-*` (and vice versa) via `fab_review/modify.changes.layer`. All other
  parts of the id are immutable.
- **Monotonic**: counters only increment. Deleting an entry does NOT free its
  counter slot — historical ids remain unique forever. Layer-flip does NOT
  decrement the source-layer counter.

---

## Counters Envelope

Source of truth: `AgentsMetaCountersSchema` in
`packages/shared/src/schemas/agents-meta.ts`.

Stored under the `counters` key of each meta file:

```json
{
  "counters": {
    "KP": { "MOD": 0, "DEC": 0, "GLD": 0, "PIT": 0, "PRO": 0 },
    "KT": { "MOD": 3, "DEC": 8, "GLD": 1, "PIT": 0, "PRO": 2 }
  }
}
```

Rules:
- Each sub-key tracks the highest counter ever issued for that
  `(scope, type)` pair within its meta file.
- **Never decrement** — counter values are monotonically non-decreasing.
- **Layer-flip does NOT decrement** the source layer's counter. A
  `KP-DEC-0005` flipped to team layer becomes a fresh `KT-DEC-NNNN`
  allocation against the team counter; the personal counter retains the
  `0005` slot as historically used.
- After deletion: the slot value stays at its last-issued value; the next
  allocation uses `slot + 1`.
- `allocateKnowledgeId(layer, type, counters)` returns the next id and a new
  counters object with the relevant slot incremented by 1.
- Both roots (`KP` and `KT`) are always present; slots default to `0` when
  the `counters` key is absent (backward compat with v1.x meta files).

---

## Meta Revision Formula

Every meta file (`agents.meta.json`) carries a top-level `revision` string
used for stale detection in MCP responses (`fab_plan_context.client_hash`,
`fab_get_rule_sections.stale`).

```
revision = sha256(sorted(stable_id + ":" + frontmatter_hash))
```

Where:
- `stable_id` is each entry's id from frontmatter.
- `frontmatter_hash` is `sha256` of the canonicalized frontmatter (sorted
  keys, scalar normalization).
- The pairs are joined `id:hash`, sorted lexicographically, then the joined
  list is hashed.

When the revision is recomputed:
- Any frontmatter change to any entry (id, type, maturity, layer,
  layer_reason, created_at, tags).
- Any add or remove of an entry.
- NOT recomputed on writes to `pending/<type>/<slug>.md` — pending entries
  are excluded from the meta surface (Q2 LOCKED).

Drift detection (Q5 LOCKED): a separate id-set + frontmatter-key match
serves as the actual drift signal; `revision` is the cheap cache key for
client-side stale detection.

---

## Naming Guidelines

The on-disk filename is `<id>--<slug>.md` (double-dash separator). The
`<id>` half is mechanical (counter-allocated). The `<slug>` half is
LLM-proposed and constrained by 5 rules (Q1 LOCKED — these rules are
enforced by the `fabric-archive` Skill, not by MCP):

1. **kebab-case** — lowercase ASCII letters, digits, and `-` only. No
   uppercase, no underscores, no spaces.
2. **2 to 5 words** — too short loses semantic specificity; too long
   bloats the filename.
3. **20 to 40 characters total** — bounded for `ls` readability.
4. **Semantic core** — verb-or-noun phrase that captures the entry's
   subject. Avoid filler words ("note", "thoughts", "stuff").
5. **Unique within (type, layer)** — two entries with the same type and
   layer must not share a slug. The Skill checks this before proposing.

Filename pattern examples:
- `KT-DEC-0001--boundary-b-async-review.md`
- `KP-PIT-0007--watcher-debounce-thrash.md`
- `KT-GLD-0003--zod-strict-payload-shape.md`

Layer-flip = `git mv KT-...--slug.md → KP-...--slug.md` (slug stable).
Slug rename = `git mv <id>--old-slug.md → <id>--new-slug.md` + emit
`knowledge_slug_renamed`.

---

## Language Policy

Source of truth: `fabricLanguageSchema` in
`packages/shared/src/schemas/fabric-config.ts` (rc.12 hard rename from
`knowledgeLanguageSchema`).

The **M3 style** (Q3 LOCKED) governs knowledge entry content:

- **Frontmatter fields/values**: EN (protocol — never localized).
- **Section markers** (`[MISSION_STATEMENT]`, `[MANDATORY_INJECTION]`,
  `[BUSINESS_LOGIC_CHUNKS]`, `[CONTEXT_INFO]`): EN (LLM anchors).
- **H1 / H2 headings**: EN (structural skeleton, grep/lint stable).
- **Body paragraphs**: zh-CN OR EN per `fabric_language` config.
- **Tech terms** in body (TypeScript, Zod, MCP, etc.): preserved EN.

Config field `fabric_language` (rc.12 hard rename from `knowledge_language`):

```
"match-existing"  (default)  → init-scan detects from existing entries' language;
                               empty repo defaults to "en".
"zh-CN"                      → explicit lock; init-scan templates and
                               fab_extract_knowledge body output in zh-CN.
"en"                         → explicit lock; everything English.
"zh-CN-hybrid"   (rc.12)     → Chinese narrative prose with English technical
                               terms preserved (MCP tool names, CLI commands,
                               file paths, Skill/Fabric protected tokens).
```

Surfaces that stay EN regardless of `fabric_language`:
- Fabric tool source code, CLI messages, error strings.
- `docs/` directory (OSS audience).
- Skill files (`SKILL.md` and prompt templates).

---

## Dual Meta-File Protocol

Q4 LOCKED. The team and personal layers each carry their own `agents.meta.json`
and counters envelope:

| Path | Scope | Counters |
|---|---|---|
| `<repo>/.fabric/agents.meta.json` | Team layer (KT entries) | `KT.MOD/DEC/GLD/PIT/PRO` advance independently |
| `~/.fabric/agents.meta.json` | Personal layer (KP entries) | `KP.MOD/DEC/GLD/PIT/PRO` advance independently |

Read path: `readAgentsMeta(projectRoot, homeDir)` reads both meta files and
merges into a single in-memory view. Writes go to the layer-appropriate file
(team writes touch repo meta; personal writes touch `~/.fabric/`).

Pending stage (Q2 LOCKED):
- Pending entries live under `pending/<type>/<slug>.md` (by-type
  subdirectories mirroring final layout).
- Pending frontmatter has **no `id` field** — only `type / maturity:draft /
  layer / created_at / source_session / tags`.
- `rule-meta-builder` skips the `pending/` subtree entirely; MCP
  `fab_plan_context` never returns pending entries.
- Counter increments only on `fab_review/approve` (late-bind). Rejected
  pending entries leave the counter untouched; deferred pending entries
  also leave the counter untouched until later approval.

The 5-step approve transaction (atomic — see `mcp-contracts.md` for the
`fab_review/approve` shape):

1. Allocate next counter for `(layer, type)` → new `stable_id`.
2. Inject `id`, finalize `created_at`, set `maturity: verified` in
   frontmatter.
3. `git mv pending/<type>/<slug>.md → <type>/<id>--<slug>.md`.
4. Rebuild meta (recompute `revision`, persist new counters).
5. Append `knowledge_promote_started` + `knowledge_promoted` (or
   `knowledge_promote_failed`) to `events.jsonl`.

A failure between steps 3 and 4 yields an orphaned counter; doctor's 7th
lint check (`orphaned counter`, rc.4) reports these for manual recovery.

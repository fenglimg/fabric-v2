# Fabric v2.0 MCP Contracts

API surface specification for the six MCP tools exposed by the Fabric v2.2
server. Updated in lock-step with `packages/shared/src/schemas/api-contracts.ts`.
Companion to [data-schema.md](./data-schema.md), which specifies the on-disk
shapes that these tools read and write.

This document covers what is **invoked** (tool I/O, error shapes, idempotency).
For the persisted shapes themselves (frontmatter, events, counters), see
`data-schema.md`.

---

## MCP Tool Contracts

Six tools form the current MCP surface:

| Tool | Maturity | Purpose |
|---|---|---|
| `fab_recall` | rc.37 | Preferred one-call recall: fetch relevant knowledge bodies for paths/intent. |
| `fab_plan_context` | rc.1 (extended in rc.2) | Build neutral knowledge-selection context for a path set. |
| `fab_get_knowledge_sections` | rc.23 rename / body contract | Fetch full markdown bodies for selected knowledge entries. |
| `fab_extract_knowledge` | rc.2 (schema pre-locked) | Persist a pending knowledge entry from a session. |
| `fab_archive_scan` | rc.37 | Scan recent work/session history for archive-worthy candidates. |
| `fab_review` | rc.3 (schema pre-locked) | Human review loop: list / approve / reject / modify / search / defer. |

All input/output shapes below are derived from the canonical Zod schemas in
`packages/shared/src/schemas/api-contracts.ts`. See
[data-schema.md](./data-schema.md) for field semantics on `stable_id`,
frontmatter, counters, and event types referenced here.

### `fab_plan_context`

Read-only, idempotent. Returns ranked candidate descriptions for the supplied
candidate paths and a `selection_token` for the two-step retrieval path.

Input (`planContextInputSchema`):

```ts
z.object({
  paths: z.array(z.string()).min(1),
  intent: z.string().optional(),
  known_tech: z.array(z.string()).optional(),
  detected_entities: z.record(z.array(z.string())).optional(),
  client_hash: z.string().optional(),
  correlation_id: z.string().optional(),
  session_id: z.string().optional(),
  include_deprecated: z.boolean().optional(),
  // v2/rc.2 (Q6 LOCKED): client-supplied layer scope.
  // When omitted, falls back to fabric-config.default_layer_filter (TASK-002).
  layer_filter: z.enum(["team", "personal", "both"]).optional(),
});
```

Output (`planContextOutputSchema`) — abridged:

```ts
z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  selection_token: z.string(),
  entries: z.array(z.object({
    path: z.string(),
    requirement_profile: /* requirement profile shape */,
    description_index: z.array(_descriptionIndexItemSchema),
    required_stable_ids: z.array(z.string()),
    ai_selectable_stable_ids: z.array(z.string()),
    initial_selected_stable_ids: z.array(z.string()),
    selection_policy: /* policy shape */,
  })),
  shared: z.object({ /* shared index + preflight diagnostics */ }),
  warnings: z.array(structuredWarningSchema).optional(),
});
```

Where each `description_index` item exposes the v2 surface (see
[data-schema.md frontmatter](./data-schema.md#frontmatter-7-fields) for field
semantics):

```ts
z.object({
  stable_id: z.string(),
  level: z.enum(["L0", "L1", "L2"]),
  required: z.boolean(),
  selectable: z.boolean(),
  description: _ruleDescriptionSchema,
  // v2.0: top-level mirrors of frontmatter for client-side filtering.
  type: _knowledgeTypeEnum.optional(),
  maturity: _maturityEnum.optional(),
  layer: _layerEnum.optional(),
  layer_reason: z.string().optional(),
  // v2/rc.2 (Q6 LOCKED): tags exposed at API surface.
  tags: z.array(z.string()).optional(),
});
```

Errors:
- Invalid `paths[]` (empty, non-string) → Zod validation error.
- Unknown `layer_filter` value → Zod validation error.

Idempotency:
- Pure read; safe to retry. `revision_hash` lets clients short-circuit when
  unchanged. `selection_token` is a one-shot handle for a subsequent
  `fab_get_knowledge_sections` call but is itself stable for identical inputs at
  identical revisions.

Emits: `knowledge_context_planned` event.

### `fab_recall`

Read-only, idempotent. Preferred runtime entry point for agents. It collapses
the common `fab_plan_context` -> `fab_get_knowledge_sections` ceremony into one
call while still returning a reusable `selection_token`.

Input (`recallInputSchema`) — abridged:

```ts
z.object({
  paths: z.array(z.string()).min(1),
  intent: z.string().optional(),
  ids: z.array(z.string()).optional(),
  layer_filter: z.enum(["team", "personal", "both"]).optional(),
  session_id: z.string().optional(),
  correlation_id: z.string().optional(),
});
```

Output (`recallOutputSchema`) — abridged:

```ts
z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  selection_token: z.string(),
  rules: z.array(z.object({
    stable_id: z.string(),
    path: z.string(),
    body: z.string(),
  })),
  warnings: z.array(structuredWarningSchema).optional(),
});
```

Emits the same planning/selection/consumption telemetry as the two-step path.

### `fab_get_knowledge_sections`

Read-only, idempotent. Materializes full markdown bodies for AI-selected
knowledge entries.

Input (`knowledgeSectionsInputSchema`):

```ts
z.object({
  selection_token: z.string().min(1),
  ai_selected_stable_ids: z.array(z.string()),
  ai_selection_reasons: z.record(z.string().min(1)).optional().default({}),
  correlation_id: z.string().optional(),
  session_id: z.string().optional(),
  client_hash: z.string().optional(),
});
```

Output (`knowledgeSectionsOutputSchema`) — abridged:

```ts
z.object({
  revision_hash: z.string(),
  selected_stable_ids: z.array(z.string()),
  rules: z.array(z.object({
    stable_id: z.string(),
    level: z.enum(["L0", "L1", "L2"]),
    path: z.string(),
    body: z.string(),
  })),
  diagnostics: z.array(/* discriminated union of diagnostic codes */),
  redirect_to: z.record(z.string(), z.string()).optional(),
  warnings: z.array(structuredWarningSchema).optional(),
});
```

Errors and diagnostics:
- `missing_knowledge_metadata` (warn) — pre-v2 entry without
  `knowledge_type`/`knowledge_layer`. Does not block selection.
- `redirect_to` — populated when a layer-flip changed an entry's canonical id
  since the caller's `selection_token` was minted. Clients should retry against
  the mapped new id. See
  [data-schema.md stable_id](./data-schema.md#stable-id-format) for why
  layer-flip changes the id prefix.
- ENOENT on disk → server performs ONE meta-rebuild retry, then returns the
  diagnostic to the client (Q6.e LOCKED `e3` policy).

Idempotency:
- Pure read; safe to retry. `redirect_to` makes layer-flip self-healing for
  agents that catch it and re-resolve.

Emits: `knowledge_sections_fetched` event.

### `fab_archive_scan`

Read-only, idempotent. Scans recent session/work history and returns
archive-worthy candidates for a Skill to judge before calling
`fab_extract_knowledge`.

Input (`archiveScanInputSchema`) accepts optional range/session filters.
Output (`archiveScanOutputSchema`) returns candidate summaries and warnings.

### `fab_extract_knowledge` (rc.2)

Semi-thick input (Q7.a LOCKED `a2`). The Skill summarizes session context;
the MCP server persists a pending knowledge entry under
`<repo>/.fabric/knowledge/pending/<type>/<slug>.md`. Schema pre-locked in
TASK-003; emit-site implementation lands in rc.2.

Input (`FabExtractKnowledgeInputSchema`):

```ts
z.object({
  source_session: z.string(),
  recent_paths: z.array(z.string()),
  user_messages_summary: z.string(),
  type: z.enum(["decisions", "pitfalls", "guidelines", "models", "processes"]),
  slug: z.string(),
});
```

Output (`FabExtractKnowledgeOutputSchema`):

```ts
z.object({
  pending_path: z.string(),
  idempotency_key: z.string(),
});
```

Field semantics:
- `type` uses **plural form** (mirrors directory layout under
  `.fabric/knowledge/<type>/`). Maps to singular for frontmatter `type`
  field — see [data-schema.md frontmatter](./data-schema.md#frontmatter-7-fields).
- `slug` follows the 5 naming rules in
  [data-schema.md naming guidelines](./data-schema.md#naming-guidelines).
  Server may sanitize; if sanitization changes the slug, the
  `idempotency_key` is computed against the SANITIZED slug.
- `pending_path` is workspace-relative (`<repo>/.fabric/knowledge/pending/<type>/<slug>.md`).

Errors:
- `slug` violates the 5 naming rules → Zod-level + server-side sanitization
  rejection.
- `type` not in the plural enum → Zod validation error.

Idempotency (Q7.b LOCKED `b3+b4` hybrid):
- `idempotency_key` derived from `(source_session, type, slug)`.
- Replay with identical inputs → identical `idempotency_key` → server
  detects existing pending entry and **appends evidence** rather than
  creating a duplicate.
- Different `slug` for same `(source_session, type)` → new pending entry.

Emits: `knowledge_proposed` event.

### `fab_review` (rc.3)

Discriminated union over a fixed `action` field. Six actions exhaustively
cover the human review loop. Schema pre-locked in TASK-003; emit-site
implementation lands in rc.3.

Input (`FabReviewInputSchema`):

```ts
z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    filters: _fabReviewFiltersSchema,
  }),
  z.object({
    action: z.literal("approve"),
    pending_paths: z.array(z.string()).min(1),
  }),
  z.object({
    action: z.literal("reject"),
    pending_paths: z.array(z.string()).min(1),
    reason: z.string().min(1),
  }),
  z.object({
    action: z.literal("modify"),
    pending_path: z.string().min(1),
    changes: z.object({
      title: z.string().optional(),
      summary: z.string().optional(),
      // Writing layer here triggers a layer-flip.
      layer: z.enum(["team", "personal"]).optional(),
      maturity: z.enum(["draft", "verified", "proven"]).optional(),
      tags: z.array(z.string()).optional(),
    }),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().min(1),
    filters: _fabReviewFiltersSchema,
  }),
  z.object({
    action: z.literal("defer"),
    pending_paths: z.array(z.string()).min(1),
    until: z.string().datetime().optional(),
    reason: z.string().optional(),
  }),
]);
```

Output (`FabReviewOutputSchema`) — discriminated union mirroring `action`:

```ts
z.discriminatedUnion("action", [
  z.object({ action: z.literal("list"), items: z.array(_fabReviewListItemSchema) }),
  z.object({
    action: z.literal("approve"),
    approved: z.array(z.object({ pending_path: z.string(), stable_id: z.string() })),
  }),
  z.object({ action: z.literal("reject"), rejected: z.array(z.string()) }),
  z.object({
    action: z.literal("modify"),
    pending_path: z.string(),
    prior_stable_id: z.string().optional(),
    new_stable_id: z.string().optional(),
  }),
  z.object({ action: z.literal("search"), items: z.array(_fabReviewListItemSchema) }),
  z.object({ action: z.literal("defer"), deferred: z.array(z.string()) }),
]);
```

Per-action notes:
- **`list`** — pure read; filtered by `(type, layer, maturity, tags)`. No
  side effects.
- **`approve`** — atomic 5-step transaction (counter++, frontmatter
  finalize, `git mv`, meta rebuild, event append). See
  [data-schema.md dual-meta-file protocol](./data-schema.md#dual-meta-file-protocol).
  Late-bind id allocation. Emits `knowledge_promote_started` and one of
  `knowledge_promoted` / `knowledge_promote_failed`.
- **`reject`** — pending file deleted; counter NOT incremented. Emits
  `knowledge_rejected`.
- **`modify`** — frontmatter patch. If `changes.layer` differs from the
  current layer, the server runs a layer-flip (KP↔KT id swap) and returns
  `prior_stable_id` + `new_stable_id`. Emits `knowledge_layer_changed` (on
  layer change) or other relevant event types per field.
- **`search`** — same shape as `list` but free-text + filter combination;
  pure read.
- **`defer`** — pending entries marked deferred until `until`. Emits
  `knowledge_deferred`. Expiry detection runs as a `fabric doctor` lint check
  (Q7.d LOCKED — no proactive hook).

Errors:
- `pending_path` not under `pending/` → reject with explicit error.
- Concurrent approve race → second caller sees `knowledge_promote_failed`
  and counter increment is preserved (orphaned slot reported by doctor).
- `modify.changes.layer` to same layer → no-op (no event emitted).

Idempotency:
- `list` / `search` / `approve` (post-promotion) / `reject` (post-deletion)
  are naturally idempotent — re-invocation returns the current state.
- `modify` is NOT idempotent in the layer-flip path: a second flip undoes
  the first.
- `defer` is idempotent; re-deferring an already-deferred entry refreshes
  `until` only.

Emits: `knowledge_proposed` (chained from extract), `knowledge_promote_*`,
`knowledge_rejected`, `knowledge_layer_changed`, `knowledge_slug_renamed`,
`knowledge_demoted`, `knowledge_deferred`. See
[data-schema.md event types](./data-schema.md#event-types-26-total).

---

## Thin MCP / Thick Skill

Q7.e LOCKED design principle. The MCP server is a **deterministic CRUD
primitive**; the LLM lives in the Skill.

**Why MCP is thin**:
- Determinism. Every input shape produces the same persisted output —
  testable with golden fixtures, idempotent under retries.
- No LLM-orchestration concerns leak into the server: no API keys, no
  retry-with-backoff for provider rate limits, no billing, no provider
  abstraction. Servers are language-server-style infrastructure.
- Replayability. The event ledger plus the Zod-validated tool surface let
  any session be re-run from the events file alone.

**Why Skill is thick**:
- LLM judgment carries context that doesn't compress into a JSON request.
  Tag inference, slug naming, layer assignment — all benefit from reading
  the actual session, not from a typed parameter.
- Skills are per-client (Claude Code, Cursor, Codex CLI) and can evolve
  prompt strategies independently of the MCP server's wire contract.
- The Skill owns NAMING guidelines, language detection, type
  classification, semantic dedup. The MCP owns counter monotonicity, file
  writes, layer-flip transactions.

The split is enforced by the MCP schemas: every input field is a literal,
an enum, or a free-text string the server treats opaquely. The server
**never calls an LLM**.

---

## Skill ↔ MCP Responsibility Matrix

The matrix below documents which decision lives where. Rows in **Skill**
are LLM judgment calls; rows in **MCP** are deterministic primitives.

| Decision Type | Lives In | Why |
|---|---|---|
| Tag inference (which `tags[]` to attach) | Skill | Requires reading session context for keyword salience. |
| Counter increment (`stable_id` allocation) | MCP | Monotonicity is a load-bearing audit property; must be deterministic. |
| Idempotency dedup (replay detection) | MCP | Pure function of `(source_session, type, slug)` → key. |
| Slug naming choice | Skill | LLM applies the 5 naming rules with semantic awareness. |
| Layer assignment (initial — proposal) | Skill | LLM judges "is this team-shared or personal?" from session context. |
| Layer assignment (validation — KP/KT prefix matches dir) | MCP | Mechanical check against on-disk path. |
| Layer-flip mechanism (`modify.changes.layer`) | MCP | Atomic id-prefix swap, counter mgmt, event emission. |
| Defer expiry detection | MCP (doctor) | Time-based scan, runs deterministically. |
| Type classification (model / decision / guideline / pitfall / process) | Skill | LLM categorizes from content semantics. |
| Maturity transitions (draft → verified → proven) | Skill (proposes), MCP (persists) | Skill judges readiness; MCP persists the frontmatter change atomically. |
| Semantic dedup (is this the same idea as KT-DEC-0007?) | Skill | LLM compares prose; embedding-or-prompt-based. |
| Frontmatter assembly (final YAML block) | MCP | Mechanical serialization of validated fields. |
| Pending → promoted file move (`git mv`) | MCP | Single transactional step; no LLM involvement. |
| Layer-language detection (zh-CN vs EN body) | Skill | LLM scans existing entries; respects `fabric_language` config. |
| Drift reporting (id-set + frontmatter mismatch) | MCP | Pure comparison; runs in `rule-meta-builder` and `fabric doctor`. |
| Event payload composition (which fields to log) | MCP | Schema-driven; Skill never writes to `events.jsonl`. |

The matrix is the contract. Any rc.2/3 implementation that crosses these
lines (e.g. an MCP that calls an LLM, or a Skill that allocates a counter)
violates the v2.0 design and must be rejected at review time.

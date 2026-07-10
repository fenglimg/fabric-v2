import { z } from "zod";

import type { Locale } from "../i18n/types.js";
import { onboardSlotSchema } from "../onboard-slots.js";
import { SCOPE_COORDINATE_PATTERN, SCOPE_COORDINATE_HINT } from "./scope.js";

// ---------------------------------------------------------------------------
// Shared warning schema (R24 contract)
// ---------------------------------------------------------------------------

export const structuredWarningSchema = z.object({
  code: z.string(),
  file: z.string(),
  line: z.number().optional(),
  message: z.string().optional(),
  action_hint: z.string(),
});

// ---------------------------------------------------------------------------
// MCP tool contracts — plan-context
// ---------------------------------------------------------------------------

// v2.0 knowledge enums — declared here as schemas (not just types) so they can
// flow through plan-context output validation. Mirrors the canonical enums
// further down in this file (KnowledgeTypeSchema/MaturitySchema/LayerSchema).
//
// v2.0.0-rc.29 BUG-C1: Unified to PLURAL across the board (frontmatter, MCP I/O,
// filesystem layout, agents-meta, i18n cross-tab keys). Disk frontmatter has
// always been authored with plural (`type: decisions`); the previous singular
// schema rejected those entries silently (40/41 dropped → planner downgraded
// them to `selectable=false` → AI could not recall team knowledge). The dual
// vocabulary has been collapsed; conversion code in `review.ts` is now an
// identity. Legacy singular disk entries are normalized in
// `knowledge-meta-builder.ts:parseFrontmatter` (SINGULAR_TO_PLURAL).
//
// Canonical vocabulary:
//   ["models", "decisions", "guidelines", "pitfalls", "processes"]
// matching FS directory layout the MCP user navigates by and the disk
// frontmatter the existing corpus already uses.
const _knowledgeTypeEnum = z.enum(["models", "decisions", "guidelines", "pitfalls", "processes"]);
const _maturityEnum = z.enum(["draft", "verified", "proven"]);

const _ruleDescriptionSchema = z.object({
  summary: z.string(),
  // TASK-005 wire thinning: intent_clues dropped from recall wire (0 hook
  // consumers grep-verified). Selection signal is summary + must_read_if
  // (when distinct) + knowledge_type; intent_clues is preserved in the on-disk
  // .md frontmatter (KB source-of-truth) and reachable via read_path.
  intent_clues: z.array(z.string()).optional(),
  // wire-slim (payload): fab_recall projects a LEAN description (summary +
  // must_read_if + knowledge_type — the selection signal), leaving tech_stack/
  // impact/intent_clues to be Read on demand via read_path (KT-DEC-0026 lean
  // contract at the field level). So they are optional on the wire. plan-context
  // still returns them in full — zod keeps optional-present values, only ABSENT
  // is now allowed, so no plan-context consumer regresses.
  tech_stack: z.array(z.string()).optional(),
  impact: z.array(z.string()).optional(),
  // TASK-002 wire dedup: omitted when identical to `summary` (~40% of KB entries
  // — knowledge-meta-builder.ts:212/:248 `?? summary` fallback). Consumers may
  // fall back to `summary` when absent. KB source-of-truth (the .md frontmatter)
  // stays unchanged; this optionality is a WIRE-only projection.
  must_read_if: z.string().optional(),
  // v2.0: optional knowledge-entry fields. Absent for v1.x rules; present for
  // entries that declare frontmatter `id/type/maturity`. W4/Track1: the redundant
  // `knowledge_layer` field was removed — a candidate's layer is derived from its
  // stable_id prefix (KP-→personal, else team; KT-DEC-0004).
  id: z.string().optional(),
  knowledge_type: _knowledgeTypeEnum.optional(),
  maturity: _maturityEnum.optional(),
  created_at: z.string().optional(),
  // v2.0.0-rc.38 UX-3 (D-MCP fold ③): these three were previously carried ONLY
  // as top-level mirrors on the index item. With the mirrors removed,
  // `description` becomes their canonical (and only) home, so the schema must
  // validate them here. Optional + default-safe (tags/[]/broad) so legacy
  // entries without frontmatter still parse.
  tags: z.array(z.string()).optional(),
  relevance_scope: z.enum(["narrow", "broad"]).optional(),
  relevance_paths: z.array(z.string()).optional(),
  // v2.2 H2-related (W1-T7) — W1-REVIEW codex HIGH-2: the MCP-facing description
  // schema must also carry `related`, else zod strips the graph edges on output
  // validation and they never reach the client (MC1 include_related / fabric-
  // connect would see nothing). Mirrors the agents-meta ruleDescriptionSchema.
  related: z.array(z.string()).optional(),
  // v2.2 glossary aliases FIELD (C-001): mirrors agents.ts RuleDescription.
  // MUST be declared here or zod .strip() drops aliases on output validation
  // before plan-context feeds them into the BM25 body — long-tail alias terms
  // would never reach the lexical/vector index (KT-PIT-0018 zod-strip lesson).
  aliases: z.array(z.string()).optional(),
});

// v2.0.0-rc.38 UX-3 (D-MCP fold ③): collapsed to { stable_id, description }.
// The dead L0/L1/L2 ceremony scalars (level/required/selectable) and every
// top-level mirror of a `description.*` field (type/maturity/layer/
// layer_reason/relevance_scope/relevance_paths/tags) were removed — they were
// ~7 redundant keys per entry and read by no production consumer (the hint
// CLI already falls back to `description.*`). W4/Track1: the knowledge layer is
// no longer carried as a field at all — it is derived on demand from the
// stable_id prefix (KP-→personal, else team; KT-DEC-0004).
const _descriptionIndexItemSchema = z.object({
  stable_id: z.string(),
  description: _ruleDescriptionSchema,
  // recall dedupe marker: true when this candidate is ALSO injected in full at
  // SessionStart ("ALWAYS-ACTIVE RULES" = broad model/guideline). MUST be
  // declared here or zod .strip() drops it at the MCP boundary (KT-PIT-0005),
  // silently breaking the marker even though recall() sets it. Only ever true.
  always_active: z.boolean().optional(),
});

// v2.0-rc.5 A3 (TASK-007): Cocos-era profile inference retired.
// `inferred_domain` (UI/Gameplay/Asset hardcoded), `intent_tokens`
// (Chinese game-perf token list), and `impact_hints` (Performance regex)
// dropped from the requirement profile — they had zero applicability beyond
// the werewolf-stub-era game project.
// v2.0.0-rc.38 UX-3 (D-MCP fold ③): dropped `path_segments` (== target_path
// split on "/") and `extension` (== suffix of target_path) — both trivially
// derivable by any consumer, so shipping them per-entry was pure bloat. The
// remaining fields are input echoes kept for caller convenience.
// v2.2 payload de-dup: `user_intent` lifted OUT of the per-path profile to a
// single top-level `intent` echo on the response. It was a verbatim copy of the
// caller's intent in EVERY entry (N paths → N identical copies); per-path the
// profile now carries only fields that actually vary by path.
const _requirementProfileSchema = z.object({
  target_path: z.string(),
  known_tech: z.array(z.string()),
  detected_entities: z.array(z.string()),
});

// v2.0-rc.5 A1: `_selectionPolicySchema` retired with the L0/L1/L2 protocol.
// v2.0-rc.7 T9: `_candidateFullContentSchema` retired with the degenerate
// single-stage mode. See docs/decisions/rc5-a3-superseded.md.
export const planContextInputSchema = z.object({
  paths: z
    .array(z.string())
    .min(1)
    .describe("Candidate file paths to build neutral rule selection context for"),
  intent: z
    .string()
    .optional()
    .describe("User-stated requirement or implementation intent; used only to build a neutral requirement profile"),
  known_tech: z
    .array(z.string())
    .optional()
    .describe("Known technologies involved in the requirement profile"),
  detected_entities: z
    .record(z.array(z.string()))
    .optional()
    .describe("Optional path-keyed detected entities for the requirement profile"),
  client_hash: z
    .string()
    .optional()
    .describe("Revision hash from a prior fab_plan_context response; enables stale detection"),
  correlation_id: z
    .string()
    .optional()
    .describe("Optional caller-provided correlation id for Event Ledger records"),
  session_id: z
    .string()
    .optional()
    .describe(
      "Recommended: pass the current client session id (Claude Code: $session_id; Codex: corresponding identifier) — enables cross-session debt tracking in fabric doctor and accurate archive-hint cross-session count. Falls back gracefully if omitted.",
    ),
  // v2.0-rc.5 A3 (TASK-007): `include_deprecated` removed — it was a no-op
  // placeholder (MaturitySchema has no `deprecated` value). When the maturity
  // enum widens we re-introduce the flag as part of that protocol bump.
  // v2/rc.2 (Q6): client-supplied layer scope. When omitted, the server
  // falls back to fabric-config.default_layer_filter (TASK-002) so a single
  // workspace policy controls the default. Explicit values override.
  layer_filter: z
    .enum(["team", "personal", "both"])
    .optional()
    .describe(
      "Restrict description_index to the named layer. Default: fabric-config.default_layer_filter (TASK-002).",
    ),
  // v2.0-rc.5 C3 (TASK-012): explicit path context for `narrow` relevance
  // filtering. When omitted, the server falls back to `paths` so existing
  // callers see narrowing against the requested paths. When the resolved
  // list is empty, the narrow filter fails open (every narrow entry passes).
  target_paths: z
    .array(z.string())
    .optional()
    .describe(
      "Path context for narrow-scope relevance filtering. Defaults to `paths`; empty = no filter.",
    ),
});

// v2.0-rc.5 A3 (TASK-007): the L0/L1/L2 selection ceremony is fully retired.
// Per-entry `selection_policy / required_stable_ids / ai_selectable_stable_ids
// / initial_selected_stable_ids` are gone; the aggregate `required_stable_ids
// / ai_selectable_stable_ids` on `shared` are gone too (token state still
// tracks selectable ids internally for the two-stage path).
//
// v2.0-rc.7 T9: the response shape is now symmetric across all candidate
// counts. `selection_token` is REQUIRED on every successful response and the
// Agent must follow up with `fab_get_knowledge_sections` to load bodies (that
// tool emits the `knowledge_consumed` event needed for rc.5 C5 closure). The
// inline `candidates_full_content` degenerate-mode field is gone. See
// docs/decisions/rc5-a3-superseded.md. The per-entry `.passthrough()` escape
// from TASK-005 is removed — entries now have a fixed shape.
// v2.0.0-rc.38 UX-1 (D-MCP fold ①): `entries[].description_index` is gone.
// Since rc.37 A1 removed server-side relevance filtering every per-path index
// was a byte-for-byte copy of the shared index — N paths shipped N+1 copies of
// the same candidate list. The candidate index is now a single top-level
// `candidates` array (was `shared.description_index`) and `entries` carries
// only the per-path requirement profile. `preflight_diagnostics` is lifted to
// the top level (the `shared` wrapper held nothing else).
const _preflightDiagnosticSchema = z.object({
  // v2.0.0-rc.38 UX-2: `empty_shell_suppressed` surfaces draft entries whose
  // description carries no selection signal (summary === stable_id + empty
  // intent_clues/tech_stack/impact). They are filtered out of `candidates` to
  // cut noise; this diagnostic names them so `fabric doctor` /
  // --enrich-descriptions can prompt enrichment.
  code: z.enum(["missing_description", "empty_shell_suppressed"]),
  severity: z.literal("warn"),
  message: z.string(),
  stable_ids: z.array(z.string()).optional(),
  path: z.string().optional(),
});

// K6 (W3-K): shared {key,reason} omission convention — the archive-scan
// dropped[] (archiveScanOutputSchema, further down) uses {session_id,reason};
// recall/plan-context dropped[] uses {id,reason}. Both report WHAT was dropped +
// WHY (a controlled reason enum) instead of a bare count, so the LLM sees which
// entries were omitted and can act on it. The recall reasons are the two
// truncation cuts the retrieval pipeline applies: `retrieval_budget` (top_k cap
// + ratio-to-top floor) and `payload_budget` (the MCP payload-byte trim).
// (Declared here — ahead of planContextOutputSchema/recallOutputSchema that
// consume it — rather than beside archiveScanOutputSchema: a `const` is not
// hoisted, so a later declaration would hit the temporal dead zone when these
// eagerly-evaluated z.object() schemas initialize at module load.)
const _recallDropReasonSchema = z.enum(["retrieval_budget", "payload_budget"]);

export const planContextOutputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  selection_token: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      requirement_profile: _requirementProfileSchema,
    }),
  ),
  // v2.2 payload de-dup: single top-level echo of the caller's `intent` (was
  // duplicated into every entry's requirement_profile). Omitted when no intent.
  intent: z.string().optional(),
  candidates: z.array(_descriptionIndexItemSchema),
  // v2.2 A-INFRA-3 (W1-T3-TOPK) / MC4-payload-budget (W1-T4) / K6 (W3-K):
  // structured list of lower-ranked candidates dropped by the unified truncation
  // chain, each tagged with WHY it was dropped (`retrieval_budget` = top_k cap +
  // ratio-to-top floor; `payload_budget` = MCP payload-byte trim). Present and
  // non-empty ONLY when truncation fired, so the steady-state wire shape is
  // unchanged. Replaces the bare numeric omission count so the LLM sees WHICH
  // candidates were dropped and can act ("these N exist; narrow your intent").
  // Reuses the archive-scan {key,reason} omission convention
  // (_recallDropReasonSchema, keyed on id here).
  dropped: z
    .array(z.object({ id: z.string(), reason: _recallDropReasonSchema }))
    .optional(),
  preflight_diagnostics: z.array(_preflightDiagnosticSchema),
  warnings: z.array(structuredWarningSchema).optional(),
  // v2.0.0-rc.22 Scope D T-D2: optional auto-heal banner fields. Surfaced
  // ONLY when the loadActiveMetaOrStale call detected drift and rebuilt the
  // meta in-place. Downstream CLI / hint renderers use this pair to render a
  // "knowledge meta auto-healed (was <prev>, now <curr>)" notice without
  // having to query the event ledger.
  auto_healed: z.boolean().optional(),
  previous_revision_hash: z.string().optional(),
  // v2.0.0-rc.37 NEW-24: stale-id redirect map. Populated when one or more
  // recent fab_review modify-layer flips reassigned a canonical stable_id
  // and the NEW id is in this response's description_index. Callers that
  // cached the OLD id from a prior session look it up here and substitute
  // the new id before issuing fab_get_knowledge_sections / fab_recall. Empty
  // (field omitted) when no actionable redirects exist for the surfaced
  // candidate set. See packages/server/src/services/id-redirect.ts.
  redirects: z.record(z.string()).optional(),
  // lifecycle-refactor W3-T2 (§7 图谱消费): related-expansion provenance map
  // (appended id → surfaced source id). Present only when `include_related` was
  // requested AND at least one in-corpus one-hop neighbour was appended. Omitted
  // on the graph-empty / steady-state path. Additive — declare it here or zod
  // strips it on output validation.
  related_appended: z.record(z.string()).optional(),
});

export const planContextAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Plan rule context",
} as const;

// ---------------------------------------------------------------------------
// CLI contract — `fabric plan-context-hint`
//
// Versioned, machine-readable output emitted by the rc.5 D1 CLI subcommand
// (TASK-004) and consumed by:
//   * rc.6 hooks (E1: SessionStart, E2: PreToolUse) which render a
//     human-readable summary from this payload, and
//   * the `fabric-import` Skill which uses it to default-broad pending
//     creation when no explicit `relevance_paths` are declared.
//
// `version` is bumped on any breaking shape change. Adding fields with a
// default-safe value is backward compatible and does NOT require a bump.
// ---------------------------------------------------------------------------

export const planContextHintNarrowEntrySchema = z.object({
  id: z.string(),
  type: z.string(),
  maturity: z.string(),
  summary: z.string(),
  // W2-2 (KT-DEC-0027): the entry's must_read_if trigger hook, forwarded for the
  // SessionStart REFERENCE rendering (decision/pitfall/process → title + hook).
  // Optional — omitted when the frontmatter declares none.
  must_read_if: z.string().optional(),
  // TASK-003 (impact-map MVP): the entry's impact list, forwarded so the narrow
  // PreToolUse hint can surface the consequences of ignoring this knowledge when
  // editing a matching relevance path. Optional — omitted when none declared.
  impact: z.array(z.string()).optional(),
});

export const planContextHintOutputSchema = z.object({
  version: z.literal(1),
  revision_hash: z.string(),
  target_paths: z.array(z.string()),
  narrow: z.array(planContextHintNarrowEntrySchema),
  broad_count: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// MCP tool contracts — knowledge-sections
//
// rc.23 TASK-002 F4: the legacy single-call `fab_get_rules` /
// `getKnowledgeInputSchema` / `getKnowledgeOutputSchema` / `getKnowledgeAnnotations`
// surface was removed. After the rc.5 two-step rewrite (`fab_plan_context` →
// `fab_get_knowledge_sections`) the single-shot tool became unreachable; its
// supporting `_knowledgeEntrySchema` / `_humanLockedSchema` /
// `_descriptionStubSchema` helpers and `fab_get_rules` describe references
// were dead weight that misled future maintainers.
// ---------------------------------------------------------------------------

// v2.0.0-rc.23 TASK-013 (F8b): the legacy 4-element KNOWLEDGE_SECTION_NAMES_TUPLE
// enum (MISSION_STATEMENT / MANDATORY_INJECTION / BUSINESS_LOGIC_CHUNKS /
// CONTEXT_INFO — the A-set `## [BRACKET]` heading discipline) was removed.
// After F8a deleted the scan baseline writers, the A-set has no writer; B-set
// `## <Title>` headings (Summary / Why proposed / Session context / Evidence
// from rc.7 fab_propose) are now the only convention. The `sections`
// input parameter on fab_get_knowledge_sections went with it — callers fetch
// the full markdown body keyed by stable_id (`rules[].body: string`) and the
// LLM scans/extracts what it needs.
export const knowledgeSectionsInputSchema = z.object({
  selection_token: z.string().min(1).describe("Selection token returned by fab_plan_context"),
  ai_selected_stable_ids: z
    .array(z.string())
    .describe(
      "Stable ids picked from fab_plan_context candidates[].stable_id; choose 1..N to fetch bodies for",
    ),
  ai_selection_reasons: z
    .record(z.string().min(1))
    .optional()
    .default({})
    .describe(
      "Optional reason for each AI-selected L1 stable_id (audit telemetry). Omit to fetch bodies without annotating — server defaults to {} rather than rejecting the documented two-step call.",
    ),
  correlation_id: z
    .string()
    .optional()
    .describe("Optional caller-provided correlation id for Event Ledger records"),
  session_id: z
    .string()
    .optional()
    .describe("Optional caller-provided session id for Event Ledger records"),
  // v2.0 rc.5 TASK-014 (C5): optional client identity hash propagated into
  // knowledge_consumed events. Falls back to empty string when unset — full
  // client-identity propagation deferred to rc.6.
  client_hash: z
    .string()
    .optional()
    .describe("Optional caller-provided client hash propagated into knowledge_consumed events"),
});

export const knowledgeSectionsOutputSchema = z.object({
  revision_hash: z.string(),
  // v2.0.0-rc.38 UX-13 (D-MCP step-2 audit): the deprecated `precedence`
  // L2/L1/L0 tuple (flagged "removed in rc.24" but still emitted) is gone — it
  // was a constant 3-string field on every response read by no production
  // consumer. v2.0.0-rc.38 Goal B: the dead L0/L1/L2 `level` axis was retired
  // too (dead-write — no consumer ordered by it).
  selected_stable_ids: z.array(z.string()),
  rules: z.array(
    z.object({
      stable_id: z.string(),
      path: z.string(),
      // v2.0.0-rc.23 TASK-013 (F8b): replaced the legacy
      // `sections: Record<string,string>` (keyed by the 4-element A-set enum)
      // with the full markdown body (frontmatter stripped). Callers scan the
      // body for whichever B-set heading they need (Summary / Why proposed /
      // Session context / Evidence) — section-name discipline is now a writer
      // convention, not an API contract.
      body: z.string(),
    }),
  ),
  diagnostics: z.array(
    // v2.0.0-rc.23 TASK-013 (F8b): `missing_section` was removed alongside the
    // A-set enum. `missing_knowledge_metadata` stays as the warn-level signal
    // for un-migrated v1.x entries (no knowledge_type in frontmatter). Does NOT
    // block selection.
    z.object({
      code: z.enum(["missing_knowledge_metadata", "unresolved_selected_id"]),
      severity: z.literal("warn"),
      stable_id: z.string(),
      message: z.string(),
    }),
  ),
  // v2/rc.3 (Q6) + v2.0.0-rc.37 NEW-24: present iff at least one stable_id in
  // the caller-supplied ai_selected_stable_ids was rewritten by the layer-flip
  // redirect resolver. Pre-rc.37: this was a single { stable_id } object set
  // only on the rare token-mint-vs-flip race. rc.37+: also accepts a map of
  // (old_id → new_id) when multiple rewrites fire in one fetch. Both shapes
  // are accepted for forward-compat; readers should branch on shape and
  // refresh their cached ids accordingly.
  redirect_to: z
    .union([
      z.object({ stable_id: z.string() }),
      z.record(z.string()),
    ])
    .optional()
    .describe(
      "Post-layer-flip redirect. Pre-rc.37: { stable_id } shape from rc.3 fab_review/modify. rc.37+: also accepts a (old_id → new_id) map for fab_get_knowledge_sections / fab_recall transparent rewrite.",
    ),
  warnings: z.array(structuredWarningSchema).optional(),
});

export const knowledgeSectionsAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Fetch knowledge entry bodies",
} as const;

// ---------------------------------------------------------------------------
// MCP tool contract — fab_recall (W1 / KT-DEC-0026: retrieval collapsed to ONE
// lean tool)
//
// `fab_recall(paths)` returns candidate DESCRIPTIONS + native READ PATHS only —
// it no longer delivers bodies. The agent reads the body on demand from `paths[]`
// (Read <store>/.../{type}/{id}--*.md), which the PostToolUse hook observes as
// `knowledge_body_read` (KT-DEC-0030). Rationale (KT-GLD-0005 cost-asymmetry): an
// eager body is a permanent per-recall context tax; a needed body is one cheap
// native Read away. The two-step (fab_plan_context → fab_get_knowledge_sections)
// MCP surface and the selection_token / body-tier packaging are retired
// (clean-slate, KT-DEC-0002).
// ---------------------------------------------------------------------------

export const recallInputSchema = z.object({
  paths: z
    .array(z.string())
    .min(1)
    .describe(
      "Candidate file paths to recall Fabric knowledge entries for. Same semantics as fab_plan_context.paths.",
    ),
  intent: z
    .string()
    .optional()
    .describe("User-stated requirement or implementation intent; used to build a neutral requirement profile."),
  known_tech: z
    .array(z.string())
    .optional()
    .describe("Known technologies involved."),
  detected_entities: z
    .record(z.array(z.string()))
    .optional()
    .describe("Optional path-keyed detected entities."),
  client_hash: z
    .string()
    .optional()
    .describe("Revision hash from a prior call; enables stale detection."),
  correlation_id: z
    .string()
    .optional()
    .describe("Optional caller-provided correlation id for Event Ledger records."),
  session_id: z
    .string()
    .optional()
    .describe(
      "Current client session id (Claude Code: $session_id; Codex: corresponding identifier). Enables cross-session debt tracking. Falls back gracefully if omitted.",
    ),
  layer_filter: z
    .enum(["team", "personal", "both"])
    .optional()
    .describe(
      "Restrict recall to the named layer. Default: fabric-config.default_layer_filter.",
    ),
  target_paths: z
    .array(z.string())
    .optional()
    .describe(
      "Path context for narrow-scope relevance filtering. Defaults to `paths`; empty = no filter.",
    ),
  ids: z
    .array(z.string())
    .optional()
    .describe(
      "Optional explicit stable_ids to SCOPE the returned read paths. When omitted, `paths` carries one read path per surfaced candidate. The candidate DESCRIPTION index is always returned in full for discovery — `ids` only narrows which read paths are surfaced (e.g. when you already know which entries to Read). Stale ids are redirect-rewritten before matching.",
    ),
  // W1-3 / KT-DEC-0031: graph expansion (surface related read paths, no body).
  include_related: z
    .boolean()
    .optional()
    .describe(
      "When true, also surface the one-hop `related` graph neighbours (of the surfaced entries) that are present in the candidate set — their descriptions and read paths, NOT their bodies.",
    ),
  // TASK-006 (KT-PIT-0036 observability opt-in): score_breakdown carries the
  // numbers-only signal decomposition (bm25/vector/salience/recency/locality/
  // proximity/credibility → final). Emitted per-entry ONLY when this flag is
  // true — the debug/tuning surface. Steady-state recall omits it to stay lean
  // (~4.8KB saved on a 24-entry sample). final===score invariant still enforced
  // at the plan-context service layer (candidate_scores Map) regardless.
  include_score_breakdown: z
    .boolean()
    .optional()
    .describe(
      "When true, populate `entry.score_breakdown` (numbers-only signal decomposition — bm25/vector/salience/recency/locality/proximity/credibility → final). Off by default for wire efficiency. Enable when debugging ranking or tuning scoring weights.",
    ),
});

// TASK-004 + Codex review F6: recall uses its OWN slim description schema
// (was: shared _ruleDescriptionSchema). Sharing let intent_clues / tech_stack /
// related / relevance_paths etc. remain schema-legal on the recall wire even
// after slimDescription() stopped emitting them — a KT-PIT-0018 zod .strip()
// footgun waiting to trip. This dedicated schema locks the projected contract.
// Fields correspond 1:1 to slimDescription() output (services/recall.ts) — keep
// them in sync when adding/removing wire-facing description fields.
const _recallEntryDescriptionSchema = z.object({
  summary: z.string(),
  // TASK-002: omitted when identical to summary (~40% dedup).
  must_read_if: z.string().optional(),
  // Semantic-preservation (PLN-002 F1 restored): knowledge-hint-narrow.cjs
  // consumes this for the "⚠️ 后果" narrow-hint line.
  impact: z.array(z.string()).optional(),
  // Semantic-preservation (PLN-002): cite-contract-reminder.cjs consumes it.
  knowledge_type: _knowledgeTypeEnum.optional(),
});

// ux-w2-4: the unified recall entry. Folds the former dual `candidates[]`
// (descriptions) × `paths[]` (read paths) — which the consumer had to JOIN on
// stable_id — into ONE self-contained item: description + where-to-Read +
// body-already-in-context flag. No join, no second array.
// TASK-004 wire thinning: `rank` (derivable from array index, 0 consumers) and
// `score` (redundant with score_breakdown.final by KT-PIT-0036 invariant) removed.
// `store: {alias}` flattened to `store_alias` (no extensibility signal was needed).
const _recallEntrySchema = z.object({
  stable_id: z.string(),
  // The projected DESCRIPTION (recall-specific slim contract, not the shared
  // frontmatter shape). Codex review F6: dedicated schema locks the wire contract.
  description: _recallEntryDescriptionSchema,
  // on-disk knowledge file to Read for the full body. Omitted when the entry has
  // no resolvable file (description-only discovery) or was scoped out by `ids`.
  read_path: z.string().optional(),
  // originating store alias (omitted for unqualified / single-store entries).
  store_alias: z.string().optional(),
  // true when this entry's body is ALSO injected at SessionStart (broad
  // model/guideline "ALWAYS-ACTIVE") — skip the Read, it is already in context.
  body_in_context: z.boolean().optional(),
  // P1 recall-observability: numbers-only decomposition of `score` into its
  // weighted signal contributions. NEVER carries body/description text — preserves
  // the lean read_path contract (KT-DEC-0019 / KT-GLD-0005). bm25_rank/vector_rank
  // are reserved for a later RRF wave (declared so the wire never strips them).
  score_breakdown: z
    .object({
      final: z.number(),
      bm25: z.number().optional(),
      bm25_rank: z.number().optional(),
      vector: z.number().optional(),
      vector_rank: z.number().optional(),
      salience: z.number(),
      recency: z.number(),
      locality: z.number(),
      // BORROW-008 proximity boost — MUST be declared or zod .strip() drops it at
      // the MCP boundary (KT-PIT-0005), desyncing wire `final` from its components.
      proximity: z.number(),
      // PLN-004 F1 credibility content-age decay MULTIPLIER factor — optional
      // (only present once the multiplier is wired). MUST be declared or zod
      // .strip() drops it at the MCP boundary (KT-PIT-0005).
      credibility: z.number().optional(),
    })
    .optional(),
});

export const recallOutputSchema = z.object({
  // Retained: client hook cache key (packages/cli/.claude/hooks/knowledge-hint-narrow.cjs)
  revision_hash: z.string(),
  // ux-w2-4: single unified entry list (was candidates[] + paths[] + per-path
  // requirement-profile entries[]). Each item carries description + read_path +
  // rank + body_in_context, so the agent never joins two arrays on stable_id.
  entries: z.array(_recallEntrySchema),
  // K6 (W3-K): structured list of lower-ranked candidates dropped by the
  // retrieval pipeline. dropped_ids preserves per-id transparency (KT-DEC-0028);
  // dropped_reasons hoists the reason to a top-level count map (68/68 same-reason
  // observation from ANL-002). Present ONLY when truncation fired.
  dropped_ids: z.array(z.string()).optional(),
  dropped_reasons: z
    .object({
      retrieval_budget: z.number().int().nonnegative().optional(),
      payload_budget: z.number().int().nonnegative().optional(),
    })
    .optional(),
  preflight_diagnostics: z.array(_preflightDiagnosticSchema).optional(),
  warnings: z.array(structuredWarningSchema).optional(),
  // Auto-heal banner pair (consumed by knowledge-hint-broad.cjs:711-729).
  auto_healed: z.boolean().optional(),
  previous_revision_hash: z.string().optional(),
  // v2.0.0-rc.37 NEW-24: parallel to planContextOutputSchema.redirects — stale
  // (pre layer-flip) ids in `ids` are redirect-rewritten before matching; the
  // surfaced map exposes the substitution so callers refresh cached state.
  redirects: z.record(z.string()).optional(),
  // lifecycle-refactor W3-T2 (§7 图谱消费): related-expansion provenance map
  // (appended id → surfaced source id). Present only when include_related
  // appended an in-corpus neighbour. Omitted on the steady-state path.
  related_appended: z.record(z.string()).optional(),
  next_steps: z.array(z.string()).optional(),
});

export const recallAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Recall Fabric knowledge (one-call)",
} as const;

// v2.0.0-rc.37 NEW-9: deterministic Phase 1 ledger scan for fabric-archive.
// Ports the error-prone LLM-side anchor-find + session forward-collect +
// outcome-ledger filter state machine (user_dismissed / cooldown /
// covered_through_ts high-value-signal) to the server. The Skill calls this,
// then loads digests for the returned session_ids + does semantic stitching
// (Boundary B: deterministic scan → MCP; semantic selection → LLM).
export const archiveScanInputSchema = z.object({
  range: z
    .union([z.array(z.string()).min(1), z.literal("all")])
    .optional()
    .describe(
      "Phase 0 scope: explicit session_id[] to constrain the scan, or the 'all' sentinel. Omitted = scan everything since the last knowledge_proposed anchor.",
    ),
  now_ms: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Override for the anti-loop cooldown clock (testing). Defaults to Date.now()."),
  correlation_id: z
    .string()
    .optional()
    .describe("Optional caller-provided correlation id for Event Ledger records."),
  session_id: z
    .string()
    .optional()
    .describe("Current client session id; recorded for cross-session debt tracking."),
});

export const archiveScanOutputSchema = z.object({
  // ts of the most recent knowledge_proposed event (the lower bound), or null
  // when the workspace has never archived (scan everything).
  anchor_ts: z.number().nullable(),
  // Distinct session_ids since the anchor that survived the outcome filter,
  // in first-seen order — ready for the Skill to load digests + stitch.
  session_ids: z.array(z.string()),
  // Sessions dropped by the filter, with the rule that fired (audit/debug).
  // Shares the {key,reason} omission convention with recall's dropped[] above
  // (keys on session_id here, on id in recall).
  dropped: z.array(
    z.object({
      session_id: z.string(),
      reason: z.enum(["user_dismissed", "cooldown", "no_new_signal"]),
    }),
  ),
  // max ts examined across the scan — becomes the next covered_through_ts.
  covered_through_ts: z.number().nullable(),
  // Idempotency keys already proposed by prior archive runs but not yet
  // reviewed (Phase 4.5 cross-session pending dedupe). Drop matching candidates.
  already_proposed_keys: z.array(z.string()),
  warnings: z.array(structuredWarningSchema).optional(),
});

export const archiveScanAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Scan event ledger for archive candidates (deterministic)",
} as const;
export type ArchiveScanInput = z.infer<typeof archiveScanInputSchema>;
export type ArchiveScanOutput = z.infer<typeof archiveScanOutputSchema>;

// ---------------------------------------------------------------------------
// MCP tool contracts — fab_propose (rc.2 protocol pre-lock)
//
// Semi-thick design: the Skill summarizes the user/session context, the MCP
// server persists a pending knowledge entry under the resolved write store's
// knowledge/pending/ tree. Project-local knowledge roots are retired.
// Schema lands now so consumers can target it; implementation arrives in rc.2.
// ---------------------------------------------------------------------------

// v2.0.0-rc.7 T6: enum of allowed `proposed_reason` values. The skill side
// MUST pick one — the value is greppable/lintable for future maturity-promotion
// scoring (deferred). The 1-line human descriptions live in
// PROPOSED_REASON_DESCRIPTIONS below and drive the `## Why proposed` body
// section that fab_propose writes.
export const ProposedReasonSchema = z.enum([
  "explicit-user-mark",
  "diagnostic-then-fix",
  "decision-confirmation",
  "wrong-turn-revert",
  "new-dependency-or-pattern",
  "dismissal-with-reason",
]);
export type ProposedReason = z.infer<typeof ProposedReasonSchema>;

// 1-line descriptions used to render `## Why proposed` in the pending body.
// Content-layer i18n: the pending body follows the unified language flow
// (`resolveGlobalLocale`), so the explanation must exist in both locales. The
// consumer (extract-knowledge.ts) selects the map by the resolved locale.
// Keep stable: changing strings here changes every newly-written pending file
// in that locale (byte-sensitive — see bootstrap byte-lock rationale).
const PROPOSED_REASON_DESCRIPTIONS_ZH: Record<ProposedReason, string> = {
  "explicit-user-mark": "用户显式标记需归档（always / never / 下次注意 等规范性语言）。",
  "diagnostic-then-fix": "诊断过程发现新模式或踩坑，修复后值得沉淀。",
  "decision-confirmation": "≥2 候选方案经权衡后确认选型，需保留 rationale。",
  "wrong-turn-revert": "尝试某路径后回退，错误路径本身是值得记录的 pitfall。",
  "new-dependency-or-pattern": "引入新依赖 / 新模式 / 新命名约定。",
  "dismissal-with-reason": "用户明确拒绝某方案并给出原因，原因即可归档知识。",
};

const PROPOSED_REASON_DESCRIPTIONS_EN: Record<ProposedReason, string> = {
  "explicit-user-mark":
    "User explicitly marked this for archival (normative language: always / never / next time, etc.).",
  "diagnostic-then-fix":
    "A new pattern or pitfall surfaced during diagnosis and is worth retaining after the fix.",
  "decision-confirmation":
    "A choice was confirmed after weighing ≥2 candidate approaches; the rationale must be preserved.",
  "wrong-turn-revert":
    "A path was tried then reverted; the wrong turn itself is a pitfall worth recording.",
  "new-dependency-or-pattern": "Introduces a new dependency / pattern / naming convention.",
  "dismissal-with-reason":
    "The user explicitly rejected an approach and gave a reason; the reason is archivable knowledge.",
};

// Locale-keyed map; extract-knowledge.ts picks via `resolveGlobalLocale()`.
export const PROPOSED_REASON_DESCRIPTIONS_BY_LOCALE: Record<
  Locale,
  Record<ProposedReason, string>
> = {
  "zh-CN": PROPOSED_REASON_DESCRIPTIONS_ZH,
  en: PROPOSED_REASON_DESCRIPTIONS_EN,
};

// v2.0.0-rc.7 T5: source_sessions[] is the canonical array form.
// v2.0.0-rc.23 TASK-003 (F5): the pre-T5 `source_session: string` alias and
// its preprocess shim were removed — the dual-field design had zero remaining
// users (fabric-archive / fabric-import / fabric-review skills all emit the
// array form). Schema now requires source_sessions: string[] directly.
const _sourceSessionsField = z.array(z.string().min(1)).min(1);

// Internal: base z.object schema. Kept separate from FabExtractKnowledgeInputSchema
// so MCP tool registration can use `.shape` (registerTool's inputSchema contract);
// the parse-facing export below adds the superRefine that enforces non-empty
// source_sessions when the field is omitted entirely.
const _FabExtractKnowledgeInputBaseSchema = z.object({
  // v2.0.0-rc.7 T5: array form. rc.23 dropped the legacy single-string alias.
  // v2.2 全砍 F13: REQUIRED in the base schema (was `.optional()`) so the MCP
  // tool's advertised inputSchema (registerTool reads `.shape`) matches the
  // requirement the superRefine enforces. Previously a caller reading the schema
  // saw it optional, omitted it, and got rejected at parse — a contract lie.
  source_sessions: _sourceSessionsField.describe(
    "Originating session ids (REQUIRED, non-empty array); correlates with Event Ledger records. Array form (T5+, rc.23 made it the sole accepted shape).",
  ),
  recent_paths: z
    .array(z.string())
    .describe("Workspace paths recently touched in the source session — used as scope hints"),
  user_messages_summary: z
    .string()
    .describe("Skill-side summary of the user's intent/messages, kept compact"),
  type: z
    .enum(["decisions", "pitfalls", "guidelines", "models", "processes"])
    .describe("Knowledge type bucket (plural form, mirrors directory layout)"),
  slug: z
    .string()
    .describe("URL-safe short identifier proposed by the Skill; server may sanitize"),
  // v2.2 C1 (W1) — author-facing scope is now TWO fields only: `audience` +
  // `paths`. Everything else (layer / visibility_store / relevance_scope /
  // store) is engine-derived, never author input (C1 §一.1). The physical write
  // store is the hard privacy boundary (cross-store-write R5#3); `audience` only
  // subdivides WHO within that boundary.
  //
  //   audience — the open scope coordinate describing WHO the entry is for
  //              (personal | team | project:x | org:y...). Replaces the old
  //              `layer` + `semantic_scope` pair: a `personal` coordinate routes
  //              to the personal store; everything else resolves via write_routes.
  //              Omit → engine defaults to project:<active> (bound repo) or team.
  audience: z
    .string()
    .regex(SCOPE_COORDINATE_PATTERN, { message: SCOPE_COORDINATE_HINT })
    .optional()
    .describe(
      "WHO this entry is for — an open scope coordinate (personal | team | project:x | org:y...). The sole author-facing audience field; the engine derives layer/visibility_store/store from it + the physical write store. Omit to default to project:<active> (bound repo) or team.",
    ),
  // v2.0.0-rc.7 T6: proposed_reason — required enum that drives `## Why
  // proposed` rendering. Skills (archive / import / review) infer the
  // appropriate reason per their semantics (see each SKILL.md).
  proposed_reason: ProposedReasonSchema.describe(
    "Why this entry is being proposed. Drives `## Why proposed` rendering and enables future maturity-promotion scoring.",
  ),
  // v2.0.0-rc.7 T6: session_context — required 3-5 line markdown blob that
  // captures the session goal + key turning point. Future-self review reads
  // this without conversation transcript access. Min length guards against
  // empty placeholders; cap is soft (no max), Skill caps at ~600 chars.
  session_context: z
    .string()
    .min(20, { message: "session_context must be ≥20 chars (3-5 lines describing goal + turning point)" })
    .describe(
      "3-5 line markdown blob — session goal + key turning point. Reviewed by future-self without transcript access.",
    ),
  // v2.0.0-rc.8 A1 (skill-contract-fix): relevance scope/paths on the
  // creation surface. Mirrors `_fabReviewModifyChangesSchema.relevance_*`
  // (L518-533) verbatim so callers can declare scope at archive time
  // instead of waiting for a fab_review.modify follow-up. Both fields are
  // optional — when omitted, the pending file omits the YAML lines entirely
  // (knowledge-meta-builder defaults to broad + [] at parse time, see
  // L1007-1021). Personal + narrow is silently degraded to broad + [] at
  // service entry, mirroring the rc.5 review.ts:725-739 behaviour, and emits
  // a `knowledge_scope_degraded` event keyed by `pending:<idempotency_key>`.
  // NOTE: these fields MUST NOT be part of the idempotency hash inputs at
  // extract-knowledge.ts:78 — preserves rc.5→rc.7 collision detection.
  //   paths — relevance anchors (workspace-relative globs/paths). The engine
  //           DERIVES relevance_scope from this field's presence: non-empty →
  //           narrow (surface only when an edit matches an anchor); empty/omitted
  //           → broad (always surface). This eliminates the old separate
  //           relevance_scope flag and its narrow+empty illegal state by
  //           construction (KT-MOD-0001). Glob syntax follows Copilot `applyTo`
  //           / Cursor `globs` (cross-client moat). Personal audience forces
  //           broad+[] (workspace-relative paths cross-project lose meaning).
  paths: z
    .array(z.string())
    .optional()
    .describe(
      "Relevance anchors (workspace-relative globs/paths). Non-empty → narrow (surface only on matching edits); empty/omitted → broad (always surface). The engine derives relevance_scope from this — there is no separate scope flag.",
    ),
  // v2.0.0-rc.23 TASK-006 (a-C1): four optional structured fields that the
  // skill-side LLM populates from raw observations. The same information
  // historically lived only in `## Session context` prose, forcing future-self
  // reviewers / plan-context retrievers to re-read the entire body to decide
  // relevance. Lifting them into structured frontmatter lets downstream
  // surfaces (description_index, scoring, relevance triage) consume them
  // directly. ALL FOUR ARE STRICTLY OPTIONAL — skills that cannot infer them
  // confidently must omit, not guess.
  //
  // IMPORTANT: these fields MUST NOT participate in the idempotency_key hash
  // (see rc.8 A1 convention at extract-knowledge.ts — relevance_scope /
  // relevance_paths follow the same rule). Including them would let an LLM
  // re-roll of the same observation create a second pending file just because
  // its inferred metadata wording drifted.
  intent_clues: z
    .array(z.string())
    .optional()
    .describe(
      "Short LLM-readable triggers describing when this rule should fire and when it should not. Each item ≤80 chars, imperative phrasing (e.g. 'when editing Cocos UI batch code', 'NOT for non-batch contexts'). Optional — omit when the skill cannot infer cleanly.",
    ),
  tech_stack: z
    .array(z.string())
    .optional()
    .describe(
      "Tech stack / languages / frameworks the rule applies to (e.g. ['typescript', 'cocos-creator', 'nodejs']). Inferred from recent_paths file extensions and manifest files. Optional — omit when the rule is stack-agnostic.",
    ),
  impact: z
    .array(z.string())
    .optional()
    .describe(
      "Consequences of ignoring this rule, used by the LLM to weight relevance vs cost. Each item ≤120 chars (e.g. 'O(n²) re-render on every frame', 'silent data loss on collision'). Optional — omit when impact is not observable.",
    ),
  must_read_if: z
    .string()
    .optional()
    .describe(
      "One-line strong trigger; when this condition holds the entry is considered required reading. Single line ≤160 chars (e.g. 'touching anything under packages/cli/src/commands/hooks.ts'). Optional — omit when no single strong trigger fits.",
    ),
  // v2.0.0-rc.37 NEW-37 (werewolf dogfood remediation): optional tags array.
  // Werewolf实测发现 100% canonical entries 的 `tags: []` 为空,主题聚类与
  // 跨条目检索退化。Skills (fabric-archive / fabric-import) 应每个 entry 产
  // 2-4 个 kebab-case 主题词。Server 写入时直接落 frontmatter `tags: [...]`;
  // empty array 仍然合法(skill 无法 confident 推断时显式空)。
  // IDEMPOTENCY: tags MUST NOT 参与 idempotency_key hash(同 relevance_*
  // / intent_clues 等可变字段一致),re-extract 时 tags 调整不应产生重复
  // pending file。
  tags: z
    .array(z.string())
    .optional()
    .describe(
      "Optional topic tags (2-4 kebab-case strings recommended). Drives cross-entry retrieval + topic clustering. Skill-inferred from session content; omit when not confidently inferable. Empty array allowed but discouraged (degrades narrow hint topic signal).",
    ),
  // v2.0.0-rc.23 TASK-014 (F8c): optional onboard-slot tag. The S5 slot
  // mechanism reintroduces a Skill-orchestrated "project tone" capture
  // surface after F8a deleted the auto-`fabric scan` baseline pipeline.
  // fabric-archive's first-run phase reads `fabric onboard-coverage` to
  // discover unclaimed slots, then propagates the chosen slot label here
  // so the resulting pending entry counts toward coverage.
  //
  // STRICT optionality: every non-onboard fab_propose call MUST
  // omit this field. The skill is the only producer; downstream consumers
  // (plan_context retrieval, doctor lints) treat missing as a steady-state
  // signal that the entry was NOT part of an onboard pass.
  //
  // IDEMPOTENCY: like the four a-C1 fields and the rc.8 A1 relevance pair,
  // `onboard_slot` MUST NOT participate in the idempotency_key hash at
  // extract-knowledge.ts:100-106. An LLM that re-rolls the same observation
  // with a different (or absent) slot must still collapse onto the same
  // pending file — otherwise the slot mechanic itself could spawn
  // duplicate entries.
  onboard_slot: onboardSlotSchema
    .optional()
    .describe(
      "Optional slot tag from the S5 onboarding set (tech-stack-decision / architecture-pattern / code-style-tone / build-system-idiom / domain-vocabulary); lets fabric-archive's first-run phase claim a project-tone slot. Skill propose-time only; never required.",
    ),
  // v2.0.0-rc.37 NEW-7: read-only evidence paths lifted from the legacy
  // body `## Evidence` markdown block into structured frontmatter. These are
  // paths the agent CONSULTED while building this knowledge but never
  // modified — they document context without participating in the
  // activation gate (relevance_paths does that). Splitting evidence into a
  // first-class frontmatter array lets future plan-context retrieval read
  // it as data (intersect with current paths to surface high-recall hits)
  // instead of re-parsing markdown. Optional; omit when no read-only
  // signal was captured. Like relevance_paths it MUST NOT participate in
  // the idempotency_key hash (an idempotent re-extract may surface a
  // slightly different read set without spawning a duplicate pending).
  evidence_paths: z
    .array(z.string())
    .optional()
    .describe(
      "Workspace-relative paths the agent CONSULTED (read but never modified) while building this knowledge. Documents context without affecting activation. Lifted from the legacy body ## Evidence markdown block into structured frontmatter so plan-context retrieval can read it as data.",
    ),
});

// Exported alias of the base shape — MCP tool registration uses `.shape` to
// derive registerTool's per-field schema map. We attach the superRefine
// downstream on the parse-facing schema.
export const FabExtractKnowledgeInputSchema = _FabExtractKnowledgeInputBaseSchema.superRefine(
  (value, ctx) => {
    // rc.23 TASK-003 (F5): source_sessions is the only accepted shape — require
    // a non-empty array. The legacy `source_session` single-string alias was
    // removed; callers that still emit it will fail Zod parsing at the unknown-
    // key boundary (or be silently dropped by the .object() default-strip).
    const hasArray = Array.isArray(value.source_sessions) && value.source_sessions.length > 0;
    if (!hasArray) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source_sessions (non-empty string array) is required",
        path: ["source_sessions"],
      });
    }
  },
);
// Sibling export so registerTool can pass `.shape` (ZodEffects has no .shape).
export const FabExtractKnowledgeInputShape = _FabExtractKnowledgeInputBaseSchema.shape;
export type FabExtractKnowledgeInput = z.infer<typeof FabExtractKnowledgeInputSchema>;

export const FabExtractKnowledgeOutputSchema = z.object({
  pending_path: z
    .string()
    .describe("Workspace-relative path to the persisted pending entry"),
  idempotency_key: z
    .string()
    .describe("Stable key derived from inputs; identical inputs yield identical key"),
  // v2.0.0-rc.23 TASK-009 (d): optional warnings surface for the first-reconcile
  // gate (`meta_stale` / `reconcile_failed`). Absent on the steady-state path.
  warnings: z.array(structuredWarningSchema).optional(),
});
export type FabExtractKnowledgeOutput = z.infer<typeof FabExtractKnowledgeOutputSchema>;

export const fabExtractKnowledgeAnnotations = {
  readOnlyHint: false,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Extract pending knowledge entry",
} as const;

// ---------------------------------------------------------------------------
// MCP tool contracts — fab_review (rc.3 protocol pre-lock) + fab_pending (W3-K K2)
//
// W3-K K2 (read/write split): the two READ actions (`list` + `search`) were
// lifted out of fab_review into a dedicated read-only tool `fab_pending`
// (readOnlyHint:true, idempotentHint:true). fab_review now carries ONLY the 6
// WRITE actions: approve, reject, modify, modify-content, modify-layer, defer.
// The filter + item shapes (_fabReviewFiltersSchema / _fabReviewListItemSchema /
// _fabReviewSearchItemSchema) stay SHARED between the two tools — fab_pending is
// a pure relocation of the read surface, ZERO behavior change. Consumers should
// `switch (input.action)` for type-narrowed handling on either tool.
// ---------------------------------------------------------------------------

const _fabReviewFiltersSchema = z
  .object({
    type: z.enum(["decisions", "pitfalls", "guidelines", "models", "processes"]).optional(),
    layer: z.enum(["team", "personal", "both"]).optional(),
    maturity: z.enum(["draft", "verified", "proven"]).optional(),
    tags: z.array(z.string()).optional(),
    // rc.4 TASK-006 fix (c): ISO-8601 lower bound on entry created_at; entries
    // strictly older than this threshold are excluded from list / search
    // results. Additive optional field — existing callers unaffected.
    created_after: z.string().datetime().optional(),
    // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): opt-in surfacing of lifecycle-filtered
    // entries. Default (omit both) hides rejected entries and deferred entries
    // whose deferred_until is in the future. Pass true to include them — e.g.
    // for vacuum tooling, audit dashboards, or "show me what I parked" UX.
    include_rejected: z.boolean().optional(),
    include_deferred: z.boolean().optional(),
    // v2.0.0-rc.27 TASK-006 (audit §2.23): opt-in body inspection. Default
    // list/search return only frontmatter-derived fields — a malicious
    // pending entry could hide a prompt-injection payload under `## Evidence`
    // body content that frontmatter inspection never surfaces. Setting
    // `include_body: true` attaches the full post-frontmatter content to
    // each item, and (for search) extends the haystack to body text. The
    // default-off design keeps the wire payload small for routine list
    // calls; reviewer workflows pass `true` before approving so the body
    // is rendered into the reviewer's UI for visual scan.
    include_body: z.boolean().optional(),
  })
  .optional();

const _fabReviewModifyChangesSchema = z.object({
  title: z.string().optional(),
  summary: z.string().optional(),
  // Q7: writing `layer` here triggers a layer-flip; downstream callers may
  // observe a redirect_to in fab_get_knowledge_sections if stable_id changes.
  layer: z.enum(["team", "personal"]).optional(),
  maturity: z.enum(["draft", "verified", "proven"]).optional(),
  tags: z.array(z.string()).optional(),
  // v2.0-rc.5 C3 (TASK-012): relevance scope/paths patches. Applied to
  // pending AND canonical entries. When an explicit team→personal layer flip
  // arrives on a narrow entry, the server auto-degrades to broad + [] and
  // emits a `knowledge_scope_degraded` event regardless of what the caller
  // sent in these fields (personal-implies-broad).
  relevance_scope: z.enum(["narrow", "broad"]).optional(),
  relevance_paths: z.array(z.string()).optional(),
  // v2.2 project-scope migration: re-scope an existing entry's resolution
  // coordinate (e.g. team → project:fabric-v2) WITHOUT moving stores
  // (scope ⊥ store, S42/A2). The in-place modify path keeps visibility_store
  // intact, so a team→project flip just relabels who recall surfaces it to
  // (G-FILTER, cross-store-recall.ts) — the entry stays physically in the
  // same shared store. A personal-root coordinate is rejected here: landing
  // an entry in the personal store is a store move, which is the dedicated
  // modify-layer path (R5#3 privacy boundary), never an in-place scalar edit.
  semantic_scope: z.string().regex(SCOPE_COORDINATE_PATTERN).optional(),
  // v2.2 graph edges (KT-DEC-0031 wiki seam): write the `related` H2 adjacency
  // (bare or store-qualified stable_ids this entry points at). REPLACE semantics
  // mirror tags/relevance_paths — the caller (fabric-connect) reads existing
  // edges via fab_recall and sends the merged set. Absent this field the modify
  // path silently dropped `related` via zod .strip() (KT-PIT-0005 recurrence),
  // leaving the only programmatic related-write path non-functional.
  related: z.array(z.string()).optional(),
  // rc.9 (2026-07-06): discovery-signal scalar patches — must_read_if triggers
  // Reference-type entry surfacing; intent_clues drives the AI's "should I Read
  // the body?" judgment; impact enumerates consequence prose surfaced in the
  // BM25F body slot. Before rc.9 these three fields were undeclared here, so
  // fab_review modify silently .strip()'d them (KT-PIT-0005 recurrence) and the
  // only path to fix a bad-shape must_read_if / missing intent_clues was direct
  // Edit — bypassing the skill audit trail. All three are REPLACE semantics
  // (mirror tags/related). must_read_if is a scalar string; intent_clues +
  // impact are flow-arrays.
  must_read_if: z.string().optional(),
  intent_clues: z.array(z.string()).optional(),
  impact: z.array(z.string()).optional(),
});

export const FabReviewInputSchema = z.discriminatedUnion("action", [
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
    changes: _fabReviewModifyChangesSchema,
  }),
  // v2.0.0-rc.37 NEW-12: explicit modify split. `modify-content` edits scalar
  // frontmatter/body fields (title/summary/maturity/tags/relevance_*) and MUST
  // NOT carry a layer change. `modify-layer` is the dedicated layer-flip path
  // (changes.layer REQUIRED) which may reallocate the stable_id + emit an
  // id-redirect (rc.37 NEW-24). Legacy `modify` stays for back-compat and
  // routes by whether changes.layer is present.
  z.object({
    action: z.literal("modify-content"),
    pending_path: z.string().min(1),
    changes: _fabReviewModifyChangesSchema,
  }),
  z.object({
    action: z.literal("modify-layer"),
    pending_path: z.string().min(1),
    changes: _fabReviewModifyChangesSchema.extend({
      layer: z.enum(["team", "personal"]),
    }),
  }),
  // v2.3 batch content-modify: array-native flush for the fabric-review maintain
  // loop. Each item is an INDEPENDENT content edit — unlike approve/reject/defer
  // (which share one reason/until over pending_paths[]), modify needs its OWN
  // changes per entry, so the shape is items[] not paths[]. Layer is stripped
  // per item (content-only; layer-flips stay on the single interactive
  // modify-layer path). Per-item failure is isolated: a bad item reports
  // {ok:false, error} in modified[] without aborting its siblings.
  z.object({
    action: z.literal("modify-content-batch"),
    items: z
      .array(
        z.object({
          pending_path: z.string().min(1),
          changes: _fabReviewModifyChangesSchema,
        }),
      )
      .min(1),
  }),
  z.object({
    action: z.literal("defer"),
    pending_paths: z.array(z.string()).min(1),
    until: z.string().datetime().optional(),
    reason: z.string().optional(),
  }),
  // retire (W3-C: fabric-review retire-mode landing surface). Semantically
  // deprecates one or more CANONICAL knowledge entries so they stop surfacing in
  // recall candidates / broad SessionStart indexes — WITHOUT deleting the file
  // (red line: deprecate-over-delete). The service writes `deprecated: true`
  // (+ `superseded_by: <id>` when the entry is replaced) into the entry's
  // frontmatter via the same in-place merge path modify uses; body + stable_id
  // are preserved so the "当时为什么这么决策" rationale stays inspectable.
  z.object({
    action: z.literal("retire"),
    // Canonical entry paths (store-absolute, from fab_pending list/search).
    pending_paths: z.array(z.string()).min(1),
    // Optional stable_id of the entry that supersedes these (bare `KT-DEC-0001`
    // or store-qualified `alias:KT-DEC-0001`). Written as `superseded_by`
    // frontmatter so the supersession chain is recoverable.
    superseded_by: z.string().optional(),
    // Optional human reason recorded on the knowledge_modified ledger event.
    reason: z.string().optional(),
  }),
]);
export type FabReviewInput = z.infer<typeof FabReviewInputSchema>;

// ---------------------------------------------------------------------------
// fab_pending (W3-K K2) — read-only browse/search surface lifted out of
// fab_review. Discriminated union over `action` with the two READ literals
// (list / search). Reuses the SAME _fabReviewFiltersSchema as the (now
// write-only) fab_review tool — pure relocation, ZERO behavior change.
// ---------------------------------------------------------------------------

export const FabPendingInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    filters: _fabReviewFiltersSchema,
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().min(1),
    filters: _fabReviewFiltersSchema,
  }),
]);
export type FabPendingInput = z.infer<typeof FabPendingInputSchema>;

// MCP SDK 1.29.0 surface: registerTool's `inputSchema` requires a flat
// ZodRawShape (z.object-friendly); passing FabPendingInputSchema (a
// discriminatedUnion) directly crashes the SDK with `_zod undefined` AND
// publishes JSON Schema with empty `properties: {}`. FabPendingInputShape
// mirrors the union of all branch fields with `action` as the required
// discriminator and every other field `.optional()`. Cross-field strictness
// (action=search requires query) is preserved at runtime by the handler
// narrowing through FabPendingInputSchema. Drift between this shape and the
// union branches is caught by a unit test in
// packages/server/src/tools/pending.test.ts.
export const FabPendingInputShape = {
  action: z
    .enum(["list", "search"])
    .describe(
      "Action selector. Discriminates the per-action fields below; required. list browses pending entries; search ranges over pending + canonical knowledge.",
    ),
  filters: _fabReviewFiltersSchema.describe(
    "Optional filters (type/layer/maturity/tags/created_after). Used by action=list and action=search.",
  ),
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Substring query against title/summary/tags/path. Required (non-empty) when action=search.",
    ),
} as const;

// MCP SDK 1.29.0 surface (TASK-001 fix): registerTool's `inputSchema` requires
// a flat ZodRawShape (z.object-friendly) so its internal `validateToolOutput`
// path can call `.safeParseAsync` on a per-field schema. Passing
// FabReviewInputSchema (a discriminatedUnion) directly crashes the SDK with
// `_zod undefined` AND publishes JSON Schema with empty `properties: {}`,
// breaking ToolSearch discoverability.
//
// FabReviewInputShape mirrors the union of all branch fields with `action` as
// the required discriminator and every other field `.optional()`. Cross-field
// strictness (e.g. action=approve requires pending_paths) is preserved at
// runtime by the handler narrowing through FabReviewInputSchema (the
// authoritative internal contract). Drift between this shape and the union
// branches is caught by a unit test in packages/server/src/tools/review.test.ts.
export const FabReviewInputShape = {
  action: z
    .enum([
      "approve",
      "reject",
      "modify",
      "modify-content",
      "modify-layer",
      "modify-content-batch",
      "defer",
      "retire",
    ])
    .describe(
      "Action selector. Discriminates the per-action fields below; required. modify-content edits scalars (no layer); modify-layer is the layer-flip path (changes.layer required); modify is the legacy combined alias; modify-content-batch flushes an array of independent content edits (items[]) in one call; retire marks canonical entries deprecated (deprecate-over-delete) so they stop surfacing. (list/search moved to the read-only fab_pending tool.)",
    ),
  pending_paths: z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      "Workspace-relative pending entry paths (or canonical entry paths for action=retire). Required when action=approve|reject|defer|retire (non-empty array).",
    ),
  pending_path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Workspace-relative pending OR canonical entry path. Required when action=modify.",
    ),
  reason: z
    .string()
    .optional()
    .describe(
      "Reason string. Required (non-empty) when action=reject; optional when action=defer.",
    ),
  changes: _fabReviewModifyChangesSchema.optional().describe(
    "Frontmatter scalar patches (title/summary/layer/maturity/tags/relevance_*/semantic_scope/related). Required when action=modify. semantic_scope re-scopes the entry's resolution coordinate in place (e.g. team → project:<id>) without moving stores; personal-root coordinates are rejected (use modify-layer).",
  ),
  items: z
    .array(
      z.object({
        pending_path: z.string().min(1),
        changes: _fabReviewModifyChangesSchema,
      }),
    )
    .min(1)
    .optional()
    .describe(
      "Batch of independent content edits — required (non-empty) when action=modify-content-batch. Each item {pending_path, changes} is applied content-only (layer stripped); per-item failures surface in modified[] without aborting siblings.",
    ),
  until: z
    .string()
    .datetime()
    .optional()
    .describe(
      "ISO-8601 datetime upper bound for the deferral. Optional; used only when action=defer.",
    ),
  superseded_by: z
    .string()
    .optional()
    .describe(
      "Stable_id (bare or store-qualified) of the entry that supersedes the retired one, written as `superseded_by` frontmatter. Optional; used only when action=retire.",
    ),
} as const;

// Per-action result shapes. Each variant mirrors its input action so the
// consumer can pair `(input.action, output.action)` without extra plumbing.
//
// v2.0.0-rc.29 TASK-007 (BUG-M4): list and search no longer share a single
// item schema. `_fabReviewListItemSchema` continues to describe pending-only
// entries returned by `action=list` (path semantics: `pending_path`). The new
// `_fabReviewSearchItemSchema` describes search results, which can be EITHER
// pending OR canonical — disambiguated by the required `area` discriminator
// and a neutrally-named `path` field. See FabReviewOutputSchema below for the
// per-action wiring.
const _fabReviewListItemSchema = z.object({
  pending_path: z.string(),
  // v2.0.0-rc.27 TASK-001 (§2.12): for personal-layer entries `pending_path`
  // carries the human-friendly `~/...` form (legacy contract) while
  // `pending_path_absolute` carries the os-expanded absolute path. Programmatic
  // consumers (Read tool, fs.readFile, downstream MCP servers) should prefer
  // the absolute variant — the `~` is a shell-only sigil that breaks every
  // non-shell consumer. Team entries omit this field because their
  // `pending_path` is already store-resolved and unambiguous.
  pending_path_absolute: z.string().optional(),
  type: z.enum(["decisions", "pitfalls", "guidelines", "models", "processes"]),
  layer: z.enum(["team", "personal"]),
  maturity: z.enum(["draft", "verified", "proven"]),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  // Store-only cutover: origin reflects the resolved store audience where the
  // pending file lives; layer reflects the declared classification that will
  // drive approval semantics.
  origin: z.enum(["team", "personal"]).optional(),
  // v2.0.0-rc.27 TASK-001 (§2.2/§2.3): frontmatter status markers. Default
  // "active" (or absent). `rejected` entries are excluded from list/search
  // unless filters.include_rejected=true; `deferred` entries are excluded
  // when deferred_until is in the future. Authored by reject/defer write
  // paths — never by extract or approve.
  status: z.enum(["active", "rejected", "deferred"]).optional(),
  deferred_until: z.string().datetime().optional(),
  // v2.0.0-rc.27 TASK-006 (audit §2.23): full body content (everything
  // after the closing `---` of frontmatter). Surfaced only when caller
  // passes `filters.include_body: true`. Default-omitted to keep payload
  // small for routine list calls.
  body: z.string().optional(),
});

// v2.0.0-rc.29 TASK-007 (BUG-M4): search-result item schema. Unlike list,
// search ranges over BOTH pending and canonical knowledge. `area` is the
// authoritative discriminator. `path` is the neutrally-named filesystem
// pointer (replaces the misleading `pending_path` for canonical hits); the
// optional `path_absolute` carries the os-expanded path for personal-layer
// entries (mirrors `_fabReviewListItemSchema.pending_path_absolute`). All
// other fields are the same as the list-item schema.
const _fabReviewSearchItemSchema = z.object({
  // Search hits live in one of two store trees:
  //  - "pending"   → mounted store `knowledge/pending/`
  //  - "canonical" → mounted store `knowledge/{decisions,pitfalls,...}`
  area: z.enum(["pending", "canonical"]),
  path: z.string(),
  path_absolute: z.string().optional(),
  type: z.enum(["decisions", "pitfalls", "guidelines", "models", "processes"]),
  layer: z.enum(["team", "personal"]),
  maturity: z.enum(["draft", "verified", "proven"]),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  origin: z.enum(["team", "personal"]).optional(),
  status: z.enum(["active", "rejected", "deferred"]).optional(),
  deferred_until: z.string().datetime().optional(),
  body: z.string().optional(),
  // For pending hits the upstream stable_id may still be unassigned — keep it
  // optional so canonical hits (which always have one) parse alongside pending
  // hits in the same array.
  stable_id: z.string().optional(),
});

// v2.0.0-rc.23 TASK-009 (d): every variant carries an optional `warnings`
// array so the first-reconcile gate can surface `meta_stale` / `reconcile_failed`
// regardless of which review action ran. Field stays absent on the
// steady-state path — no wire shape change for existing consumers.
export const FabReviewOutputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("approve"),
    approved: z.array(z.object({ pending_path: z.string(), stable_id: z.string() })),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
  z.object({
    action: z.literal("reject"),
    rejected: z.array(z.string()),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
  z.object({
    action: z.literal("modify"),
    pending_path: z.string(),
    // When a layer-flip occurred, prior_stable_id and new_stable_id differ.
    prior_stable_id: z.string().optional(),
    new_stable_id: z.string().optional(),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
  // v2.3 batch content-modify result: per-item {pending_path, ok, error?}. No
  // prior/new_stable_id — content edits strip layer, so no id reallocation can
  // occur. ok=false items carry the failure message; siblings still applied
  // (partial failure is reported per-item, never thrown for the whole batch).
  z.object({
    action: z.literal("modify-content-batch"),
    modified: z.array(
      z.object({
        pending_path: z.string(),
        ok: z.boolean(),
        error: z.string().optional(),
      }),
    ),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
  z.object({
    action: z.literal("defer"),
    deferred: z.array(z.string()),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
  z.object({
    action: z.literal("retire"),
    // Each retired canonical entry: its echoed path + (when the frontmatter
    // carried one) its stable_id, plus the superseded_by id when supplied. The
    // file is NOT deleted — only marked `deprecated: true` in place.
    retired: z.array(
      z.object({
        path: z.string(),
        stable_id: z.string().optional(),
        superseded_by: z.string().optional(),
      }),
    ),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
]);
export type FabReviewOutput = z.infer<typeof FabReviewOutputSchema>;

// fab_pending (W3-K K2) output union — the relocated list/search result shapes.
// list returns pending-only entries (`_fabReviewListItemSchema`, `pending_path`
// semantics); search ranges over pending + canonical (`_fabReviewSearchItemSchema`,
// `area` discriminator + neutrally-named `path`). Both item schemas stay SHARED
// with the (now write-only) fab_review surface.
export const FabPendingOutputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    items: z.array(_fabReviewListItemSchema),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
  z.object({
    action: z.literal("search"),
    items: z.array(_fabReviewSearchItemSchema),
    warnings: z.array(structuredWarningSchema).optional(),
  }),
]);
export type FabPendingOutput = z.infer<typeof FabPendingOutputSchema>;

// MCP SDK 1.29.0 surface: flat ZodRawShape for registerTool's `outputSchema`
// (mirrors FabReviewOutputShape rationale). Unions the list/search variant
// fields with `action` as the required discriminator; structuredContent is
// re-validated against FabPendingOutputSchema for per-action precision.
export const FabPendingOutputShape = {
  action: z
    .enum(["list", "search"])
    .describe(
      "Echoes the input action; clients can switch on it for per-variant fields below.",
    ),
  items: z
    .array(z.union([_fabReviewListItemSchema, _fabReviewSearchItemSchema]))
    .optional()
    .describe(
      "Pending entries (action=list, `pending_path` shape) or pending+canonical entries (action=search, `area`+`path` shape).",
    ),
  warnings: z.array(structuredWarningSchema).optional(),
} as const;

// MCP SDK 1.29.0 surface (TASK-001 fix): mirrors FabReviewInputShape rationale
// for the output side. registerTool's `outputSchema` consumer
// (validateToolOutput) requires a flat ZodRawShape; passing
// FabReviewOutputSchema (discriminatedUnion) yields the same `_zod undefined`
// crash + empty JSON Schema properties.
//
// FabReviewOutputShape unions all variant fields with `action` as the required
// discriminator and every variant-specific field `.optional()`. Output
// structuredContent is still validated against FabReviewOutputSchema in tests
// (and may be at runtime by callers) for full per-action precision.
export const FabReviewOutputShape = {
  action: z
    .enum(["approve", "reject", "modify", "modify-content-batch", "defer", "retire"])
    .describe(
      "Echoes the input action; clients can switch on it for per-variant fields below. (list/search results moved to the read-only fab_pending tool.)",
    ),
  approved: z
    .array(z.object({ pending_path: z.string(), stable_id: z.string() }))
    .optional()
    .describe(
      "Allocated stable ids paired with their original pending paths. Present when action=approve.",
    ),
  rejected: z
    .array(z.string())
    .optional()
    .describe(
      "Pending paths that were rejected (files retained on disk; doctor owns vacuum). Present when action=reject.",
    ),
  pending_path: z
    .string()
    .optional()
    .describe(
      "Echoed target path for the modification. Present when action=modify.",
    ),
  prior_stable_id: z
    .string()
    .optional()
    .describe(
      "Prior stable id. Present when action=modify AND a layer-flip reallocated the id.",
    ),
  new_stable_id: z
    .string()
    .optional()
    .describe(
      "New stable id after reallocation. Present when action=modify AND a layer-flip reallocated the id.",
    ),
  modified: z
    .array(
      z.object({
        pending_path: z.string(),
        ok: z.boolean(),
        error: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Per-item results for action=modify-content-batch: {pending_path, ok, error?}. ok=false items carry the error; siblings still applied.",
    ),
  deferred: z
    .array(z.string())
    .optional()
    .describe(
      "Pending paths that were deferred (files retained on disk). Present when action=defer.",
    ),
  retired: z
    .array(
      z.object({
        path: z.string(),
        stable_id: z.string().optional(),
        superseded_by: z.string().optional(),
      }),
    )
    .optional()
    .describe(
      "Canonical entries marked deprecated in place (files retained — deprecate-over-delete). Present when action=retire.",
    ),
  // v2.0.0-rc.23 TASK-009 (d): optional warnings surface for the first-reconcile
  // gate (`meta_stale` / `reconcile_failed`). Absent on the steady-state path.
  warnings: z.array(structuredWarningSchema).optional(),
} as const;

export const fabReviewAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
  title: "Review pending knowledge entries",
} as const;

// fab_pending (W3-K K2): the read-only browse/search surface. C-002 honest
// read tool — readOnlyHint:true + idempotentHint:true (mirrors recallAnnotations
// at the top of this file). list/search never mutate state.
export const fabPendingAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Browse and search pending knowledge entries",
} as const;

// ---------------------------------------------------------------------------
// CLI contract — `fabric doctor --cite-coverage`
//
// v2.0.0-rc.24 TASK-09: Zod schema mirroring the `CiteCoverageReport` runtime
// type that lives in `packages/server/src/services/doctor.ts` (TASK-08). The
// shape is intentionally duplicated here so the CLI renderer (TASK-10) can
// validate JSON output and downstream tooling can consume a single typed
// surface without taking a server-package import.
//
// Field-by-field equivalence with the doctor.ts type is enforced by the
// roundtrip tests in `packages/shared/test/api-contracts.test.ts`. If a field
// is added to the runtime type, both this schema and the i18n locales must be
// updated in lockstep.
// ---------------------------------------------------------------------------

// CiteContractMetrics — strict-bucket contract audit counters. All counters
// are turn-cite occurrences (not session-level). `skip_count` is open-keyed
// because skip-reason vocabulary is parser-author-controlled (see B1
// grill-me lock — operators data-drive vocabulary expansion).
export const citeContractMetricsSchema = z.object({
  decisions_cited: z.number().int().nonnegative(),
  pitfalls_cited: z.number().int().nonnegative(),
  contract_with: z.number().int().nonnegative(),
  contract_missing: z.number().int().nonnegative(),
  hard_violated: z.number().int().nonnegative(),
  cite_id_unresolved: z.number().int().nonnegative(),
  skip_count: z.record(z.string(), z.number().int().nonnegative()),
});
export type CiteContractMetrics = z.infer<typeof citeContractMetricsSchema>;

// CiteLayerTypeBreakdown — (layer × knowledge_type) cross-tab.
// Inner keys = the canonical PLURAL KnowledgeType enum literals
// ("decisions" / "pitfalls" / "models" / "guidelines" / "processes") plus
// "unresolved" for cite_ids not present in the idTypeMap. Inner record is
// open-keyed so a future type addition does not break the wire shape.
export const citeLayerTypeBreakdownSchema = z.object({
  team: z.record(z.string(), z.number().int().nonnegative()),
  personal: z.record(z.string(), z.number().int().nonnegative()),
});
export type CiteLayerTypeBreakdown = z.infer<typeof citeLayerTypeBreakdownSchema>;

// CiteCoverageReport — full payload returned by `runDoctorCiteCoverage`.
// rc.20 fields (status / marker_ts / marker_emitted_now / since_ts /
// client_filter / metrics / per_client / dismissed_reason_histogram /
// none_reason_histogram / generated_at) preserved verbatim. rc.24 additions
// (TASK-08): layer_filter, contract_metrics_status, contract_metrics,
// per_layer_type, contract_marker_ts.
export const citeCoverageReportSchema = z.object({
  status: z.enum(["ok", "skipped"]),
  marker_ts: z.number().int().nonnegative(),
  marker_emitted_now: z.boolean(),
  since_ts: z.number().int().nonnegative(),
  client_filter: z.enum(["cc", "codex", "all"]),
  // v2.0.0-rc.24 TASK-08: layer filter discriminator. Optional so pre-TASK-10
  // CLI callers (which never set the flag) still parse. Defaults to "all" at
  // the service layer.
  layer_filter: z.enum(["team", "personal", "all"]).optional(),
  metrics: z.object({
    edits_touched: z.number().int().nonnegative(),
    qualifying_cites: z.number().int().nonnegative(),
    recalled_unverified: z.number().int().nonnegative(),
    expected_but_missed: z.number().int().nonnegative(),
    total_turns: z.number().int().nonnegative(),
    // v2.0.0-rc.38 UX-8 (C, user-authorized): cite-policy COMPLIANCE rate —
    // the corrected G-CITE semantic. The legacy qualifying_cites/edits ratio
    // measured "how often an applicable KB id existed" (a function of corpus
    // density / soak), NOT "did the AI follow the cite policy". Compliance
    // credits every valid cite line — `KB: <id> [applied|dismissed]` AND
    // `KB: none [reason]` (the policy explicitly allows the none sentinel) —
    // over the turns where a cite was expected. null when no cite-expected
    // turns observed (avoids a misleading 0/0 → 0). Range [0,1].
    cite_compliance_rate: z.number().min(0).max(1).nullable().optional(),
    compliant_cites: z.number().int().nonnegative().optional(),
    noncompliant_cites: z.number().int().nonnegative().optional(),
    // Edit signals lacking session_id → uncorrelatable, silently excluded from
    // expected_but_missed. >0 typically means a stale pre-session_id hook is
    // installed (run `fabric install`). Surfaced so the denominator gap is
    // visible rather than a silent 100% confound.
    uncorrelatable_edits: z.number().int().nonnegative().optional(),
    // v2.1 ⑤ cite-redesign (P5): recall-based coverage口径. The redesign infers
    // a citation from real behavior — an in-session fab_recall
    // (knowledge_context_planned) whose target_paths overlap a subsequently
    // edited file IS the citation, no hand-written `KB:` line required.
    // recall_backed_edits = correlatable edits preceded (within the recall
    // window) by such an overlapping recall. recall_coverage_rate =
    // recall_backed_edits / edits_touched (null when no edits). Additive — the
    // legacy first-line-`KB:` metrics above are unchanged (back-compat).
    recall_backed_edits: z.number().int().nonnegative().optional(),
    recall_coverage_rate: z.number().min(0).max(1).nullable().optional(),
    // v2.2.0-rc.1 W1-T3 (cite 诚实拆分 / lifecycle §3): exposed_and_mutated is a
    // WEAK auxiliary signal — strictly SEPARATE from cite_compliance_rate (which
    // is the true explicit-adherence rate, currently ~2.5%). It MUST NOT be
    // merged into compliance: it estimates "a narrow PreToolUse-surfaced KB id
    // whose contract-specific glob was subsequently edited (mutated) in the same
    // session, and was not [dismissed] that round". It credits NOTHING toward the
    // real `KB:`-line compliance — it is an observational hint that surfaced
    // knowledge influenced an edit, surfaced ONLY as its own field so the renderer
    // can label it "weak signal, NOT counted toward true adherence". Three
    // conditions (all required): (1) id came from a `hook_surface_emitted` with
    // hook_name === "knowledge-hint-narrow"; (2) the id's contract glob is
    // SPECIFIC (excludes `**/*` wildcards and generic guideline-type entries);
    // (3) the id was not [dismissed] in the same session. `count` = number of
    // distinct (session_id, stable_id) pairs satisfying all three; `ids` =
    // sorted distinct stable_ids (capped, diagnostics only). Always >= 0; null/
    // absent on degraded/skipped reports.
    exposed_and_mutated: z
      .object({
        count: z.number().int().nonnegative(),
        ids: z.array(z.string()).optional(),
      })
      .optional(),
    // lifecycle-refactor W2-T4 (§5 row7 PostToolUse / §0 下沉 doctor): mutation
    // funnel rebuilt offline from the new `file_mutated` PostToolUse marker —
    // the权威 signal that a mutation actually completed (path + tool_call_id),
    // distinct from the PreToolUse `edit_intent_checked` EDIT-INTENT signal that
    // feeds `edits_touched`. mutations_observed.count = number of distinct
    // `file_mutated` events in window (per-call tool_call_id dedup guards the
    // PostToolUse parallel-fire race). Strictly ADDITIVE — never folded into
    // cite_compliance_rate (honesty 铁律, mirrors exposed_and_mutated). Absent on
    // degraded/skipped reports.
    mutations_observed: z
      .object({
        count: z.number().int().nonnegative(),
      })
      .optional(),
    // lifecycle-refactor W2-T4 (§5 row7 mutation_pool + downgrade): low-confidence
    // mutation attribution pool. A `file_mutated` event is `attributed` ONLY when
    // its `source_event_id` links back to a `hook_surface_emitted` (surfaced/cited
    // knowledge) in window — attribution key = store_id + stable_id +
    // source_event_id (distinct dedup so multi-store never double-counts). Every
    // other mutation (no source_event_id, or a source_event_id that does not
    // resolve to a surfaced event) downgrades to `unattributed_workspace_dirty`.
    // NOTE: this is the events.jsonl-only attribution. The §9 git-diff fallback
    // (升 fallback via session shell event + baseline) is a SPECULATIVE
    // implementation note — deliberately NOT run here (doctor stays read-only,
    // no git diff / no disk write). Additive; absent on degraded/skipped reports.
    mutation_pool: z
      .object({
        attributed: z.number().int().nonnegative(),
        unattributed_workspace_dirty: z.number().int().nonnegative(),
      })
      .optional(),
    // lifecycle-refactor W2-T4 (§5 row2 SessionEnd funnel 对账下沉 doctor): the
    // SessionEnd hook only O(1)-appends a `session_ended` marker; this counts the
    // distinct sessions that emitted one (funnel "closed" boundary). Purely an
    // observability marker — not joined into any rate. Additive.
    sessions_closed: z
      .object({
        count: z.number().int().nonnegative(),
      })
      .optional(),
  }),
  per_client: z
    .record(
      z.string(),
      z.object({
        edits_touched: z.number().int().nonnegative().optional(),
        qualifying_cites: z.number().int().nonnegative().optional(),
        recalled_unverified: z.number().int().nonnegative().optional(),
        expected_but_missed: z.number().int().nonnegative().optional(),
        total_turns: z.number().int().nonnegative().optional(),
      }),
    )
    .optional(),
  dismissed_reason_histogram: z
    .record(z.string(), z.number().int().nonnegative())
    .optional(),
  none_reason_histogram: z.record(z.string(), z.number().int().nonnegative()).optional(),
  // v2.0.0-rc.24 TASK-08: contract-policy audit metrics. Status discriminates
  // populated vs degraded modes. contract_metrics + per_layer_type are emitted
  // (zeroed) in degraded modes so the renderer iterates one stable shape.
  contract_metrics_status: z
    .enum(["ok", "skipped:bootstrap_drift", "awaiting_marker"])
    .optional(),
  contract_metrics: citeContractMetricsSchema.optional(),
  per_layer_type: citeLayerTypeBreakdownSchema.optional(),
  contract_marker_ts: z.number().int().nonnegative().optional(),
  generated_at: z.string(),
});
export type CiteCoverageReport = z.infer<typeof citeCoverageReportSchema>;

// ---------------------------------------------------------------------------
// Existing API contract schemas
// ---------------------------------------------------------------------------

export const ledgerSourceSchema = z.enum(["ai", "human"]);

const timestampFilterSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (trimmed.length === 0) {
      return undefined;
    }

    if (/^\d+$/.test(trimmed)) {
      return Number.parseInt(trimmed, 10);
    }

    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}, z.number().int().nonnegative());

export const ledgerQuerySchema = z.object({
  source: ledgerSourceSchema.optional(),
  since: timestampFilterSchema.optional(),
});

export const historyStateQuerySchema = z.object({
  ledger_id: z.string().trim().min(1).optional(),
  ts: timestampFilterSchema.optional(),
}).superRefine((value, ctx) => {
  const provided = [value.ledger_id, value.ts].filter((entry) => entry !== undefined);

  if (provided.length !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide exactly one of ledger_id or ts.",
      path: ["ledger_id"],
    });
  }
});

export const humanLockApproveRequestSchema = z.object({
  file: z.string().min(1),
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
  new_hash: z.string().min(1),
});

export const humanLockFileParamsSchema = z.object({
  file: z.string().min(1),
});

export const annotateIntentRequestSchema = z.object({
  ledger_entry_id: z.string().min(1),
  annotation: z.string().trim().min(1),
});

// ---------------------------------------------------------------------------
// v2.0 Knowledge entry schema
//
// Frontmatter for knowledge entries written into mounted store `knowledge/` trees.
// Fields MUST stay flat scalars to
// remain compatible with the hand-rolled regex parser at
// packages/server/src/services/knowledge-meta-builder.ts:748-785.
// ---------------------------------------------------------------------------

// 5 knowledge types (MECE) — canonical PLURAL form matching disk layout and
// MCP I/O surface (v2.0.0-rc.29 BUG-C1 unification).
export const KnowledgeTypeSchema = z.enum([
  "models", // entities, data structures, relationships
  "decisions", // architectural/technical choices with rationale
  "guidelines", // recommended practices (recommend) or anti-patterns (avoid)
  "pitfalls", // known risks, failure modes, troubleshooting
  "processes", // workflows, state machines, operational steps
]);
export type KnowledgeType = z.infer<typeof KnowledgeTypeSchema>;

// 3 maturity levels
export const MaturitySchema = z.enum(["draft", "verified", "proven"]);
export type Maturity = z.infer<typeof MaturitySchema>;

// 2 layers (personal at home dir, team at repo)
export const LayerSchema = z.enum(["personal", "team"]);
export type Layer = z.infer<typeof LayerSchema>;

// stable_id format: KP-{type-code}-{counter} (personal) | KT-{type-code}-{counter} (team)
// type-code map: models=MOD, decisions=DEC, guidelines=GLD, pitfalls=PIT, processes=PRO
export const StableIdSchema = z.string().regex(/^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}$/);
export type StableId = z.infer<typeof StableIdSchema>;

// v2.0 frontmatter — ALL flat scalars, no nested objects
export const KnowledgeEntryFrontmatterSchema = z.object({
  id: StableIdSchema, // e.g., "KT-DEC-0042"
  type: KnowledgeTypeSchema, // one of 5 types
  maturity: MaturitySchema, // draft | verified | proven
  layer: LayerSchema, // personal | team
  created_at: z.string(), // ISO 8601 timestamp
  // Note: 'tags' and other fields can be added later but core schema is these 6
});
export type KnowledgeEntryFrontmatter = z.infer<typeof KnowledgeEntryFrontmatterSchema>;

// Helper: type-code mapping (plural keys → 3-letter ID-prefix code)
export const KNOWLEDGE_TYPE_CODES = {
  models: "MOD",
  decisions: "DEC",
  guidelines: "GLD",
  pitfalls: "PIT",
  processes: "PRO",
} as const;

export type KnowledgeTypeCode = (typeof KNOWLEDGE_TYPE_CODES)[KnowledgeType];

// Helper: format/parse stable_id
export function formatKnowledgeId(layer: Layer, type: KnowledgeType, counter: number): StableId {
  const layerPrefix = layer === "personal" ? "KP" : "KT";
  const typeCode = KNOWLEDGE_TYPE_CODES[type];
  return `${layerPrefix}-${typeCode}-${String(counter).padStart(4, "0")}`;
}

export function parseKnowledgeId(
  id: string,
): { layer: Layer; type: KnowledgeType; counter: number } | null {
  const match = id.match(/^(KP|KT)-(MOD|DEC|GLD|PIT|PRO)-(\d+)$/);
  if (!match) return null;
  const layer: Layer = match[1] === "KP" ? "personal" : "team";
  const typeCode = match[2];
  const entry = Object.entries(KNOWLEDGE_TYPE_CODES).find(([, code]) => code === typeCode);
  if (!entry) return null;
  const type = entry[0] as KnowledgeType;
  return { layer, type, counter: parseInt(match[3], 10) };
}

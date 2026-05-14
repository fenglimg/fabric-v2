import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared warning schema (R24 contract)
// ---------------------------------------------------------------------------

export const structuredWarningSchema = z.object({
  code: z.string(),
  file: z.string(),
  line: z.number().optional(),
  action_hint: z.string(),
});

// ---------------------------------------------------------------------------
// MCP tool contracts — plan-context
// ---------------------------------------------------------------------------

// v2.0 knowledge enums — declared here as schemas (not just types) so they can
// flow through plan-context output validation. Mirrors the canonical enums
// further down in this file (KnowledgeTypeSchema/MaturitySchema/LayerSchema).
const _knowledgeTypeEnum = z.enum(["model", "decision", "guideline", "pitfall", "process"]);
const _maturityEnum = z.enum(["draft", "verified", "proven"]);
const _layerEnum = z.enum(["personal", "team"]);

const _ruleDescriptionSchema = z.object({
  summary: z.string(),
  intent_clues: z.array(z.string()),
  tech_stack: z.array(z.string()),
  impact: z.array(z.string()),
  must_read_if: z.string(),
  entities: z.array(z.string()).optional(),
  // v2.0: optional knowledge-entry fields. Absent for v1.x rules; present for
  // entries that declare frontmatter `id/type/maturity/layer`.
  id: z.string().optional(),
  knowledge_type: _knowledgeTypeEnum.optional(),
  maturity: _maturityEnum.optional(),
  knowledge_layer: _layerEnum.optional(),
  layer_reason: z.string().optional(),
  created_at: z.string().optional(),
});

const _descriptionIndexItemSchema = z.object({
  stable_id: z.string(),
  level: z.enum(["L0", "L1", "L2"]),
  required: z.boolean(),
  selectable: z.boolean(),
  description: _ruleDescriptionSchema,
  // v2.0: top-level knowledge surface for client-side filtering. Mirrors
  // description.* — exposed here so MCP clients can filter without reaching
  // into the nested payload.
  type: _knowledgeTypeEnum.optional(),
  maturity: _maturityEnum.optional(),
  layer: _layerEnum.optional(),
  layer_reason: z.string().optional(),
  // v2/rc.2: tag list shipped via frontmatter (commit a85121a). Exposed at
  // the API surface so MCP clients can filter without re-parsing the
  // description payload. Absent on legacy entries; consumers should treat
  // missing as [].
  tags: z.array(z.string()).optional(),
  // v2.0-rc.5 (C1): relevance scope/paths drive plan-context-hint narrowing.
  // Exposed at the API surface so MCP clients (and the `fabric
  // plan-context-hint` CLI from D1) can filter without re-parsing the
  // description payload. Defaults applied at the parse layer
  // (knowledge-meta-builder + agentsMetaNodeBaseSchema):
  //   relevance_scope → 'broad'  (always-surface, safe default)
  //   relevance_paths → []       (no path anchors)
  // Consumers should treat missing fields as broad/[]. Optional on the wire
  // so older servers without rc.5 schemas remain wire-compatible.
  relevance_scope: z.enum(["narrow", "broad"]).optional(),
  relevance_paths: z.array(z.string()).optional(),
});

// v2.0-rc.5 A3 (TASK-007): Cocos-era profile inference retired.
// `inferred_domain` (UI/Gameplay/Asset hardcoded), `intent_tokens`
// (Chinese game-perf token list), and `impact_hints` (Performance regex)
// dropped from the requirement profile — they had zero applicability beyond
// the werewolf-stub-era game project.
const _requirementProfileSchema = z.object({
  target_path: z.string(),
  path_segments: z.array(z.string()),
  extension: z.string(),
  known_tech: z.array(z.string()),
  user_intent: z.string(),
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
    .describe("Optional caller-provided session id for Event Ledger records"),
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
export const planContextOutputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  selection_token: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      requirement_profile: _requirementProfileSchema,
      description_index: z.array(_descriptionIndexItemSchema),
    }),
  ),
  shared: z.object({
    description_index: z.array(_descriptionIndexItemSchema),
    preflight_diagnostics: z.array(
      z.object({
        code: z.literal("missing_description"),
        severity: z.literal("warn"),
        message: z.string(),
        stable_ids: z.array(z.string()).optional(),
        path: z.string().optional(),
      }),
    ),
  }),
  warnings: z.array(structuredWarningSchema).optional(),
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
});

export const planContextHintOutputSchema = z.object({
  version: z.literal(1),
  revision_hash: z.string(),
  target_paths: z.array(z.string()),
  narrow: z.array(planContextHintNarrowEntrySchema),
  broad_count: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// MCP tool contracts — get-knowledge
// ---------------------------------------------------------------------------

const _knowledgeEntrySchema = z.object({ path: z.string(), content: z.string() });
const _humanLockedSchema = z.object({ file: z.string(), excerpt: z.string() });
const _descriptionStubSchema = z.object({ path: z.string(), description: z.string() });

export const getKnowledgeInputSchema = z.object({
  path: z.string().describe("Target file path to query rules for"),
  client_hash: z
    .string()
    .optional()
    .describe("Revision hash from prior fab_get_rules response; enables stale detection"),
  correlation_id: z
    .string()
    .optional()
    .describe("Optional caller-provided correlation id for Event Ledger records"),
  session_id: z
    .string()
    .optional()
    .describe("Optional caller-provided session id for Event Ledger records"),
});

export const getKnowledgeOutputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  rules: z.object({
    L0: z.string(),
    L1: z.array(_knowledgeEntrySchema),
    L2: z.array(_knowledgeEntrySchema),
    human_locked_nearby: z.array(_humanLockedSchema),
    description_stubs: z.array(_descriptionStubSchema).optional(),
  }),
  warnings: z.array(structuredWarningSchema).optional(),
});

export const getKnowledgeAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Get rule content",
} as const;

// ---------------------------------------------------------------------------
// MCP tool contracts — knowledge-sections
// ---------------------------------------------------------------------------

const KNOWLEDGE_SECTION_NAMES_TUPLE = ["MISSION_STATEMENT", "MANDATORY_INJECTION", "BUSINESS_LOGIC_CHUNKS", "CONTEXT_INFO"] as const;

export const knowledgeSectionsInputSchema = z.object({
  selection_token: z.string().min(1).describe("Selection token returned by fab_plan_context"),
  sections: z.array(z.enum(KNOWLEDGE_SECTION_NAMES_TUPLE)).min(1).describe("Structured rule sections to fetch"),
  ai_selected_stable_ids: z
    .array(z.string())
    .describe("AI-selected L1 stable_ids chosen from fab_plan_context ai_selectable_stable_ids"),
  ai_selection_reasons: z
    .record(z.string().min(1))
    .describe("Reason for each AI-selected L1 stable_id"),
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
  precedence: z.tuple([z.literal("L2"), z.literal("L1"), z.literal("L0")]),
  selected_stable_ids: z.array(z.string()),
  rules: z.array(
    z.object({
      stable_id: z.string(),
      level: z.enum(["L0", "L1", "L2"]),
      path: z.string(),
      sections: z.record(z.string()),
    }),
  ),
  diagnostics: z.array(
    z.discriminatedUnion("code", [
      z.object({
        code: z.literal("missing_section"),
        severity: z.literal("warn"),
        stable_id: z.string(),
        section: z.enum(KNOWLEDGE_SECTION_NAMES_TUPLE),
        message: z.string(),
      }),
      // v2.0: warn-level diagnostic for un-migrated v1.x entries (no
      // knowledge_type and no knowledge_layer). Does NOT block selection.
      z.object({
        code: z.literal("missing_knowledge_metadata"),
        severity: z.literal("warn"),
        stable_id: z.string(),
        message: z.string(),
      }),
    ]),
  ),
  // v2/rc.3 (Q6): present iff a layer-flip in fab_review/modify changed the
  // canonical stable_id since the caller's selection_token was minted.
  // Clients should retry against `redirect_to.stable_id`.
  redirect_to: z
    .object({ stable_id: z.string() })
    .optional()
    .describe(
      "Post-layer-flip redirect. Populated when stable_id changed after token mint (rc.3 fab_review/modify).",
    ),
  warnings: z.array(structuredWarningSchema).optional(),
});

export const knowledgeSectionsAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Filter rule sections",
} as const;

// ---------------------------------------------------------------------------
// MCP tool contracts — fab_extract_knowledge (rc.2 protocol pre-lock)
//
// Semi-thick design: the Skill summarizes the user/session context, the MCP
// server persists a pending knowledge entry under .fabric/knowledge/pending/.
// Schema lands now so consumers can target it; implementation arrives in rc.2.
// ---------------------------------------------------------------------------

// v2.0.0-rc.7 T6: enum of allowed `proposed_reason` values. The skill side
// MUST pick one — the value is greppable/lintable for future maturity-promotion
// scoring (deferred). The 1-line human descriptions live in
// PROPOSED_REASON_DESCRIPTIONS below and drive the `## Why proposed` body
// section that fab_extract_knowledge writes.
export const ProposedReasonSchema = z.enum([
  "explicit-user-mark",
  "diagnostic-then-fix",
  "decision-confirmation",
  "wrong-turn-revert",
  "new-dependency-or-pattern",
  "dismissal-with-reason",
]);
export type ProposedReason = z.infer<typeof ProposedReasonSchema>;

// 1-line zh-CN descriptions used to render `## Why proposed` in pending body.
// Keep stable: changing strings here changes every newly-written pending file.
export const PROPOSED_REASON_DESCRIPTIONS: Record<ProposedReason, string> = {
  "explicit-user-mark": "用户显式标记需归档（always / never / 下次注意 等规范性语言）。",
  "diagnostic-then-fix": "诊断过程发现新模式或踩坑，修复后值得沉淀。",
  "decision-confirmation": "≥2 候选方案经权衡后确认选型，需保留 rationale。",
  "wrong-turn-revert": "尝试某路径后回退，错误路径本身是值得记录的 pitfall。",
  "new-dependency-or-pattern": "引入新依赖 / 新模式 / 新命名约定。",
  "dismissal-with-reason": "用户明确拒绝某方案并给出原因，原因即可归档知识。",
};

// v2.0.0-rc.7 T5: `source_session: string` → `source_sessions: string[]`.
// Pre-T5 callers may still pass a single string; the preprocess shim below
// transforms it transparently to `[s]` so the rest of the schema sees the
// array form. The output frontmatter is always the array form.
const _sourceSessionsField = z.preprocess(
  (value) => {
    if (typeof value === "string") return [value];
    return value;
  },
  z.array(z.string().min(1)).min(1),
);

// Internal: base z.object schema. The exported FabExtractKnowledgeInputSchema
// adds a superRefine on top to require at least one of source_sessions /
// source_session. We keep the un-refined base around so the MCP tool
// registration can still use `.shape` (registerTool's inputSchema contract).
const _FabExtractKnowledgeInputBaseSchema = z.object({
  // v2.0.0-rc.7 T5: array form. Legacy single-string callers are accepted
  // via the preprocess shim above. The optional pre-T5 alias `source_session`
  // is kept as an accepted alternative below for in-flight integrations
  // (Zod parses one or the other — see refinement).
  source_sessions: _sourceSessionsField
    .optional()
    .describe(
      "Originating session ids; correlates with Event Ledger records. Array form (T5). Single string accepted via back-compat shim.",
    ),
  // Pre-T5 alias. When set and source_sessions is missing, the handler maps
  // it to [source_session]. Marked optional so new callers can drop it.
  source_session: z
    .string()
    .min(1)
    .optional()
    .describe(
      "DEPRECATED — pre-T5 alias for source_sessions. Use source_sessions: string[]. Single string still accepted for back-compat.",
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
  // rc.5 B1: dual pending root. When 'personal', the server writes to
  // ~/.fabric/knowledge/pending/<type>/; otherwise to .fabric/knowledge/pending/<type>/.
  // Defaults to 'team' to preserve existing call sites (Skill bumps as needed).
  layer: z
    .enum(["team", "personal"])
    .optional()
    .describe(
      "Storage layer for the pending entry. 'team' writes under the workspace; 'personal' writes under the user's home. Defaults to 'team'.",
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
  relevance_scope: z
    .enum(["narrow", "broad"])
    .optional()
    .describe(
      "Optional relevance scope. 'narrow' restricts plan-context-hint surfacing to relevance_paths; 'broad' always surfaces. Omit to let the meta-builder default to 'broad'. Personal + narrow is silently degraded to broad + [].",
    ),
  relevance_paths: z
    .array(z.string())
    .optional()
    .describe(
      "Optional path anchors for narrow scope. Workspace-relative globs or paths. Omit to let the meta-builder default to []. Ignored when scope is broad (server preserves the array for audit).",
    ),
});

// Exported alias of the base shape — MCP tool registration uses `.shape` to
// derive registerTool's per-field schema map. We attach the superRefine
// downstream on the parse-facing schema.
export const FabExtractKnowledgeInputSchema = _FabExtractKnowledgeInputBaseSchema.superRefine(
  (value, ctx) => {
    // Exactly one of source_sessions / source_session must produce a non-empty
    // array. We accept both for migration ease but require at least one.
    const hasArray = Array.isArray(value.source_sessions) && value.source_sessions.length > 0;
    const hasString =
      typeof value.source_session === "string" && value.source_session.length > 0;
    if (!hasArray && !hasString) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "either source_sessions (array, preferred) or source_session (legacy single string) must be provided",
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
// MCP tool contracts — fab_review (rc.3 protocol pre-lock)
//
// Discriminated union over a fixed `action` field. 6 actions exhaustively
// cover the human review loop: list, approve, reject, modify, search, defer.
// Consumers should `switch (input.action)` for type-narrowed handling.
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
});

export const FabReviewInputSchema = z.discriminatedUnion("action", [
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
    changes: _fabReviewModifyChangesSchema,
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
export type FabReviewInput = z.infer<typeof FabReviewInputSchema>;

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
    .enum(["list", "approve", "reject", "modify", "search", "defer"])
    .describe(
      "Action selector. Discriminates the per-action fields below; required.",
    ),
  filters: _fabReviewFiltersSchema.describe(
    "Optional filters (type/layer/maturity/tags/created_after). Used by action=list and action=search.",
  ),
  pending_paths: z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      "Workspace-relative pending entry paths. Required when action=approve|reject|defer (non-empty array).",
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
    "Frontmatter scalar patches (title/summary/layer/maturity/tags/relevance_*). Required when action=modify.",
  ),
  query: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Substring query against title/summary/tags/path. Required (non-empty) when action=search.",
    ),
  until: z
    .string()
    .datetime()
    .optional()
    .describe(
      "ISO-8601 datetime upper bound for the deferral. Optional; used only when action=defer.",
    ),
} as const;

// Per-action result shapes. Each variant mirrors its input action so the
// consumer can pair `(input.action, output.action)` without extra plumbing.
const _fabReviewListItemSchema = z.object({
  pending_path: z.string(),
  type: z.enum(["decisions", "pitfalls", "guidelines", "models", "processes"]),
  layer: z.enum(["team", "personal"]),
  maturity: z.enum(["draft", "verified", "proven"]),
  tags: z.array(z.string()).optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  // rc.5 B1: dual pending root. 'team' = workspace .fabric/knowledge/pending,
  // 'personal' = ~/.fabric/knowledge/pending. Distinct from `layer` (frontmatter):
  // origin reflects where the pending file actually lives on disk; layer reflects
  // the declared classification that will drive the approve destination.
  origin: z.enum(["team", "personal"]).optional(),
});

export const FabReviewOutputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    items: z.array(_fabReviewListItemSchema),
  }),
  z.object({
    action: z.literal("approve"),
    approved: z.array(z.object({ pending_path: z.string(), stable_id: z.string() })),
  }),
  z.object({
    action: z.literal("reject"),
    rejected: z.array(z.string()),
  }),
  z.object({
    action: z.literal("modify"),
    pending_path: z.string(),
    // When a layer-flip occurred, prior_stable_id and new_stable_id differ.
    prior_stable_id: z.string().optional(),
    new_stable_id: z.string().optional(),
  }),
  z.object({
    action: z.literal("search"),
    items: z.array(_fabReviewListItemSchema),
  }),
  z.object({
    action: z.literal("defer"),
    deferred: z.array(z.string()),
  }),
]);
export type FabReviewOutput = z.infer<typeof FabReviewOutputSchema>;

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
    .enum(["list", "approve", "reject", "modify", "search", "defer"])
    .describe(
      "Echoes the input action; clients can switch on it for per-variant fields below.",
    ),
  items: z
    .array(_fabReviewListItemSchema)
    .optional()
    .describe(
      "Pending/canonical entries surfaced. Present when action=list or action=search.",
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
  deferred: z
    .array(z.string())
    .optional()
    .describe(
      "Pending paths that were deferred (files retained on disk). Present when action=defer.",
    ),
} as const;

export const fabReviewAnnotations = {
  readOnlyHint: false,
  idempotentHint: false,
  destructiveHint: false,
  openWorldHint: false,
  title: "Review pending knowledge entries",
} as const;

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
// Frontmatter for knowledge entries written into .fabric/knowledge/ (team layer)
// or ~/.fabric/knowledge/ (personal layer). Fields MUST stay flat scalars to
// remain compatible with the hand-rolled regex parser at
// packages/server/src/services/knowledge-meta-builder.ts:748-785.
// ---------------------------------------------------------------------------

// 5 knowledge types (MECE)
export const KnowledgeTypeSchema = z.enum([
  "model", // entities, data structures, relationships
  "decision", // architectural/technical choices with rationale
  "guideline", // recommended practices (recommend) or anti-patterns (avoid)
  "pitfall", // known risks, failure modes, troubleshooting
  "process", // workflows, state machines, operational steps
]);
export type KnowledgeType = z.infer<typeof KnowledgeTypeSchema>;

// 3 maturity levels
export const MaturitySchema = z.enum(["draft", "verified", "proven"]);
export type Maturity = z.infer<typeof MaturitySchema>;

// 2 layers (personal at home dir, team at repo)
export const LayerSchema = z.enum(["personal", "team"]);
export type Layer = z.infer<typeof LayerSchema>;

// stable_id format: KP-{type-code}-{counter} (personal) | KT-{type-code}-{counter} (team)
// type-code map: model=MOD, decision=DEC, guideline=GLD, pitfall=PIT, process=PRO
export const StableIdSchema = z.string().regex(/^K[PT]-(MOD|DEC|GLD|PIT|PRO)-\d{4,}$/);
export type StableId = z.infer<typeof StableIdSchema>;

// v2.0 frontmatter — ALL flat scalars, no nested objects
export const KnowledgeEntryFrontmatterSchema = z.object({
  id: StableIdSchema, // e.g., "KT-DEC-0042"
  type: KnowledgeTypeSchema, // one of 5 types
  maturity: MaturitySchema, // draft | verified | proven
  layer: LayerSchema, // personal | team
  layer_reason: z.string().optional(), // why this layer (for ambiguous cases)
  created_at: z.string(), // ISO 8601 timestamp
  // Note: 'tags' and other fields can be added later but core schema is these 6
});
export type KnowledgeEntryFrontmatter = z.infer<typeof KnowledgeEntryFrontmatterSchema>;

// Helper: type-code mapping
export const KNOWLEDGE_TYPE_CODES = {
  model: "MOD",
  decision: "DEC",
  guideline: "GLD",
  pitfall: "PIT",
  process: "PRO",
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

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

const _ruleDescriptionSchema = z.object({
  summary: z.string(),
  intent_clues: z.array(z.string()),
  tech_stack: z.array(z.string()),
  impact: z.array(z.string()),
  must_read_if: z.string(),
  entities: z.array(z.string()).optional(),
});

const _descriptionIndexItemSchema = z.object({
  stable_id: z.string(),
  level: z.enum(["L0", "L1", "L2"]),
  required: z.boolean(),
  selectable: z.boolean(),
  description: _ruleDescriptionSchema,
});

const _requirementProfileSchema = z.object({
  target_path: z.string(),
  path_segments: z.array(z.string()),
  extension: z.string(),
  inferred_domain: z.array(z.string()),
  known_tech: z.array(z.string()),
  user_intent: z.string(),
  intent_tokens: z.array(z.string()),
  impact_hints: z.array(z.string()),
  detected_entities: z.array(z.string()),
});

const _selectionPolicySchema = z.object({
  required_levels: z.tuple([z.literal("L0"), z.literal("L2")]),
  ai_selectable_levels: z.tuple([z.literal("L1")]),
  final_fetch_rule: z.literal("required_stable_ids + ai_selected_l1_stable_ids"),
});

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
});

export const planContextOutputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  selection_token: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      requirement_profile: _requirementProfileSchema,
      description_index: z.array(_descriptionIndexItemSchema),
      required_stable_ids: z.array(z.string()),
      ai_selectable_stable_ids: z.array(z.string()),
      initial_selected_stable_ids: z.array(z.string()),
      selection_policy: _selectionPolicySchema,
    }),
  ),
  shared: z.object({
    required_stable_ids: z.array(z.string()),
    ai_selectable_stable_ids: z.array(z.string()),
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
// MCP tool contracts — get-rules
// ---------------------------------------------------------------------------

const _rulesEntrySchema = z.object({ path: z.string(), content: z.string() });
const _humanLockedSchema = z.object({ file: z.string(), excerpt: z.string() });
const _descriptionStubSchema = z.object({ path: z.string(), description: z.string() });

export const getRulesInputSchema = z.object({
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

export const getRulesOutputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  rules: z.object({
    L0: z.string(),
    L1: z.array(_rulesEntrySchema),
    L2: z.array(_rulesEntrySchema),
    human_locked_nearby: z.array(_humanLockedSchema),
    description_stubs: z.array(_descriptionStubSchema).optional(),
  }),
  warnings: z.array(structuredWarningSchema).optional(),
});

export const getRulesAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Get rule content",
} as const;

// ---------------------------------------------------------------------------
// MCP tool contracts — rule-sections
// ---------------------------------------------------------------------------

const RULE_SECTION_NAMES_TUPLE = ["MISSION_STATEMENT", "MANDATORY_INJECTION", "BUSINESS_LOGIC_CHUNKS", "CONTEXT_INFO"] as const;

export const ruleSectionsInputSchema = z.object({
  selection_token: z.string().min(1).describe("Selection token returned by fab_plan_context"),
  sections: z.array(z.enum(RULE_SECTION_NAMES_TUPLE)).min(1).describe("Structured rule sections to fetch"),
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
});

export const ruleSectionsOutputSchema = z.object({
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
    z.object({
      code: z.literal("missing_section"),
      severity: z.literal("warn"),
      stable_id: z.string(),
      section: z.enum(RULE_SECTION_NAMES_TUPLE),
      message: z.string(),
    }),
  ),
  warnings: z.array(structuredWarningSchema).optional(),
});

export const ruleSectionsAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
  title: "Filter rule sections",
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { planContext, type PlanContextInput } from "../services/plan-context.js";

const inputSchema = {
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
};

const ruleDescriptionSchema = z.object({
  summary: z.string(),
  intent_clues: z.array(z.string()),
  tech_stack: z.array(z.string()),
  impact: z.array(z.string()),
  must_read_if: z.string(),
  entities: z.array(z.string()).optional(),
});

const descriptionIndexItemSchema = z.object({
  stable_id: z.string(),
  level: z.enum(["L0", "L1", "L2"]),
  required: z.boolean(),
  selectable: z.boolean(),
  description: ruleDescriptionSchema,
});

const requirementProfileSchema = z.object({
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

const selectionPolicySchema = z.object({
  required_levels: z.tuple([z.literal("L0"), z.literal("L2")]),
  ai_selectable_levels: z.tuple([z.literal("L1")]),
  final_fetch_rule: z.literal("required_stable_ids + ai_selected_l1_stable_ids"),
});

const outputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  selection_token: z.string(),
  entries: z.array(
    z.object({
      path: z.string(),
      requirement_profile: requirementProfileSchema,
      description_index: z.array(descriptionIndexItemSchema),
      required_stable_ids: z.array(z.string()),
      ai_selectable_stable_ids: z.array(z.string()),
      initial_selected_stable_ids: z.array(z.string()),
      selection_policy: selectionPolicySchema,
    }),
  ),
  shared: z.object({
    required_stable_ids: z.array(z.string()),
    ai_selectable_stable_ids: z.array(z.string()),
    description_index: z.array(descriptionIndexItemSchema),
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
});

export function registerPlanContext(server: McpServer): void {
  server.registerTool(
    "fab_plan_context",
    {
      description:
        "Use during plan or architecture phases to build a neutral Fabric rule description index and selection token before fetching rule sections.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ paths, intent, known_tech, detected_entities, client_hash }: PlanContextInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await planContext(projectRoot, { paths, intent, known_tech, detected_entities, client_hash });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}

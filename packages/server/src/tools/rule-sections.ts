import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import {
  getRuleSections,
  RULE_SECTION_NAMES,
  type GetRuleSectionsInput,
} from "../services/rule-sections.js";

const inputSchema = {
  selection_token: z.string().min(1).describe("Selection token returned by fab_plan_context"),
  sections: z.array(z.enum(RULE_SECTION_NAMES)).min(1).describe("Structured rule sections to fetch"),
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
};

const outputSchema = z.object({
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
      section: z.enum(RULE_SECTION_NAMES),
      message: z.string(),
    }),
  ),
});

export function registerRuleSections(server: McpServer): void {
  server.registerTool(
    "fab_get_rule_sections",
    {
      description:
        "Fetch structured Fabric rule sections after fab_plan_context. Required L0/L2 rules are merged with AI-selected L1 rules server-side.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input: GetRuleSectionsInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await getRuleSections(projectRoot, input);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}

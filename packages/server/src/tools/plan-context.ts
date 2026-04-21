import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { planContext, type PlanContextInput } from "../services/plan-context.js";

const inputSchema = {
  paths: z
    .array(z.string())
    .min(2)
    .describe("Candidate file paths to query rules for during planning or architecture review"),
  client_hash: z
    .string()
    .optional()
    .describe("Revision hash from a prior fab_plan_context response; enables stale detection"),
};

const rulesEntrySchema = z.object({ path: z.string(), content: z.string() });
const humanLockedSchema = z.object({ file: z.string(), excerpt: z.string() });
const rulesPayloadSchema = z.object({
  L0: z.string(),
  L1: z.array(rulesEntrySchema),
  L2: z.array(rulesEntrySchema),
  human_locked_nearby: z.array(humanLockedSchema),
});

const outputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  entries: z.array(
    z.object({
      path: z.string(),
      rules: rulesPayloadSchema,
    }),
  ),
});

export function registerPlanContext(server: McpServer): void {
  server.registerTool(
    "fab_plan_context",
    {
      description:
        "Use during plan or architecture phases to batch-query Fabric rules for multiple candidate paths in one round-trip. Use fab_get_rules for single-file queries; use fab_plan_context for 2+ files.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ paths, client_hash }: PlanContextInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await planContext(projectRoot, { paths, client_hash });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}

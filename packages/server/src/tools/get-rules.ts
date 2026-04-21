import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { getRules, type GetRulesInput } from "../services/get-rules.js";

const inputSchema = {
  path: z.string().describe("Target file path to query rules for"),
  client_hash: z
    .string()
    .optional()
    .describe("Revision hash from prior fab_get_rules response; enables stale detection"),
};

const rulesEntrySchema = z.object({ path: z.string(), content: z.string() });
const humanLockedSchema = z.object({ file: z.string(), excerpt: z.string() });

const outputSchema = z.object({
  revision_hash: z.string(),
  stale: z.boolean(),
  rules: z.object({
    L0: z.string(),
    L1: z.array(rulesEntrySchema),
    L2: z.array(rulesEntrySchema),
    human_locked_nearby: z.array(humanLockedSchema),
  }),
});

export function registerGetRules(server: McpServer): void {
  server.registerTool(
    "fab_get_rules",
    {
      description:
        "Call before modifying any file to retrieve Fabric rules for a target path.",
      inputSchema,
      outputSchema,
      annotations: { readOnlyHint: true },
    },
    async ({ path, client_hash }: GetRulesInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await getRules(projectRoot, { path, client_hash });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}

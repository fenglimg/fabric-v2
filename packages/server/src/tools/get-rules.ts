import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  getRulesAnnotations,
  getRulesInputSchema,
  getRulesOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { resolveProjectRoot } from "../meta-reader.js";
import { getRules, type GetRulesInput } from "../services/get-rules.js";

export function registerGetRules(server: McpServer): void {
  server.registerTool(
    "fab_get_rules",
    {
      description:
        "Call before modifying any file to retrieve Fabric rules for a target path.",
      inputSchema: getRulesInputSchema,
      outputSchema: getRulesOutputSchema,
      annotations: getRulesAnnotations,
    },
    async ({ path, client_hash, correlation_id, session_id }: GetRulesInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await getRules(projectRoot, { path, client_hash, correlation_id, session_id });

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
}

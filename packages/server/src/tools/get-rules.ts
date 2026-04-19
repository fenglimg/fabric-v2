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

function createTextResponse(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload),
      },
    ],
  };
}

export function registerGetRules(server: McpServer): void {
  server.tool(
    "fab_get_rules",
    "MANDATORY: Call before modifying any file to retrieve Fabric rules for a target path.",
    inputSchema,
    async ({ path, client_hash }: GetRulesInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await getRules(projectRoot, { path, client_hash });

      return createTextResponse(result);
    },
  );
}

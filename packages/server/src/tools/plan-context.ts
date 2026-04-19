import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveProjectRoot } from "../meta-reader.js";
import { planContext, type PlanContextInput } from "../services/plan-context.js";

const inputSchema = {
  paths: z
    .array(z.string())
    .min(1)
    .describe("Candidate file paths to query rules for during planning or architecture review"),
  client_hash: z
    .string()
    .optional()
    .describe("Revision hash from a prior fab_plan_context response; enables stale detection"),
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

export function registerPlanContext(server: McpServer): void {
  server.tool(
    "fab_plan_context",
    "Use during plan or architecture phases to batch-query Fabric rules for multiple candidate paths in one round-trip.",
    inputSchema,
    async ({ paths, client_hash }: PlanContextInput) => {
      const projectRoot = resolveProjectRoot();
      const result = await planContext(projectRoot, { paths, client_hash });

      return createTextResponse(result);
    },
  );
}

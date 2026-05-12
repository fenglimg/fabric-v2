import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  knowledgeSectionsAnnotations,
  knowledgeSectionsInputSchema,
  knowledgeSectionsOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { resolveProjectRoot } from "../meta-reader.js";
import { readPayloadLimits } from "../config-loader.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import {
  getKnowledgeSections,
  type GetKnowledgeSectionsInput,
} from "../services/knowledge-sections.js";
import { ensureKnowledgeFresh } from "../services/knowledge-sync.js";

export function registerKnowledgeSections(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_get_knowledge_sections",
    {
      description:
        "Fetch structured Fabric rule sections after fab_plan_context. Required L0/L2 rules are merged with AI-selected L1 rules server-side.",
      inputSchema: knowledgeSectionsInputSchema,
      outputSchema: knowledgeSectionsOutputSchema,
      annotations: knowledgeSectionsAnnotations,
    },
    async (input: GetKnowledgeSectionsInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        const projectRoot = resolveProjectRoot();
        const syncReport = await ensureKnowledgeFresh(projectRoot);
        const result = await getKnowledgeSections(projectRoot, input);

        const response = {
          ...result,
          warnings: [...syncReport.warnings],
        };

        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(response);
        const guardResult = enforcePayloadLimit(serialized, payloadLimits);
        if (guardResult.warning) {
          response.warnings = [
            ...response.warnings,
            {
              code: guardResult.warning.code,
              file: '<response>',
              action_hint: 'Consider narrowing the request scope to reduce response size',
            },
          ];
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
          structuredContent: response,
        };
      } finally {
        tracker?.exit(requestId);
      }
    },
  );
}

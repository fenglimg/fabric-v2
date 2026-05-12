import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  planContextAnnotations,
  planContextInputSchema,
  planContextOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { resolveProjectRoot } from "../meta-reader.js";
import { readPayloadLimits } from "../config-loader.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { planContext, type PlanContextInput } from "../services/plan-context.js";
import { ensureKnowledgeFresh } from "../services/knowledge-sync.js";

export function registerPlanContext(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_plan_context",
    {
      description:
        "Use during plan or architecture phases to build a neutral Fabric rule description index and selection token before fetching rule sections.",
      inputSchema: planContextInputSchema,
      outputSchema: planContextOutputSchema,
      annotations: planContextAnnotations,
    },
    async ({ paths, intent, known_tech, detected_entities, client_hash, correlation_id, session_id, include_deprecated }: PlanContextInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        const projectRoot = resolveProjectRoot();
        const syncReport = await ensureKnowledgeFresh(projectRoot);
        const result = await planContext(projectRoot, {
          paths,
          intent,
          known_tech,
          detected_entities,
          client_hash,
          correlation_id,
          session_id,
          include_deprecated,
        });

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

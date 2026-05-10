import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  FabReviewInputSchema,
  FabReviewOutputSchema,
  fabReviewAnnotations,
  type FabReviewInput,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";

import { resolveProjectRoot } from "../meta-reader.js";
import { readPayloadLimits } from "../config-loader.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { reviewKnowledge } from "../services/review.js";

export function registerReview(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_review",
    {
      description:
        "Review pending knowledge entries under .fabric/knowledge/pending/. Discriminated by `action`: list (enumerate), approve (allocate stable_id and promote to canonical layer/type path), reject/modify/search/defer (TASK-002). Skill-side tool — invoked by fabric-review.",
      // Discriminated union schemas — passed whole (registerTool accepts
      // `AnySchema` in addition to `ZodRawShape`; see @modelcontextprotocol/sdk
      // mcp.d.ts:150).
      inputSchema: FabReviewInputSchema,
      outputSchema: FabReviewOutputSchema,
      annotations: fabReviewAnnotations,
    },
    async (input: FabReviewInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        const projectRoot = resolveProjectRoot();
        const result = await reviewKnowledge(projectRoot, input);

        const response = result;

        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(response);
        enforcePayloadLimit(serialized, payloadLimits);

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

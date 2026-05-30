import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  FabReviewInputSchema,
  FabReviewInputShape,
  FabReviewOutputShape,
  fabReviewAnnotations,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";

import { appendPayloadWarning } from "./payload-warning.js";
import { resolveProjectRoot } from "../meta-reader.js";
import { readPayloadLimits } from "../config-loader.js";
import {
  awaitFirstReconcileGate,
  gateWarning,
  type GateWarning,
} from "../services/first-reconcile-gate.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { reviewKnowledge } from "../services/review.js";

export function registerReview(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_review",
    {
      description:
        "Review pending knowledge entries under .fabric/knowledge/pending/. Discriminated by `action`: list (enumerate), approve (allocate stable_id and promote to canonical layer/type path), reject/modify/search/defer (TASK-002). Skill-side tool — invoked by fabric-review.",
      // Flat ZodRawShape required by MCP SDK 1.29.0 registerTool. The
      // authoritative cross-field contract still lives in FabReviewInputSchema
      // (discriminatedUnion) and is enforced inside the handler via
      // `FabReviewInputSchema.parse(input)`.
      inputSchema: FabReviewInputShape,
      outputSchema: FabReviewOutputShape,
      annotations: fabReviewAnnotations,
    },
    async (input: unknown) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        // v2.0.0-rc.23 TASK-009 (d): see plan-context.ts for rationale.
        const gateResult = await awaitFirstReconcileGate();
        const gateWarn = gateWarning(gateResult);

        // Narrow via the discriminatedUnion to recover full per-action
        // strictness (e.g. action=approve requires non-empty pending_paths).
        const narrowed = FabReviewInputSchema.parse(input);
        const projectRoot = resolveProjectRoot();
        const result = await reviewKnowledge(projectRoot, narrowed);

        const response: typeof result & { warnings?: GateWarning[] } = { ...result };
        if (gateWarn) {
          response.warnings = [gateWarn];
        }

        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(response);
        // v2.2 MC5-action-hint (W3-T3): surface the soft-warn banner symmetrically
        // with peer tools instead of discarding it.
        const guardResult = enforcePayloadLimit(serialized, payloadLimits);
        response.warnings = appendPayloadWarning(
          response.warnings,
          guardResult,
          "fab_review returned a large result set — pass a narrower filter (topic / status / id) to reduce response size.",
        );

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

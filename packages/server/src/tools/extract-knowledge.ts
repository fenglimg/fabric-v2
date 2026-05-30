import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  FabExtractKnowledgeInputShape,
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeOutputSchema,
  fabExtractKnowledgeAnnotations,
  type FabExtractKnowledgeInput,
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
import { extractKnowledge } from "../services/extract-knowledge.js";

export function registerExtractKnowledge(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_extract_knowledge",
    {
      description:
        "Persist a proposed pending knowledge entry under .fabric/knowledge/pending/<type>/<slug>.md. Idempotent on (source_sessions[0], type, slug); repeat calls append evidence rather than overwrite. Skill-side tool — invoked at session-stop.",
      inputSchema: FabExtractKnowledgeInputShape,
      outputSchema: FabExtractKnowledgeOutputSchema.shape,
      annotations: fabExtractKnowledgeAnnotations,
    },
    async (input: FabExtractKnowledgeInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        // v2.0.0-rc.23 TASK-009 (d): see plan-context.ts for rationale.
        const gateResult = await awaitFirstReconcileGate();
        const gateWarn = gateWarning(gateResult);

        // F5: registerTool validates against FabExtractKnowledgeInputShape (the
        // raw z.object shape), which does NOT carry the superRefine that
        // requires a non-empty source_sessions[]. Re-parse through the full
        // schema (mirrors review.ts) so a missing/empty source_sessions is
        // rejected here instead of silently persisting a contract-violating
        // pending entry with source_sessions=[].
        const validated = FabExtractKnowledgeInputSchema.parse(input);

        const projectRoot = resolveProjectRoot();
        const result = await extractKnowledge(projectRoot, validated);

        const response: typeof result & { warnings?: GateWarning[] } = { ...result };
        if (gateWarn) {
          response.warnings = [gateWarn];
        }

        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(response);
        // v2.2 MC5-action-hint (W3-T3): surface the soft-warn banner symmetrically
        // with peer tools instead of discarding it. The response is normally
        // small, so this fires only on a pathological over-warn payload.
        const guardResult = enforcePayloadLimit(serialized, payloadLimits);
        response.warnings = appendPayloadWarning(
          response.warnings,
          guardResult,
          "fab_extract_knowledge produced an unexpectedly large response — extract from a smaller span of text.",
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

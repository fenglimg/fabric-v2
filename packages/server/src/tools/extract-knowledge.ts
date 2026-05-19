import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  FabExtractKnowledgeInputShape,
  FabExtractKnowledgeOutputSchema,
  fabExtractKnowledgeAnnotations,
  type FabExtractKnowledgeInput,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";

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

        const projectRoot = resolveProjectRoot();
        const result = await extractKnowledge(projectRoot, input);

        const response: typeof result & { warnings?: GateWarning[] } = { ...result };
        if (gateWarn) {
          response.warnings = [gateWarn];
        }

        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(response);
        // enforcePayloadLimit returns a guard structure; we discard the
        // size-overage warning here because fab_extract_knowledge response
        // is small (two short strings + optional rc.23 gate warning) and
        // never realistically exceeds the limit. Keep the call to remain
        // consistent with peer tools.
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

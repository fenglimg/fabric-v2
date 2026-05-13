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
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { extractKnowledge } from "../services/extract-knowledge.js";

export function registerExtractKnowledge(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_extract_knowledge",
    {
      description:
        "Persist a proposed pending knowledge entry under .fabric/knowledge/pending/<type>/<slug>.md. Idempotent on (source_session, type, slug); repeat calls append evidence rather than overwrite. Skill-side tool — invoked at session-stop.",
      inputSchema: FabExtractKnowledgeInputShape,
      outputSchema: FabExtractKnowledgeOutputSchema.shape,
      annotations: fabExtractKnowledgeAnnotations,
    },
    async (input: FabExtractKnowledgeInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        const projectRoot = resolveProjectRoot();
        const result = await extractKnowledge(projectRoot, input);

        const response = { ...result };

        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(response);
        // enforcePayloadLimit returns a guard structure; we discard the
        // warning here because fab_extract_knowledge response is small
        // (two short strings) and the schema does not surface a warnings
        // array. Keep the call to remain consistent with peer tools.
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

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
import {
  awaitFirstReconcileGate,
  gateWarning,
} from "../services/first-reconcile-gate.js";
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
        "Fetch the full markdown body of one or more Fabric rules picked from fab_plan_context. Returns body strings keyed by stable_id (frontmatter stripped). Use after fab_plan_context returned selectable entries to load full rule content for LLM context injection — scan the body for whatever headings the rule defines (Summary / Why proposed / Session context / Evidence, etc.).",
      inputSchema: knowledgeSectionsInputSchema,
      outputSchema: knowledgeSectionsOutputSchema,
      annotations: knowledgeSectionsAnnotations,
    },
    async (input: GetKnowledgeSectionsInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        // v2.0.0-rc.23 TASK-009 (d): see plan-context.ts for rationale.
        const gateResult = await awaitFirstReconcileGate();
        const gateWarn = gateWarning(gateResult);

        const projectRoot = resolveProjectRoot();
        // v2.0.0-rc.30 TASK-002 (G1 flip): paired with plan-context.ts caller,
        // see that file's TASK-002 comment for bench rationale.
        const syncReport = await ensureKnowledgeFresh(projectRoot, { autoHealOnDrift: true });
        const result = await getKnowledgeSections(projectRoot, input);

        const response = {
          ...result,
          warnings: [
            ...(gateWarn ? [gateWarn] : []),
            ...syncReport.warnings,
          ],
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

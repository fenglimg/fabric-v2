import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  recallAnnotations,
  recallInputSchema,
  recallOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { resolveProjectRoot } from "../meta-reader.js";
import { readPayloadLimits } from "../config-loader.js";
import {
  awaitFirstReconcileGate,
  gateWarning,
} from "../services/first-reconcile-gate.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { ensureKnowledgeFresh } from "../services/knowledge-sync.js";
import { recall, type RecallInput } from "../services/recall.js";

// v2.0.0-rc.37 NEW-3: one-call recall MCP tool. Mirrors plan-context.ts +
// knowledge-sections.ts envelope handling (gate wait + auto-heal + payload
// guard + structured warnings) so callers get identical telemetry surface
// regardless of whether they take the two-step or combined path.
export function registerRecall(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_recall",
    {
      description:
        "Combined one-call replacement for (fab_plan_context → fab_get_knowledge_sections). Pass candidate `paths` (+ optional `intent`) and receive the full markdown bodies of every relevant Fabric rule in a single round-trip. After rc.37 removed server-side `selectable=false` filtering, the LLM-driven id-picking step is almost always a no-op (the AI just picks every selectable entry) — `fab_recall` collapses that ceremony for the common case while still backing the response with a `selection_token` you can reuse with fab_get_knowledge_sections for follow-up fetches. Pass explicit `ids` to scope the fetched bodies (otherwise all surfaced entries are loaded).",
      inputSchema: recallInputSchema,
      outputSchema: recallOutputSchema,
      annotations: recallAnnotations,
    },
    async ({
      paths,
      intent,
      known_tech,
      detected_entities,
      client_hash,
      correlation_id,
      session_id,
      target_paths,
      ids,
    }) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        const gateResult = await awaitFirstReconcileGate();
        const gateWarn = gateWarning(gateResult);

        const projectRoot = resolveProjectRoot();
        const syncReport = await ensureKnowledgeFresh(projectRoot, { autoHealOnDrift: true });

        const input: RecallInput = {
          paths,
          intent,
          known_tech,
          detected_entities,
          client_hash,
          correlation_id,
          session_id,
          target_paths,
          ids,
        };
        const result = await recall(projectRoot, input);

        const response: Record<string, unknown> = {
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
            ...(response.warnings as unknown[]),
            {
              code: guardResult.warning.code,
              file: '<response>',
              action_hint:
                'Pass an explicit `ids` array to scope fab_recall, or fall back to the two-step (fab_plan_context → fab_get_knowledge_sections) flow to fetch bodies on demand.',
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

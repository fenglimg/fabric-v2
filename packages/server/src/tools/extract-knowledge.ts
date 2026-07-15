import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ZodError } from "zod";

import {
  FabExtractKnowledgeInputShape,
  FabExtractKnowledgeInputSchema,
  FabExtractKnowledgeOutputSchema,
  fabExtractKnowledgeAnnotations,
  type FabExtractKnowledgeInput,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { SCOPE_COORDINATE_HINT } from "@fenglimg/fabric-shared";
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
import { unsealedProjectScopeWarning } from "../services/write-scope-warning.js";
import { toMcpToolError } from "./mcp-tool-error.js";

export function registerExtractKnowledge(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_propose",
    {
      description:
        "Persist a proposed pending knowledge entry into the resolved write-target store under knowledge/pending/<type>/<slug>.md. Idempotent on (source_sessions[0], type, slug); repeat calls append evidence rather than overwrite. Skill-side tool — invoked at session-stop.",
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
        // W3-K K5: on a scope-coordinate (audience) regex failure, surface a
        // structured error carrying an `action_hint` with a legal example so the
        // agent can self-correct. The example is single-sourced from
        // SCOPE_COORDINATE_HINT (also the zod regex message), so it never drifts.
        let validated: FabExtractKnowledgeInput;
        try {
          validated = FabExtractKnowledgeInputSchema.parse(input);
        } catch (parseErr) {
          if (parseErr instanceof ZodError) {
            const audienceIssue = parseErr.issues.find((issue) => issue.path.includes("audience"));
            if (audienceIssue !== undefined) {
              const hinted = new Error(audienceIssue.message) as Error & {
                code: string;
                action_hint: string;
              };
              hinted.code = "scope_coordinate_invalid";
              hinted.action_hint = SCOPE_COORDINATE_HINT;
              throw hinted;
            }
          }
          throw parseErr;
        }

        const projectRoot = resolveProjectRoot();
        const result = await extractKnowledge(projectRoot, validated);

        const response: typeof result & { warnings?: GateWarning[] } = { ...result };
        if (gateWarn) {
          response.warnings = [gateWarn];
        }

        // project-scope guard: fail-loud the unsealed-project drift at write
        // time — a bound write store with no project coordinate silently lands
        // team-layer entries flat instead of under projects/<id>/. Advisory.
        const scopeWarn = unsealedProjectScopeWarning(projectRoot);
        if (scopeWarn) {
          response.warnings = [...(response.warnings ?? []), scopeWarn];
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
          "fab_propose produced an unexpectedly large response — extract from a smaller span of text.",
        );

        // W3-K K4: single-line summary; full data in structuredContent.
        return {
          content: [
            {
              type: "text" as const,
              text: `Fabric propose: ${response.pending_path} (see structuredContent)`,
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        return toMcpToolError(error, { tool: "fab_propose" });
      } finally {
        tracker?.exit(requestId);
      }
    },
  );
}

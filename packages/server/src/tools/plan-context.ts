import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  planContextAnnotations,
  planContextInputSchema,
  planContextOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  enforcePayloadLimit,
  type PayloadGuardResult,
} from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { resolveProjectRoot } from "../meta-reader.js";
import { readPayloadLimits } from "../config-loader.js";
import {
  awaitFirstReconcileGate,
  gateWarning,
} from "../services/first-reconcile-gate.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { planContext, type PlanContextInput } from "../services/plan-context.js";
import { ensureKnowledgeFresh } from "../services/knowledge-sync.js";
import { type StructuredToolWarning } from "./payload-warning.js";

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
    async ({ paths, intent, known_tech, detected_entities, client_hash, correlation_id, session_id, target_paths, layer_filter }: PlanContextInput) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        // v2.0.0-rc.23 TASK-009 (d): wait at most 5s for the background
        // first reconcile to complete. On timeout or failure we still
        // serve the call from whatever meta is on disk, but tag the
        // response with a fail-loud warning so the caller knows.
        const gateResult = await awaitFirstReconcileGate();
        const gateWarn = gateWarning(gateResult);

        const projectRoot = resolveProjectRoot();
        // v2.0.0-rc.30 TASK-002 (G1 flip): opted into autoHealOnDrift after
        // rc.29 PARTIAL built the channel. micro-bench (knowledge-sync.bench.ts)
        // measured ~12% hz regression on the no-drift hot path (well below the
        // 30% threshold from the deferral plan) — drift→heal pairing now ships
        // by default, closing the 7% heal-coverage gap reported in rc.29 BUG-G1.
        const syncReport = await ensureKnowledgeFresh(projectRoot, { autoHealOnDrift: true });
        const payloadLimits = readPayloadLimits(projectRoot);
        const baseWarnings: StructuredToolWarning[] = [
          ...(gateWarn ? [gateWarn] : []),
          ...syncReport.warnings,
        ];
        const trimWarning = {
          code: 'mcp_payload_trimmed' as const,
          file: '<response>',
          message: 'Dropped lower-ranked candidate(s) to fit the MCP payload budget.',
          action_hint:
            'Dropped lower-ranked candidate(s) to fit the MCP payload budget (see omitted_candidate_count); narrow your intent or raise mcpPayloadLimits.hardBytes to surface more.',
        };
        const result = await planContext(projectRoot, {
          paths,
          intent,
          known_tech,
          detected_entities,
          client_hash,
          correlation_id,
          session_id,
          // F54 (ISS-20260531-090): these were declared in
          // planContextInputSchema but never forwarded to the service, so any
          // client/LLM-supplied value was silently discarded.
          target_paths,
          layer_filter,
          payload_budget: {
            limits: payloadLimits,
            warnings: baseWarnings,
            trim_warning: trimWarning,
          },
        });
        const {
          payload_over_budget: payloadOverBudget,
          payload_trimmed: payloadTrimmed,
          ...publicResult
        } = result;

        let response = {
          ...publicResult,
          warnings: baseWarnings,
        };

        if (payloadTrimmed === true) {
          response.warnings = [...response.warnings, trimWarning];
        }

        const serialized = JSON.stringify(response);
        // Service-level budget trimming runs before the selection token is
        // cached, so the token's selectable ids match the returned candidates.
        // The sole exception is a pathological single oversized candidate; the
        // service signals that state so we warn instead of reintroducing a 413.
        let guardResult: PayloadGuardResult;
        if (payloadOverBudget === true) {
          guardResult = { bytes: Buffer.byteLength(serialized, "utf8") };
          response.warnings = [
            ...response.warnings,
            {
              code: 'mcp_payload_warn',
              file: '<response>',
              message: 'Response still exceeds the hard payload budget after trimming; a single entry may be oversized.',
              action_hint: 'Response still exceeds the hard payload budget after trimming; a single entry may be oversized — raise mcpPayloadLimits.hardBytes or enrich that entry to be terser.',
            },
          ];
        } else {
          guardResult = enforcePayloadLimit(serialized, payloadLimits);
          if (guardResult.warning) {
            response.warnings = [
              ...response.warnings,
              {
                code: guardResult.warning.code,
                file: '<response>',
                message: guardResult.warning.message,
                action_hint: 'Consider narrowing the request scope to reduce response size',
              },
            ];
          }
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

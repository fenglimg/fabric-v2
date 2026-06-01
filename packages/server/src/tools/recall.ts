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
import { appendEventLedgerEvent } from "../services/event-ledger.js";

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
      layer_filter,
      ids,
      include_related,
    }) => {
      const requestId = randomUUID();
      // v2.1 GATE-INTERACT-T2 (#2 slice): time the round-trip so the MCP stdio
      // surface emits a `mcp_stdio_trace` ledger event (NEW-N-3 instrumentation).
      // Wall-clock via a monotonic-ish counter avoided: hrtime is fine server-side.
      const startedAt = process.hrtime.bigint();
      let traceStatus: "ok" | "error" = "ok";
      let payloadBytesOut = 0;
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
          // F54 (ISS-20260531-090): forwarded so recall→planContext honors the
          // declared layer restriction instead of silently discarding it.
          layer_filter,
          ids,
          include_related,
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

        payloadBytesOut = Buffer.byteLength(serialized, "utf8");
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response) }],
          structuredContent: response,
        };
      } catch (error) {
        traceStatus = "error";
        throw error;
      } finally {
        tracker?.exit(requestId);
        // Best-effort MCP stdio trace (telemetry must never break the tool).
        try {
          const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          const payloadBytesIn = Buffer.byteLength(
            JSON.stringify({ paths, intent, known_tech, detected_entities, target_paths, ids }),
            "utf8",
          );
          await appendEventLedgerEvent(resolveProjectRoot(), {
            event_type: "mcp_stdio_trace",
            ...(correlation_id ? { correlation_id } : {}),
            ...(session_id ? { session_id } : {}),
            tool_name: "fab_recall",
            request_id: requestId,
            duration_ms: durationMs,
            status: traceStatus,
            payload_bytes_in: payloadBytesIn,
            payload_bytes_out: payloadBytesOut,
          });
        } catch {
          // swallow — telemetry is never load-bearing.
        }
      }
    },
  );
}

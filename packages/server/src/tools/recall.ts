import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  recallAnnotations,
  recallInputSchema,
  recallOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { appendPayloadWarning, type StructuredToolWarning } from "./payload-warning.js";
import { toMcpToolError } from "./mcp-tool-error.js";
import {
  defaultProjectContextProvider,
  type ProjectContextProvider,
} from "../project-context-provider.js";
import { readPayloadLimits } from "../config-loader.js";
import {
  awaitFirstReconcileGate,
  gateWarning,
} from "../services/first-reconcile-gate.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { projectRootWarning } from "../services/project-root-warning.js";
import { recall, type RecallInput } from "../services/recall.js";
import { appendEventLedgerEvent } from "../services/event-ledger.js";

// v2.0.0-rc.37 NEW-3: one-call recall MCP tool. Mirrors plan-context.ts +
// knowledge-sections.ts envelope handling (gate wait + auto-heal + payload
// guard + structured warnings) so callers get identical telemetry surface
// regardless of whether they take the two-step or combined path.
export function registerRecall(
  server: McpServer,
  tracker?: InFlightTracker,
  contextProvider: ProjectContextProvider = defaultProjectContextProvider,
): void {
  server.registerTool(
    "fab_recall",
    {
      description:
        "Recall the Fabric knowledge relevant to the files you are about to touch. Pass candidate `paths` (+ optional `intent`) and receive a single ranked `entries[]` list (best-first — array index IS the rank). Each entry carries `description.summary` (always) plus optional `description.must_read_if` (omitted when identical to summary), `description.impact` (⚠️ consequence hints), `description.knowledge_type`, `read_path` (on-disk file for the body), `store_alias`, and `body_in_context:true` when the body is already injected at SessionStart. Full frontmatter fields (intent_clues / tech_stack / related / tags / relevance_paths) are NOT on the wire — Read the `read_path` to load them. Pass `ids` to scope surfaced read_paths, `include_related:true` to append one-hop neighbours, `include_score_breakdown:true` for numeric ranking diagnostics.",
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
      include_score_breakdown,
    }) => {
      const requestId = randomUUID();
      let context: ReturnType<ProjectContextProvider["snapshotForCall"]> | undefined;
      // v2.1 GATE-INTERACT-T2 (#2 slice): time the round-trip so the MCP stdio
      // surface emits a `mcp_stdio_trace` ledger event (NEW-N-3 instrumentation).
      // Wall-clock via a monotonic-ish counter avoided: hrtime is fine server-side.
      const startedAt = process.hrtime.bigint();
      let traceStatus: "ok" | "error" = "ok";
      let payloadBytesOut = 0;
      tracker?.enter(requestId);
      try {
        context = contextProvider.snapshotForCall();
        const gateResult = await awaitFirstReconcileGate();
        const gateWarn = gateWarning(gateResult);

        const projectRoot = context.workspaceRoot;
        // KT-PIT-0046: fail-loud when the root carries no project config —
        // the read-set is personal-only and the caller must know.
        const rootWarn = projectRootWarning(context);

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
          include_score_breakdown,
        };
        const result = await recall(projectRoot, input);

        const response: Record<string, unknown> & { warnings: StructuredToolWarning[] } = {
          ...result,
          warnings: [
            ...(gateWarn ? [gateWarn] : []),
            ...(rootWarn ? [rootWarn] : []),
          ],
        };

        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(response);
        const guardResult = enforcePayloadLimit(serialized, payloadLimits);
        response.warnings = appendPayloadWarning(
          response.warnings,
          guardResult,
          "Pass an explicit `ids` array (or a narrower `intent`) to scope fab_recall's entries — each entry carries a `read_path`, so Read it to load any body on demand.",
        );

        payloadBytesOut = Buffer.byteLength(serialized, "utf8");
        // W3-K K4: content[].text is a single-line human glance; the full data
        // rides in structuredContent (the agent reads that). Eliminates the
        // double-payload that bloated this response past the 16KB warn limit.
        return {
          content: [
            {
              type: "text" as const,
              text: `Fabric recall: ${result.entries.length} entries (see structuredContent)`,
            },
          ],
          structuredContent: response,
        };
      } catch (error) {
        traceStatus = "error";
        return toMcpToolError(error, {
          tool: "fab_recall",
          actionHint:
            "Pass non-empty paths[] and optional intent; ensure fabric install + bound stores.",
        });
      } finally {
        tracker?.exit(requestId);
        // Best-effort MCP stdio trace (telemetry must never break the tool).
        try {
          const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
          const payloadBytesIn = Buffer.byteLength(
            JSON.stringify({ paths, intent, known_tech, detected_entities, target_paths, ids }),
            "utf8",
          );
          if (context !== undefined) {
            await appendEventLedgerEvent(context.workspaceRoot, {
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
          }
        } catch {
          // swallow — telemetry is never load-bearing.
        }
      }
    },
  );
}

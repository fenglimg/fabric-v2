import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  FabPendingInputSchema,
  FabPendingInputShape,
  FabPendingOutputShape,
  fabPendingAnnotations,
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
import { reviewPending } from "../services/review.js";

// W3-K K2 (read/write split): fab_pending is the read-only browse/search surface
// lifted out of fab_review. It handles ONLY the two READ actions (list / search)
// and is registered readOnlyHint:true / idempotentHint:true so MCP hosts and AI
// callers can safely invoke the read path. The handler re-parses via the
// discriminatedUnion FabPendingInputSchema (the SDK-facing inputSchema is the
// flattened FabPendingInputShape; see api-contracts.ts for the SDK 1.29.0
// rationale) and delegates to the reviewPending service.
//
// P1 recall-engine-refactor (TASK-005): the `search` action now flows through the
// UNIFIED ranker — reviewPending → triageSearch → rankDescriptionItems('triage').
// fab_pending triage and fab_recall share ONE improved ranker; triage applies NO
// top_k / NO floor so pending review never silently drops a match.
export function registerPending(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_pending",
    {
      description:
        "Browse and search store-backed pending + canonical knowledge (read-only). Discriminated by `action`; required fields per action: " +
        "list → (filters optional, returns pending entries with `pending_path`); " +
        "search → query (filters optional, ranges over pending + canonical with `area`+`path`). " +
        "Never mutates state — pair with the write-only fab_review tool for approve/reject/modify/defer. Skill-side read tool — invoked by fabric-review / fabric-archive.",
      // Flat ZodRawShape required by MCP SDK 1.29.0 registerTool. The
      // authoritative cross-field contract still lives in FabPendingInputSchema
      // (discriminatedUnion) and is enforced inside the handler via
      // `FabPendingInputSchema.parse(input)`.
      inputSchema: FabPendingInputShape,
      outputSchema: FabPendingOutputShape,
      annotations: fabPendingAnnotations,
    },
    async (input: unknown) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        // v2.0.0-rc.23 TASK-009 (d): see plan-context.ts for rationale.
        const gateResult = await awaitFirstReconcileGate();
        const gateWarn = gateWarning(gateResult);

        // Narrow via the discriminatedUnion to recover full per-action
        // strictness (e.g. action=search requires a non-empty query).
        const narrowed = FabPendingInputSchema.parse(input);
        const projectRoot = resolveProjectRoot();
        const result = await reviewPending(projectRoot, narrowed);

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
          "fab_pending returned a large result set — pass a narrower filter (topic / status / id) to reduce response size.",
        );

        // W3-K K4: single-line summary; full data in structuredContent.
        return {
          content: [
            {
              type: "text" as const,
              text: `Fabric pending: ${response.action} (see structuredContent)`,
            },
          ],
          structuredContent: response,
        };
      } finally {
        tracker?.exit(requestId);
      }
    },
  );
}

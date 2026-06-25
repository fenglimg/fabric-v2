import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  archiveScanAnnotations,
  archiveScanInputSchema,
  archiveScanOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import { enforcePayloadLimit } from "@fenglimg/fabric-shared/node/mcp-payload-guard";
import { appendPayloadWarning } from "./payload-warning.js";
import { resolveProjectRoot } from "../meta-reader.js";
import { readPayloadLimits } from "../config-loader.js";
import { type InFlightTracker } from "../services/in-flight-tracker.js";
import { collectArchiveScan } from "../services/archive-scan.js";

// v2.0.0-rc.37 NEW-9: deterministic Phase 1 ledger scan for fabric-archive.
// Read-only: no gate wait / auto-heal needed (the scan reads events.jsonl, not
// the knowledge index). The Skill calls this, then loads digests for the
// returned session_ids + does semantic stitching.
export function registerArchiveScan(server: McpServer, tracker?: InFlightTracker): void {
  server.registerTool(
    "fab_archive_scan",
    {
      description:
        "Deterministic Phase 1 ledger scan for fabric-archive. Finds the most-recent knowledge_proposed anchor, forward-collects distinct session_ids since it, and applies the outcome-ledger filter (drop user_dismissed sessions, sessions inside the 12h anti-loop cooldown, and watermarked sessions with no new high-value signal). Returns the filtered session_ids (ready for digest load) plus already_proposed idempotency keys for cross-session pending dedupe. Replaces the error-prone LLM-side events.jsonl tail-scan.",
      inputSchema: archiveScanInputSchema,
      outputSchema: archiveScanOutputSchema,
      annotations: archiveScanAnnotations,
    },
    async ({ range, now_ms, correlation_id, session_id }) => {
      const requestId = randomUUID();
      tracker?.enter(requestId);
      try {
        const projectRoot = resolveProjectRoot();
        const result = await collectArchiveScan(projectRoot, {
          range,
          now_ms,
          correlation_id,
          session_id,
        });
        const payloadLimits = readPayloadLimits(projectRoot);
        const serialized = JSON.stringify(result);
        // v2.2 MC5-action-hint (W3-T3): symmetric warn surfacing via the shared helper.
        const guardResult = enforcePayloadLimit(serialized, payloadLimits);
        result.warnings = appendPayloadWarning(
          result.warnings,
          guardResult,
          "fab_archive_scan returned a large candidate set — pass an explicit `range` of session_ids to narrow the scan.",
        );
        // W3-K K4: single-line summary; full data in structuredContent.
        return {
          content: [
            {
              type: "text" as const,
              text: `Fabric archive scan: ${result.session_ids.length} sessions, ${result.dropped.length} dropped (see structuredContent)`,
            },
          ],
          structuredContent: result,
        };
      } finally {
        tracker?.exit(requestId);
      }
    },
  );
}

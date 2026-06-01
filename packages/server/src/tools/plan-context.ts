import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import {
  planContextAnnotations,
  planContextInputSchema,
  planContextOutputSchema,
} from "@fenglimg/fabric-shared/schemas/api-contracts";
import {
  enforcePayloadLimit,
  trimToPayloadBudget,
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
        });

        let response = {
          ...result,
          warnings: [
            ...(gateWarn ? [gateWarn] : []),
            ...syncReport.warnings,
          ],
        };

        const payloadLimits = readPayloadLimits(projectRoot);

        // v2.2 MC4-payload-budget (W1-T4): the byte-budget tail of the unified
        // truncation chain (CJK → BM25 → top_k → payload). Previously the guard
        // HARD-THREW a 413 when a well-seeded repo's response overflowed the
        // 64KB limit, crashing plan_context entirely. Now we trim the
        // LEAST-relevant candidates off the BM25-ranked tail until the envelope
        // fits — degrading gracefully and folding the dropped count into the
        // same `omitted_candidate_count` signal top_k already uses. Trimming
        // from the tail is safe because planContext returns candidates ranked
        // best-first.
        //
        // v2.2 W1-REVIEW (gemini HIGH): the trim warning itself costs ~250B, and
        // appending it AFTER the fit re-breached hardBytes (then enforcePayloadLimit
        // re-threw the 413 this feature removes). Fix: the measurement envelope
        // INCLUDES that warning whenever the list is being trimmed (i.e. shorter
        // than the full candidate set), so the post-trim payload — warning and all
        // — is what gets bounded. The full-list measurement stays bare, so a
        // response that already fits is never over-trimmed for a warning it will
        // not carry. The appended warning is byte-identical to the measured one
        // (the exact dropped count lives in omitted_candidate_count, not the text).
        //
        // v2.2 W1-REVIEW (codex-1, non-blocking): the selection_token was already
        // minted in planContext() over the POST-top_k candidate set, before this
        // byte-trim runs. So after a payload trim the token's
        // ai_selectable_stable_ids is a SUPERSET of the returned `candidates`.
        // This is benign: every candidate the client can see is still fetchable
        // (token ⊇ candidates — never the harmful reverse), and with the default
        // top_k=24 a >64KB response is essentially unreachable so this path rarely
        // fires. Recorded as a v2.3 consistency note (move the byte-trim into the
        // service before token mint) rather than fixed here, to avoid threading
        // the gate/sync warnings + payload limits down into planContext().
        const trimWarning = {
          code: 'mcp_payload_trimmed' as const,
          file: '<response>',
          action_hint:
            'Dropped lower-ranked candidate(s) to fit the MCP payload budget (see omitted_candidate_count); narrow your intent or raise mcpPayloadLimits.hardBytes to surface more.',
        };
        const trim = trimToPayloadBudget(
          response.candidates,
          (candidates) =>
            JSON.stringify(
              candidates.length === response.candidates.length
                ? response
                : { ...response, candidates, warnings: [...response.warnings, trimWarning] },
            ),
          payloadLimits,
        );
        if (trim.dropped > 0) {
          response = {
            ...response,
            candidates: trim.items,
            omitted_candidate_count: (response.omitted_candidate_count ?? 0) + trim.dropped,
          };
          response.warnings = [...response.warnings, trimWarning];
        }

        const serialized = JSON.stringify(response);
        // After the budget trim the envelope fits the hard limit in the common
        // case, so enforcePayloadLimit only contributes the soft WARN banner.
        // The sole exception is a pathological single oversized candidate
        // (trim.overBudget) — there we degrade to a warning rather than
        // re-introducing the 413 crash this task removed.
        let guardResult: PayloadGuardResult;
        if (trim.overBudget) {
          guardResult = { bytes: trim.bytes };
          response.warnings = [
            ...response.warnings,
            {
              code: 'mcp_payload_warn',
              file: '<response>',
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

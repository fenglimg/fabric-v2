import { readFile } from "node:fs/promises";

import { type AgentsLayer } from "@fenglimg/fabric-shared";
import { McpToolError } from "@fenglimg/fabric-shared/errors";

import { appendEventLedgerEvent } from "./event-ledger.js";
import { buildCrossStoreBodyIndex, computeReadSetRevision, type CrossStoreBodyRef } from "./cross-store-recall.js";
import { readSelectionToken } from "./plan-context.js";
import { loadIdRedirectMap, resolveRedirectedId } from "./id-redirect.js";
import { bumpCounter, METRIC_COUNTER_NAMES } from "./metrics.js";
// ISS-017: extractBody is now the single shared implementation in _shared.ts.
// Re-exported here to preserve the existing import surface (recall.ts +
// knowledge-sections.test.ts import it from this module).
import { extractBody } from "./_shared.js";
export { extractBody };

// v2.0.0-rc.23 TASK-013 (F8b): KNOWLEDGE_SECTION_NAMES + KnowledgeSectionName
// + the `missing_section` diagnostic + the per-section structured response
// were removed. After F8a deleted the scan baseline writers, the A-set
// `## [BRACKET]` heading discipline had no writer; the LLM-facing API now
// returns the full markdown body (frontmatter stripped) keyed by stable_id.
// See parseKnowledgeSections (now `extractBody`) below.

export type GetKnowledgeSectionsInput = {
  selection_token: string;
  ai_selected_stable_ids: string[];
  ai_selection_reasons: Record<string, string>;
  correlation_id?: string;
  session_id?: string;
  // v2.0 rc.5 TASK-014 (C5): client identity propagated into knowledge_consumed
  // events. Falls back to empty string when unset (full client-identity
  // propagation pattern deferred to rc.6 per TASK-014 note).
  client_hash?: string;
};

// v2.0.0-rc.29 TASK-006 (BUG-Q1): dropped `export` — only referenced inside
// this file (`KnowledgeSectionResult.diagnostics[]` field type + local
// `diagnostics: KnowledgeSectionDiagnostic[]` array). No external consumer.
type KnowledgeSectionDiagnostic = {
  // v2.0: warn-level signal that a fetched rule lacks knowledge metadata
  // (no `type` AND no `layer` in frontmatter). Surfaces un-migrated v1.x
  // files without breaking selection — the rule is still returned.
  // Wave D (F7): `unresolved_selected_id` — a store-qualified id surfaced by
  // cross-store recall has no project-meta node; skipped instead of crashing.
  code: "missing_knowledge_metadata" | "unresolved_selected_id";
  severity: "warn";
  stable_id: string;
  message: string;
};

export type KnowledgeSectionResult = {
  revision_hash: string;
  selected_stable_ids: string[];
  rules: Array<{
    stable_id: string;
    level: AgentsLayer;
    path: string;
    body: string;
  }>;
  diagnostics: KnowledgeSectionDiagnostic[];
  // v2.0.0-rc.37 NEW-24: populated when the input `ai_selected_stable_ids`
  // referenced a layer-flipped id that was transparently rewritten to the
  // post-flip canonical id before fetching. Maps OLD id → NEW id so the
  // caller can refresh its cached selection. Omitted when no rewrites fired.
  redirect_to?: { stable_id: string } | Record<string, string>;
};

/**
 * v2.0.0-rc.23 TASK-013 (F8b): strip a YAML frontmatter block from raw rule
 * markdown and return the remaining body. The frontmatter regex mirrors the
 * one in knowledge-meta-builder.ts (extractDescription / extractIdFromFrontmatter)
 * to keep parsing behavior consistent. When no frontmatter is present the
 * original content is returned unchanged.
 *
 * Replaces the legacy `parseKnowledgeSections` which split markdown into the
 * 4-element A-set enum (removed in F8b). The implementation now lives in
 * _shared.ts (ISS-017) and is re-exported above.
 */

export async function getKnowledgeSections(
  projectRoot: string,
  input: GetKnowledgeSectionsInput,
): Promise<KnowledgeSectionResult> {
  const token = readSelectionToken(input.selection_token);
  if (token === undefined) {
    // ISS-035: the MCP SDK serializes only `error.message` to the client, so
    // the recovery hint lives in the message AND the FabricError actionHint
    // field (the latter aligns with the payload-warning action_hint surface).
    throw new McpToolError(
      "selection_token is missing or expired — re-run fab_plan_context to obtain a fresh selection_token, then retry fab_get_knowledge_sections with the same ai_selected_stable_ids",
      {
        actionHint:
          "re-run fab_plan_context(paths) to mint a fresh selection_token, then call fab_get_knowledge_sections again with that token",
      },
    );
  }

  // v2.0.0-rc.37 NEW-24: rewrite any layer-flipped ids in the caller-supplied
  // selection BEFORE selectable-set validation. A stale id (cached from a
  // pre-flip plan-context call) would otherwise fail validation; with the
  // rewrite the caller transparently sees the new canonical id served and
  // gets back a redirect_to map describing every substitution that fired.
  let idRedirects: Map<string, string>;
  try {
    idRedirects = await loadIdRedirectMap(projectRoot);
  } catch {
    idRedirects = new Map();
  }
  const rewriteApplied: Record<string, string> = {};
  const rewrittenAiSelected = input.ai_selected_stable_ids.map((stableId) => {
    const resolved = resolveRedirectedId(idRedirects, stableId);
    if (resolved !== stableId) {
      rewriteApplied[stableId] = resolved;
    }
    return resolved;
  });
  // Reasons map keys may also reference the old id. Re-key onto the new id
  // so validateAiSelections sees a consistent (id, reason) pair set.
  const rewrittenReasons: Record<string, string> = { ...input.ai_selection_reasons };
  for (const [oldId, newId] of Object.entries(rewriteApplied)) {
    if (rewrittenReasons[oldId] !== undefined && rewrittenReasons[newId] === undefined) {
      rewrittenReasons[newId] = rewrittenReasons[oldId];
    }
  }

  validateAiSelections(token.ai_selectable_stable_ids, rewrittenAiSelected, rewrittenReasons);

  // v2.2 W5 R3 (读侧 cutover): co-location agents.meta retired. ALL knowledge now
  // lives in the read-set stores (team + personal), which ship no agents.meta —
  // so every selected id is resolved through the cross-store body index and its
  // body is read FROM THE STORE. The old project-meta path (loadActiveMeta →
  // buildRuleNodeIndex → throw on a bare colon-less id) is gone: there is no
  // project node table anymore. An id absent from the store index → genuinely
  // unresolved (deleted / not in read-set / stale client cache) → warn-skip,
  // never a hard throw, because the canonical store set is the only authority.
  const revision = computeReadSetRevision(projectRoot);
  const selectedStableIds = [...token.required_stable_ids, ...rewrittenAiSelected];
  const storeBodyIndex = buildCrossStoreBodyIndex(projectRoot);
  const unresolvedSelectedIds: string[] = [];
  const storeSelected: Array<{ stableId: string; ref: CrossStoreBodyRef }> = [];
  for (const stableId of selectedStableIds) {
    const ref = storeBodyIndex.get(stableId);
    if (ref !== undefined) {
      storeSelected.push({ stableId, ref });
    } else {
      unresolvedSelectedIds.push(stableId);
    }
  }
  const diagnostics: KnowledgeSectionDiagnostic[] = [];
  const rules: KnowledgeSectionResult["rules"] = [];

  // v2.2 全砍 F7 (HIGH) + W5 R3: deliver bodies from the read-set store. Store
  // entries are served as L1 with the store file path. A read failure here (file
  // vanished between walk + read) degrades to an unresolved diagnostic rather
  // than crashing the whole call.
  for (const { stableId, ref } of storeSelected) {
    let content: string;
    try {
      content = await readFile(ref.file, "utf8");
    } catch {
      unresolvedSelectedIds.push(stableId);
      continue;
    }
    rules.push({
      stable_id: stableId,
      level: "L1",
      path: ref.file,
      body: extractBody(content),
    });
  }

  for (const stableId of unresolvedSelectedIds) {
    diagnostics.push({
      code: "unresolved_selected_id",
      severity: "warn",
      stable_id: stableId,
      message: `Selected rule '${stableId}' is not present in the project's agents.meta.json or any read-set store — skipped (deleted, layer-flipped, or its store is not bound).`,
    });
  }

  const result: KnowledgeSectionResult = {
    revision_hash: revision,
    selected_stable_ids: rules.map((rule) => rule.stable_id),
    rules,
    diagnostics,
    // v2.0.0-rc.37 NEW-24: only surface redirect_to when a rewrite actually
    // fired. The shape is a `{ old_id: new_id, ... }` map so callers can
    // refresh multiple stale ids in one response; the legacy single-stable_id
    // form is preserved as a degenerate special case in the schema for
    // forward-compat (one rewrite = the canonical pre-rc.37 shape consumers
    // already understood).
    ...(Object.keys(rewriteApplied).length > 0 ? { redirect_to: rewriteApplied } : {}),
  };

  try {
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_selection",
      selection_token: input.selection_token,
      target_paths: token.target_paths,
      required_stable_ids: token.required_stable_ids,
      ai_selectable_stable_ids: token.ai_selectable_stable_ids,
      ai_selected_stable_ids: input.ai_selected_stable_ids,
      final_stable_ids: result.selected_stable_ids,
      ai_selection_reasons: pickSelectionReasons(input.ai_selected_stable_ids, input.ai_selection_reasons),
      rejected_stable_ids: [],
      ignored_stable_ids: [],
      correlation_id: input.correlation_id,
      session_id: input.session_id,
    });
  } catch {
    // Selection telemetry is best-effort and must not block rule delivery.
  }

  // v2.0.0-rc.37 Wave B (B3): dual-write counter rollup. Per-call bump for
  // the fetched signal; the audit event continues to land in events.jsonl
  // because orphan_demote consumes per-id final_stable_ids[]. Cutover to
  // counter-only happens post-GA after lint readers migrate.
  bumpCounter(projectRoot, METRIC_COUNTER_NAMES.knowledge_sections_fetched);
  try {
    // v2.0.0-rc.23 TASK-013 (F8b): `requested_sections` retained in the
    // ledger envelope for replay/audit continuity (event schema is generic
    // `z.array(z.string())`), but always emitted as an empty array now that
    // the `sections` input parameter was removed. Downstream cite-coverage /
    // orphan-demote replay code never reads this field — the canonical
    // signal is `final_stable_ids`.
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_sections_fetched",
      selection_token: input.selection_token,
      target_paths: token.target_paths,
      requested_sections: [],
      final_stable_ids: result.selected_stable_ids,
      ai_selected_stable_ids: input.ai_selected_stable_ids,
      diagnostics,
      correlation_id: input.correlation_id,
      session_id: input.session_id,
    });
  } catch {
    // Fetch telemetry is best-effort and must not block rule delivery.
  }

  // v2.0 rc.5 TASK-014 (C5): emit one knowledge_consumed event per unique
  // stable_id resolved by this fetch. Dedupe within a single request via a
  // Set so a stable_id appearing more than once in the resolved rule list
  // produces exactly one event. Drives doctor lint #16 (orphan_demote) via
  // replay-derived last_consumed_at.
  const consumedAt = new Date().toISOString();
  const consumedClientHash = input.client_hash ?? "";
  const emittedConsumed = new Set<string>();
  for (const stableId of result.selected_stable_ids) {
    if (emittedConsumed.has(stableId)) {
      continue;
    }
    emittedConsumed.add(stableId);
    // v2.0.0-rc.37 Wave B (B3): dual-write per-id consumption counter alongside
    // the audit event. Counter name embeds the stable_id so post-GA migration
    // of orphan_demote / cite-coverage can switch to reading the metrics
    // sidecar without losing per-entry granularity.
    bumpCounter(projectRoot, `${METRIC_COUNTER_NAMES.knowledge_consumed}:${stableId}`);
    try {
      await appendEventLedgerEvent(projectRoot, {
        event_type: "knowledge_consumed",
        stable_id: stableId,
        consumed_at: consumedAt,
        client_hash: consumedClientHash,
        correlation_id: input.correlation_id,
        session_id: input.session_id,
      });
    } catch {
      // Consumption telemetry is best-effort and must not block rule delivery.
    }
  }

  return result;
}

function validateAiSelections(
  aiSelectableStableIds: string[],
  aiSelectedStableIds: string[],
  aiSelectionReasons: Record<string, string>,
): void {
  const selectable = new Set(aiSelectableStableIds);

  for (const stableId of aiSelectedStableIds) {
    if (!selectable.has(stableId)) {
      throw new Error(
        `Invalid rule selection "${stableId}": not in this token's plan-context candidates. Pass only stable_ids from fab_plan_context candidates[].stable_id.`,
      );
    }
    // v2.2 全砍 F8: ai_selection_reasons is OPTIONAL (audit telemetry) per the
    // schema (`.optional().default({})` — "Omit to fetch bodies without
    // annotating"). The server previously REQUIRED a reason per selected id,
    // contradicting the advertised contract and rejecting a documented call
    // shape. Reasons are now genuinely optional — a missing/empty reason is
    // recorded as-is and never blocks body delivery.
  }
}

// v2.2 W5 R3 (读侧 cutover): buildRuleNodeIndex / sortRuleNodes / outputLevelOrder
// / resolveRuleSourcePath were the co-location project-meta delivery path (node
// table lookup, L0/L1/L2 priority sort, content_ref→abs-path resolution). All
// retired — store-qualified bodies are resolved via buildCrossStoreBodyIndex and
// read directly from `ref.file` (an absolute store path), so no node index, no
// level/priority sort, and no content_ref resolution are needed anymore.

function pickSelectionReasons(
  selectedStableIds: string[],
  reasons: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(selectedStableIds.map((stableId) => [stableId, reasons[stableId] ?? ""]));
}

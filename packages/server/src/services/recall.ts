// v2.0.0-rc.37 NEW-3: combined one-call recall service.
//
// Wraps the existing two-step (planContext → getKnowledgeSections) into a
// single MCP-tool surface. After Wave A1 removed server-side `selectable`
// filtering, the AI's "id selection" step is almost always "pick all" — this
// service makes that the default path, but still leaves the explicit `ids`
// hatch open for callers that want to scope.
//
// Internally it still walks the canonical services so emitted ledger events
// (knowledge_context_planned + knowledge_selection + knowledge_sections_fetched
// + knowledge_consumed) and the selection_token caching path are byte-equal
// to the two-step flow. Callers that need additional fetches against the same
// token can keep calling fab_get_knowledge_sections — the returned token is
// the same one fab_plan_context would have emitted.

import { planContext, type PlanContextInput, type PlanContextResult } from "./plan-context.js";
import { getKnowledgeSections, extractBody } from "./knowledge-sections.js";
import { loadIdRedirectMap, resolveRedirectedId } from "./id-redirect.js";

export type RecallInput = PlanContextInput & {
  /**
   * Optional explicit set of stable_ids to fetch bodies for. When omitted,
   * fab_recall picks up every stable_id surfaced in the shared description
   * index (the common case after rc.37 selectable-filter removal). When
   * provided, filters the fetched body set to this intersection.
   */
  ids?: string[];
};

export type RecallResult = PlanContextResult & {
  rules: Array<{
    stable_id: string;
    level: "L0" | "L1" | "L2";
    path: string;
    body: string;
  }>;
  selected_stable_ids: string[];
  diagnostics: Array<{
    code: "missing_knowledge_metadata";
    severity: "warn";
    stable_id: string;
    message: string;
  }>;
};

// Synth `ai_selection_reasons` payload for the underlying
// fab_get_knowledge_sections call. The combined surface skips the AI
// reasoning ceremony, so we stamp a uniform marker string per id; downstream
// audits (cite-coverage / orphan-demote replay) treat it as a system-driven
// recall, distinguishable from genuine AI-chosen selections.
const RECALL_REASON_MARKER = "fab_recall: combined-call auto-selection";

export async function recall(projectRoot: string, input: RecallInput): Promise<RecallResult> {
  const planResult = await planContext(projectRoot, input);

  const candidateIds = planResult.candidates.map((item) => item.stable_id);
  // v2.0.0-rc.37 NEW-24: callers passing `ids` may hand back a stale (pre
  // layer-flip) id. Rewrite via the redirect resolver so the substitution
  // happens before the intersection check; the rewritten ids are what we
  // actually fetch. Best-effort — if the ledger read fails we just skip the
  // rewrite and let the intersection naturally drop the stale id.
  let rewrittenIds: string[] | undefined;
  if (input.ids !== undefined) {
    try {
      const redirectMap = await loadIdRedirectMap(projectRoot);
      rewrittenIds = input.ids.map((id) => resolveRedirectedId(redirectMap, id));
    } catch {
      rewrittenIds = input.ids;
    }
  }
  const effectiveIds = rewrittenIds ?? candidateIds;
  const requestedIds = effectiveIds.filter((id) => candidateIds.includes(id));
  // De-dupe while preserving the candidate ordering — planContext already
  // dedupes via dedupeDescriptionIndex; we just preserve that order for the
  // bodies array so callers see stable response shape.
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const id of candidateIds) {
    if (requestedIds.includes(id) && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }

  // Empty-fetch path: no candidates → return the plan envelope with empty
  // rules/diagnostics. Avoids a spurious getKnowledgeSections call that would
  // immediately validate-then-no-op.
  if (orderedIds.length === 0) {
    return {
      ...planResult,
      rules: [],
      selected_stable_ids: [],
      diagnostics: [],
    };
  }

  const reasons: Record<string, string> = {};
  for (const id of orderedIds) {
    reasons[id] = RECALL_REASON_MARKER;
  }

  const sectionsResult = await getKnowledgeSections(projectRoot, {
    selection_token: planResult.selection_token,
    ai_selected_stable_ids: orderedIds,
    ai_selection_reasons: reasons,
    correlation_id: input.correlation_id,
    session_id: input.session_id,
    client_hash: input.client_hash,
  });

  return {
    ...planResult,
    rules: sectionsResult.rules,
    selected_stable_ids: sectionsResult.selected_stable_ids,
    diagnostics: sectionsResult.diagnostics,
  };
}

// Re-exported for test scaffolds that want to strip frontmatter consistently
// with the section-fetch path.
export { extractBody };

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
  /**
   * v2.2 MC1-recall-pack (W2-T4): when true, expand the fetched set with the
   * one-hop `related` graph neighbours (H2) of the selected entries that are
   * also present in the candidate index. Lets a scoped `ids` recall pull in the
   * connected knowledge without a second round-trip. No-op when `ids` is omitted
   * (every candidate is already fetched) or no related edges resolve in-corpus.
   */
  include_related?: boolean;
};

// v2.2 MC1-recall-pack (W2-T4): packaging increments that make the one-call
// recall self-describing — a behavioral directive, dynamic next-step hints, and
// a truncation summary — so the agent does not have to infer next actions from
// raw fields.
export type RecallTruncation = {
  omitted_candidate_count: number;
  returned_candidate_count: number;
};

export type RecallResult = PlanContextResult & {
  rules: Array<{
    stable_id: string;
    level: "L0" | "L1" | "L2";
    path: string;
    body: string;
    // lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测 / D7): per-rule
    // store provenance. cross-store-recall stamps candidate ids `<alias>:<id>`;
    // this surfaces that store alias as a structured field so the caller can
    // trace each recalled entry to its origin store without re-parsing the id.
    // Omitted for project-local entries (bare id, no alias prefix). Additive.
    store?: { alias: string };
  }>;
  selected_stable_ids: string[];
  diagnostics: Array<{
    code: "missing_knowledge_metadata" | "unresolved_selected_id";
    severity: "warn";
    stable_id: string;
    message: string;
  }>;
  // v2.2 MC1-recall-pack (W2-T4): packaging increments.
  directive: string;
  next_steps?: string[];
  truncation?: RecallTruncation;
};

// Synth `ai_selection_reasons` payload for the underlying
// fab_get_knowledge_sections call. The combined surface skips the AI
// reasoning ceremony, so we stamp a uniform marker string per id; downstream
// audits (cite-coverage / orphan-demote replay) treat it as a system-driven
// recall, distinguishable from genuine AI-chosen selections.
const RECALL_REASON_MARKER = "fab_recall: combined-call auto-selection";

// v2.2 MC1-recall-pack (W2-T4): the standing behavioral directive returned on
// every recall. Reinforces the cite-before-edit contract (D4 AI-in-loop) at the
// exact moment the agent has the KB bodies in hand and is about to act on them.
const RECALL_DIRECTIVE =
  "Before you edit or commit to a decision, cite the KB id you apply or dismiss (first reply line: `KB: <id> [applied|dismissed:<reason>]`).";

export async function recall(projectRoot: string, input: RecallInput): Promise<RecallResult> {
  const planResult = await planContext(projectRoot, input);

  const candidateIds = planResult.candidates.map((item) => item.stable_id);
  const candidateLookup = new Map<string, string>();
  for (const id of candidateIds) {
    for (const key of relatedLookupKeys(id)) {
      if (!candidateLookup.has(key)) {
        candidateLookup.set(key, id);
      }
    }
  }
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
  // ISS-20260531-092 / ISS-20260531-105: keep the candidate-order contract,
  // but use Sets for membership so explicit-id recall is O(N + M), not O(N*M).
  const candidateIdSet = new Set(candidateIds);
  const requestedIdSet = new Set(effectiveIds.filter((id) => candidateIdSet.has(id)));
  // De-dupe while preserving the candidate ordering — planContext already
  // dedupes via dedupeDescriptionIndex; we just preserve that order for the
  // bodies array so callers see stable response shape.
  const seen = new Set<string>();
  const orderedIds: string[] = [];
  for (const id of candidateIds) {
    if (requestedIdSet.has(id) && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }

  // v2.2 MC1-recall-pack (W2-T4): include_related graph expansion. Collect the
  // one-hop `related` (H2) ids declared by the currently-selected entries, then
  // append those that are present in the candidate index but not yet selected
  // (preserving candidate order). Bounded to the candidate set so every added id
  // is fetchable under the same selection_token — a related id outside the
  // surfaced corpus is intentionally skipped rather than fetched out of band.
  let relatedAvailableNotIncluded = false;
  if (input.include_related === true) {
    const relatedIds = new Set<string>();
    for (const candidate of planResult.candidates) {
      if (!seen.has(candidate.stable_id)) continue;
      for (const rel of candidate.description.related ?? []) {
        const resolved = candidateLookup.get(rel);
        if (resolved !== undefined) {
          relatedIds.add(resolved);
        }
      }
    }
    for (const id of candidateIds) {
      if (relatedIds.has(id) && !seen.has(id)) {
        seen.add(id);
        orderedIds.push(id);
      }
    }
  } else {
    // Surface (without fetching) whether the selected entries point at related
    // entries the caller could pull in via include_related.
    relatedAvailableNotIncluded = planResult.candidates.some(
      (candidate) =>
        seen.has(candidate.stable_id) &&
        (candidate.description.related ?? []).some((rel) => {
          const resolved = candidateLookup.get(rel);
          return resolved !== undefined && !seen.has(resolved);
        }),
    );
  }

  const packaging = buildRecallPackaging(planResult, relatedAvailableNotIncluded);

  // Empty-fetch path: no candidates → return the plan envelope with empty
  // rules/diagnostics. Avoids a spurious getKnowledgeSections call that would
  // immediately validate-then-no-op.
  if (orderedIds.length === 0) {
    return {
      ...planResult,
      rules: [],
      selected_stable_ids: [],
      diagnostics: [],
      ...packaging,
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
    rules: sectionsResult.rules.map(attachStoreProvenance),
    selected_stable_ids: sectionsResult.selected_stable_ids,
    diagnostics: sectionsResult.diagnostics,
    ...packaging,
  };
}

// lifecycle-refactor W3-T4 (§2 store 轴 / store-qualified 观测): derive per-rule
// store provenance from a store-qualified stable_id. cross-store-recall stamps
// candidate ids `<alias>:<stable_id>` (the local id is a `K[PT]-...` token that
// never contains a colon, so the prefix before the FIRST colon is the alias).
// A bare (project-local) id yields no `store` field. Pure + additive — only
// attaches the optional field; never mutates the existing rule shape.
export function attachStoreProvenance<T extends { stable_id: string }>(rule: T): T & { store?: { alias: string } } {
  const colon = rule.stable_id.indexOf(":");
  if (colon <= 0) {
    return rule;
  }
  const alias = rule.stable_id.slice(0, colon);
  return { ...rule, store: { alias } };
}

function relatedLookupKeys(stableId: string): string[] {
  const parts = stableId.split(":");
  const localId = parts.at(-1);
  return localId === undefined || localId === stableId ? [stableId] : [stableId, localId];
}

// v2.2 MC1-recall-pack (W2-T4): assemble the directive / next_steps / truncation
// packaging from the plan envelope. Pure — derives entirely from the already-
// computed planResult plus the related-availability flag.
function buildRecallPackaging(
  planResult: PlanContextResult,
  relatedAvailableNotIncluded: boolean,
): { directive: string; next_steps?: string[]; truncation?: RecallTruncation } {
  const omitted = planResult.omitted_candidate_count ?? 0;
  const nextSteps: string[] = [];
  if (omitted > 0) {
    nextSteps.push(
      `${omitted} lower-ranked candidate(s) were omitted by the retrieval budget — pass a narrower intent (or raise plan_context_top_k / the retrieval_budget_profile) to surface them.`,
    );
  }
  if (relatedAvailableNotIncluded) {
    nextSteps.push(
      "Selected entries link to related KB entries (graph edges) — pass include_related:true to fetch them in the same call.",
    );
  }
  return {
    directive: RECALL_DIRECTIVE,
    ...(nextSteps.length > 0 ? { next_steps: nextSteps } : {}),
    ...(omitted > 0
      ? { truncation: { omitted_candidate_count: omitted, returned_candidate_count: planResult.candidates.length } }
      : {}),
  };
}

// Re-exported for test scaffolds that want to strip frontmatter consistently
// with the section-fetch path.
export { extractBody };

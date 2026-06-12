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

import { readFile } from "node:fs/promises";

import { planContext, type PlanContextInput, type PlanContextResult } from "./plan-context.js";
import { getKnowledgeSections, extractBody } from "./knowledge-sections.js";
import { buildCrossStoreBodyIndex } from "./cross-store-recall.js";
import { loadIdRedirectMap, resolveRedirectedId } from "./id-redirect.js";
import { readRecallBodyBudget } from "../config-loader.js";

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

// grill-report C-003/C-009 (body-tier): the split between discovery layer
// (every top_k candidate's description, always returned via `candidates`) and
// application layer (full bodies, only for the highest-ranked few that fit
// BODY_BUDGET). `bodies_returned` = rules[] length; `description_only` = how many
// surfaced candidates carry a description but NO eager body (fetch on demand via
// fab_get_knowledge_sections with the returned selection_token). Omitted when no
// candidate was held back (the response carried every candidate's body).
export type RecallBodyTier = {
  bodies_returned: number;
  description_only: number;
};

export type RecallResult = PlanContextResult & {
  rules: Array<{
    stable_id: string;
    path: string;
    body: string;
    // grill-report C-005 (body-tier): set when the body was sliced to keep the
    // response under the hard payload ceiling (a single oversized head entry).
    // The full body remains fetchable via fab_get_knowledge_sections. Omitted in
    // the common case (body delivered whole). Additive.
    truncated?: boolean;
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
  // grill-report C-003/C-009 (body-tier): the discovery/application split summary.
  body_tier?: RecallBodyTier;
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

  // grill-report C-003/C-004/C-006/C-009 (body-tier): decide which surfaced
  // candidates ship a full body. The auto-select default (no explicit `ids`) is
  // capped by BODY_BUDGET — accumulate body bytes in rank order, stop at the
  // first overflow, the rest stay description-only (still in `candidates`,
  // fetchable on demand via fab_get_knowledge_sections + the returned
  // selection_token). Explicit `ids` (and the include_related expansion that
  // only fires WITH explicit ids) bypass the budget per C-006 — the on-demand
  // escape hatch must not be re-throttled — and fetch every requested body.
  // payloadHardBytes is resolved here too for the C-005 ceiling guard below.
  const { bodyBudgetBytes, payloadHardBytes } = readRecallBodyBudget(projectRoot);
  let bodyFetchIds = orderedIds;
  if (input.ids === undefined && orderedIds.length > 1) {
    bodyFetchIds = await selectBodyBudgetedIds(projectRoot, orderedIds, bodyBudgetBytes);
  }
  // description_only = surfaced candidates we did NOT ship an eager body for
  // (budget-trimmed on the auto path; 0 on the explicit-ids/related path).
  const descriptionOnlyCount = orderedIds.length - bodyFetchIds.length;
  const packaging = buildRecallPackaging(planResult, relatedAvailableNotIncluded, descriptionOnlyCount);

  // Empty-fetch path: no candidates → return the plan envelope with empty
  // rules/diagnostics. Avoids a spurious getKnowledgeSections call that would
  // immediately validate-then-no-op. selectBodyBudgetedIds floors at 1, so when
  // orderedIds is non-empty bodyFetchIds is too (diagnostics for an unresolved
  // head are still produced by getKnowledgeSections below).
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
  for (const id of bodyFetchIds) {
    reasons[id] = RECALL_REASON_MARKER;
  }

  const sectionsResult = await getKnowledgeSections(projectRoot, {
    selection_token: planResult.selection_token,
    ai_selected_stable_ids: bodyFetchIds,
    ai_selection_reasons: reasons,
    correlation_id: input.correlation_id,
    session_id: input.session_id,
    client_hash: input.client_hash,
  });

  const result: RecallResult = {
    ...planResult,
    rules: sectionsResult.rules.map(attachStoreProvenance),
    selected_stable_ids: sectionsResult.selected_stable_ids,
    diagnostics: sectionsResult.diagnostics,
    ...packaging,
    ...(descriptionOnlyCount > 0
      ? {
          body_tier: {
            bodies_returned: sectionsResult.rules.length,
            description_only: descriptionOnlyCount,
          },
        }
      : {}),
  };

  // grill-report C-005: recall MUST NOT 413. A pathological single oversized
  // head body (the floor entry that alone blew the budget) is sliced + flagged
  // so the assembled envelope fits the hard ceiling.
  return applyBodyHardCeiling(result, payloadHardBytes);
}

// grill-report C-004/C-005 (body-tier): pick the rank-ordered prefix of
// candidates whose bodies fit BODY_BUDGET. Floors at the #1 candidate (always
// returned, even if its body alone overflows or it is unresolvable — in which
// case getKnowledgeSections emits the warn diagnostic), then accumulates body
// bytes until the next one would overflow. Caller only invokes this on the
// auto-select path with > 1 candidate. Reads bodies via the same cross-store
// index getKnowledgeSections uses; an unresolvable / unreadable entry measures
// as 0 bytes (it ships no body anyway). Best-effort: a body-index build failure
// degrades to "fetch everything" (lean is an optimization, never a hard gate).
async function selectBodyBudgetedIds(
  projectRoot: string,
  orderedIds: string[],
  bodyBudgetBytes: number,
): Promise<string[]> {
  let bodyIndex: Awaited<ReturnType<typeof buildCrossStoreBodyIndex>>;
  try {
    bodyIndex = await buildCrossStoreBodyIndex(projectRoot);
  } catch {
    return orderedIds;
  }
  const measure = async (id: string): Promise<number> => {
    const ref = bodyIndex.get(id);
    if (ref === undefined) return 0;
    try {
      return Buffer.byteLength(extractBody(await readFile(ref.file, "utf8")), "utf8");
    } catch {
      return 0;
    }
  };
  const kept: string[] = [];
  let acc = 0;
  for (const id of orderedIds) {
    const bytes = await measure(id);
    if (kept.length === 0) {
      // Floor (C-005): always keep #1, regardless of size/resolvability.
      kept.push(id);
      acc += bytes;
      continue;
    }
    if (acc + bytes > bodyBudgetBytes) break; // C-004: stop at first overflow.
    kept.push(id);
    acc += bytes;
  }
  return kept;
}

// grill-report C-005 (body-tier): keep the assembled recall envelope under the
// hard payload ceiling so the tool layer never throws 413. The only realistic
// overflow under body-tier is a single oversized FLOOR body (the #1 candidate
// kept past BODY_BUDGET). Slice the longest body (marking it `truncated`) and
// re-measure until it fits — the full body stays fetchable via
// fab_get_knowledge_sections. RESERVE leaves room for the `warnings` array the
// tool layer appends after recall returns. Pure (no I/O).
const TOOL_ENVELOPE_RESERVE_BYTES = 4096;
const BODY_TRUNCATION_MARKER =
  "\n\n…[truncated to fit the recall payload ceiling — fetch the full body via fab_get_knowledge_sections]";

function applyBodyHardCeiling(result: RecallResult, payloadHardBytes: number): RecallResult {
  const cap = Math.max(1024, payloadHardBytes - TOOL_ENVELOPE_RESERVE_BYTES);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") <= cap) {
    return result;
  }
  const rules = result.rules.map((rule) => ({ ...rule }));
  let truncatedAny = false;
  // Bounded loop: JSON escaping makes the per-cut byte delta nonlinear, so slice
  // the longest body, re-measure, repeat (cap 8 iterations).
  for (let i = 0; i < 8; i++) {
    const bytes = Buffer.byteLength(JSON.stringify({ ...result, rules }), "utf8");
    if (bytes <= cap) break;
    let idx = -1;
    let longest = -1;
    for (let j = 0; j < rules.length; j++) {
      if (rules[j].body.length > longest) {
        longest = rules[j].body.length;
        idx = j;
      }
    }
    if (idx < 0 || rules[idx].body.length <= BODY_TRUNCATION_MARKER.length) break;
    const overflow = bytes - cap;
    // body.length is CHARS; non-ASCII bytes ≈ 3× chars, so cutting `overflow`
    // chars drops ≥ overflow bytes — safe (never under-cuts). Converges fast.
    const keepLen = Math.max(0, rules[idx].body.length - overflow - BODY_TRUNCATION_MARKER.length);
    rules[idx] = {
      ...rules[idx],
      body: rules[idx].body.slice(0, keepLen) + BODY_TRUNCATION_MARKER,
      truncated: true,
    };
    truncatedAny = true;
  }
  if (!truncatedAny) return result;
  return {
    ...result,
    rules,
    next_steps: [
      ...(result.next_steps ?? []),
      "A recalled body was truncated to fit the payload ceiling — fetch its full content via fab_get_knowledge_sections (same selection_token + the rule's stable_id).",
    ],
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
  descriptionOnlyCount: number,
): { directive: string; next_steps?: string[]; truncation?: RecallTruncation } {
  const omitted = planResult.omitted_candidate_count ?? 0;
  const nextSteps: string[] = [];
  // grill-report C-003 (body-tier): the discovery→application escape-hatch hint.
  // These candidates ARE present (with descriptions) in `candidates`; only their
  // bodies were held back by BODY_BUDGET. The selection_token caches the FULL
  // candidate set, so any of them is fetchable on demand.
  if (descriptionOnlyCount > 0) {
    nextSteps.push(
      `${descriptionOnlyCount} lower-ranked candidate(s) returned description-only (body-tier budget) — read their description in candidates[], and fetch any body on demand via fab_get_knowledge_sections with the returned selection_token + the candidate's stable_id.`,
    );
  }
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

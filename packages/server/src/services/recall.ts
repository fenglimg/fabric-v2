// W1 (KT-DEC-0026 / KT-GLD-0005): recall collapses to ONE lean tool that returns
// candidate DESCRIPTIONS + native READ PATHS only — it no longer delivers bodies.
//
// Rationale (KT-GLD-0005 cost-asymmetry): an eagerly-injected body is a PERMANENT
// per-recall context tax that cannot be reclaimed; a body the agent actually needs
// is one cheap native `Read` away (recoverable). The description+path index is
// enough to drive discovery; the agent reads the body on demand from the path,
// which the PostToolUse hook (KT-DEC-0030) observes as `knowledge_body_read`.
//
// This is the Memory-style shape: a dynamically-generated index (candidates) +
// the file path to Read for the full entry — no server-side body packaging,
// budget slicing, or two-step selection_token ceremony.

import type { RecallScoreBreakdown } from "@fenglimg/fabric-shared";

import {
  planContext,
  type PlanContextInput,
  type PlanContextResult,
  type PreflightDiagnostic,
} from "./plan-context.js";
import { buildCrossStoreBodyIndex } from "./cross-store-recall.js";
import { loadIdRedirectMap, resolveRedirectedId } from "./id-redirect.js";

export type RecallInput = PlanContextInput & {
  /**
   * Optional explicit set of stable_ids to SCOPE the returned read paths to.
   * When omitted, `paths` carries one entry per surfaced candidate. The candidate
   * DESCRIPTION index is always returned in full for discovery — `ids` only narrows
   * which read paths are surfaced (e.g. `recall(ids)` when the agent already knows
   * which entries it wants to Read). Stale (pre layer-flip) ids are redirect-rewritten
   * before the match.
   */
  ids?: string[];
  /**
   * When true, forwarded to planContext, which appends the one-hop `related` graph
   * neighbours (H2) of the surfaced set to the candidate index (descriptions only —
   * NO body). Their read paths are included in `paths` like any other candidate
   * (W1-3 / KT-DEC-0031: surface the related id, do not fetch its body).
   */
  include_related?: boolean;
  /**
   * TASK-006 (KT-PIT-0036 observability opt-in): when true, populate
   * `entry.score_breakdown` with the numbers-only signal decomposition
   * (bm25/vector/salience/recency/locality/proximity/credibility → final).
   * Off by default for wire efficiency. Enable when debugging ranking or tuning
   * scoring weights. The final===score invariant is enforced at the plan-context
   * service layer (candidate_scores Map) regardless of this flag.
   */
  include_score_breakdown?: boolean;
};

// W1 (KT-DEC-0026): one read path per surfaced candidate. `path` is the on-disk
// knowledge file (under the mounted store) the agent Reads to load the body on
// demand. `store` is the originating store alias (derived from the store-qualified
// stable_id), omitted for unqualified entries.
export type RecallPath = {
  stable_id: string;
  path: string;
  store?: { alias: string };
};

// wire-slim (payload): the MCP recall entry carries ONLY the fields the agent
// needs to SELECT which bodies to Read — summary (headline) + must_read_if
// (trigger) + impact (consequence) + knowledge_type (category). The
// verbose/engine-only fields (intent_clues, tech_stack, tags, relevance_paths, related,
// created_at, maturity, semantic_scope, relevance_scope, id) are reachable on
// demand via read_path — KT-DEC-0026's lean contract applied at the description
// FIELD level. Internal consumers (related graph, doctor lints, ranking) read
// planResult.candidates / the raw store, never this projected wire shape, so the
// slim is wire-only. Isolated as its own type here to avoid rippling RuleDescription.
type FullRuleDescription = PlanContextResult["candidates"][number]["description"];
export type RecallEntryDescription = Pick<FullRuleDescription, "summary"> &
  // TASK-002: must_read_if is omitted on the wire when identical to `summary`.
  // TASK-005: intent_clues dropped from wire (0 hook consumers) — the .md body
  // remains reachable via read_path. `impact` KEPT per PLN-002 semantic-
  // preservation decision (knowledge-hint-narrow.cjs:1265 consumes it for the
  // "⚠️ 后果" narrow-hint line); `knowledge_type` KEPT per PLN-002 (cite-contract-
  // reminder.cjs:89 consumes it). Selection = summary + must_read_if (when
  // distinct) + impact + knowledge_type.
  Partial<Pick<FullRuleDescription, "must_read_if" | "impact" | "knowledge_type">>;

// ux-w2-4: one unified entry folds the former candidates[] (description) ×
// paths[] (read path) join into a single self-contained item.
// TASK-004 wire thinning: `rank` (derivable from array index — entries are already
// returned best-first), `score` (redundant with score_breakdown.final by
// KT-PIT-0036 invariant), and nested `store: {alias}` (no extensibility signal)
// removed; store surface flattened to `store_alias`.
export type RecallEntry = {
  stable_id: string;
  description: RecallEntryDescription;
  read_path?: string;
  store_alias?: string;
  body_in_context?: boolean;
  // P1 recall-observability: numbers-only decomposition of the plan-context
  // sort score. Observability infrastructure — additive/optional, never carries
  // body text (lean read_path contract). Consumers reconstruct the ranking
  // signal from score_breakdown.final (KT-PIT-0036 final===score invariant).
  score_breakdown?: RecallScoreBreakdown;
};

// W1 (KT-DEC-0026) + ux-w2-4: the lean recall envelope. Inherits the plan
// envelope's discovery fields EXCEPT its two list shapes (the per-path
// requirement-profile `entries[]` and the description `candidates[]`) — recall
// replaces both with a single merged `entries[]` (description + read_path + rank
// + body_in_context). The two-step `selection_token` is intentionally dropped —
// there is no fab_get_knowledge_sections fetch to feed it (KT-DEC-0002).
export type RecallResult = Omit<
  PlanContextResult,
  | "selection_token"
  | "payload_trimmed"
  | "payload_over_budget"
  | "entries"
  | "candidates"
  // P1: candidate_scores is folded into each entry's score/score_breakdown — recall
  // does not re-surface the raw Map.
  | "candidate_scores"
  // TASK-001 envelope thinning: 0-consumer wire fields (grep-verified against
  // packages/cli/**/hooks — no consumer). Cite policy is bootstrap-injected
  // via AGENTS.md + SessionStart, no per-response echo needed.
  | "stale"
  | "intent"
  // TASK-003: transformed to dropped_ids + dropped_reasons below. Preserves
  // KT-DEC-0028 id-transparency while hoisting the reason to a per-response
  // count map (68/68 same-reason observed in ANL-002 sample).
  | "dropped"
  // TASK-003: emitted only when non-empty (was: always [] on steady state).
  | "preflight_diagnostics"
> & {
  entries: RecallEntry[];
  next_steps?: string[];
  dropped_ids?: string[];
  dropped_reasons?: { retrieval_budget?: number; payload_budget?: number };
  preflight_diagnostics?: PreflightDiagnostic[];
};

export async function recall(projectRoot: string, input: RecallInput): Promise<RecallResult> {
  const planResult = await planContext(projectRoot, input);
  // P1: pull candidate_scores out of the rest-spread — recall folds it into each
  // entry's score/score_breakdown, it must not re-surface as a raw Map.
  const {
    selection_token: _token,
    payload_trimmed: _pt,
    payload_over_budget: _pob,
    candidate_scores: candidateScores,
    ...planRest
  } = planResult;

  // Build the id → on-disk file index from the read-set store walk. This reuses
  // the cached walk planContext already performed (no extra disk read). Best-effort:
  // a multi-store hiccup degrades to "no paths" rather than crashing recall.
  let bodyIndex: Awaited<ReturnType<typeof buildCrossStoreBodyIndex>>;
  try {
    bodyIndex = await buildCrossStoreBodyIndex(projectRoot);
  } catch {
    bodyIndex = new Map();
  }

  const candidateIds = planResult.candidates.map((c) => c.stable_id);
  const candidateIdSet = new Set(candidateIds);
  // Map both the store-qualified id and its bare local id back to the canonical
  // candidate id, so a caller passing either form (in `ids` or a `related` edge)
  // resolves correctly.
  const candidateLookup = new Map<string, string>();
  const candidateById = new Map<string, (typeof planResult.candidates)[number]>();
  for (const candidate of planResult.candidates) {
    candidateById.set(candidate.stable_id, candidate);
    for (const key of relatedLookupKeys(candidate.stable_id)) {
      if (!candidateLookup.has(key)) candidateLookup.set(key, candidate.stable_id);
    }
  }

  // Resolve the optional `ids` scope filter (redirect-rewrite stale ids first).
  let scopeIds: Set<string> | undefined;
  if (input.ids !== undefined) {
    let rewritten = input.ids;
    try {
      const redirectMap = await loadIdRedirectMap(projectRoot);
      rewritten = input.ids.map((id) => resolveRedirectedId(redirectMap, id));
    } catch {
      rewritten = input.ids;
    }
    scopeIds = new Set(
      rewritten.map((id) => candidateLookup.get(id) ?? id).filter((id) => candidateIdSet.has(id)),
    );
    // W1-3 (KT-DEC-0031): include_related expands the scoped set with the one-hop
    // `related` neighbours of the scoped candidates (their read paths, not bodies),
    // so `recall(ids, include_related)` surfaces the connected entries too.
    if (input.include_related === true) {
      for (const id of [...scopeIds]) {
        for (const rel of candidateById.get(id)?.description.related ?? []) {
          const resolved = candidateLookup.get(rel);
          if (resolved !== undefined) scopeIds.add(resolved);
        }
      }
    }
  }

  // One read path per surfaced candidate (scoped by `ids` when provided), in
  // candidate (ranked) order. A candidate with no resolvable on-disk file is
  // skipped — it carries a description for discovery but no body to Read.
  const paths: RecallPath[] = [];
  for (const candidate of planResult.candidates) {
    if (scopeIds !== undefined && !scopeIds.has(candidate.stable_id)) continue;
    const ref = bodyIndex.get(candidate.stable_id);
    if (ref === undefined) continue;
    paths.push(attachPathStore({ stable_id: candidate.stable_id, path: ref.file }));
  }

  const nextSteps = buildNextSteps(planResult, paths, candidateById, candidateLookup);

  // always-active dedupe marker: a broad model/guideline candidate is ALSO
  // injected in full at SessionStart ("ALWAYS-ACTIVE RULES"), so its body is
  // already in the agent's context — mark it so the agent does not waste a Read.
  // Pure function of (relevance_scope, knowledge_type); no client state needed.
  // NOT dropped/demoted: SessionStart injection degrades to an index line on
  // budget overflow, so the body's presence is not guaranteed.
  // ux-w2-4: fold candidates (description) × paths (read path) into ONE entry
  // list. Candidates are already in ranked order, so the array index is the
  // 1-based relevance rank. read_path/store are attached when the candidate has
  // a resolvable on-disk file; body_in_context marks the SessionStart-injected
  // always-active bodies so the agent skips a redundant Read.
  const pathByStableId = new Map(paths.map((p) => [p.stable_id, p]));
  const entries: RecallEntry[] = planRest.candidates.map((c) => {
    const readPath = pathByStableId.get(c.stable_id);
    // P1 recall-observability: look up the numbers-only breakdown plan-context
    // captured for this candidate. Absent for scoreless candidates (broad no-query
    // probe, related-appended neighbours that ranked outside the scored cut) —
    // then the field is omitted, keeping the steady wire shape.
    const scored = candidateScores?.get(c.stable_id);
    return {
      stable_id: c.stable_id,
      description: slimDescription(c.description),
      ...(readPath ? { read_path: readPath.path } : {}),
      // TASK-004: flatten { alias } → alias string on the wire.
      ...(readPath?.store ? { store_alias: readPath.store.alias } : {}),
      ...(isAlwaysActive(c) ? { body_in_context: true as const } : {}),
      // TASK-004: entry.score dropped (final===score invariant, KT-PIT-0036);
      // consumers read score_breakdown.final when opt-in enabled.
      // TASK-006: score_breakdown is now opt-in via include_score_breakdown —
      // steady-state recall omits it (~4.8KB saved on a 24-entry sample). The
      // plan-context service layer still writes candidate_scores unconditionally,
      // so the debug surface is available on demand without perturbing ranking.
      ...(scored && input.include_score_breakdown === true
        ? { score_breakdown: scored.score_breakdown }
        : {}),
    };
  });

  // Drop the plan envelope's two list shapes (recall folds them into `entries[]`)
  // + TASK-001 wire thinning: stale/intent explicit-strip (KT-PIT-0018 belt-and-
  // suspenders — output-schema .strip() would also drop them, but explicit
  // destructuring makes the "0 consumers, gone by design" intent visible in code).
  const {
    entries: _reqProfiles,
    candidates: _candidates,
    stale: _stale,
    intent: _intent,
    dropped: droppedList,
    preflight_diagnostics: preflightList,
    ...planRestNoLists
  } = planRest;

  // TASK-003 wire transform: dropped[{id, reason}] → dropped_ids (KT-DEC-0028
  // id-transparency) + dropped_reasons count map (68/68 same-reason observed in
  // ANL-002 sample; per-response reason counts stay descriptive if mixed).
  const retrievalDroppedCount = (droppedList ?? []).filter(
    (d) => d.reason === "retrieval_budget",
  ).length;
  const payloadDroppedCount = (droppedList ?? []).filter((d) => d.reason === "payload_budget")
    .length;
  const droppedIds = (droppedList ?? []).map((d) => d.id);

  return {
    ...planRestNoLists,
    entries,
    ...(nextSteps.length > 0 ? { next_steps: nextSteps } : {}),
    ...(droppedIds.length > 0 ? { dropped_ids: droppedIds } : {}),
    ...(retrievalDroppedCount > 0 || payloadDroppedCount > 0
      ? {
          dropped_reasons: {
            ...(retrievalDroppedCount > 0 ? { retrieval_budget: retrievalDroppedCount } : {}),
            ...(payloadDroppedCount > 0 ? { payload_budget: payloadDroppedCount } : {}),
          },
        }
      : {}),
    ...(preflightList !== undefined && preflightList.length > 0
      ? { preflight_diagnostics: preflightList }
      : {}),
  };
}

// Mirrors the SessionStart hook's ALWAYS_TYPES (knowledge-hint-broad.cjs):
// broad ∧ knowledge_type ∈ {models, guidelines} → full BODY injected at session
// start. decision/pitfall/process are REFERENCE (id+hook only) and narrow stays
// silent, so neither is always-active.
const ALWAYS_ACTIVE_TYPES = new Set(["models", "guidelines"]);

function isAlwaysActive(candidate: { description: { relevance_scope?: string; knowledge_type?: string } }): boolean {
  const { relevance_scope, knowledge_type } = candidate.description;
  return (relevance_scope ?? "broad") !== "narrow" && ALWAYS_ACTIVE_TYPES.has(knowledge_type ?? "");
}

// wire-slim projection (payload): keep ONLY the selection-signal fields, leaving
// the rest to on-demand Read via read_path (KT-DEC-0026).
// TASK-002: must_read_if omitted when identical to summary (~40% dedup rate;
// consumers fall back to summary when absent — no KB source-of-truth change).
// TASK-005: intent_clues dropped from wire (0 hook consumers grep-verified).
// The .md body remains reachable via read_path when needed.
function slimDescription(d: FullRuleDescription): RecallEntryDescription {
  return {
    summary: d.summary,
    ...(d.must_read_if !== d.summary ? { must_read_if: d.must_read_if } : {}),
    ...(Array.isArray(d.impact) && d.impact.length > 0 ? { impact: d.impact } : {}),
    ...(d.knowledge_type !== undefined ? { knowledge_type: d.knowledge_type } : {}),
  };
}

// W1 (KT-DEC-0026): discovery-layer next-step hints. No body-tier hint anymore
// (bodies are never packaged) — only the "more candidates exist" truncation hint
// and the "related entries available" graph hint. The related hint keys off the
// RETURNED read-path set: it fires when a surfaced path links to a related entry
// whose path was NOT returned (scoped out / include_related off), and no-ops once
// include_related has pulled those paths in.
function buildNextSteps(
  planResult: PlanContextResult,
  paths: RecallPath[],
  candidateById: Map<string, { description: { related?: string[] } }>,
  candidateLookup: Map<string, string>,
): string[] {
  const nextSteps: string[] = [];
  // K6 (W3-K): the "more candidates exist" hint fires on the retrieval_budget
  // omissions (top_k cap + ratio-to-top floor) — the cut a narrower intent /
  // higher plan_context_top_k can recover. payload_budget drops are not surfaced
  // here (they are a wire-size cap, not a relevance signal the caller controls).
  const omitted = (planResult.dropped ?? []).filter((d) => d.reason === "retrieval_budget").length;
  if (omitted > 0) {
    nextSteps.push(
      `${omitted} lower-ranked candidate(s) were omitted by the retrieval budget — pass a narrower intent (or raise plan_context_top_k) to surface them.`,
    );
  }
  const surfacedPaths = new Set(paths.map((p) => p.stable_id));
  const relatedAvailableNotIncluded = paths.some((p) =>
    (candidateById.get(p.stable_id)?.description.related ?? []).some((rel) => {
      const resolved = candidateLookup.get(rel);
      return resolved !== undefined && !surfacedPaths.has(resolved);
    }),
  );
  if (relatedAvailableNotIncluded) {
    nextSteps.push(
      "Surfaced entries link to related KB entries (graph edges) — pass include_related:true to surface their read paths in the same call.",
    );
  }
  return nextSteps;
}

// W1 (KT-DEC-0026): derive per-path store provenance from a store-qualified
// stable_id. cross-store-recall stamps candidate ids `<alias>:<stable_id>` (the
// local id never contains a colon), so the prefix before the FIRST colon is the
// alias. A bare (unqualified) id yields no `store` field. Pure + additive.
export function attachPathStore(p: RecallPath): RecallPath {
  const colon = p.stable_id.indexOf(":");
  if (colon <= 0) return p;
  return { ...p, store: { alias: p.stable_id.slice(0, colon) } };
}

function relatedLookupKeys(stableId: string): string[] {
  const parts = stableId.split(":");
  const localId = parts.at(-1);
  return localId === undefined || localId === stableId ? [stableId] : [stableId, localId];
}

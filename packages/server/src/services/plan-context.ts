/**
 * planContext facade (ISS-20260713-011).
 * Scoring / BM25 cache / selection-token live in dedicated modules;
 * this file orchestrates the plan-context pipeline and re-exports the public API.
 */
import {
  type RuleDescription,
  type RuleDescriptionIndexItem,
  type RecallScore,
} from "@fenglimg/fabric-shared";
import {
  trimToPayloadBudget,
  type PayloadGuardOptions,
} from "@fenglimg/fabric-shared/node/mcp-payload-guard";

import { readSelectionTokenTtlMs, readPlanContextTopK, readRecallRelevanceRatio, readDefaultLayerFilter } from "../config-loader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { buildCrossStoreRawItems, computeReadSetRevision } from "./cross-store-recall.js";
import { loadIdRedirectMap, trimRedirectsToActiveIds } from "./id-redirect.js";
import { bumpCounter, METRIC_COUNTER_NAMES } from "./metrics.js";
import { coalesceSessionId, readActiveSessionId } from "./active-session.js";

import { compareStableIds as compareStableIdsPure, layerFromStableId as layerFromStableIdPure } from "./plan-context-ids.js";
import {
  buildScoringContext,
  rankDescriptionItems,
  cutRankedForRecall,
  scoreBreakdownForItem,
  relatedLookupKeys,
  type ScoringContext,
  type RankMode,
  type RankOptions,
} from "./plan-context-scoring.js";
import {
  SELECTION_TOKEN_TTL_DEFAULT_MS,
  buildSelectionToken,
  writeSelectionTokenState,
  readSelectionToken,
  createSelectionToken,
  __selectionTokenCacheSize,
  __resetSelectionTokenCache,
  type SelectionTokenState,
} from "./plan-context-selection.js";
import { __bm25CacheStats, __resetBm25Cache } from "./plan-context-bm25-cache.js";

// Re-exports — keep public import paths stable for recall / review-search / tests / index.
export type { ScoringContext, RankMode, RankOptions, SelectionTokenState };
export {
  buildScoringContext,
  rankDescriptionItems,
  cutRankedForRecall,
  scoreBreakdownForItem,
  relatedLookupKeys,
  readSelectionToken,
  createSelectionToken,
  __selectionTokenCacheSize,
  __resetSelectionTokenCache,
  __bm25CacheStats,
  __resetBm25Cache,
};

// W4/Track1 (D1): a candidate's knowledge layer is a pure function of its
// stable_id prefix — the single source of truth (KT-DEC-0004:
// `K[PT]-(DEC|MOD|GLD|PIT|PRO)-NNNN`). The redundant `description.knowledge_layer`
// field was deleted; every layer decision reads the id instead. Candidate ids
// are store-qualified (`<alias>:<localId>`), so the personal marker `KP-` may sit
// after the alias colon — match at start OR right after a colon (mirrors the
// SessionStart hint hook's `/(^|:)KP-/` derivation). Anything that is not a KP-
// id resolves to `team`, the safe default for the privacy layer filter (a
// genuinely personal entry always carries a KP-* id, late-bound at approve).
export function layerFromStableId(qualifiedId: string): "personal" | "team" {
  return layerFromStableIdPure(qualifiedId);
}

export type PlanContextInput = {
  paths: string[];
  intent?: string;
  known_tech?: string[];
  detected_entities?: Record<string, string[]>;
  client_hash?: string;
  correlation_id?: string;
  session_id?: string;
  // v2.0-rc.5 C3 (TASK-012): caller-supplied path context for relevance scoring.
  // NOTE (rc.37 A1): the old hard narrow-by-path FILTER is GONE — `target_paths`
  // no longer EXCLUDES any entry. It now feeds locality SCORING only
  // (scoreDescriptionItem: same-file/dir/package boost over relevance_paths), so
  // a path-matching entry ranks higher but a non-matching one is never dropped.
  // Scope discipline (broad surfaced / narrow silent) moved to the SessionStart
  // injection layer; recall ranks the full corpus and caps at top_k. When
  // omitted, locality contributes 0 and ranking falls back to BM25 + recency.
  target_paths?: string[];
  // F54 (ISS-20260531-090): restrict the candidate corpus to one knowledge
  // layer. "both" (or omitted) → no filtering, falling back to
  // fabric.config.json#default_layer_filter. Personal/team layer per candidate
  // is derived from its stable_id prefix (W4/Track1: KP-→personal, else team).
  layer_filter?: "team" | "personal" | "both";
  // lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): when true,
  // append the one-hop `related` graph neighbours of the top_k-surfaced set that
  // ranked OUTSIDE the top_k cut but are present in the full ranked corpus. The
  // appended ids are reported in `related_appended` (appended id → the surfaced
  // source id) so consumers (the SessionStart/PreToolUse hint hooks) can render a
  // `related-to-<id>` provenance. STRICTLY ADDITIVE: false/omitted → byte-identical
  // pre-W3-T2 behaviour. Honest no-op when the surfaced set declares no in-corpus
  // related edges — nothing is appended and `related_appended` is omitted.
  include_related?: boolean;
  /**
   * Internal MCP presentation budget. When supplied by the tool layer,
   * candidates are byte-trimmed before the selection token is cached so the
   * token cannot reference candidates omitted from the response.
   */
  payload_budget?: PlanContextPayloadBudget;
};

export type PlanContextPayloadWarning = {
  code: string;
  file?: string;
  action_hint?: string;
};

export type PlanContextPayloadBudget = {
  limits?: PayloadGuardOptions;
  warnings?: PlanContextPayloadWarning[];
  trim_warning?: PlanContextPayloadWarning;
};

// v2.0-rc.5 A3 (TASK-007): Cocos-era profile inference retired. The profile
// is now a neutral path/intent echo — no UI/Gameplay/Asset hardcoded domains,
// no Chinese game-perf token list, no Performance regex.
// v2.0.0-rc.38 UX-3 (D-MCP fold ③): dropped path_segments / extension —
// trivially derivable from target_path, pure per-entry bloat.
// v2.2 payload de-dup: `user_intent` lifted to a single top-level `intent` echo
// on the result (was a verbatim per-path copy). Per-entry profile keeps only the
// fields that vary by path.
export type RequirementProfile = {
  target_path: string;
  known_tech: string[];
  detected_entities: string[];
};

// v2.0-rc.5 A3 (TASK-007): per-entry shape drops the legacy L0/L1/L2 selection
// ceremony (required_stable_ids / ai_selectable_stable_ids /
// initial_selected_stable_ids / selection_policy).
//
// v2.0-rc.7 T9: degenerate single-stage mode (≤30 entries inlined as
// `candidates_full_content`) removed. The shape is now symmetric across all
// candidate counts: every response returns `description_index` + a
// `selection_token`, and the Agent follows up with `fab_get_knowledge_sections`
// to fetch bodies. Rationale: the inline-body branch silently bypassed
// `knowledge_consumed` event emission, breaking rc.5 C5 closure. See
// docs/decisions/rc5-a3-superseded.md.
// v2.0.0-rc.38 UX-1 (D-MCP fold ①): per-path `description_index` removed. Since
// rc.37 A1 dropped server-side relevance filtering it was identical to the
// shared index for every path — N paths shipped N+1 copies. The candidate list
// is now a single top-level `candidates`.
export type PlanContextEntry = {
  path: string;
  requirement_profile: RequirementProfile;
};

export type PreflightDiagnostic = {
  code: "missing_description" | "empty_shell_suppressed";
  severity: "warn";
  message: string;
  stable_ids?: string[];
  path?: string;
};

export type PlanContextResult = {
  revision_hash: string;
  stale: boolean;
  selection_token: string;
  entries: PlanContextEntry[];
  // v2.2 payload de-dup: single top-level echo of the caller's `intent` (was
  // duplicated into every entry's requirement_profile). Omitted when no intent.
  intent?: string;
  // v2.0.0-rc.38 UX-1: was `shared.description_index`. Lifted to a single
  // top-level array; `preflight_diagnostics` lifted alongside it (the `shared`
  // wrapper held nothing else).
  candidates: RuleDescriptionIndexItem[];
  // v2.2 A-INFRA-3 (W1-T3-TOPK) / K6 (W3-K): structured list of lower-ranked
  // candidates dropped by the retrieval pipeline, each tagged with WHY:
  // `retrieval_budget` (top_k cap + ratio-to-top floor) or `payload_budget` (the
  // MCP payload-byte trim). Present (and non-empty) ONLY when truncation actually
  // fired, so the steady-state wire shape is unchanged. Replaces the bare numeric
  // omission count — the LLM sees WHICH ids dropped and WHY ("these N
  // exist; narrow your intent") instead of believing the set is exhaustive.
  dropped?: { id: string; reason: "retrieval_budget" | "payload_budget" }[];
  preflight_diagnostics: PreflightDiagnostic[];
  // v2.0.0-rc.22 Scope D T-D2: optional auto-heal banner fields. Surfaced ONLY
  // when loadActiveMetaOrStale detected drift between on-disk meta and the
  // derived knowledge tree and rebuilt the meta in-place. Omitted (undefined)
  // when the meta was already fresh — keeps the wire shape minimal in the
  // common case. Downstream CLI shim (rc.22 T-D3) reads this pair to render
  // a one-line banner without querying the event ledger.
  auto_healed?: boolean;
  previous_revision_hash?: string;
  // v2.0.0-rc.37 NEW-24: stale-id redirect map (old → new). Populated only
  // when at least one recent knowledge_id_redirect event maps a layer-flipped
  // entry to a stable_id present in the current description_index. Empty
  // mappings are omitted to keep the steady-state wire shape minimal.
  redirects?: Record<string, string>;
  // lifecycle-refactor W3-T2 (§7 图谱消费): when `include_related` appended any
  // one-hop graph neighbour that ranked outside top_k, this maps each appended
  // stable_id → the surfaced source id whose `related` edge pulled it in. Omitted
  // (undefined) when include_related was off OR the surfaced set had no in-corpus
  // related edge to follow (honest graph-empty no-op). Additive — steady-state
  // callers never see it.
  related_appended?: Record<string, string>;
  // P1 recall-observability: stable_id → fused score + numbers-only breakdown for
  // each surfaced candidate. RUNTIME-ONLY: a Map serializes to {} so it never
  // bloats the plan-context wire payload, and recall folds it into each entry's
  // `score` / `score_breakdown` rather than re-surfacing it as a Map. Plan-context
  // itself does NOT expose score on the wire — the signal belongs to recall.
  candidate_scores?: Map<string, RecallScore>;
  /** Internal service→tool signal; stripped before MCP output. */
  payload_trimmed?: boolean;
  /** Internal service→tool signal; stripped before MCP output. */
  payload_over_budget?: boolean;
};

/**
 * v2.0.0-rc.27 TASK-002 (audit §2.22): sandbox each caller-supplied path
 * before it reaches downstream consumers. plan_context currently only echoes
 * paths into requirement_profile.path_segments and the description_index
 * matcher — but two of its downstream calls (knowledge-meta-builder
 * relevance-paths glob matching, plus the rc.5 D1 hint CLI) DO take the
 * path further. A traversal like `../../../etc/passwd` slips through
 * `normalizeKnowledgePath` (slash-only normalization) and would land in
 * those callers as an absolute escape vector when the next iteration of
 * relevance_paths glob matching adds prefix anchoring.
 *
 * Allowed shapes:
 *   - relative paths under the project root: `src/foo.ts`, `a/b/c.md`
 *   - the `**` sentinel (used by --all to probe broad/cross-cutting entries)
 *   - the bare `*` glob (matches anything at root)
 *
 * Rejected:
 *   - absolute paths (`/etc/passwd`, `/Users/x/...`)
 *   - traversal segments (`..` anywhere in the path)
 *   - shell-only sigils (`~/...` — caller must expand before passing)
 *
 * Thrown errors propagate to the MCP layer which surfaces them as
 * structured tool errors — no silent drop to broad-fallback.
 */
function assertPathInSandbox(rawPath: string): void {
  // Allow the global-match sentinels first (the only legitimate non-tree paths).
  if (rawPath === "**" || rawPath === "*") return;

  const normalized = rawPath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("//")) {
    throw new Error(
      `plan_context: absolute paths are not allowed (got "${rawPath}"); pass a path relative to the project root`,
    );
  }
  if (normalized.startsWith("~/") || normalized === "~") {
    throw new Error(
      `plan_context: shell sigil "~" is not allowed (got "${rawPath}"); expand to a project-relative path before calling`,
    );
  }
  if (normalized.split("/").some((seg) => seg === "..")) {
    throw new Error(
      `plan_context: ".." traversal is not allowed (got "${rawPath}"); pass a path that resolves under the project root`,
    );
  }
}

export async function planContext(
  projectRoot: string,
  input: PlanContextInput,
): Promise<PlanContextResult> {
  // v2.0.0-rc.27 TASK-002 (audit §2.22): sandbox every caller-supplied path
  // before any matching/reconcile work runs. Failure here is a hard throw
  // — plan_context callers are MCP-trusted but a stray traversal from a
  // misconfigured skill or a malformed prompt should not silently land in
  // the description_index matcher.
  for (const p of input.paths) {
    assertPathInSandbox(p);
  }
  if (input.target_paths !== undefined) {
    for (const p of input.target_paths) {
      assertPathInSandbox(p);
    }
  }

  // v2.2 W5 R1 (读侧 cutover): co-location agents.meta retired. There is no
  // project-local knowledge tree to derive a meta from anymore — candidates come
  // exclusively from the read-set stores (cross-store on-the-fly, below). The old
  // loadActiveMetaOrStale + buildKnowledgeMeta(.fabric/knowledge) + description
  // auto-heal machinery is gone: stores hold the canonical knowledge and ship no
  // agents.meta, and once .fabric/agents.meta.json is deleted (Z1) reading it
  // would throw. The revision is now a store-corpus content fingerprint
  // (computeReadSetRevision) — it drives the BM25 corpus cache key and the
  // client stale-detection compare, exactly as meta.revision did. Auto-heal is
  // obsolete: buildCrossStoreRawItems reads frontmatter descriptions live, so
  // there is no stored derived index that can drift out of sync with disk.
  const revision = await computeReadSetRevision(projectRoot);
  const stale = input.client_hash !== undefined && input.client_hash !== revision;
  const uniquePaths = dedupePaths(input.paths);
  // v2.0.0-rc.33 W2-3 / W2-4: pass scoring context so workspace-wide sort
  // pulls recency-boosted + path-local entries to the top. Uses the same
  // path resolution as relevanceTargetPaths (input.target_paths if provided,
  // else the deduped request paths). The `**` sentinel that --all mode uses
  // contributes zero locality score (no dirname / no package root), which is
  // the correct degenerate behavior — broad mode falls through to recency +
  // stable_id tiebreaker.
  // v2.2 A-INFRA-1 (W1-T2-BM25): caller intent → query text/terms. Joins the
  // free-form intent with known_tech and every detected_entities value. Empty
  // when the caller supplies none of these (broad SessionStart probe), which
  // disables BM25/vector and falls back to recency+locality.
  const queryText = [
    input.intent ?? "",
    ...(input.known_tech ?? []),
    ...Object.values(input.detected_entities ?? {}).flat(),
  ].join(" ");
  // v2.1 global-refactor (W1-T1) + v2.2 W5 R1: candidates come SOLELY from the
  // read-set stores (required_stores ∪ implicit personal). Store entries are
  // store-qualified (`<alias>:<id>`) and flow through the SAME layer-filter /
  // BM25 / vector / sort / dedup / top_k pipeline below. best-effort: a
  // multi-store hiccup degrades to an empty candidate set, never crashes the
  // hint. The co-location project source (buildRawDescriptionItems over
  // agents.meta nodes) was retired here — there is no project knowledge tree
  // anymore. Empty-shell suppression (summary === stable_id, no selection
  // signal) is preserved via partitionEmptyShells so store drafts get the same
  // quality gate the project-meta path applied (and the same preflight warning).
  const storeRawItems = await buildCrossStoreRawItems(projectRoot).catch(() => []);
  const { rawItems: allRawItems, suppressedStableIds } = partitionEmptyShells(storeRawItems);

  // F54 (ISS-20260531-090): honor the declared `layer_filter`. The per-call
  // value wins; otherwise fabric.config.json#default_layer_filter; "all"/"both"
  // mean no filtering. PRIVACY LOAD-BEARING: this is the filter that stops
  // personal (KP-*) knowledge from leaking into team recall. W4/Track1 (D1): a
  // candidate's layer is now derived from its stable_id prefix (KP-→personal,
  // else team) — the single source of truth (KT-DEC-0004) — instead of the
  // deleted `description.knowledge_layer` field. Deriving from the id is strictly
  // safer: a KP-* entry is excluded from `team` recall regardless of which
  // physical store it sits in.
  const effectiveLayerFilter = input.layer_filter ?? readDefaultLayerFilter(projectRoot);
  const rawItems =
    effectiveLayerFilter === "both"
      ? allRawItems
      : allRawItems.filter((item) => layerFromStableId(item.stable_id) === effectiveLayerFilter);

  // P1 recall-engine-refactor (TASK-005): the BM25/vector/scope/fusion scoring
  // context is built by the SAME shared helper fab_pending triage uses, so the
  // two surfaces rank over identical signals.
  const scoringContext = await buildScoringContext(projectRoot, revision, rawItems, {
    queryText,
    targetPaths: input.target_paths ?? dedupePaths(input.paths),
  });

  // ISS-006 / KT-DEC-0038 / P1 recall-engine-refactor (TASK-005): score → sort →
  // dedupe → mode-dependent cut, all inside the shared rankDescriptionItems core.
  // `rankedScored` is the FULL ranked corpus (no cut — the 'triage' output, which
  // also feeds the retrieval_budget dropped[] diff below). `survivingScored` is
  // that same ranking with recall's top_k + ratio-to-top floor applied
  // (config-resolved here so the ranker stays a pure function). Both derive from
  // ONE shared ranker — the single source fab_pending triage also calls.
  // ISS-20260711-143: score/sort the corpus ONCE, then derive triage (full) and
  // recall (top_k + relevance floor) views from the shared ranked array.
  const rankedScored = rankDescriptionItems(rawItems, scoringContext, "triage");
  const rankedCandidates = rankedScored.map((entry) => entry.item);

  const survivingScored = cutRankedForRecall(rankedScored, scoringContext, {
    topK: readPlanContextTopK(projectRoot),
    relevanceRatio: readRecallRelevanceRatio(projectRoot),
  });
  const topKCandidates = survivingScored.map((entry) => entry.item);
  // P1 recall-observability: capture each surfaced item's fused `score` (already
  // computed during the sort, previously dropped when {item,score} collapsed to
  // just `item`) + a numbers-only `score_breakdown`, keyed by stable_id. Kept in a
  // SEPARATE Map so it never bloats the plan-context wire payload (a Map serializes
  // to {}); recall reads it to EXPOSE the score per entry. Pure observability — it
  // does NOT touch ranking, and `score_breakdown.final` === `score` by construction.
  const candidateScores = new Map<string, RecallScore>();
  for (const entry of survivingScored) {
    candidateScores.set(entry.item.stable_id, {
      score: entry.score,
      score_breakdown: scoreBreakdownForItem(entry.item, scoringContext),
    });
  }
  // K6 (W3-K): the retrieval_budget drop set = corpus minus surfaced (top_k cap
  // + ratio-to-top floor). Computed ONCE here, BEFORE the payload trim — it is
  // CONSTANT across every trim-search iteration (the trim only ever removes more
  // candidates from `candidates`, never resurrects a retrieval-dropped one). The
  // numeric count is retained as a monotone size-proxy for the serialize
  // measurement closure below (the real dropped[] must NOT grow inside it).
  const topKIds = new Set(topKCandidates.map((item) => item.stable_id));
  const retrievalDroppedInitial = rankedCandidates
    .filter((item) => !topKIds.has(item.stable_id))
    .map((item) => ({ id: item.stable_id, reason: "retrieval_budget" as const }));

  // lifecycle-refactor W3-T2 (§7 图谱消费 / §5 hook 沿 related 二阶召回): when
  // include_related is on, follow the one-hop `related` graph edges of the
  // top_k-surfaced set and pull back in any neighbour that ranked OUTSIDE the cut
  // but exists in the full ranked corpus. Bounded to rankedCandidates (every
  // appended id is a real, fetchable entry); ids already inside top_k are not
  // re-added. The `related_appended` map records appended id → source id so the
  // hint layer can render `related-to-<source>`. Honest no-op: if the surfaced
  // set declares no in-corpus related edge, `candidates === topKCandidates` and
  // `relatedAppended` stays empty (no fake "related" output downstream).
  let candidates = topKCandidates;
  const relatedAppended: Record<string, string> = {};
  const appendedIds = new Set<string>();
  if (input.include_related === true) {
    const inTopK = new Set(topKCandidates.flatMap((item) => relatedLookupKeys(item.stable_id)));
    const rankedById = new Map<string, RuleDescriptionIndexItem>();
    for (const item of rankedCandidates) {
      for (const key of relatedLookupKeys(item.stable_id)) {
        if (!rankedById.has(key)) {
          rankedById.set(key, item);
        }
      }
    }
    const appended: RuleDescriptionIndexItem[] = [];
    for (const surfaced of topKCandidates) {
      for (const rel of surfaced.description.related ?? []) {
        if (inTopK.has(rel)) continue; // already surfaced — nothing to pull in
        const neighbour = rankedById.get(rel);
        if (neighbour === undefined) continue; // edge points outside the corpus — skip (honest)
        if (appendedIds.has(neighbour.stable_id)) continue; // first source wins, no dupes
        appendedIds.add(neighbour.stable_id);
        relatedAppended[neighbour.stable_id] = surfaced.stable_id;
        appended.push(neighbour);
      }
    }
    if (appended.length > 0) {
      candidates = [...topKCandidates, ...appended];
    }
  }

  // Codex review F4: after related expansion, drop retrieval-dropped entries
  // that got resurrected as related neighbours. A stable_id must belong to
  // exactly ONE of {surfaced, retrieval-dropped, payload-dropped} — never two.
  // Without this filter, `dropped_ids` would list ids that also appear in
  // `entries[]`, breaking KT-DEC-0028 id-partition transparency.
  const retrievalDropped = retrievalDroppedInitial.filter((d) => !appendedIds.has(d.id));
  const omittedCandidateCount = retrievalDropped.length;

  const entries: PlanContextEntry[] = uniquePaths.map((path) => ({
    path,
    requirement_profile: buildRequirementProfile(path, input),
  }));

  // v2.0-rc.7 T9: always emit a selection_token. The Agent must follow up with
  // `fab_get_knowledge_sections` (which DOES emit the `knowledge_consumed`
  // event required for rc.5 C5 closure) to load bodies. The inline
  // `candidates_full_content` short-circuit is gone.
  // v2.0.0-rc.29 TASK-008 (BUG-F3): resolve per-workspace TTL override (if any)
  // and thread it through createSelectionToken so the token's expires_at lines
  // up with the operator's chosen lifetime. Hot-path safe: readSelectionTokenTtlMs
  // is best-effort and returns undefined on any read/parse failure.
  const now = Date.now();
  const ttlMs = readSelectionTokenTtlMs(projectRoot) ?? SELECTION_TOKEN_TTL_DEFAULT_MS;
  const selectionToken = buildSelectionToken(revision, now);

  const basePreflightDiagnostics = buildPreflightDiagnostics(suppressedStableIds);
  let payloadTrimDropped = 0;
  let payloadOverBudget = false;
  // K6 (W3-K): the payload_budget drop set — candidate ids present BEFORE the
  // trim but absent AFTER it settles. Built ONCE, after the trim search
  // converges (never inside the serialize measurement closure). Empty unless a
  // payload trim actually fired.
  let payloadDropped: { id: string; reason: "payload_budget" }[] = [];
  if (input.payload_budget !== undefined) {
    const fullCandidateCount = candidates.length;
    // Snapshot the pre-trim candidate ids so the post-trim diff yields the exact
    // payload_budget-dropped set.
    const preTrimIds = candidates.map((item) => item.stable_id);
    const serialize = (candidateSlice: RuleDescriptionIndexItem[]): string => {
      const dropped = fullCandidateCount - candidateSlice.length;
      const totalOmitted = omittedCandidateCount + dropped;
      // K6 (W3-K) FEEDBACK-LOOP MITIGATION: trimToPayloadBudget calls this closure
      // REPEATEDLY to MEASURE each candidate-slice's serialized byte size during
      // its trim search. We must NOT embed the real dropped[]{id,reason} array
      // here — it GROWS as the slice shrinks (more payload_budget drops), which
      // would make the measured size grow non-monotonically and destabilize /
      // oscillate the trim search. Keep only a NUMERIC size-proxy (dropped_count)
      // — it rises monotonically with each trimmed candidate, so per-slice size
      // stays monotone. The real dropped[]{id,reason} is assembled ONCE at final
      // result assembly below, AFTER the trim settles.
      return JSON.stringify({
        revision_hash: revision,
        stale,
        selection_token: selectionToken,
        entries,
        ...(input.intent !== undefined ? { intent: input.intent } : {}),
        candidates: candidateSlice,
        ...(totalOmitted > 0 ? { dropped_count: totalOmitted } : {}),
        preflight_diagnostics: basePreflightDiagnostics,
        warnings:
          dropped > 0 && input.payload_budget?.trim_warning !== undefined
            ? [...(input.payload_budget.warnings ?? []), input.payload_budget.trim_warning]
            : input.payload_budget?.warnings,
        ...(Object.keys(relatedAppended).length > 0 ? { related_appended: relatedAppended } : {}),
      });
    };
    const trim = trimToPayloadBudget(candidates, serialize, input.payload_budget.limits);
    if (trim.dropped > 0) {
      // K6 (W3-K): build the real payload_budget dropped[] AFTER the trim settles
      // — pre-trim ids minus the survivors in trim.items.
      const survivingIds = new Set(trim.items.map((item) => item.stable_id));
      payloadDropped = preTrimIds
        .filter((id) => !survivingIds.has(id))
        .map((id) => ({ id, reason: "payload_budget" as const }));
      candidates = trim.items;
      payloadTrimDropped = trim.dropped;
    }
    payloadOverBudget = trim.overBudget;
  }

  const sharedStableIds = candidates.map((item) => item.stable_id);
  writeSelectionTokenState(selectionToken, revision, uniquePaths, [], sharedStableIds, now, ttlMs);

  // v2.0.0-rc.37 NEW-24: load recent knowledge_id_redirect events and
  // surface only the (old → new) mappings whose `new` id is in the current
  // description_index. Best-effort: ledger read failures degrade silently
  // so a corrupt ledger never blocks plan-context.
  let redirects: Record<string, string> | undefined;
  try {
    const redirectMap = await loadIdRedirectMap(projectRoot);
    const trimmed = trimRedirectsToActiveIds(redirectMap, sharedStableIds);
    if (Object.keys(trimmed).length > 0) {
      redirects = trimmed;
    }
  } catch {
    // Redirect surfacing is opportunistic; never block planning on it.
  }

  const result: PlanContextResult = {
    revision_hash: revision,
    stale,
    selection_token: selectionToken,
    entries,
    ...(input.intent !== undefined ? { intent: input.intent } : {}),
    candidates,
    // K6 (W3-K): assemble the structured dropped[] ONCE, here at final result
    // assembly — the CONSTANT retrieval_budget set (computed pre-trim) followed
    // by the payload_budget set (computed after the trim settled). Omitted when
    // nothing was dropped, keeping the steady-state wire shape unchanged.
    ...(retrievalDropped.length + payloadDropped.length > 0
      ? { dropped: [...retrievalDropped, ...payloadDropped] }
      : {}),
    preflight_diagnostics: basePreflightDiagnostics,
    // v2.2 W5 R1: the auto_healed / previous_revision_hash pair was tied to the
    // co-location loadActiveMetaOrStale read-path auto-heal, which is retired.
    // Store-backed recall reads frontmatter live, so there is no stored derived
    // index to heal — these fields are never emitted now (the response schema
    // keeps them optional for backward compat with cached client state).
    ...(redirects !== undefined ? { redirects } : {}),
    // lifecycle-refactor W3-T2 (§7): surface the related-expansion provenance map
    // ONLY when at least one neighbour was actually appended. Empty (graph-empty
    // no-op) → field omitted, steady-state wire shape unchanged.
    ...(Object.keys(relatedAppended).length > 0 ? { related_appended: relatedAppended } : {}),
    // P1 recall-observability: runtime-only score channel (Map → {} on the wire).
    ...(candidateScores.size > 0 ? { candidate_scores: candidateScores } : {}),
    ...(payloadTrimDropped > 0 ? { payload_trimmed: true } : {}),
    ...(payloadOverBudget ? { payload_over_budget: true } : {}),
  };

  // v2.0.0-rc.37 Wave B (B3): dual-write counter rollup. The audit event still
  // lands in events.jsonl because downstream lints (doctor.buildLastActiveIndex
  // walks `ai_selectable_stable_ids[]` for orphan/stale signals) need per-id
  // payloads. The metrics.jsonl counter is the forward-compatible signal that
  // will become the SOLE write path once those lint readers migrate.
  bumpCounter(projectRoot, METRIC_COUNTER_NAMES.knowledge_context_planned);
  try {
    // session_id for cite-coverage recall↔edit join: prefer the agent-supplied
    // arg, else the SessionStart/edit active-session sidecar. Without either,
    // planned events stay unscoped and recall_coverage_rate stays 0 even when
    // the agent did recall (ccpm dogfood 2026-07-12).
    const activeSid = await readActiveSessionId(projectRoot);
    const sessionId = coalesceSessionId(input.session_id, activeSid);
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_context_planned",
      target_paths: uniquePaths,
      required_stable_ids: [],
      ai_selectable_stable_ids: sharedStableIds,
      // ISS-20260711-217: cite-policy-evict / doctor-cite-coverage union
      // final_stable_ids as the recalled-id set. Keep it equal to the ids
      // actually surfaced on the lean recall wire (sharedStableIds), not [].
      final_stable_ids: sharedStableIds,
      selection_token: selectionToken,
      client_hash: input.client_hash,
      intent: input.intent,
      known_tech: input.known_tech,
      diagnostics: result.preflight_diagnostics,
      correlation_id: input.correlation_id,
      ...(sessionId ? { session_id: sessionId } : {}),
    });
  } catch {
    // Planning telemetry is best-effort and must not block rule discovery.
  }

  return result;
}

function dedupePaths(paths: string[]): string[] {
  const seenPaths = new Set<string>();

  return paths.flatMap((path) => {
    const normalized = normalizeKnowledgePath(path);
    if (seenPaths.has(normalized)) {
      return [];
    }
    seenPaths.add(normalized);
    return [normalized];
  });
}

function buildRequirementProfile(path: string, input: PlanContextInput): RequirementProfile {
  const normalizedPath = normalizeKnowledgePath(path);
  const extensionMatch = /(\.[^./\\]+)$/u.exec(normalizedPath);
  const knownTech = dedupeStableIds([
    ...(input.known_tech ?? []),
    ...(extensionMatch?.[1] === ".ts" ? ["TypeScript"] : []),
  ]);

  return {
    target_path: normalizedPath,
    known_tech: knownTech,
    detected_entities: input.detected_entities?.[normalizedPath] ?? input.detected_entities?.[path] ?? [],
  };
}

// v2.0.0-rc.38 UX-3 (D-MCP fold ③): emit only { stable_id, description }. Every
// previously-mirrored top-level field is read off `description` now; the
// inferred knowledge layer is backfilled INTO description so the layer signal
// survives without a separate top-level key.
//
// v2.0.0-rc.38 UX-2 (fold ②): empty-shell entries (summary === stable_id with
// empty intent_clues/tech_stack/impact) carry zero selection signal — they are
// dropped from `items` and their ids returned in `suppressedStableIds` so the
// caller can raise a data-quality diagnostic.
// v2.2 W5 R1 (读侧 cutover): partition cross-store candidates into surfaced items
// vs suppressed empty shells (summary === stable_id, no selection signal). This
// preserves the quality gate the retired buildRawDescriptionItems(meta) applied
// to project-meta nodes, now over store-qualified candidates. buildCrossStoreRawItems
// already drops entries with NO frontmatter description, so the only remaining
// gate here is empty-shell suppression (which still feeds the
// empty_shell_suppressed preflight warning).
function partitionEmptyShells(items: RuleDescriptionIndexItem[]): {
  rawItems: RuleDescriptionIndexItem[];
  suppressedStableIds: string[];
} {
  const suppressedStableIds: string[] = [];
  const rawItems = items.filter((item) => {
    if (isEmptyShellDescription(item.description, item.stable_id)) {
      suppressedStableIds.push(item.stable_id);
      return false;
    }
    return true;
  });
  return { rawItems, suppressedStableIds };
}

// v2.2 A-INFRA-1 (W1-T2-BM25): build the BM25 model over this call's candidate
// corpus, fold it into the scoring context, and sort. Only builds BM25 when the
// caller supplied query terms — a query-less broad probe skips the work entirely
// and ranks on recency+locality exactly as before (backward compatible). The
// model scores against the candidate set itself (corpus = candidates), which is
// the correct collection for IDF: rarity is measured among the entries the caller
// is choosing between. `scoringContext.vectorScores` (C2) is already computed by
// the caller and rides through the comparator unchanged.
// ISS-024: corpus-keyed BM25 model cache. The model depends only on the
// candidate corpus (a pure function of meta), so keying on meta.revision (a
// content hash) lets repeated query-bearing calls over the SAME KB reuse the
// index instead of re-tokenizing + re-indexing the full corpus each time. Two
// projects sharing a revision share identical corpora, so a cross-project hit
// returns an identical model — correct, not a leak.


// ISS-029: numeric-aware stable_id comparison. Plain localeCompare sorts
// "KT-DEC-9999" AFTER "KT-DEC-10000" (lexicographic: '9' > '1'), so the
// stable_id tiebreaker mis-orders once any per-store/per-type counter crosses
// into 5 digits. Intl numeric collation compares the trailing digit run by
// value, so 9999 < 10000 holds while same-width ids sort identically to before.
export function compareStableIds(a: string, b: string): number {
  return compareStableIdsPure(a, b);
}

// v2.0.0-rc.38 UX-2: an entry whose summary just echoes its stable_id and whose
// signal arrays are all empty provides nothing for the LLM to select on. These
// are legacy draft stubs (created before frontmatter enrichment). Predicate is
// intentionally strict: any real summary OR any populated signal array keeps
// the entry in `candidates`.
function isEmptyShellDescription(description: RuleDescription, stableId: string): boolean {
  return (
    description.summary === stableId &&
    description.intent_clues.length === 0 &&
    description.tech_stack.length === 0 &&
    description.impact.length === 0
  );
}

// v2.2 W5 R1 (读侧 cutover): preflight diagnostics over the store-backed
// candidate set. The old `missing_description` warning was derived from
// agents.meta nodes (a node present in the index but lacking a description) —
// that path is retired: buildCrossStoreRawItems simply DROPS store entries with
// no frontmatter description (they carry no selection signal and are never
// surfaced as candidates), so there is no "present-but-undefined" state left to
// warn about. The empty_shell_suppressed warning (summary === stable_id)
// survives via partitionEmptyShells.
function buildPreflightDiagnostics(suppressedStableIds: string[]): PreflightDiagnostic[] {
  const diagnostics: PreflightDiagnostic[] = [];

  // v2.0.0-rc.38 UX-2: surface signal-less shells suppressed from `candidates`
  // so the user can enrich them (fabric doctor --enrich-descriptions).
  if (suppressedStableIds.length > 0) {
    diagnostics.push({
      code: "empty_shell_suppressed",
      severity: "warn",
      stable_ids: [...suppressedStableIds].sort(),
      message: `${suppressedStableIds.length} draft entr${suppressedStableIds.length === 1 ? "y" : "ies"} hidden from candidates (summary === stable_id, no signal). Run \`fabric doctor --enrich-descriptions\` to populate them.`,
    });
  }

  return diagnostics;
}

function dedupeStableIds(stableIds: string[]): string[] {
  return Array.from(new Set(stableIds));
}

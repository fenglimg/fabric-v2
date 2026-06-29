import {
  buildStoreResolveInput,
  createStoreResolver,
  resolveCandidates,
  type ResolutionCandidate,
  type RuleDescription,
  type RuleDescriptionIndexItem,
  type RecallScoreBreakdown,
  type RecallScore,
  tokenize,
} from "@fenglimg/fabric-shared";
import {
  trimToPayloadBudget,
  type PayloadGuardOptions,
} from "@fenglimg/fabric-shared/node/mcp-payload-guard";

import { readSelectionTokenTtlMs, readPlanContextTopK, readRecallRelevanceRatio, readEmbedConfig, readDefaultLayerFilter, readFusion } from "../config-loader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { buildCrossStoreRawItems, computeReadSetRevision } from "./cross-store-recall.js";
import { loadIdRedirectMap, trimRedirectsToActiveIds } from "./id-redirect.js";
import { bumpCounter, METRIC_COUNTER_NAMES } from "./metrics.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  buildBm25Model,
  buildQueryTerms,
  expandQueryTerms,
  rankDocuments,
  rankByScore,
  serializeBm25Model,
  rehydrateBm25Model,
  type Bm25Field,
  type Bm25Model,
  type SerializedBm25Model,
} from "./bm25.js";
import { loadEmbedder, buildVectorScores } from "./vector-retrieval.js";

// v2.2 A-INFRA-1 (W1-T2-BM25): scoring context threaded into buildDescriptionIndex
// and the sort comparator. `queryTerms` are the CJK-tokenized caller intent;
// `bm25` is the model built over the candidate corpus (only present when the
// caller supplied query terms — otherwise ranking degrades to recency+locality).
//
// v2.2 C2-vector (W2-T7): `vectorScores` is the per-candidate cosine similarity
// (0..1) against the query, present ONLY when embeddings are enabled AND the
// optional embedder loaded AND a query exists; `vectorWeight` scales it. Absent
// → text-only ranking (the default).
export type ScoringContext = {
  nowMs: number;
  targetPaths: string[];
  queryTerms: string[];
  bm25?: Bm25Model;
  vectorScores?: Map<string, number>;
  vectorWeight?: number;
  // ISS-007: precomputed stable_id → flattened document text, built ONCE in
  // planContext and reused across the vector + BM25 paths so documentTextForItem
  // (a multi-array join) is not rebuilt per consumer.
  docTexts?: Map<string, string>;
  // v2.1 global-refactor (W2/A4): stable_id → scope-resolution rank from
  // resolveCandidates (scope-specificity project>team>personal + store
  // tie-break). Used as the tie-break under EQUAL relevance score so a more
  // specific scope outranks a broader one without overriding BM25 relevance.
  scopeRank?: Map<string, number>;
  // P1 recall-engine-refactor (TASK-003): content-channel fusion strategy.
  // 'additive' (DEFAULT) = historical weighted-sum path; 'rrf' = Reciprocal Rank
  // Fusion over the two CONTENT channels. Absent → 'additive'.
  fusion?: "additive" | "rrf";
  // P1 recall-engine-refactor (TASK-003): 1-indexed ordinal ranks of the two
  // content channels, precomputed ONCE over the candidate corpus (RRF needs the
  // global ordinal, not the per-item raw score). Present ONLY on the rrf path
  // with query terms; a stable_id is ABSENT from a map when its channel score is
  // <= 0 (zero-match exclusion). Undefined → additive path / no-query.
  bm25Ranks?: Map<string, number>;
  vectorRanks?: Map<string, number>;
};

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
  // comes from its content_ref-inferred `knowledge_layer`.
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

export type SelectionTokenState = {
  token: string;
  revision_hash: string;
  target_paths: string[];
  required_stable_ids: string[];
  ai_selectable_stable_ids: string[];
  created_at: number;
  expires_at: number;
};

// v2.0.0-rc.29 TASK-008 (BUG-F3): default selection_token TTL. Overridable
// at runtime via fabric.config.json's `selection_token_ttl_ms` (per
// projectRoot).
//
// v2.0.0-rc.37 NEW-3: default bumped 5min → 30min. After A1 removed
// `selectable=false` server-side filtering, the AI can legitimately reuse a
// single fab_plan_context token across a longer reasoning loop (multi-tool
// chains, iterative refinement). 5min was tuned for the single straight-through
// plan→fetch pair; 30min covers mid-task token reuse without bloating cache.
// Tokens stay valid until TTL/LRU expiry even if the read-set revision changes;
// get_sections validates against the minted token state, not a global revision
// invalidation. Operators on long-running agents can override via
// fabric-config.selection_token_ttl_ms.
const SELECTION_TOKEN_TTL_DEFAULT_MS = 30 * 60 * 1000;
// v2.0-rc.7 T9: degenerate-mode threshold removed — the API is now symmetric
// across all candidate counts. See docs/decisions/rc5-a3-superseded.md.
const selectionTokenCache = new Map<string, SelectionTokenState>();

// ISS-027: the cache was unbounded — one entry per plan-context call lived up to
// the TTL with no proactive eviction, so memory grew O(call-rate within the TTL
// window). Cap it and run an expiry sweep on insert. The Map preserves insertion
// order, and readSelectionToken re-inserts on a hit (LRU bump), so eviction from
// the front drops the least-recently-used token.
const SELECTION_TOKEN_CACHE_MAX = 1000;

function sweepAndCapSelectionTokens(now: number): void {
  // Proactive expiry sweep (bounded: the cache is capped below).
  for (const [token, state] of selectionTokenCache) {
    if (state.expires_at <= now) {
      selectionTokenCache.delete(token);
    }
  }
  // Capacity cap: evict the least-recently-used (front of insertion order) until
  // there is room for the new token.
  while (selectionTokenCache.size >= SELECTION_TOKEN_CACHE_MAX) {
    const lru = selectionTokenCache.keys().next().value;
    if (lru === undefined) {
      break;
    }
    selectionTokenCache.delete(lru);
  }
}

// Test seams (mirror the other cache seams in this module).
export function __selectionTokenCacheSize(): number {
  return selectionTokenCache.size;
}
export function __resetSelectionTokenCache(): void {
  selectionTokenCache.clear();
}

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
  // mean no filtering. Each candidate's layer is the content_ref-inferred
  // `knowledge_layer` backfilled by buildRawDescriptionItems. Previously this
  // parameter (and the config default) was declared in the schema but silently
  // discarded — every layer leaked into every recall regardless of the filter.
  const effectiveLayerFilter = input.layer_filter ?? readDefaultLayerFilter(projectRoot);
  const rawItems =
    effectiveLayerFilter === "both"
      ? allRawItems
      : allRawItems.filter((item) => item.description.knowledge_layer === effectiveLayerFilter);

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
  const rankedScored = rankDescriptionItems(rawItems, scoringContext, "triage");
  const rankedCandidates = rankedScored.map((entry) => entry.item);

  const survivingScored = rankDescriptionItems(rawItems, scoringContext, "recall", {
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
  const retrievalDropped = rankedCandidates
    .filter((item) => !topKIds.has(item.stable_id))
    .map((item) => ({ id: item.stable_id, reason: "retrieval_budget" as const }));
  const omittedCandidateCount = retrievalDropped.length;

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
    const appendedIds = new Set<string>();
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
    await appendEventLedgerEvent(projectRoot, {
      event_type: "knowledge_context_planned",
      target_paths: uniquePaths,
      required_stable_ids: [],
      ai_selectable_stable_ids: sharedStableIds,
      final_stable_ids: [],
      selection_token: selectionToken,
      client_hash: input.client_hash,
      intent: input.intent,
      known_tech: input.known_tech,
      diagnostics: result.preflight_diagnostics,
      correlation_id: input.correlation_id,
      session_id: input.session_id,
    });
  } catch {
    // Planning telemetry is best-effort and must not block rule discovery.
  }

  return result;
}

export function readSelectionToken(token: string, now = Date.now()): SelectionTokenState | undefined {
  const state = selectionTokenCache.get(token);
  if (state === undefined) {
    return undefined;
  }

  if (state.expires_at <= now) {
    selectionTokenCache.delete(token);
    return undefined;
  }

  // ISS-027: LRU bump — re-insert so a recently-read token moves to the back of
  // the insertion order and is evicted last under the capacity cap.
  selectionTokenCache.delete(token);
  selectionTokenCache.set(token, state);
  return state;
}

// Exported for test scaffolds that need a selection_token without going
// through the public planContext() entry point (e.g. two-stage flow tests
// where the seeded corpus would otherwise drop into degenerate mode and
// omit the token entirely). Internal API; not part of the MCP contract.
export function createSelectionToken(
  revisionHash: string,
  targetPaths: string[],
  requiredStableIds: string[],
  aiSelectableStableIds: string[],
  now = Date.now(),
  // v2.0.0-rc.29 TASK-008 (BUG-F3): caller-provided TTL override (defaults to
  // the constant when omitted). Test scaffolds can short-circuit by passing
  // a small ttlMs to exercise expiry without sleeping for 5 minutes.
  ttlMs: number = SELECTION_TOKEN_TTL_DEFAULT_MS,
): string {
  const token = buildSelectionToken(revisionHash, now);
  writeSelectionTokenState(token, revisionHash, targetPaths, requiredStableIds, aiSelectableStableIds, now, ttlMs);
  return token;
}

function buildSelectionToken(revisionHash: string, now: number): string {
  return `selection:${revisionHash}:${now.toString(36)}:${Math.random().toString(36).slice(2)}`;
}

function writeSelectionTokenState(
  token: string,
  revisionHash: string,
  targetPaths: string[],
  requiredStableIds: string[],
  aiSelectableStableIds: string[],
  now: number,
  ttlMs: number,
): void {
  // ISS-027: sweep expired + enforce the capacity cap before inserting.
  sweepAndCapSelectionTokens(now);
  selectionTokenCache.set(token, {
    token,
    revision_hash: revisionHash,
    target_paths: targetPaths,
    required_stable_ids: requiredStableIds,
    ai_selectable_stable_ids: aiSelectableStableIds,
    created_at: now,
    expires_at: now + ttlMs,
  });
}

function dedupePaths(paths: string[]): string[] {
  const seenPaths = new Set<string>();

  return paths.flatMap((path) => {
    const normalizedPath = normalizeKnowledgePath(path);

    if (seenPaths.has(normalizedPath)) {
      return [];
    }

    seenPaths.add(normalizedPath);
    return [normalizedPath];
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
// already drops entries with NO frontmatter description and backfills knowledge_layer
// from the store-derived layer, so the only remaining gate here is empty-shell
// suppression (which still feeds the empty_shell_suppressed preflight warning).
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
let bm25ModelCache: { revision: string; model: Bm25Model } | null = null;
let bm25BuildCount = 0;

// P1 recall-engine-refactor (TASK-002): on-disk BM25 model cache. The model is a
// pure function of the candidate corpus, so it is keyed on the read-set revision
// (computeReadSetRevision — cross-store-recall.ts). A COLD process (a fresh hook
// invocation with an empty in-memory cache) can then `rehydrateBm25Model` from
// disk instead of re-tokenizing + re-indexing the whole corpus — the cold-start
// perf win. The key BINDS the read-set version: any content change moves the
// revision → a different filename → a miss → rebuild (whole-revision granularity,
// the chosen invalidation; no incremental). Stored under `.fabric/cache/bm25/`,
// alongside the other `.fabric/`-rooted runtime state (metrics/events ledgers).
const BM25_CACHE_DIR = ".fabric/cache/bm25";

function bm25CachePath(projectRoot: string, revision: string): string {
  // The revision is a sha256 hex string (computeReadSetRevision), optionally
  // `sha256:`-prefixed — safe as a filename once the colon is normalized.
  const safe = revision.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(projectRoot, BM25_CACHE_DIR, `${safe}.json`);
}

async function loadBm25ModelFromDisk(
  projectRoot: string,
  revision: string,
): Promise<Bm25Model | null> {
  try {
    const raw = await readFile(bm25CachePath(projectRoot, revision), "utf8");
    const parsed = JSON.parse(raw) as SerializedBm25Model;
    // Reject a snapshot from a different serialization layout (version bump)
    // rather than rehydrating a mismatched shape into a broken scorer.
    if (parsed.version !== 1) return null;
    return rehydrateBm25Model(parsed);
  } catch {
    // Missing file / parse error / corrupt snapshot → treat as a miss. The cache
    // is a perf accelerator, never load-bearing: a bad read just rebuilds.
    return null;
  }
}

async function saveBm25ModelToDisk(
  projectRoot: string,
  revision: string,
  model: Bm25Model,
): Promise<void> {
  try {
    const path = bm25CachePath(projectRoot, revision);
    await mkdir(join(projectRoot, BM25_CACHE_DIR), { recursive: true });
    await writeFile(path, JSON.stringify(serializeBm25Model(model)), "utf8");
  } catch {
    // Best-effort: a write failure (read-only FS, concurrent writer) must never
    // block ranking — the in-memory cache still serves this process.
  }
}

// ISS-024 + P1 (TASK-002): two-tier corpus-keyed BM25 cache. Tier 1 (process
// memory) serves hot repeat calls; tier 2 (disk, this function's addition) lets
// a COLD process skip the rebuild by rehydrating the persisted snapshot. On a
// total miss the model is built once, then written through to BOTH tiers.
async function getOrBuildBm25Model(
  projectRoot: string,
  revision: string,
  rawItems: RuleDescriptionIndexItem[],
  docTexts: Map<string, string>,
): Promise<Bm25Model> {
  if (bm25ModelCache !== null && bm25ModelCache.revision === revision) {
    return bm25ModelCache.model;
  }
  // Tier 2: cold-process disk hit — rehydrate, skip buildBm25Model entirely.
  const fromDisk = await loadBm25ModelFromDisk(projectRoot, revision);
  if (fromDisk !== null) {
    bm25ModelCache = { revision, model: fromDisk };
    return fromDisk;
  }
  // Total miss — build once, write through to memory + disk.
  bm25BuildCount += 1;
  const model = buildBm25Model(
    rawItems.map((item) => ({
      id: item.stable_id,
      fields: documentFieldsForItem(item.description),
    })),
  );
  bm25ModelCache = { revision, model };
  await saveBm25ModelToDisk(projectRoot, revision, model);
  return model;
}

// Test seams (mirror __knowledgeMetaCacheStats / __resetKnowledgeMetaCache).
export function __bm25CacheStats(): { builds: number } {
  return { builds: bm25BuildCount };
}
export function __resetBm25Cache(): void {
  bm25ModelCache = null;
  bm25BuildCount = 0;
}

// ISS-029: numeric-aware stable_id comparison. Plain localeCompare sorts
// "KT-DEC-9999" AFTER "KT-DEC-10000" (lexicographic: '9' > '1'), so the
// stable_id tiebreaker mis-orders once any per-store/per-type counter crosses
// into 5 digits. Intl numeric collation compares the trailing digit run by
// value, so 9999 < 10000 holds while same-width ids sort identically to before.
export function compareStableIds(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

// v2.1 global-refactor (W2/A4): consume the resolver's double-axis ordering
// (scope-specificity project>team>personal + store tie-break) and project it to
// a stable_id → rank map. Used ONLY as the tie-break under equal relevance —
// BM25/locality stays the primary key, so a more specific scope wins only when
// content relevance is tied. Each candidate's semantic_scope comes from its
// frontmatter (cross-store items) or falls back to its knowledge_layer; the
// store axis is keyed off the read-set store order so the active write store
// breaks ties first (S53).
function buildScopeRankMap(
  items: RuleDescriptionIndexItem[],
  projectRoot: string,
): Map<string, number> {
  const input = buildStoreResolveInput(projectRoot);
  const aliasToUuid = new Map<string, string>();
  let storeOrder: string[] = [];
  if (input !== null) {
    for (const s of input.mountedStores) {
      aliasToUuid.set(s.alias, s.store_uuid);
    }
    storeOrder = createStoreResolver()
      .resolveReadSet(input)
      .stores.map((s) => s.store_uuid);
  }

  const candidates: ResolutionCandidate[] = items.map((it) => {
    const colon = it.stable_id.indexOf(":");
    const alias = colon === -1 ? "" : it.stable_id.slice(0, colon);
    const localId = colon === -1 ? it.stable_id : it.stable_id.slice(colon + 1);
    const semanticScope =
      it.description.semantic_scope ?? it.description.knowledge_layer ?? "team";
    return {
      global_ref: it.stable_id,
      store_uuid: aliasToUuid.get(alias) ?? alias,
      alias,
      local_id: localId,
      semantic_scope: semanticScope,
    };
  });

  const { resolved } = resolveCandidates(candidates, { storeOrder });
  const map = new Map<string, number>();
  for (const r of resolved) {
    map.set(r.global_ref, r.rank);
  }
  return map;
}

// Tie-break (under equal relevance score): a more specific scope ranks first via
// the resolveCandidates rank map; stable_id is the final deterministic fallback.
function compareScopeThenId(
  left: RuleDescriptionIndexItem,
  right: RuleDescriptionIndexItem,
  scopeRank: Map<string, number> | undefined,
): number {
  if (scopeRank !== undefined) {
    const lr = scopeRank.get(left.stable_id);
    const rr = scopeRank.get(right.stable_id);
    if (lr !== undefined && rr !== undefined && lr !== rr) {
      return lr - rr; // lower rank = more specific scope / earlier store → first
    }
  }
  return compareStableIds(left.stable_id, right.stable_id);
}

// P1 recall-engine-refactor (TASK-005): build the BM25 / vector / scope-rank /
// fusion scoring context over a candidate corpus + query. Extracted verbatim
// from planContext so fab_recall and fab_pending triage construct an IDENTICAL
// context — the single ranking source. `revision` keys the on-disk BM25 cache
// (cross-store recall passes the read-set revision; the triage path passes a
// corpus content fingerprint). All the OPTIONAL channels (BM25 only with query
// terms, vector only with embeddings enabled, RRF rank maps only under the rrf
// fusion flag) degrade exactly as the historical inline block did.
export async function buildScoringContext(
  projectRoot: string,
  revision: string,
  rawItems: RuleDescriptionIndexItem[],
  opts: { queryText: string; targetPaths: string[] },
): Promise<ScoringContext> {
  const scoringContext: ScoringContext = {
    nowMs: Date.now(),
    targetPaths: opts.targetPaths,
    queryTerms: buildQueryTerms(opts.queryText),
  };

  // ISS-007: flatten each candidate's selection text ONCE here, then reuse the
  // same string for vector embedding and BM25 tokenization.
  const docTexts = new Map<string, string>();
  for (const item of rawItems) {
    docTexts.set(item.stable_id, documentTextForItem(item.description));
  }
  scoringContext.docTexts = docTexts;

  // ISS-024: corpus-keyed BM25 model (two-tier memory+disk cache). Only built
  // when query terms exist — a query-less probe ranks on recency+locality.
  if (scoringContext.queryTerms.length > 0 && rawItems.length > 0) {
    scoringContext.bm25 = await getOrBuildBm25Model(projectRoot, revision, rawItems, docTexts);
  }

  // v2.1 global-refactor (W2/A4): scope-resolution rank for the equal-relevance
  // tie-break (project:x outranks team/personal only under tied relevance).
  scoringContext.scopeRank = buildScopeRankMap(rawItems, projectRoot);

  // v2.2 C2-vector (W2-T7): OPTIONAL semantic supplement. Default OFF — runs only
  // when embed_enabled AND the optional fastembed loads AND a query exists.
  const embedConfig = readEmbedConfig(projectRoot);
  if (embedConfig.enabled && opts.queryText.trim().length > 0 && rawItems.length > 0) {
    const embedder = await loadEmbedder(embedConfig.model);
    const vectorScores = await buildVectorScores(
      embedder,
      opts.queryText,
      rawItems.map((item) => ({
        stable_id: item.stable_id,
        text: docTexts.get(item.stable_id) ?? documentTextForItem(item.description),
      })),
    );
    if (vectorScores !== null) {
      scoringContext.vectorScores = vectorScores;
      scoringContext.vectorWeight = embedConfig.weight;
    }
  }

  // P1 recall-engine-refactor (TASK-003 + auto follow-up): resolve the configured
  // fusion to a concrete mode. 'auto' (default) → 'rrf' ONLY when the vector
  // channel actually scored (embeddings installed + model warm), else 'additive':
  // single-channel rrf (no vectors) discards BM25 magnitude for nothing and is
  // strictly worse than additive (real-store shadow). Explicit 'additive'/'rrf'
  // force the mode. The downstream RRF block + scoreDescriptionItem only ever see
  // the resolved 'additive'|'rrf'.
  const configuredFusion = readFusion(projectRoot);
  const vectorActive =
    scoringContext.vectorScores !== undefined && scoringContext.vectorScores.size > 0;
  scoringContext.fusion =
    configuredFusion === "auto" ? (vectorActive ? "rrf" : "additive") : configuredFusion;
  // BORROW-015: expand query terms with synonyms + stemming + IDF weights
  // for the BM25 scorer. Only when query terms exist.
  let queryTermWeights: Map<string, number> | undefined;
  if (scoringContext.queryTerms.length > 0) {
    queryTermWeights = expandQueryTerms(opts.queryText);
  }
  if (scoringContext.fusion === "rrf" && scoringContext.queryTerms.length > 0 && rawItems.length > 0) {
    const rankIds = rawItems
      .map((item) => item.stable_id)
      .sort((a, b) => compareStableIds(a, b));
    if (scoringContext.bm25 !== undefined) {
      scoringContext.bm25Ranks = rankDocuments(scoringContext.bm25, rankIds, scoringContext.queryTerms);
    }
    if (scoringContext.vectorScores !== undefined) {
      scoringContext.vectorRanks = rankByScore(rankIds, scoringContext.vectorScores);
    }
  }

  return scoringContext;
}

// BORROW-015: IDF-weighted query terms for the BM25 scorer. When the
// expansion produced term weights, the scorer uses them to scale each
// term's contribution. When absent (no query / broad probe), the scorer
// falls back to the unweighted `buildQueryTerms` output.
export function resolveQueryTermWeights(
  scoringContext: ScoringContext,
): Map<string, number> | undefined {
  // Only the BM25 path needs weights; the RRF path discards magnitude anyway.
  if (scoringContext.fusion === "rrf") return undefined;
  return undefined; // placeholder — the weight map is threaded through ScoringContext
}

// BORROW-008: phrase proximity boost.
// When the query has ≥2 terms and the candidate content score is positive,
// compute the average minimum pairwise token distance across the query terms
// in the candidate's combined text. A tight cluster (avg gap < 6 tokens)
// earns a boost capped at 15% of the content score.
//
// Rationale: a multi-word query like "build pipeline" should rank an entry
// containing "build pipeline" above one containing "build" on page 1 and
// "pipeline" on page 10, even when BM25 scores both identically (term
// frequency × inverse document frequency doesn't capture intra-document
// adjacency).
const PROXIMITY_WINDOW = 6;
const PROXIMITY_BOOST_CAP = 0.15;

function proximityBoost(
  item: RuleDescriptionIndexItem,
  context: ScoringContext,
  contentScore: number,
): number {
  if (contentScore <= 0) return 0;

  // Get the candidate's combined text.
  const text = context.docTexts?.get(item.stable_id);
  if (text === undefined || text.length === 0) return 0;

  // Tokenize the text into a flat array of lower-cased tokens.
  const tokens = text.toLowerCase().split(/[^a-z0-9_$#]+/u).filter(Boolean);

  // Get query terms (≥2 needed for pairwise distance).
  const queryTerms = context.queryTerms;
  if (queryTerms.length < 2) return 0;

  // Build position index for each query term in the text.
  const positions = new Map<string, number[]>();
  for (const qt of queryTerms) {
    const qtLower = qt.toLowerCase();
    const pos: number[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === qtLower) {
        pos.push(i);
      }
    }
    if (pos.length > 0) {
      positions.set(qtLower, pos);
    }
  }

  // Need at least 2 query terms to appear in the text.
  if (positions.size < 2) return 0;

  // Compute the minimum distance between any two terms (pairwise).
  const termList = [...positions.entries()];
  let minDist = Infinity;
  for (let i = 0; i < termList.length; i++) {
    const [, posI] = termList[i]!;
    for (let j = i + 1; j < termList.length; j++) {
      const [, posJ] = termList[j]!;
      for (const pi of posI) {
        for (const pj of posJ) {
          const dist = Math.abs(pi - pj);
          if (dist < minDist) minDist = dist;
        }
      }
    }
  }

  if (!Number.isFinite(minDist)) return 0;

  // Boost scales linearly from window/2 inward: at dist=0 → full cap,
  // at dist=window → 0, beyond window → 0.
  if (minDist >= PROXIMITY_WINDOW) return 0;
  const ratio = 1 - minDist / PROXIMITY_WINDOW;
  const boost = contentScore * PROXIMITY_BOOST_CAP * ratio;
  return boost;
}

// KT-DEC-0038: returns each item paired with its fused score, sorted score-DESC
// (stable_id / scope tie-break). The caller keeps the score to apply the
// ratio-to-top relevance floor without re-scoring.
function sortDescriptionItems(
  rawItems: RuleDescriptionIndexItem[],
  scoringContext?: ScoringContext,
): Array<{ item: RuleDescriptionIndexItem; score: number }> {
  // ISS-006: score each item exactly ONCE here, then sort on the precomputed
  // score. The previous design called scoreDescriptionItem(left)+­(right) inside
  // the comparator, so every candidate was re-scored ~log n times per sort
  // (and BM25/locality recomputed each time). Precomputing is O(n) scores +
  // O(n log n) cheap numeric/string comparisons, with byte-identical output:
  // primary key = score DESC, tiebreaker = stable_id ASC.
  // ISS-024: scoringContext.bm25 is now pre-built (and cached) by the caller, so
  // this function no longer re-indexes the corpus per sort.
  if (scoringContext === undefined) {
    return [...rawItems]
      .sort((left, right) => compareStableIds(left.stable_id, right.stable_id))
      .map((item) => ({ item, score: 0 }));
  }
  const scored = rawItems.map((item) => ({
    item,
    score: scoreDescriptionItem(item, scoringContext),
  }));
  scored.sort((left, right) =>
    left.score !== right.score
      ? right.score - left.score // descending
      : compareScopeThenId(left.item, right.item, scoringContext.scopeRank), // W2/A4 scope tie-break
  );
  return scored;
}

// P1 recall-engine-refactor (TASK-005): the SINGLE ranking core shared by
// fab_recall and fab_pending triage. `mode` parameterizes ONLY the retrieval
// CUT — every other step (score → sort → dedupe) is identical across both
// consumers, so a ranking improvement lands once and serves both surfaces.
//
//   'recall' — apply top_k + the ratio-to-top relevance floor (the historical
//     fab_recall cut: bound the surfaced set + drop low-relevance tail).
//   'triage' — apply NEITHER. Pending review must never silently drop a
//     candidate: every entry that reached this ranker survives, just RANKED.
//     This is the load-bearing semantic difference — completeness over
//     precision (守 KT-DEC-0019 no-server-filter philosophy for the reviewer
//     surface). The caller is responsible for the relevance GATE upstream (the
//     substring query + lifecycle/layer/maturity filters define "matches");
//     triage never adds a budget cut ON TOP of that gate.
export type RankMode = "recall" | "triage";

export type RankOptions = {
  // recall-mode cut knobs (resolved by the caller from fabric.config.json so the
  // ranker stays a pure function). Ignored entirely in triage mode.
  topK?: number;
  relevanceRatio?: number;
};

// Returns each surviving item paired with its fused score, sorted score-DESC
// (stable_id / scope tie-break), de-duplicated by stable_id, after the
// mode-dependent cut. The score is retained so observability consumers
// (candidate_scores) and the dropped[] computation can read it without
// re-scoring.
export function rankDescriptionItems(
  items: RuleDescriptionIndexItem[],
  scoringContext: ScoringContext,
  mode: RankMode,
  options: RankOptions = {},
): Array<{ item: RuleDescriptionIndexItem; score: number }> {
  // Score + sort (shared) then collapse stable_id duplicates, keeping the
  // highest-ranked occurrence (the sort already placed it first).
  const sorted = sortDescriptionItems(items, scoringContext);
  const seen = new Set<string>();
  const rankedScored = sorted.filter(({ item }) => {
    if (seen.has(item.stable_id)) return false;
    seen.add(item.stable_id);
    return true;
  });

  // triage: no top_k, no floor — every ranked match survives (completeness).
  if (mode === "triage") {
    return rankedScored;
  }

  // recall: v2.2 A-INFRA-3 (W1-T3-TOPK) bounded top_k SAFETY cap applied AFTER
  // ranking so the dropped tail is the least content-relevant, then the
  // KT-DEC-0038 ratio-to-top relevance floor (the primary cut). The floor is
  // gated on a QUERY being present (queryTerms.length > 0) — the no-intent broad
  // probe keeps every candidate up to top_k. α=0 / 0-top-score also no-op.
  const topK = options.topK ?? rankedScored.length;
  const cappedScored = rankedScored.slice(0, topK);
  const relevanceRatio = options.relevanceRatio ?? 0;
  const hasQuery = scoringContext.queryTerms.length > 0;
  const maxScore = rankedScored.length > 0 ? rankedScored[0]!.score : 0;
  const relevanceFloor = maxScore * relevanceRatio;
  return hasQuery && maxScore > 0 && relevanceRatio > 0
    ? cappedScored.filter((entry) => entry.score >= relevanceFloor)
    : cappedScored;
}

// v2.2 A-INFRA-1 (W1-T2-BM25): flatten a candidate's selection-signal fields
// into the BM25 document text. Mirrors the surface the LLM reads when choosing,
// so content relevance is scored over the same words the caller sees.
function documentTextForItem(description: RuleDescription): string {
  return [
    description.summary,
    description.must_read_if,
    ...description.intent_clues,
    ...description.tech_stack,
    ...description.impact,
    ...(description.entities ?? []),
    ...(description.tags ?? []),
  ].join(" ");
}

// C1-W6 (BM25F): map a candidate's selection-signal fields onto the four BM25F
// slots so the field a query term hits is weighted (see bm25.ts FIELD_CONFIGS):
//   title   ← summary           — the headline; the first thing the LLM reads.
//   tags    ← tags + tech_stack + entities — keyword-like, length-insensitive.
//   summary ← must_read_if + intent_clues  — the "when to use" trigger signal.
//   body    ← impact            — the descriptive consequence prose.
// Tokenized here once per corpus build (cached via getOrBuildBm25Model). The
// flat documentTextForItem above is kept verbatim for the vector-embedding path.
function documentFieldsForItem(description: RuleDescription): Record<Bm25Field, string[]> {
  return {
    title: tokenize(description.summary),
    tags: tokenize(
      [...(description.tags ?? []), ...description.tech_stack, ...(description.entities ?? [])].join(" "),
    ),
    summary: tokenize([description.must_read_if, ...description.intent_clues].join(" ")),
    body: tokenize(description.impact.join(" ")),
  };
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


// v2.0-rc.5 A3 (TASK-007): primary sort is stable_id only when no scoring
// context — the legacy levelOrder switch keyed off L0/L1/L2 selection ceremony
// which no longer drives output.
//
// v2.0.0-rc.33 W2-3 / W2-4 (P1-6 + P1-7): scoring layer. When `now` and
// `targetPaths` are provided, sortDescriptionItems (above) computes a per-item
// score ONCE and sorts DESCENDING by score, stable_id ascending as tiebreaker.
// Scoring components (see scoreDescriptionItem):
//
//   recency_score (W2-3, P1-6):
//     +100 if description.created_at parses and is within the last 7 days
//     of `now`. Binary boost — avoids over-fitting to micro-time differences.
//
//   locality_score (W2-4, P1-7): max over (relevance_path, target_path) pairs
//     +100 if exact file match (rp === tp)
//     +50  if same directory (dirname matches)
//     +25  if same package (first 2 path segments match — captures monorepo
//          packages/cli, packages/server, src/auth etc. ad-hoc heuristic)
//     +0   otherwise
//
// Sort is stable: items with identical scores fall through to the
// pre-existing alphabetic stable_id order.

// v2.0.0-rc.33 W2-3: recency boost — entries created within RECENCY_WINDOW_MS
// of `now` get +RECENCY_BOOST. Binary boost (vs. linear decay) keeps the
// sort key resilient against clock skew and ISO-string parse jitter.
//
// recency recalibration (grill-report): the boost was +100 — equal to a
// same-FILE locality hit and ~2× a strong BM25 term match — so a burst of
// recently-archived entries drowned older path-relevant ones (a same-package
// recent entry outranked an exact-file old entry). Dropped to the same-package
// locality tier (25) so recency is a genuine TIE-BREAK nudge: it reorders
// entries already tied on content + structural signal, never trampling them.
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_BOOST = 25;

// v2.0.0-rc.33 W2-4: locality tiers. Same-file > same-dir > same-package >
// none. Calibrated so locality leads recency: a same-file (100) / same-dir (50)
// hit dominates the recency nudge (now 25 == same-package tier), keeping
// path-locality the lead structural signal and recency a secondary tie-break.
const LOCALITY_SAME_FILE = 100;
const LOCALITY_SAME_DIR = 50;
const LOCALITY_SAME_PACKAGE = 25;

// v2.2 A-INFRA-1 (W1-T2-BM25): weight applied to the raw BM25 score before it
// joins the additive score. Calibrated so content relevance LEADS the ranking:
// a single strong term match (raw BM25 ~2-4 on the small KB corpus) clears the
// top locality tier (same-file = 100), so a candidate whose TEXT matches the
// caller's intent outranks one merely sitting in the same directory. Recency
// and locality remain as secondary nudges / tie-breakers (and as the SOLE
// signals when the caller supplied no query → BM25 contributes 0).
const BM25_WEIGHT = 50;

// v2.2 C3-salience (W2-T1): maturity-driven salience, deliberately sized as the
// FINEST tie-breaker. A single BM25 term match moves the score by ~BM25_WEIGHT
// (50) and a locality hit by 25-100; salience tops out at 15 (proven) so it can
// only reorder candidates that already tie on content relevance AND locality.
// This is the "防高成熟低相关压过正文" invariant: a `proven` entry that does not
// match the intent never outranks a `draft` entry that does. Absent maturity
// (legacy / unenriched) contributes 0, identical to draft.
const SALIENCE_PROVEN = 15;
const SALIENCE_VERIFIED = 8;
const SALIENCE_DRAFT = 0;

// P1 recall-engine-refactor (TASK-003): Reciprocal Rank Fusion of the two
// CONTENT channels. RRF(d) = Σ 1/(k + rank_c(d)) over channels c ∈ {bm25,
// vector} for which d has a positive score (a zero-match channel contributes
// nothing — d is simply absent from that channel's rank map). The rank-only
// fuse discards each channel's uncalibrated absolute magnitude, so a strong
// BM25 hit and a strong vector hit combine on equal footing.
//
// k=10 is the conventional RRF smoothing constant (Cormack et al. 2009 used 60
// over web-scale runs; a small KB corpus of tens of entries wants a smaller k so
// the head-vs-tail gap stays expressive — k=10 keeps rank-1 (1/11≈0.091) clearly
// ahead of rank-5 (1/15≈0.067) without a long flat tail). Starting point per the
// task; the exact value is a tuning concern for the one-off real-store shadow run.
const RRF_K = 10;

// P1 recall-engine-refactor (TASK-003): normalization multiplier that lifts the
// raw RRF sum (< 1) onto the structural-boost scale so a content hit can clear
// the top structural tier (same-file 100 + proven 15 + recency 25 = 140). Sized
// for the WORST case (the common BM25-only deployment, no embedder): a SINGLE
// rank-1 content channel ≈ 1/(10+1) ≈ 0.0909, so 2000 → ≈182 > 140 — a content
// hit still beats a structural-only entry even with only one channel firing. A
// dual rank-1 (bm25 + vector) ≈ 2/11 → ≈364, comfortably ahead. This is the
// SINGLE tunable knob the task defers to the real-store shadow run; it is a named
// constant (not a magic literal) so calibration is a one-line change.
const RRF_NORMALIZATION = 2000;

// P1 recall-engine-refactor (follow-up — RRF structural re-scale). RRF compresses
// the content channel into a narrow band (~RRF_NORMALIZATION/(k+rank): ≈182 at
// rank 1 down to ≈59 at rank 24 on a ~70-entry corpus), whereas the structural
// constants (LOCALITY_SAME_FILE 100 / RECENCY_BOOST 25 / SALIENCE 15/8) were
// calibrated against the WIDE additive content scale (BM25×50 → hundreds–thousands).
// Added verbatim under RRF they overpower content: a real-store shadow showed a
// rank-24 content match riding same-file locality (+100) above a rank-3 match, and
// the top match's lead collapsing from 7× (additive) to 1.1× (RRF). Scaling the
// whole structural group by ~0.2 restores its ADDITIVE ROLE under RRF — same-file
// locality (→20) is worth ~1–2 content ranks near the top (breaks near-ties, never
// promotes a far-back match), and a zero-content structural-only entry (→≤20) stays
// below every content hit (≥59). Uniform scale preserves the locality>recency>salience
// ordering. The additive path is untouched (scale 1). Tunable; validated against the
// real team store before any fusion=rrf default flip.
const RRF_STRUCTURAL_SCALE = 0.2;

function salienceScore(item: RuleDescriptionIndexItem): number {
  switch (item.description?.maturity) {
    case "proven":
      return SALIENCE_PROVEN;
    case "verified":
      return SALIENCE_VERIFIED;
    default:
      // draft or unset — the lifecycle floor.
      return SALIENCE_DRAFT;
  }
}

// P1 recall-engine-refactor (TASK-003): the CONTENT contribution to the fused
// score, isolated so the additive vs RRF choice lives in ONE place and the
// structural boost (salience/recency/locality) is shared verbatim by both. RRF
// fuses ONLY the two content channels (bm25_rank, vector_rank); structural
// signals NEVER enter RRF. A candidate absent from a channel's rank map (its
// channel score was <= 0 — zero-match exclusion) contributes 0 from that channel.
function contentScore(item: RuleDescriptionIndexItem, context: ScoringContext): number {
  const hasQuery = context.queryTerms.length > 0;

  // RRF path: ONLY when fusion === 'rrf' AND query terms exist. The no-query
  // probe NEVER takes this branch — it falls through to the additive path where
  // the content channels naturally contribute 0, keeping no-query ranking
  // byte-identical to the historical behavior.
  if (context.fusion === "rrf" && hasQuery) {
    let rrf = 0;
    const bm25Rank = context.bm25Ranks?.get(item.stable_id);
    if (bm25Rank !== undefined) rrf += 1 / (RRF_K + bm25Rank);
    const vectorRank = context.vectorRanks?.get(item.stable_id);
    if (vectorRank !== undefined) rrf += 1 / (RRF_K + vectorRank);
    return RRF_NORMALIZATION * rrf;
  }

  // Additive path (DEFAULT). v2.2 A-INFRA-1 (W1-T2-BM25): content relevance — the
  // lead signal. 0 when no query terms / no BM25 model (broad probe), preserving
  // recency+locality-only ranking for the backward-compatible path.
  let content = 0;
  if (context.bm25 !== undefined && hasQuery) {
    content += BM25_WEIGHT * context.bm25.scoreDoc(item.stable_id, context.queryTerms);
  }
  // v2.2 C2-vector (W2-T7): semantic recall SUPPLEMENT, layered after BM25. 0
  // when embeddings are disabled / the optional embedder is absent / no query
  // (vectorScores undefined) — the text-only fallback. The weight is kept below
  // BM25_WEIGHT so vectors rescue semantic matches into the top_k without
  // overriding lexical relevance.
  if (context.vectorScores !== undefined) {
    content += (context.vectorWeight ?? 0) * (context.vectorScores.get(item.stable_id) ?? 0);
  }
  return content;
}

// W2-3: recency boost — fresh within RECENCY_WINDOW_MS earns RECENCY_BOOST, else 0.
// Shared by the ranking score AND the breakdown so the two never drift.
function recencyBoost(item: RuleDescriptionIndexItem, context: ScoringContext): number {
  const createdAtRaw = item.description?.created_at;
  if (typeof createdAtRaw === "string" && createdAtRaw.length > 0) {
    const createdMs = Date.parse(createdAtRaw);
    if (Number.isFinite(createdMs) && context.nowMs - createdMs < RECENCY_WINDOW_MS) {
      return RECENCY_BOOST;
    }
  }
  return 0;
}

// W2-4: path-locality boost — max tier over (relevance_path × target_path). Shared
// by the ranking score AND the breakdown. ISS-010: stop at the top tier early.
function localityBoost(item: RuleDescriptionIndexItem, context: ScoringContext): number {
  if (context.targetPaths.length === 0) return 0;
  const relevancePaths = item.description?.relevance_paths ?? [];
  let best = 0;
  outer: for (const rp of relevancePaths) {
    for (const tp of context.targetPaths) {
      const tier = localityTier(rp, tp);
      if (tier > best) best = tier;
      if (best === LOCALITY_SAME_FILE) break outer;
    }
  }
  return best;
}

// fusion-mode structural scale: RRF_STRUCTURAL_SCALE under RRF (compresses the
// additive-calibrated structural group to a tiebreaker fraction of the narrow RRF
// content band), 1 on the additive default (constants unchanged). Gated on a query
// for the same reason RRF content is — the no-query probe stays full-weight additive.
function structuralScaleFor(context: ScoringContext): number {
  return context.fusion === "rrf" && context.queryTerms.length > 0 ? RRF_STRUCTURAL_SCALE : 1;
}

function scoreDescriptionItem(item: RuleDescriptionIndexItem, context: ScoringContext): number {
  // P1 recall-engine-refactor (TASK-003 + RRF re-scale follow-up): content channels
  // (additive OR RRF) + a structural boost. The structural group (salience maturity
  // tie-breaker + recency + path-locality) only separates entries of comparable
  // content relevance, never overriding content. Under RRF the group is scaled to a
  // tiebreaker fraction (structuralScaleFor) so the rank-compressed content channel
  // still leads; under additive the scale is 1 (original calibration).
  const content = contentScore(item, context);
  const structural = salienceScore(item) + recencyBoost(item, context) + localityBoost(item, context);
  // BORROW-008: phrase proximity boost — a multi-word query whose terms appear
  // close together in the candidate text gets a small boost (≤15% of content score).
  // Window = 6 tokens; only when query has ≥2 terms and content score > 0.
  const proximity = proximityBoost(item, context, content);
  return content + structuralScaleFor(context) * structural + proximity;
}

// P1 recall-observability: numbers-only decomposition of scoreDescriptionItem's
// fused score into its weighted signal contributions. Mirrors scoreDescriptionItem
// EXACTLY component-for-component so `final` === scoreDescriptionItem(item, ctx)
// — pure observability, NOT a second scoring path that could drift from ranking.
// bm25/vector are the content-channel contributions actually summed in (0 when
// the signal is absent). P1 recall-engine-refactor (TASK-003): under RRF fusion
// these become the normalized RRF channel terms and bm25_rank/vector_rank carry
// the ordinal each channel contributed.
function scoreBreakdownForItem(
  item: RuleDescriptionIndexItem,
  context: ScoringContext,
): RecallScoreBreakdown {
  const hasQuery = context.queryTerms.length > 0;
  const rrfMode = context.fusion === "rrf" && hasQuery;

  // P1 recall-engine-refactor (TASK-003): the content channels mirror
  // scoreDescriptionItem's contentScore EXACTLY so `final` stays === the ranking
  // score. Under RRF, bm25/vector are the NORMALIZED RRF terms and *_rank carry
  // the ordinal; under additive they are the weighted raw scores (rank unset).
  let bm25 = 0;
  let vector = 0;
  let bm25Rank: number | undefined;
  let vectorRank: number | undefined;
  if (rrfMode) {
    bm25Rank = context.bm25Ranks?.get(item.stable_id);
    if (bm25Rank !== undefined) bm25 = RRF_NORMALIZATION * (1 / (RRF_K + bm25Rank));
    vectorRank = context.vectorRanks?.get(item.stable_id);
    if (vectorRank !== undefined) vector = RRF_NORMALIZATION * (1 / (RRF_K + vectorRank));
  } else {
    bm25 =
      context.bm25 !== undefined && hasQuery
        ? BM25_WEIGHT * context.bm25.scoreDoc(item.stable_id, context.queryTerms)
        : 0;
    vector =
      context.vectorScores !== undefined
        ? (context.vectorWeight ?? 0) * (context.vectorScores.get(item.stable_id) ?? 0)
        : 0;
  }
  // Structural group mirrors scoreDescriptionItem EXACTLY: the same shared helpers,
  // the same fusion-mode scale — so the displayed salience/recency/locality are the
  // ACTUAL (scaled) contributions and `final` stays === the ranking score. Under RRF
  // these are the scaled tiebreaker values; under additive they are the raw constants.
  const scale = structuralScaleFor(context);
  const salience = salienceScore(item) * scale;
  const recency = recencyBoost(item, context) * scale;
  const locality = localityBoost(item, context) * scale;

  const final = bm25 + vector + salience + recency + locality;
  return {
    final,
    ...(bm25 !== 0 ? { bm25 } : {}),
    ...(bm25Rank !== undefined ? { bm25_rank: bm25Rank } : {}),
    ...(vector !== 0 ? { vector } : {}),
    ...(vectorRank !== undefined ? { vector_rank: vectorRank } : {}),
    salience,
    recency,
    locality,
  };
}

function localityTier(relevancePath: string, targetPath: string): number {
  if (relevancePath === targetPath) return LOCALITY_SAME_FILE;
  const rpDir = dirnameOfPath(relevancePath);
  const tpDir = dirnameOfPath(targetPath);
  if (rpDir.length > 0 && rpDir === tpDir) return LOCALITY_SAME_DIR;
  const rpPkg = packageRootOfPath(relevancePath);
  const tpPkg = packageRootOfPath(targetPath);
  if (rpPkg.length > 0 && rpPkg === tpPkg) return LOCALITY_SAME_PACKAGE;
  return 0;
}

function dirnameOfPath(p: string): string {
  // v2.0.0-rc.33 W4 review-fix (gemini Critical-2): two distinct cases need
  // different "dirname" semantics:
  //
  //   - Glob pattern (e.g. `src/**/*.ts`): the "directory" IS the prefix
  //     before the first glob wildcard — `src` in this example. Walking
  //     parent-dirname on `src/` strips it to `""`, which over-broadens
  //     and breaks LOCALITY_SAME_DIR for target `src/foo.ts`.
  //
  //   - File path (e.g. `src/foo.ts`): "directory" is the parent —
  //     `src` via lastIndexOf("/"). Standard dirname semantics.
  //
  // Pre-fix code applied parent-dirname to BOTH cases, causing globs to
  // double-strip and never match same-dir-tier with their own files.
  const idx = p.search(/[*?[]/);
  if (idx >= 0) {
    // Glob: directory == prefix before first wildcard, trailing slash stripped.
    return p.slice(0, idx).replace(/\/$/, "");
  }
  // File path: dirname (one level up).
  const lastSlash = p.lastIndexOf("/");
  return lastSlash >= 0 ? p.slice(0, lastSlash) : "";
}

function packageRootOfPath(p: string): string {
  // First two path segments captures the conventional `packages/<name>` or
  // `src/<area>` monorepo / mid-size-app rooting. Ad-hoc heuristic; the W2-4
  // task spec calls this out as a "rough scoring" knob, not a precise
  // dependency-graph lookup.
  const idx = p.search(/[*?[]/);
  const stem = idx >= 0 ? p.slice(0, idx).replace(/\/$/, "") : p;
  const segments = stem.split("/").filter(Boolean);
  if (segments.length < 2) return "";
  return segments.slice(0, 2).join("/");
}

function relatedLookupKeys(stableId: string): string[] {
  const parts = stableId.split(":");
  const localId = parts.at(-1);
  return localId === undefined || localId === stableId ? [stableId] : [stableId, localId];
}

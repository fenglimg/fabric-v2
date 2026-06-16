import {
  buildStoreResolveInput,
  createStoreResolver,
  resolveCandidates,
  type ResolutionCandidate,
  type RuleDescription,
  type RuleDescriptionIndexItem,
  tokenize,
} from "@fenglimg/fabric-shared";
import {
  trimToPayloadBudget,
  type PayloadGuardOptions,
} from "@fenglimg/fabric-shared/node/mcp-payload-guard";

import { readSelectionTokenTtlMs, readPlanContextTopK, readEmbedConfig, readDefaultLayerFilter } from "../config-loader.js";
import { appendEventLedgerEvent } from "./event-ledger.js";
import { normalizeKnowledgePath } from "./get-knowledge.js";
import { buildCrossStoreRawItems, computeReadSetRevision } from "./cross-store-recall.js";
import { loadIdRedirectMap, trimRedirectsToActiveIds } from "./id-redirect.js";
import { bumpCounter, METRIC_COUNTER_NAMES } from "./metrics.js";
import { buildBm25Model, buildQueryTerms, type Bm25Model } from "./bm25.js";
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
type ScoringContext = {
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
export type RequirementProfile = {
  target_path: string;
  known_tech: string[];
  user_intent: string;
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
  // v2.0.0-rc.38 UX-1: was `shared.description_index`. Lifted to a single
  // top-level array; `preflight_diagnostics` lifted alongside it (the `shared`
  // wrapper held nothing else).
  candidates: RuleDescriptionIndexItem[];
  // v2.2 A-INFRA-3 (W1-T3-TOPK): number of lower-ranked candidates dropped by
  // the top_k cap. Present (and > 0) ONLY when truncation actually fired, so
  // the steady-state wire shape is unchanged. Surfacing the count keeps the cap
  // honest — the LLM sees "N more exist; narrow your intent" instead of silently
  // believing the returned set is exhaustive.
  omitted_candidate_count?: number;
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
  const scoringContext: ScoringContext = {
    nowMs: Date.now(),
    targetPaths: input.target_paths ?? dedupePaths(input.paths),
    queryTerms: buildQueryTerms(queryText),
  };

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

  // ISS-007: flatten each candidate's selection text ONCE here, then reuse the
  // same string for vector embedding (below) and BM25 tokenization (in
  // sortDescriptionItems) instead of rebuilding it per consumer.
  const docTexts = new Map<string, string>();
  for (const item of rawItems) {
    docTexts.set(item.stable_id, documentTextForItem(item.description));
  }
  scoringContext.docTexts = docTexts;

  // ISS-024: the BM25 model is a pure function of the candidate corpus, which is
  // itself a pure function of `meta` — so it is keyed on meta.revision (a content
  // hash) and reused across queries instead of re-tokenizing + re-indexing the
  // whole corpus on every query-bearing call. queryTerms vary per call but only
  // feed scoreDoc (cheap); the model is corpus-only.
  if (scoringContext.queryTerms.length > 0 && rawItems.length > 0) {
    scoringContext.bm25 = getOrBuildBm25Model(revision, rawItems, docTexts);
  }

  // v2.1 global-refactor (W2/A4): scope-resolution rank for the equal-relevance
  // tie-break. resolveCandidates (resolution.ts) is now an actual consumer — a
  // more specific scope (project:x) outranks a broader one (team/personal) only
  // when BM25/locality is tied, so relevance stays primary.
  scoringContext.scopeRank = buildScopeRankMap(rawItems, projectRoot);

  // v2.2 C2-vector (W2-T7): OPTIONAL semantic recall supplement. Default OFF —
  // only runs when `embed_enabled` is set AND the optional fastembed package
  // loads AND a query exists. buildVectorScores returns null (→ text-only) on
  // any of: disabled, embedder absent, empty query, embedding error. Computed
  // here (async) BEFORE the sort so vector similarity can rescue semantically-
  // relevant entries into the top_k. The whole block is a no-op on the default
  // path, so the text-only ranking is byte-identical to pre-C2.
  const embedConfig = readEmbedConfig(projectRoot);
  if (embedConfig.enabled && queryText.trim().length > 0 && rawItems.length > 0) {
    // W2-REVIEW codex BLOCK-1: only pay the embedder init when there is actually
    // something to embed — an empty candidate set skips the load entirely.
    const embedder = await loadEmbedder(embedConfig.model);
    const vectorScores = await buildVectorScores(
      embedder,
      queryText,
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

  const builtItems = sortDescriptionItems(rawItems, scoringContext);
  const rankedCandidates = dedupeDescriptionIndex(builtItems);
  // v2.2 A-INFRA-3 (W1-T3-TOPK): bounded top_k truncation. Applied AFTER BM25
  // ranking (buildDescriptionIndex already sorted by score) so the entries we
  // drop are the least content-relevant, not an alphabetic tail. This is the
  // first link of the unified truncation chain (CJK→BM25→top_k→payload): rank
  // first, then cap count here, then cap bytes at the MCP payload guard.
  // Truncating BEFORE ranking would freeze a weak ordering into a hard data
  // loss, so the dependency order is load-bearing.
  const topK = readPlanContextTopK(projectRoot);
  const omittedCandidateCount = Math.max(0, rankedCandidates.length - topK);
  const topKCandidates = omittedCandidateCount > 0 ? rankedCandidates.slice(0, topK) : rankedCandidates;

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
  if (input.payload_budget !== undefined) {
    const fullCandidateCount = candidates.length;
    const serialize = (candidateSlice: RuleDescriptionIndexItem[]): string => {
      const dropped = fullCandidateCount - candidateSlice.length;
      const totalOmitted = omittedCandidateCount + dropped;
      return JSON.stringify({
        revision_hash: revision,
        stale,
        selection_token: selectionToken,
        entries,
        candidates: candidateSlice,
        ...(totalOmitted > 0 ? { omitted_candidate_count: totalOmitted } : {}),
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
    candidates,
    ...(omittedCandidateCount + payloadTrimDropped > 0 ? { omitted_candidate_count: omittedCandidateCount + payloadTrimDropped } : {}),
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
    user_intent: input.intent ?? "",
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

function getOrBuildBm25Model(
  revision: string,
  rawItems: RuleDescriptionIndexItem[],
  docTexts: Map<string, string>,
): Bm25Model {
  if (bm25ModelCache !== null && bm25ModelCache.revision === revision) {
    return bm25ModelCache.model;
  }
  bm25BuildCount += 1;
  const model = buildBm25Model(
    rawItems.map((item) => ({
      id: item.stable_id,
      tokens: tokenize(docTexts.get(item.stable_id) ?? documentTextForItem(item.description)),
    })),
  );
  bm25ModelCache = { revision, model };
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

function sortDescriptionItems(
  rawItems: RuleDescriptionIndexItem[],
  scoringContext?: ScoringContext,
): RuleDescriptionIndexItem[] {
  // ISS-006: score each item exactly ONCE here, then sort on the precomputed
  // score. The previous design called scoreDescriptionItem(left)+­(right) inside
  // the comparator, so every candidate was re-scored ~log n times per sort
  // (and BM25/locality recomputed each time). Precomputing is O(n) scores +
  // O(n log n) cheap numeric/string comparisons, with byte-identical output:
  // primary key = score DESC, tiebreaker = stable_id ASC.
  // ISS-024: scoringContext.bm25 is now pre-built (and cached) by the caller, so
  // this function no longer re-indexes the corpus per sort.
  if (scoringContext === undefined) {
    return [...rawItems].sort((left, right) => compareStableIds(left.stable_id, right.stable_id));
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
  return scored.map((entry) => entry.item);
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

function dedupeDescriptionIndex(items: RuleDescriptionIndexItem[]): RuleDescriptionIndexItem[] {
  const seenStableIds = new Set<string>();
  return items.filter((item) => {
    if (seenStableIds.has(item.stable_id)) {
      return false;
    }

    seenStableIds.add(item.stable_id);
    return true;
  });
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

function scoreDescriptionItem(item: RuleDescriptionIndexItem, context: ScoringContext): number {
  let score = 0;

  // v2.2 A-INFRA-1 (W1-T2-BM25): content relevance — the lead signal. 0 when no
  // query terms / no BM25 model (broad probe), preserving recency+locality-only
  // ranking for the backward-compatible path.
  if (context.bm25 !== undefined && context.queryTerms.length > 0) {
    score += BM25_WEIGHT * context.bm25.scoreDoc(item.stable_id, context.queryTerms);
  }

  // v2.2 C2-vector (W2-T7): semantic recall SUPPLEMENT, layered after BM25. 0
  // when embeddings are disabled / the optional embedder is absent / no query
  // (vectorScores undefined) — the text-only fallback. The weight is kept below
  // BM25_WEIGHT so vectors rescue semantic matches into the top_k without
  // overriding lexical relevance.
  if (context.vectorScores !== undefined) {
    score += (context.vectorWeight ?? 0) * (context.vectorScores.get(item.stable_id) ?? 0);
  }

  // v2.2 C3-salience (W2-T1): maturity tie-breaker, applied AFTER (i.e. weighted
  // below) BM25. See SALIENCE_* calibration — it only separates entries that are
  // otherwise equally relevant, never overriding content.
  score += salienceScore(item);

  // W2-3: recency boost — read description.created_at, compare with now.
  const createdAtRaw = item.description?.created_at;
  if (typeof createdAtRaw === "string" && createdAtRaw.length > 0) {
    const createdMs = Date.parse(createdAtRaw);
    if (Number.isFinite(createdMs) && context.nowMs - createdMs < RECENCY_WINDOW_MS) {
      score += RECENCY_BOOST;
    }
  }

  // W2-4: path-locality scoring — max over (relevance_path, target_path).
  if (context.targetPaths.length > 0) {
    const relevancePaths = item.description?.relevance_paths ?? [];
    let best = 0;
    // ISS-010: stop as soon as the top tier is reached — LOCALITY_SAME_FILE can
    // never be beaten, so exhausting the rest of the cartesian product is waste.
    outer: for (const rp of relevancePaths) {
      for (const tp of context.targetPaths) {
        const tier = localityTier(rp, tp);
        if (tier > best) best = tier;
        if (best === LOCALITY_SAME_FILE) break outer;
      }
    }
    score += best;
  }

  return score;
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

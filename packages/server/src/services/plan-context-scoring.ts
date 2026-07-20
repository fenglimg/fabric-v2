/**
 * ISS-20260713-011: scoring context builder + fused rank/score helpers for plan-context.
 * Behavior-preserving extract from plan-context.ts — formulas unchanged.
 */
import {
  buildStoreResolveInput,
  createStoreResolver,
  resolveCandidates,
  type ResolutionCandidate,
  type RuleDescription,
  type RuleDescriptionIndexItem,
  type RecallScoreBreakdown,
  type RecallScore,
} from "@fenglimg/fabric-shared";

import {
  readEmbedConfig,
  readFusion,
  readCredibilityHalfLives,
  readCredibilityFloors,
} from "../config-loader.js";
import {
  buildQueryTerms,
  rankDocuments,
  rankByScore,
  type Bm25Model,
} from "./bm25.js";
import { resolveEmbedder, buildVectorScores } from "./vector-retrieval.js";
import { compareStableIds, layerFromStableId } from "./plan-context-ids.js";
import {
  applyRankCapAndFloor,
  type RankMode,
  type RankOptions,
} from "./plan-context-rank.js";

// Re-export rank types from SSOT (plan-context-rank) so existing importers of
// RankMode/RankOptions from plan-context-scoring keep working without dual defs.
export type { RankMode, RankOptions };

import {
  scoreDescriptionItem,
  scoreBreakdownForItem,
} from "./plan-context-score-factors.js";
// Re-export score breakdown + related keys so plan-context facade import paths stay stable.
// ISS-20260713-042: relatedLookupKeys SSOT is plan-context-ids.ts — re-export only.
export { scoreBreakdownForItem } from "./plan-context-score-factors.js";
export { relatedLookupKeys } from "./plan-context-ids.js";

import { getOrBuildBm25Model } from "./plan-context-bm25-cache.js";
import { documentTextForItem } from "./plan-context-doc-text.js";

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
  // PLN-004 F1 credibility content-age decay: per-knowledge-type half-lives (days)
  // and per-maturity floors, resolved ONCE per planContext call (buildScoringContext)
  // and threaded here so credibilityFactor stays allocation-free on the per-candidate
  // hot path. Optional: the single production construction site sets them; a bespoke
  // test ScoringContext that omits them makes the factor a 1.0 no-op.
  credibilityHalfLives?: Record<"decisions" | "guidelines" | "models" | "pitfalls" | "processes", number>;
  credibilityFloors?: Record<"draft" | "verified" | "proven", number>;
};


// ISS-029: numeric-aware stable_id comparison. Plain localeCompare sorts
// "KT-DEC-9999" AFTER "KT-DEC-10000" (lexicographic: '9' > '1'), so the
// stable_id tiebreaker mis-orders once any per-store/per-type counter crosses
// into 5 digits. Intl numeric collation compares the trailing digit run by
// value, so 9999 < 10000 holds while same-width ids sort identically to before.

// v2.1 global-refactor (W2/A4): consume the resolver's double-axis ordering
// (scope-specificity project>team>personal + store tie-break) and project it to
// a stable_id → rank map. Used ONLY as the tie-break under equal relevance —
// BM25/locality stays the primary key, so a more specific scope wins only when
// content relevance is tied. Each candidate's semantic_scope comes from its
// frontmatter (cross-store items) or falls back to its id-prefix-derived layer
// (W4/Track1: KP-→personal, else team; KT-DEC-0004); the store axis is keyed off
// the read-set store order so the active write store breaks ties first (S53).
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
      it.description.semantic_scope ?? layerFromStableId(it.stable_id);
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
    // PLN-004 F1: resolve the credibility half-lives + floors ONCE here (never per
    // candidate) so credibilityFactor is a pure lookup on the ranking hot path.
    credibilityHalfLives: readCredibilityHalfLives(projectRoot),
    credibilityFloors: readCredibilityFloors(projectRoot),
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
    // config-layering W3 (TASK-003): resolveEmbedder is the SINGLE embedder-
    // selection site — it re-reads the (memoized) embed config internally and
    // returns the remote HTTP embedder, a pure-text degrade (null), or the local
    // fastembed embedder. embedConfig here still supplies .enabled/.model (cache
    // key)/.weight for the surrounding block.
    const embedder = await resolveEmbedder(projectRoot);
    // TASK-004: version-keyed doc-vector disk cache. Key on the read-set revision
    // (same content fingerprint as the BM25 cache) + the resolved embedding model,
    // so a cold process rehydrates instead of re-embedding the corpus, and a model
    // swap / corpus change naturally misses. embedConfig.model is always a concrete
    // resolved value (readEmbedConfig falls back to DEFAULT_EMBED_MODEL).
    const vectorScores = await buildVectorScores(
      embedder,
      opts.queryText,
      rawItems.map((item) => ({
        stable_id: item.stable_id,
        text: docTexts.get(item.stable_id) ?? documentTextForItem(item.description),
      })),
      { projectRoot, corpusRevision: revision, embeddingModel: embedConfig.model },
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
//
// RankMode / RankOptions live in plan-context-rank.ts (ISS-039 SSOT); re-exported above.

// Returns each surviving item paired with its fused score, sorted score-DESC
// (stable_id / scope tie-break), de-duplicated by stable_id, after the
// mode-dependent cut. The score is retained so observability consumers
// (candidate_scores) and the dropped[] computation can read it without
// re-scoring.
// ISS-20260711-143 / ISS-039: apply recall top_k + ratio-to-top cut via SSOT.
export function cutRankedForRecall(
  rankedScored: Array<{ item: RuleDescriptionIndexItem; score: number }>,
  scoringContext: ScoringContext,
  options: RankOptions = {},
): Array<{ item: RuleDescriptionIndexItem; score: number }> {
  const hasQuery = scoringContext.queryTerms.length > 0;
  return applyRankCapAndFloor(rankedScored, "recall", options, hasQuery);
}

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

  // ISS-20260713-011: cap/floor delegated to plan-context-rank.ts
  const hasQuery = scoringContext.queryTerms.length > 0;
  return applyRankCapAndFloor(rankedScored, mode, options, hasQuery);
}


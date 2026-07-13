/**
 * ISS-20260713-038: pure score factor helpers extracted from plan-context-scoring.
 * Behavior-preserving — formulas unchanged. ScoringContext type stays in scoring module.
 */
import type {
  RuleDescriptionIndexItem,
  RecallScoreBreakdown,
} from "@fenglimg/fabric-shared";

import type { ScoringContext } from "./plan-context-scoring.js";

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

export function proximityBoost(
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

  // ISS-20260711-139: min pairwise distance via two-pointer merge on sorted
  // position lists — O(q² · (p_i+p_j)) instead of O(q² · p_i · p_j) nested scans.
  const termList = [...positions.entries()];
  let minDist = Infinity;
  for (let i = 0; i < termList.length; i++) {
    const [, posI] = termList[i]!;
    for (let j = i + 1; j < termList.length; j++) {
      const [, posJ] = termList[j]!;
      let a = 0;
      let b = 0;
      while (a < posI.length && b < posJ.length) {
        const pi = posI[a]!;
        const pj = posJ[b]!;
        const dist = Math.abs(pi - pj);
        if (dist < minDist) minDist = dist;
        if (minDist === 0) break;
        if (pi < pj) a += 1;
        else b += 1;
      }
      if (minDist === 0) break;
    }
    if (minDist === 0) break;
  }

  if (!Number.isFinite(minDist)) return 0;

  // Boost scales linearly from window/2 inward: at dist=0 → full cap,
  // at dist=window → 0, beyond window → 0.
  if (minDist >= PROXIMITY_WINDOW) return 0;
  const ratio = 1 - minDist / PROXIMITY_WINDOW;
  const boost = contentScore * PROXIMITY_BOOST_CAP * ratio;
  return boost;
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

// PLN-004 F1: content-age credibility MULTIPLIER. Exponential decay off created_at
// with a per-knowledge-type half-life, clamped UP by a per-maturity floor so a
// stale-but-endorsed entry keeps a minimum weight and a literal match is never
// zeroed. ORTHOGONAL to recencyBoost (a 7-day ADDITIVE freshness bump on the same
// created_at) and to the orphan_demote usage-inactivity ladder (last-activity age):
// this is a continuous full-age-axis MULTIPLICATIVE content-age decay, so composing
// it with those never double-penalizes. Missing/unparseable created_at → 1 (no
// penalty). created_at is the available age driver — content_hash-driven
// content_changed_at is deferred (no persistence layer). The half-life/floor maps are
// resolved once in buildScoringContext; absent only in bespoke test contexts, where
// the factor is a 1.0 no-op.
function credibilityFactor(item: RuleDescriptionIndexItem, context: ScoringContext): number {
  const halfLives = context.credibilityHalfLives;
  const floors = context.credibilityFloors;
  if (halfLives === undefined || floors === undefined) return 1;
  const createdAtRaw = item.description?.created_at;
  if (typeof createdAtRaw !== "string" || createdAtRaw.length === 0) return 1;
  const createdMs = Date.parse(createdAtRaw);
  if (!Number.isFinite(createdMs)) return 1;
  const ageDays = (context.nowMs - createdMs) / (24 * 60 * 60 * 1000);
  if (ageDays <= 0) return 1;
  const type = item.description?.knowledge_type;
  const halfLife = type !== undefined ? halfLives[type] : halfLives.decisions;
  const factor = Math.pow(2, -ageDays / halfLife);
  const maturity = item.description?.maturity;
  const floor = maturity !== undefined ? floors[maturity] : floors.draft;
  return Math.max(floor, Math.min(1, factor));
}

export function scoreDescriptionItem(item: RuleDescriptionIndexItem, context: ScoringContext): number {
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
  // PLN-004 F1: multiply the fused additive score by the content-age credibility
  // factor (mirrors maestro-flow scoring.ts `score *= credibilityFactor`). Applied to
  // the WHOLE fused return so a stale entry sinks even on a literal match, floored per
  // maturity so it is never zeroed. MUST be mirrored EXACTLY in scoreBreakdownForItem
  // or `final` desyncs from this ranking score (KT-PIT-0036 class invariant).
  return (content + structuralScaleFor(context) * structural + proximity) * credibilityFactor(item, context);
}

// P1 recall-observability: numbers-only decomposition of scoreDescriptionItem's
// fused score into its weighted signal contributions. Mirrors scoreDescriptionItem
// EXACTLY component-for-component so `final` === scoreDescriptionItem(item, ctx)
// — pure observability, NOT a second scoring path that could drift from ranking.
// bm25/vector are the content-channel contributions actually summed in (0 when
// the signal is absent). P1 recall-engine-refactor (TASK-003): under RRF fusion
// these become the normalized RRF channel terms and bm25_rank/vector_rank carry
// the ordinal each channel contributed.
export function scoreBreakdownForItem(
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
  // BORROW-008 parity fix: scoreDescriptionItem adds proximityBoost UNSCALED
  // (outside structuralScaleFor), keyed off `content` (=== bm25 + vector, the
  // RRF/additive content total). This breakdown historically OMITTED it, so
  // `final` was score − proximity for every multi-term-query candidate, breaking
  // the "final === scoreDescriptionItem by construction" invariant the comments
  // above assert. Mirror it here — same helper, same content arg, unscaled.
  const proximity = proximityBoost(item, context, bm25 + vector);

  // PLN-004 F1: mirror scoreDescriptionItem's credibility multiplier EXACTLY — the
  // same helper multiplies the same subtotal, so `final` stays === the ranking score
  // (the final===score invariant, guarded by recall.test.ts :210/:528). `credibility`
  // is the multiplier itself (a distinct factor, NOT an additive component): the
  // additive components sum to the subtotal, and subtotal * credibility === final.
  const credibility = credibilityFactor(item, context);
  const final = (bm25 + vector + salience + recency + locality + proximity) * credibility;
  return {
    final,
    ...(bm25 !== 0 ? { bm25 } : {}),
    ...(bm25Rank !== undefined ? { bm25_rank: bm25Rank } : {}),
    ...(vector !== 0 ? { vector } : {}),
    ...(vectorRank !== undefined ? { vector_rank: vectorRank } : {}),
    salience,
    recency,
    locality,
    proximity,
    credibility,
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


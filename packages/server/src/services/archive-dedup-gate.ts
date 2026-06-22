// C1-W4 (archive dedup/conflict gate): the archive kernel's Stage 2. Before a
// fresh candidate is persisted, classify it against the curated canonical corpus
// via the SAME BM25 similarity basis the doctor conflict lint uses
// (buildSimilarityModel + pairSimilarity). The verdict travels into the pending
// frontmatter (`x-fabric-dedup`) so the single downstream review point
// (fabric-review) can act on it.
//
// IRON RULE (KT-DEC-0019 no-server-filter): this gate NEVER drops or merges a
// candidate at write time. A near-duplicate still lands on disk, flagged — the
// human review decides discard/merge/keep. Silently dropping a candidate the
// user asked to archive is the exact no-server-filter violation we refuse.

import { buildSimilarityModel, pairSimilarity, type ConflictEntry } from "./conflict-lint.js";

export type DedupVerdict = "unique" | "near-duplicate" | "conflict";

export interface DedupMatch {
  stable_id: string;
  similarity: number;
}

export interface DedupResult {
  verdict: DedupVerdict;
  /** Existing entries scoring at/above the conflict threshold, similarity-desc. */
  matches: DedupMatch[];
}

// Bands (synthesis §二.3): ≥0.85 → near-duplicate (recommend discard/merge);
// [0.5, 0.85) → conflict (flag, still write); <0.5 → unique. 0.5 mirrors the
// conservative DEFAULT_CONFLICT_SIMILARITY_THRESHOLD (宁少报) so the gate and the
// doctor conflict lint draw the "too similar" line in the same place.
export const DEDUP_NEAR_DUPLICATE_THRESHOLD = 0.85;
export const DEDUP_CONFLICT_THRESHOLD = 0.5;

// Sentinel id for the not-yet-persisted candidate inside the comparison model.
const CANDIDATE_ID = "__candidate__";

export interface ArchiveCandidate {
  text: string;
  /** Plural knowledge_type ("decisions" | ... ). */
  knowledge_type: string;
  /** "team" | "personal". */
  layer: string;
}

/**
 * Classify a fresh archive candidate against the existing corpus.
 *
 * Comparison is restricted to the SAME (knowledge_type, layer) bucket — a
 * duplicate/conflict across buckets is not meaningful (mirrors conflict-lint
 * grouping). Similarity is pairSimilarity's symmetric min-ratio: BOTH the
 * candidate and the existing entry must strongly recover each other, so a short
 * candidate incidentally contained in a long entry does not over-fire.
 */
export function classifyArchiveCandidate(
  candidate: ArchiveCandidate,
  corpus: ConflictEntry[],
  opts: { nearDuplicateThreshold?: number; conflictThreshold?: number } = {},
): DedupResult {
  const nearDuplicate = opts.nearDuplicateThreshold ?? DEDUP_NEAR_DUPLICATE_THRESHOLD;
  const conflict = opts.conflictThreshold ?? DEDUP_CONFLICT_THRESHOLD;

  const bucket = corpus.filter(
    (e) => e.knowledge_type === candidate.knowledge_type && e.layer === candidate.layer,
  );
  if (bucket.length === 0) {
    return { verdict: "unique", matches: [] };
  }

  const { model, tokensById } = buildSimilarityModel([
    { id: CANDIDATE_ID, text: candidate.text },
    ...bucket.map((e) => ({ id: e.stable_id, text: e.text })),
  ]);
  const candidateTokens = tokensById.get(CANDIDATE_ID) ?? [];

  const matches = bucket
    .map((e) => ({
      stable_id: e.stable_id,
      similarity: pairSimilarity(
        model,
        { id: CANDIDATE_ID, tokens: candidateTokens },
        { id: e.stable_id, tokens: tokensById.get(e.stable_id) ?? [] },
      ),
    }))
    .filter((m) => m.similarity >= conflict)
    .sort((a, b) => b.similarity - a.similarity || a.stable_id.localeCompare(b.stable_id));

  const top = matches[0]?.similarity ?? 0;
  const verdict: DedupVerdict =
    top >= nearDuplicate ? "near-duplicate" : top >= conflict ? "conflict" : "unique";

  return { verdict, matches };
}

/**
 * One-line review marker for the pending frontmatter (`x-fabric-dedup`).
 * Returns undefined for a clean/unique candidate (no marker emitted), so the
 * steady-state pending shape is unchanged for non-duplicate archives.
 */
export function formatDedupMarker(result: DedupResult): string | undefined {
  if (result.verdict === "unique" || result.matches.length === 0) {
    return undefined;
  }
  const top = result.matches[0];
  return `${result.verdict} of ${top.stable_id} (${top.similarity.toFixed(2)})`;
}

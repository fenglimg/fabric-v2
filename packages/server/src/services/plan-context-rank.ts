/**
 * ISS-20260713-011 second slice: pure ranking helpers for plan-context.
 * Heavy BM25/scoring stays in plan-context.ts until further extraction.
 */

export type RankMode = "recall" | "triage";

export type RankOptions = {
  topK?: number;
  relevanceRatio?: number;
};

/**
 * Apply recall-mode top_k + relevance floor to an already-scored list
 * (highest score first). Triage mode returns input unchanged.
 */
export function applyRankCapAndFloor<T extends { score: number }>(
  rankedScored: T[],
  mode: RankMode,
  options: RankOptions = {},
  hasQuery: boolean,
): T[] {
  if (mode === "triage") return rankedScored;
  const topK = options.topK ?? rankedScored.length;
  const cappedScored = rankedScored.slice(0, topK);
  const relevanceRatio = options.relevanceRatio ?? 0;
  const maxScore = rankedScored.length > 0 ? rankedScored[0]!.score : 0;
  const relevanceFloor = maxScore * relevanceRatio;
  return hasQuery && maxScore > 0 && relevanceRatio > 0
    ? cappedScored.filter((entry) => entry.score >= relevanceFloor)
    : cappedScored;
}

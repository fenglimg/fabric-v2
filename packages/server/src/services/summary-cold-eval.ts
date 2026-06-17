// KT-GLD-0006: review-time cold-eval summary self-sufficiency judge — PROTOCOL + STUB.
//
// The write-time mechanical floor (extract-knowledge.ts) rejects DEGENERATE
// summaries (=== stable_id / slug, or below the length floor). It cannot catch
// PSEUDO-self-sufficient ones — fluent prose that still only POINTS at the body
// ("explains the new retrieval approach") instead of stating the thesis the
// reader can act on ("recall keeps score >= 0.25 × top; below that is dropped").
//
// Detecting that needs a ZERO-CONTEXT judge. Self-sufficiency is the property
// "can a reader who has NOT seen the body act on this line alone?". The agent
// that just wrote the body has curse-of-knowledge and will charitably back-fill
// the missing context, so its SELF-eval rubber-stamps the pointer (empirically
// 100% self-pass vs 81% cold-pass — the gap is all benevolent completion). The
// judge therefore MUST be cold: a fresh judge with the body OUT of context.
//
// Because a cold LLM judgment is non-deterministic and offline, it does NOT run
// on the server hot path. It is driven by the fabric-review skill, batched over
// pending/canonical entries (low-frequency), via `maestro delegate` cold-eval.
// This module is the connected STUB: it builds the cold-eval batch request
// (deterministic + unit-tested) and types the verdict contract the external
// judge feeds back through fab_review. No live LLM call lives here.

/** A summary to be cold-judged, keyed by its stable_id. */
export interface ColdEvalCandidate {
  stable_id: string;
  summary: string;
}

/** The verdict the external cold-eval judge returns per candidate. */
export interface ColdEvalVerdict {
  stable_id: string;
  /** true when the summary alone is act-on sufficient without the body. */
  self_sufficient: boolean;
  /** When not self-sufficient, the judge's suggested act-on rewrite. */
  suggested_summary?: string;
  /** Short rationale (pointer-vs-thesis) for the verdict. */
  reason?: string;
}

/** The batch request handed to the external (maestro delegate) cold-eval judge. */
export interface ColdEvalBatch {
  rubric: string;
  candidates: ColdEvalCandidate[];
}

// The zero-context rubric. Deliberately states the body is WITHHELD so the judge
// cannot back-fill — that withholding is the whole point (it removes the
// curse-of-knowledge that makes a self-eval rubber-stamp).
export const COLD_EVAL_RUBRIC = [
  "You are a ZERO-CONTEXT judge. You are shown ONLY a one-line knowledge summary —",
  "never the full entry body. For each summary decide: could a reader who has NOT",
  "seen the body ACT on this line alone (apply the decision / avoid the pitfall /",
  "follow the rule)?",
  "",
  "PASS (self_sufficient=true): the line states the thesis — the what + the",
  "operative so-what. FAIL (self_sufficient=false): the line only POINTS at the",
  "body ('explains the approach', 'covers the edge cases') without stating it.",
  "When you FAIL one, return a suggested_summary that states the thesis in one line.",
].join("\n");

/**
 * Build the cold-eval batch request for the external judge. Pure + deterministic:
 * drops blank summaries (nothing to judge) and pairs the candidates with the
 * zero-context rubric. The fabric-review skill hands the result to
 * `maestro delegate` and applies the returned {@link ColdEvalVerdict}[] via
 * fab_review modify. Returns a batch with an empty candidate list when nothing is
 * judgeable, so callers can short-circuit without a delegate round-trip.
 */
export function buildColdEvalBatch(candidates: ColdEvalCandidate[]): ColdEvalBatch {
  const judgeable = candidates.filter(
    (c) => typeof c.summary === "string" && c.summary.trim().length > 0,
  );
  return { rubric: COLD_EVAL_RUBRIC, candidates: judgeable };
}

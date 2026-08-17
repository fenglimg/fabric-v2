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
  /**
   * Plural knowledge type (decisions/pitfalls/guidelines/models/processes).
   * Selects which rubric judges this candidate — see {@link rubricFamilyFor}.
   * Omitted → judged as `reference`, the weaker of the two bars.
   */
  knowledge_type?: string;
}

/**
 * Which bar a candidate is held to.
 *
 * `rule`      — guidelines/models. They land in the SessionStart ALWAYS-ACTIVE
 *               sink as a body-less INDEX line, so the summary IS the operative
 *               rule; it must be directly actionable.
 * `reference` — decisions/pitfalls/processes. They surface as `must_read_if`
 *               triggers, so the summary's job is to let a reader decide whether
 *               to open the body — it must be a CONCLUSION, not a minute.
 */
export type ColdEvalRubricFamily = "rule" | "reference";

const RULE_TYPES = new Set(["guidelines", "models"]);

export function rubricFamilyFor(knowledgeType: string | undefined): ColdEvalRubricFamily {
  return knowledgeType !== undefined && RULE_TYPES.has(knowledgeType) ? "rule" : "reference";
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
  family: ColdEvalRubricFamily;
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

// The reference-type rubric (decisions / pitfalls / processes).
//
// These were originally EXEMPT from cold-eval on the reasoning that they surface
// as `must_read_if` triggers and are "deliberately pointers". That exemption did
// not hold: `must_read_if` is an OPTIONAL field the author is told to omit rather
// than guess, and `fab_recall` puts `summary` on the wire either way — so the
// summary is what an agent actually reads to decide whether to open the body.
// Measured on the wespy corpus, the exempt types ran 54% session-minute summaries
// among reviewed entries vs 32% for the covered types, and `decisions` alone ran
// 70%: the least-gated types were the worst-indexed.
//
// The exemption's OBSERVATION was right though — a decision summary is not an
// always-active rule, so holding it to "directly actionable rule" produces false
// failures. Hence a separate, weaker-but-real bar: state the conclusion.
export const COLD_EVAL_RUBRIC_REFERENCE = [
  "You are a ZERO-CONTEXT judge. You are shown ONLY a one-line knowledge summary —",
  "never the full entry body. These entries are REFERENCE (a decision, a pitfall, a",
  "procedure): the reader meets this line while working on something else and must",
  "decide whether to stop and open the body.",
  "",
  "PASS (self_sufficient=true): the line states the CONCLUSION — what was decided /",
  "what breaks / what to do, and enough of the why to judge relevance.",
  "FAIL (self_sufficient=false): the line narrates the SESSION instead of stating the",
  "outcome ('the user asked X, I tried Y, then we changed to Z'), or only labels the",
  "topic ('notes on the exit modal decision') without saying what was concluded.",
  "A summary may be a pointer about WHEN it applies, but never about WHAT it says.",
  "When you FAIL one, return a suggested_summary stating the conclusion in one line.",
].join("\n");

const RUBRIC_BY_FAMILY: Record<ColdEvalRubricFamily, string> = {
  rule: COLD_EVAL_RUBRIC,
  reference: COLD_EVAL_RUBRIC_REFERENCE,
};

/**
 * Build the cold-eval batch requests for the external judge. Pure + deterministic:
 * drops blank summaries (nothing to judge) and groups the rest by rubric family,
 * so guidelines/models are judged as always-active RULES and
 * decisions/pitfalls/processes as REFERENCE conclusions.
 *
 * The fabric-review skill hands each batch to `maestro delegate` and applies the
 * returned {@link ColdEvalVerdict}[] via fab_review modify. Returns only
 * non-empty batches (empty array when nothing is judgeable), so callers can
 * short-circuit without a delegate round-trip.
 */
export function buildColdEvalBatch(candidates: ColdEvalCandidate[]): ColdEvalBatch[] {
  const judgeable = candidates.filter(
    (c) => typeof c.summary === "string" && c.summary.trim().length > 0,
  );
  const batches: ColdEvalBatch[] = [];
  // Stable order: rule first, then reference.
  for (const family of ["rule", "reference"] as const) {
    const members = judgeable.filter((c) => rubricFamilyFor(c.knowledge_type) === family);
    if (members.length === 0) continue;
    batches.push({ rubric: RUBRIC_BY_FAMILY[family], family, candidates: members });
  }
  return batches;
}

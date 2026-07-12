import type { Translator } from "@fenglimg/fabric-shared";

import { collectStoreCanonicalEntries } from "./cross-store-recall.js";
import type { DoctorCheck } from "./doctor-types.js";

// ---------------------------------------------------------------------------
// v2.2 C1 — knowledge PROMOTION lint (the growth counterpart to the
// doctor-knowledge-age.ts decay lints). Surfaces verified entries that have
// earned a promotion-to-proven REVIEW.
//
// SIGNAL (decisions/importance-is-maturity-not-usage-count): a knowledge
// entry's importance is its maturity tier, NOT a usage count. Usage-count is
// unusable as a promotion signal — it is blind to always-active `broad`
// knowledge (pushed at SessionStart, never pull-recalled → produces no usage
// events) and self-reinforcing for `narrow` (recalled → ranked higher →
// recalled more). The ONE automatic importance proxy that survives both flaws
// is `related` graph IN-DEGREE: it is declared (not behavioral), so it neither
// self-reinforces nor goes blind to broad. A verified entry that ≥N OTHER
// entries point at via `related` is structurally central → a proven candidate.
//
// DETECTION-ONLY (KT-PIT-0016): this lint NEVER mutates maturity. It surfaces
// candidates; the sufficient-judgment gates from
// processes/maturity-promotion-rubric-v1 (0 dismissals, guideline/model
// cold-eval self-sufficiency, a reviewer's "this is foundational" affirmation)
// live in the fabric-review flow, NOT here. Pure read; never throws.
//
// draft→verified is intentionally NOT surfaced here: a fresh draft's
// correctness is a human / cold-eval judgment with no clean mechanical signal,
// so it stays entirely a fabric-review approve-time decision.
// ---------------------------------------------------------------------------

// processes/maturity-promotion-rubric-v1: a verified entry is a proven candidate
// when at least this many OTHER entries point at it via `related`.
const PROVEN_RELATED_INDEGREE_THRESHOLD = 3;

export type PromotionCandidate = {
  stable_id: string; // store-qualified `<alias>:<local-id>`
  path: string;
  related_indegree: number;
};

export interface KnowledgePromotionInspection {
  candidates: PromotionCandidate[];
  indegree_threshold: number;
}

// Strip an optional `<alias>:` store prefix so a qualified related target
// (`team:KT-DEC-0001`) and a bare local one (`KT-DEC-0001`) count as the same
// node.
function toLocalId(id: string): string {
  const sep = id.indexOf(":");
  return sep === -1 ? id : id.slice(sep + 1);
}

// Count inbound `related` edges per LOCAL stable_id across the corpus.
// NOTE (issue-ISS-20260609-039): `related` targets are NOT rewritten through the
// knowledge_id_redirect map, so an edge pointing at a pre-layer-flip id
// under-counts. Acceptable for a detection-only surfacing lint; redirect-aware
// in-degree is deferred with the wiki graph surface (KT-DEC-0031).
export function computeRelatedInDegree(
  entries: ReadonlyArray<{ description: { related?: string[] } }>,
): Map<string, number> {
  const indegree = new Map<string, number>();
  for (const entry of entries) {
    for (const target of entry.description.related ?? []) {
      const key = toLocalId(target);
      indegree.set(key, (indegree.get(key) ?? 0) + 1);
    }
  }
  return indegree;
}

// Walk the store corpus and surface verified entries whose `related` in-degree
// meets the threshold. `indegreeThreshold` is injectable for unit tests.
export async function inspectStoreKnowledgePromotion(
  projectRoot: string,
  indegreeThreshold: number = PROVEN_RELATED_INDEGREE_THRESHOLD,
): Promise<KnowledgePromotionInspection> {
  const entries = await collectStoreCanonicalEntries(projectRoot);
  const indegree = computeRelatedInDegree(entries);

  const candidates: PromotionCandidate[] = [];
  for (const entry of entries) {
    if (entry.description.maturity !== "verified") {
      continue; // only verified → proven is mechanically surfaced.
    }
    const deg = indegree.get(entry.stableId) ?? 0;
    if (deg >= indegreeThreshold) {
      candidates.push({
        stable_id: entry.qualifiedId,
        path: `store:${entry.qualifiedId}`,
        related_indegree: deg,
      });
    }
  }

  candidates.sort((a, b) => a.path.localeCompare(b.path));
  return { candidates, indegree_threshold: indegreeThreshold };
}

export function createPromotionCandidateCheck(
  t: Translator,
  inspection: KnowledgePromotionInspection,
): DoctorCheck {
  if (inspection.candidates.length === 0) {
    return {
      name: t("doctor.check.promotion_candidate.name"),
      status: "ok",
      message: t("doctor.check.promotion_candidate.ok"),
    };
  }
  const first = inspection.candidates[0];
  const detail = `${first.stable_id} (verified, ${first.related_indegree} inbound related → proven candidate)`;
  const count = inspection.candidates.length;
  return {
    name: t("doctor.check.promotion_candidate.name"),
    // An opportunity, not a defect — info kind keeps doctor health "ok".
    status: "ok",
    kind: "info",
    code: "knowledge_promotion_candidate",
    fixable: false,
    message: t(`doctor.check.promotion_candidate.message.${count === 1 ? "singular" : "plural"}`, {
      count: String(count),
      threshold: String(inspection.indegree_threshold),
      detail,
    }),
    actionHint: t("doctor.check.promotion_candidate.remediation"),
  };
}

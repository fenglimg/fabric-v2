/**
 * ISS-20260713-011: document text / BM25F field flatteners for plan-context scoring.
 */
import { tokenize, type RuleDescription } from "@fenglimg/fabric-shared";
import type { Bm25Field } from "./bm25.js";

// v2.2 A-INFRA-1 (W1-T2-BM25): flatten a candidate's selection-signal fields
// into the BM25 document text. Mirrors the surface the LLM reads when choosing,
// so content relevance is scored over the same words the caller sees.
export function documentTextForItem(description: RuleDescription): string {
  return [
    description.summary,
    description.must_read_if,
    ...description.intent_clues,
    ...description.tech_stack,
    ...description.impact,
    ...(description.tags ?? []),
    // v2.2 glossary aliases (C-002): long-tail synonym terms feed the flat
    // vector-embedding document verbatim, same as the BM25F summary slot below.
    ...(description.aliases ?? []),
  ].join(" ");
}

// C1-W6 (BM25F): map a candidate's selection-signal fields onto the four BM25F
// slots so the field a query term hits is weighted (see bm25.ts FIELD_CONFIGS):
//   title   ← summary           — the headline; the first thing the LLM reads.
//   tags    ← tags + tech_stack — keyword-like, length-insensitive.
//   summary ← must_read_if + intent_clues + aliases — the "when to use" trigger
//             signal, plus v2.2 glossary synonyms (C-002 / R1). Aliases land in
//             this MID-weight slot (NOT the keyword-like `tags` HIGH-weight slot)
//             so a long-tail alias query lifts an entry into top_k WITHOUT
//             out-ranking a direct content hit on summary/title ("content 领先").
//   body    ← impact            — the descriptive consequence prose.
// Tokenized here once per corpus build (cached via getOrBuildBm25Model). The
// flat documentTextForItem above is kept verbatim for the vector-embedding path.
export function documentFieldsForItem(description: RuleDescription): Record<Bm25Field, string[]> {
  return {
    title: tokenize(description.summary),
    tags: tokenize([...(description.tags ?? []), ...description.tech_stack].join(" ")),
    summary: tokenize(
      [description.must_read_if, ...description.intent_clues, ...(description.aliases ?? [])].join(
        " ",
      ),
    ),
    body: tokenize(description.impact.join(" ")),
  };
}

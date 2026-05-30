// v2.2 A-INFRA-1 (W1-T2-BM25): Okapi BM25 content-relevance scoring over the
// candidate KB corpus. Until now plan-context ranked candidates purely on
// recency + path-locality (rc.33 W2-3/W2-4) — structural signals that ignore
// whether a candidate's TEXT actually matches the caller's intent. BM25 adds
// the missing content axis: given the caller's query terms (intent + known_tech
// + detected_entities), score each candidate document by classic TF-IDF-with-
// length-normalization so the entries that talk about what the caller is doing
// float up.
//
// The model is built per plan-context call over that call's candidate set —
// the corpus is small (tens of entries) so there is no index to persist. When
// the caller supplies no query terms (the common SessionStart broad case) the
// scorer is simply not built and ranking falls back to recency + locality
// unchanged, preserving backward compatibility.

import { tokenize } from "@fenglimg/fabric-shared";

// Standard Okapi BM25 free parameters. k1 controls term-frequency saturation,
// b controls document-length normalization. 1.5 / 0.75 are the canonical
// defaults and behave well on short documents like KB descriptions.
const K1 = 1.5;
const B = 0.75;

export interface Bm25Document {
  id: string;
  tokens: string[];
}

export interface Bm25Model {
  /**
   * BM25 score of document `id` against the (pre-tokenized) query terms.
   * Returns 0 for an unknown id, an empty document, no query terms, or no
   * term overlap. Query-term duplicates are collapsed — repeating a term in
   * the query does not inflate the score (term frequency is a document
   * property, not a query property).
   */
  scoreDoc(id: string, queryTerms: string[]): number;
}

/**
 * Build a BM25 model over `docs`. The corpus statistics (document frequency,
 * average document length) are computed once here; `scoreDoc` is then O(query
 * terms) per call.
 */
export function buildBm25Model(docs: Bm25Document[]): Bm25Model {
  const totalDocs = docs.length;
  const documentFrequency = new Map<string, number>();
  const perDoc = new Map<string, { termFreq: Map<string, number>; length: number }>();
  let totalLength = 0;

  for (const doc of docs) {
    const termFreq = new Map<string, number>();
    for (const term of doc.tokens) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1);
    }
    for (const term of termFreq.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    totalLength += doc.tokens.length;
    // Last write wins on duplicate ids — callers dedupe upstream, but be safe.
    perDoc.set(doc.id, { termFreq, length: doc.tokens.length });
  }

  const avgDocLength = totalDocs > 0 ? totalLength / totalDocs : 0;

  // Probabilistic IDF with the +0.5 smoothing that keeps the value positive
  // even for a term present in every document (the canonical BM25 variant adds
  // the leading 1 inside the log for exactly this reason).
  const idf = (term: string): number => {
    const n = documentFrequency.get(term) ?? 0;
    return Math.log(1 + (totalDocs - n + 0.5) / (n + 0.5));
  };

  return {
    scoreDoc(id: string, queryTerms: string[]): number {
      const data = perDoc.get(id);
      if (data === undefined || data.length === 0 || queryTerms.length === 0) {
        return 0;
      }
      const normalizer = avgDocLength > 0 ? data.length / avgDocLength : 1;
      let score = 0;
      const scoredTerms = new Set<string>();
      for (const term of queryTerms) {
        if (scoredTerms.has(term)) {
          continue;
        }
        scoredTerms.add(term);
        const freq = data.termFreq.get(term);
        if (freq === undefined) {
          continue;
        }
        const numerator = freq * (K1 + 1);
        const denominator = freq + K1 * (1 - B + B * normalizer);
        score += idf(term) * (numerator / denominator);
      }
      return score;
    },
  };
}

/**
 * Tokenize free-form query text (intent + tech + entities, already joined)
 * into BM25 query terms using the same CJK-aware tokenizer as the documents,
 * so zh/en queries match zh/en documents on equal footing.
 */
export function buildQueryTerms(text: string): string[] {
  return tokenize(text);
}

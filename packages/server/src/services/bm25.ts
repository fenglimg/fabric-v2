// v2.2 A-INFRA-1 (W1-T2-BM25) + C1-W6 (BM25F port): Okapi BM25F content-relevance
// scoring over the candidate KB corpus. Until now plan-context ranked candidates
// purely on recency + path-locality (rc.33 W2-3/W2-4) — structural signals that
// ignore whether a candidate's TEXT actually matches the caller's intent. BM25
// added the missing content axis; C1-W6 upgrades that single concatenated-text
// scorer to BM25F so the field a term hits matters: a query word in a candidate's
// summary (its headline) counts more than the same word buried in its impact
// notes. (Ported/adapted from maestro-flow wiki search.ts FIELD_CONFIGS +
// searchBM25F; fabric KB candidates carry no `body`/`title` of their own, so the
// RuleDescription fields are mapped onto the four BM25F slots by plan-context.)
//
// The model is built per plan-context call over that call's candidate set —
// the corpus is small (tens of entries) so there is no index to persist. When
// the caller supplies no query terms (the common SessionStart broad case) the
// scorer is simply not built and ranking falls back to recency + locality
// unchanged, preserving backward compatibility.

import { tokenize } from "@fenglimg/fabric-shared";

// Standard Okapi BM25 free parameter. k1 controls term-frequency saturation;
// document-length normalization is per-field (b lives in FIELD_CONFIGS).
const K1 = 1.5;

// The four BM25F fields. Field text/tokens are supplied by the caller
// (plan-context maps RuleDescription onto these slots).
export type Bm25Field = "title" | "summary" | "tags" | "body";

export const BM25_FIELDS: readonly Bm25Field[] = ["title", "summary", "tags", "body"];

interface FieldConfig {
  /** Per-field term-frequency boost. Higher = a hit in this field counts more. */
  boost: number;
  /** Per-field length normalization (0 = none; canonical for short keyword
   *  fields like tags, where length carries no signal). */
  b: number;
}

// Adapted from maestro-flow wiki search.ts FIELD_CONFIGS. The fabric mapping
// (set in plan-context.documentFieldsForItem): title←summary (the headline the
// LLM reads first), tags←tags+tech_stack+entities (keyword signals), summary←
// must_read_if+intent_clues (the "when to use" trigger), body←impact.
const FIELD_CONFIGS: Record<Bm25Field, FieldConfig> = {
  title: { boost: 3, b: 0.3 },
  tags: { boost: 2, b: 0 },
  summary: { boost: 1.5, b: 0.75 },
  body: { boost: 1, b: 0.75 },
};

export interface Bm25Document {
  id: string;
  /** Pre-tokenized terms per field. Omitted/empty fields contribute nothing. */
  fields: Record<Bm25Field, string[]>;
}

export interface Bm25Model {
  /**
   * BM25F score of document `id` against the (pre-tokenized) query terms.
   * Returns 0 for an unknown id, no query terms, or no term overlap in any
   * field. Query-term duplicates are collapsed — repeating a term in the query
   * does not inflate the score (term frequency is a document property, not a
   * query property).
   */
  scoreDoc(id: string, queryTerms: string[]): number;
  /**
   * P1 recall-engine-refactor (TASK-002): the plain JSON-safe snapshot of the
   * corpus statistics this model scores against, attached so the model can be
   * serialized to disk (`serializeBm25Model`) and a cold hook can `rehydrate`
   * an identical scorer without re-tokenizing the corpus.
   */
  readonly __serialized: SerializedBm25Model;
}

interface DocStats {
  /** Per-field term → frequency. */
  fieldTermFreq: Record<Bm25Field, Map<string, number>>;
  /** Per-field token count. */
  fieldLength: Record<Bm25Field, number>;
}

// P1 recall-engine-refactor (TASK-002): the model's internal statistics, in a
// PLAIN JSON-safe shape (no Map / closure). This is what serialize/rehydrate
// round-trips so a cold hook can skip rebuild — the runtime Bm25Model below is
// reconstructed FROM this. `fieldTermFreq` is an array of [term, freq] pairs per
// field (Map is not JSON-serializable); everything else is already primitive.
export interface SerializedBm25Model {
  /** Schema/format version — bump on any layout change so a stale on-disk cache
   *  (different shape) is detected and discarded rather than mis-rehydrated. */
  version: 1;
  totalDocs: number;
  /** term → document frequency (union-of-fields df), as [term, count] pairs. */
  documentFrequency: [string, number][];
  /** Per-field corpus average length. */
  avgFieldLength: Record<Bm25Field, number>;
  /** Per-doc stats: id → { per-field [term,freq] pairs, per-field length }. */
  perDoc: {
    id: string;
    fieldTermFreq: Record<Bm25Field, [string, number][]>;
    fieldLength: Record<Bm25Field, number>;
  }[];
}

function emptyFieldRecord<T>(make: () => T): Record<Bm25Field, T> {
  return { title: make(), summary: make(), tags: make(), body: make() };
}

/**
 * Build a BM25F model over `docs`. Corpus statistics (per-field document
 * frequency over the union of fields, per-field average length) are computed
 * once here; `scoreDoc` is then O(query terms × fields) per call.
 */
export function buildBm25Model(docs: Bm25Document[]): Bm25Model {
  const totalDocs = docs.length;
  // Document frequency is counted over the UNION of fields — a term present in
  // any field of a document counts once toward its df (matches maestro-flow,
  // where field postings share one idf per term).
  const documentFrequency = new Map<string, number>();
  const perDoc = new Map<string, DocStats>();
  const totalFieldLength = emptyFieldRecord<number>(() => 0);

  for (const doc of docs) {
    const fieldTermFreq = emptyFieldRecord<Map<string, number>>(() => new Map());
    const fieldLength = emptyFieldRecord<number>(() => 0);
    const docTerms = new Set<string>();

    for (const field of BM25_FIELDS) {
      const tokens = doc.fields[field] ?? [];
      fieldLength[field] = tokens.length;
      totalFieldLength[field] += tokens.length;
      const tf = fieldTermFreq[field];
      for (const term of tokens) {
        tf.set(term, (tf.get(term) ?? 0) + 1);
        docTerms.add(term);
      }
    }
    for (const term of docTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
    // Last write wins on duplicate ids — callers dedupe upstream, but be safe.
    perDoc.set(doc.id, { fieldTermFreq, fieldLength });
  }

  const avgFieldLength = emptyFieldRecord<number>(() => 0);
  for (const field of BM25_FIELDS) {
    avgFieldLength[field] = totalDocs > 0 ? totalFieldLength[field] / totalDocs : 0;
  }

  // P1 recall-engine-refactor (TASK-002): flatten the in-memory Maps into the
  // plain JSON-safe snapshot, then build the runtime scorer FROM it — exactly
  // the path rehydrate takes — so a freshly-built and a disk-rehydrated model
  // score identically by construction.
  const serialized: SerializedBm25Model = {
    version: 1,
    totalDocs,
    documentFrequency: [...documentFrequency],
    avgFieldLength,
    perDoc: [...perDoc].map(([id, stats]) => ({
      id,
      fieldTermFreq: emptyFieldRecord<[string, number][]>(() => []),
      fieldLength: { ...stats.fieldLength },
    })),
  };
  // Fill the per-field [term,freq] pairs (separate pass to keep the map literal
  // above readable; emptyFieldRecord seeds each field with a fresh [] array).
  for (const entry of serialized.perDoc) {
    const stats = perDoc.get(entry.id);
    if (stats === undefined) continue;
    for (const field of BM25_FIELDS) {
      entry.fieldTermFreq[field] = [...stats.fieldTermFreq[field]];
    }
  }
  return modelFromStats(serialized);
}

// P1 recall-engine-refactor (TASK-002): the single scoring engine. Both the
// freshly-built model (buildBm25Model) and the rehydrated one
// (rehydrateBm25Model) call this with the SAME serialized stats, so scoreDoc is
// guaranteed numerically identical between them — there is no second code path
// that could drift. Reconstructs the in-memory Maps (O(1) lookups) from the
// plain snapshot and attaches the snapshot for re-serialization.
function modelFromStats(serialized: SerializedBm25Model): Bm25Model {
  const totalDocs = serialized.totalDocs;
  const documentFrequency = new Map<string, number>(serialized.documentFrequency);
  const avgFieldLength = serialized.avgFieldLength;
  const perDoc = new Map<string, DocStats>();
  for (const entry of serialized.perDoc) {
    const fieldTermFreq = emptyFieldRecord<Map<string, number>>(() => new Map());
    for (const field of BM25_FIELDS) {
      fieldTermFreq[field] = new Map(entry.fieldTermFreq[field]);
    }
    perDoc.set(entry.id, { fieldTermFreq, fieldLength: entry.fieldLength });
  }

  // Probabilistic IDF with the +0.5 smoothing that keeps the value positive
  // even for a term present in every document (the canonical BM25 variant adds
  // the leading 1 inside the log for exactly this reason).
  const idf = (term: string): number => {
    const n = documentFrequency.get(term) ?? 0;
    return Math.log(1 + (totalDocs - n + 0.5) / (n + 0.5));
  };

  return {
    __serialized: serialized,
    scoreDoc(id: string, queryTerms: string[]): number {
      const data = perDoc.get(id);
      if (data === undefined || queryTerms.length === 0) {
        return 0;
      }
      let score = 0;
      const scoredTerms = new Set<string>();
      for (const term of queryTerms) {
        if (scoredTerms.has(term)) {
          continue;
        }
        scoredTerms.add(term);

        // BM25F: accumulate a boosted, per-field length-normalized pseudo term
        // frequency across all fields, THEN apply the single k1 saturation —
        // this is the field-combining variant (not a per-field BM25 sum), so a
        // term spread across summary+tags saturates together, not twice.
        let pseudoTermFreq = 0;
        for (const field of BM25_FIELDS) {
          const config = FIELD_CONFIGS[field];
          if (config.boost === 0) {
            continue;
          }
          const freq = data.fieldTermFreq[field].get(term);
          if (freq === undefined || freq === 0) {
            continue;
          }
          const avg = avgFieldLength[field] || 1;
          const norm = 1 - config.b + config.b * (data.fieldLength[field] / avg);
          pseudoTermFreq += config.boost * (freq / (norm || 1));
        }
        if (pseudoTermFreq === 0) {
          continue;
        }
        score += idf(term) * ((pseudoTermFreq * (K1 + 1)) / (pseudoTermFreq + K1));
      }
      return score;
    },
  };
}

/**
 * P1 recall-engine-refactor (TASK-002): extract a model's corpus statistics as a
 * plain JSON-serializable structure. `JSON.stringify(serializeBm25Model(m))` is
 * what the disk cache persists; `rehydrateBm25Model` reverses it into a scorer
 * that returns numerically IDENTICAL `scoreDoc` results (both go through the
 * same `modelFromStats` engine — the snapshot IS the model's sole state).
 */
export function serializeBm25Model(model: Bm25Model): SerializedBm25Model {
  return model.__serialized;
}

/**
 * P1 recall-engine-refactor (TASK-002): rebuild a runtime scorer from a snapshot
 * produced by `serializeBm25Model` (round-tripped through JSON on disk). The
 * rehydrated model's `scoreDoc(id, queryTerms)` equals the original's for the
 * same id/queryTerms — no re-tokenization, no corpus walk; a cold hook loads the
 * snapshot and scores immediately.
 */
export function rehydrateBm25Model(serialized: SerializedBm25Model): Bm25Model {
  return modelFromStats(serialized);
}

/**
 * Tokenize free-form query text (intent + tech + entities, already joined)
 * into BM25F query terms using the same CJK-aware tokenizer as the documents,
 * so zh/en queries match zh/en documents on equal footing.
 */
export function buildQueryTerms(text: string): string[] {
  return tokenize(text);
}

/**
 * P1 recall-engine-refactor (TASK-003): expose the BM25 ORDINAL RANK of each
 * document so Reciprocal Rank Fusion can consume it. `scoreDoc` already yields a
 * raw, query-relative magnitude; RRF needs the ordinal position instead.
 *
 * Returns a `Map<id, rank>` where rank is 1-indexed (1 = highest BM25 score),
 * ordered score-DESC with the supplied `ids` order as the deterministic
 * tie-break (callers pass ids in a stable order, e.g. stable_id-sorted). Only
 * documents with a STRICTLY POSITIVE score are ranked — a zero-match document
 * (no query-term overlap) is OMITTED from the map, so the RRF caller can exclude
 * it from the ranker rather than handing it a positive tail-rank that would let
 * a non-match earn a fusion score. Empty query terms → empty map (no ranking).
 */
export function rankDocuments(
  model: Bm25Model,
  ids: readonly string[],
  queryTerms: string[],
): Map<string, number> {
  if (queryTerms.length === 0) {
    return new Map();
  }
  const scored: { id: string; score: number; order: number }[] = [];
  ids.forEach((id, order) => {
    const score = model.scoreDoc(id, queryTerms);
    if (score > 0) {
      scored.push({ id, score, order });
    }
  });
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.order - b.order));
  const ranks = new Map<string, number>();
  scored.forEach((entry, index) => {
    ranks.set(entry.id, index + 1);
  });
  return ranks;
}

/**
 * P1 recall-engine-refactor (TASK-003): the generic rank companion for the
 * vector channel (and any pre-scored signal). Same contract as `rankDocuments`
 * but driven by an already-computed `id → raw score` map: 1-indexed rank,
 * score-DESC, `ids` order as tie-break, STRICTLY-POSITIVE-only (a 0/absent
 * cosine is omitted so a zero-match doc never earns a positive tail-rank). RRF
 * fuses ONLY these two content ranks; structural signals never enter here.
 */
export function rankByScore(
  ids: readonly string[],
  scores: Map<string, number>,
): Map<string, number> {
  const scored: { id: string; score: number; order: number }[] = [];
  ids.forEach((id, order) => {
    const score = scores.get(id) ?? 0;
    if (score > 0) {
      scored.push({ id, score, order });
    }
  });
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.order - b.order));
  const ranks = new Map<string, number>();
  scored.forEach((entry, index) => {
    ranks.set(entry.id, index + 1);
  });
  return ranks;
}

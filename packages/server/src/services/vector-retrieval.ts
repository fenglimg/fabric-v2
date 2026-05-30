// v2.2 C2-vector (W2-T7): OPTIONAL vector semantic retrieval, layered as a
// recall SUPPLEMENT after BM25 (CJK → BM25 → vector → top_k → payload). BM25 is
// a lexical-overlap signal — it misses entries that mean the same thing in
// different words. A small dense-embedding similarity term rescues those into
// the top_k.
//
// Hard constraints (status.json boundary):
//   - `--no-embed` is the DEFAULT: vectors are off unless `embed_enabled` is set.
//   - text-only FALLBACK is complete: when disabled, OR the optional embedder
//     package is not installed, OR embedding throws, ranking degrades to the
//     pure BM25 + recency + locality + salience path with ZERO behavior change.
//   - the install footprint does NOT grow: `fastembed` is NOT a declared
//     dependency. It is lazy-loaded at runtime via a variable specifier (so it
//     is not statically resolved / bundled), and the operator opts in by
//     installing it themselves. Absent → null → fallback.
//   - the embedder is pinned to CPU + cache-only so enabling vectors never
//     forces a GPU or a surprise network model pull at request time.

// A minimal embedder contract — `embed` maps texts to dense vectors in input
// order. The concrete fastembed adapter implements this; tests inject fakes.
export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

// Cache the load attempt so we probe the optional package at most once per
// process. `null` = unavailable (fallback); an Embedder = ready.
let embedderLoad: Promise<Embedder | null> | undefined;

// The optional package name, held in a variable so `import()` is NOT statically
// resolved by the bundler/tsc — fastembed is intentionally absent from
// package.json. Operators enabling vectors run `npm i fastembed` themselves.
const OPTIONAL_EMBED_PACKAGE = "fastembed";

/**
 * Lazy-load the optional fastembed embedder, pinned to CPU + cache-only. Returns
 * null (cached) when the package is not installed or initialization throws, so
 * every caller degrades to the text-only path. Never throws.
 */
export async function loadEmbedder(): Promise<Embedder | null> {
  if (embedderLoad === undefined) {
    embedderLoad = (async (): Promise<Embedder | null> => {
      try {
        // Variable specifier → not statically resolved. `fastembed` is an
        // optional, operator-installed package; absent in the default install.
        const moduleName: string = OPTIONAL_EMBED_PACKAGE;
        const mod = (await import(moduleName)) as unknown as FastembedModule;
        if (mod?.FlagEmbedding?.init === undefined) {
          return null;
        }
        // Pin: CPU execution, cache-only model resolution (no forced network
        // pull at request time — the operator pre-warms the model cache).
        const model = await mod.FlagEmbedding.init({
          maxLength: 512,
          cacheDir: process.env.FABRIC_EMBED_CACHE_DIR,
        });
        return {
          async embed(texts: string[]): Promise<number[][]> {
            const out: number[][] = [];
            for await (const batch of model.embed(texts)) {
              for (const vec of batch) {
                out.push(Array.from(vec));
              }
            }
            return out;
          },
        };
      } catch {
        // Package absent / init failure / runtime error → text-only fallback.
        return null;
      }
    })();
  }
  return embedderLoad;
}

// Test seam: reset the cached load (so a test can inject a fake embedder via
// `setEmbedderForTesting`). Not part of the runtime contract.
export function __resetEmbedderForTesting(embedder: Embedder | null | undefined): void {
  embedderLoad = embedder === undefined ? undefined : Promise.resolve(embedder);
}

// Minimal structural type for the optional fastembed module — declared locally
// so we never need its types as a build dependency.
interface FastembedModule {
  FlagEmbedding?: {
    init(opts: { maxLength?: number; cacheDir?: string }): Promise<{
      embed(texts: string[]): AsyncIterable<Iterable<number>[] | Float32Array[]>;
    }>;
  };
}

/**
 * Cosine similarity of two equal-length dense vectors. Returns 0 for a zero
 * vector or a length mismatch (defensive — never NaN into the score).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface VectorScoreItem {
  stable_id: string;
  text: string;
}

/**
 * Build per-candidate vector-similarity scores (0..1 cosine) against the query.
 * Returns null — signalling the caller to fall back to text-only ranking — when
 * the embedder is unavailable, the query is empty, there are no items, or
 * embedding throws. The first array element of the embedding batch is the query;
 * the rest align with `items` order.
 */
export async function buildVectorScores(
  embedder: Embedder | null,
  queryText: string,
  items: VectorScoreItem[],
): Promise<Map<string, number> | null> {
  if (embedder === null || queryText.trim().length === 0 || items.length === 0) {
    return null;
  }
  try {
    const vectors = await embedder.embed([queryText, ...items.map((item) => item.text)]);
    if (vectors.length !== items.length + 1) {
      return null;
    }
    const queryVec = vectors[0];
    const scores = new Map<string, number>();
    for (let i = 0; i < items.length; i += 1) {
      scores.set(items[i].stable_id, cosineSimilarity(queryVec, vectors[i + 1]));
    }
    return scores;
  } catch {
    return null;
  }
}

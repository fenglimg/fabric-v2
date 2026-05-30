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
//     is not statically resolved / bundled — verified: esbuild keeps the
//     `await import(moduleName)` un-resolved). The operator opts in by
//     installing it WHERE THE SERVER RESOLVES MODULES — for the default GLOBAL
//     MCP install that is a global `npm i -g fastembed`, NOT the project root
//     (W2-REVIEW codex HIGH-3: a bare specifier resolves by the server module's
//     location, not the project cwd). Absent → null → fallback.
//   - the embedder runs on CPU. Model resolution uses `cacheDir` (the operator
//     pre-warms it). HONEST CAVEAT (W2-REVIEW codex BLOCK-1 / gemini MED-1):
//     fastembed does NOT expose a strict offline flag here, so a FIRST run with
//     a cold cache will download the model weights from the model host. No KB
//     data is sent — only the model is pulled — but this is not a hard air-gap.
//     Operators needing strict offline must pre-populate FABRIC_EMBED_CACHE_DIR.

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
        // CPU execution; model cache dir is operator-controlled (pre-warm for
        // strict offline — see the HONEST CAVEAT in the header comment).
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
 * vector, a length mismatch, OR any non-finite element / result — so a corrupt
 * embedding (NaN / Infinity) can never poison the additive score or the sort
 * comparator (W2-REVIEW codex HIGH-2 / MED-5). The result is clamped to [-1, 1]
 * to absorb floating-point overshoot.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (!Number.isFinite(ai) || !Number.isFinite(bi)) {
      return 0;
    }
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  if (!Number.isFinite(sim)) {
    return 0;
  }
  return Math.max(-1, Math.min(1, sim));
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
// ISS-023: document-embedding cache. Embedding is the dominant cost and scales
// linearly with corpus size; without a cache every recall re-embeds the WHOLE
// candidate corpus on CPU. Doc embeddings depend only on the (deterministic)
// doc text, so we cache vector-by-text and embed ONLY the query (always — it
// varies) plus cache-miss docs. Bounded by an LRU cap so a long-lived server
// with a churning corpus does not grow the cache without limit.
const docVectorCache = new Map<string, number[]>();
const DOC_VECTOR_CACHE_MAX = 10_000;

export function __resetVectorCache(): void {
  docVectorCache.clear();
}

function cacheDocVector(text: string, vector: number[]): void {
  if (docVectorCache.has(text)) {
    docVectorCache.delete(text);
  }
  docVectorCache.set(text, vector);
  while (docVectorCache.size > DOC_VECTOR_CACHE_MAX) {
    const lru = docVectorCache.keys().next().value;
    if (lru === undefined) {
      break;
    }
    docVectorCache.delete(lru);
  }
}

export async function buildVectorScores(
  embedder: Embedder | null,
  queryText: string,
  items: VectorScoreItem[],
): Promise<Map<string, number> | null> {
  if (embedder === null || queryText.trim().length === 0 || items.length === 0) {
    return null;
  }
  try {
    // Embed the query (always) plus only the docs whose text is not yet cached.
    const missTexts: string[] = [];
    for (const item of items) {
      if (!docVectorCache.has(item.text)) {
        missTexts.push(item.text);
      }
    }
    const toEmbed = [queryText, ...missTexts];
    const embedded = await embedder.embed(toEmbed);
    if (embedded.length !== toEmbed.length) {
      return null;
    }
    const queryVec = embedded[0];
    for (let m = 0; m < missTexts.length; m += 1) {
      cacheDocVector(missTexts[m], embedded[m + 1]);
    }
    const scores = new Map<string, number>();
    for (const item of items) {
      const docVec = docVectorCache.get(item.text);
      if (docVec === undefined) {
        // Defensive: a doc we just embedded should always be present. Bail to
        // the text-only fallback rather than emit a partial score set.
        return null;
      }
      scores.set(item.stable_id, cosineSimilarity(queryVec, docVec));
    }
    return scores;
  } catch {
    return null;
  }
}

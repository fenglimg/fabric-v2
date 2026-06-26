// v2.2 C2-vector (W2-T7): OPTIONAL vector semantic retrieval, layered as a
// recall SUPPLEMENT after BM25 (CJK → BM25 → vector → top_k → payload). BM25 is
// a lexical-overlap signal — it misses entries that mean the same thing in
// different words. A small dense-embedding similarity term rescues those into
// the top_k.
//
// Hard constraints (status.json boundary):
//   - TASK-004 (P1 recall-engine-refactor): vectors are now ON BY DEFAULT
//     (embed_enabled defaults true; off only when set explicitly to false). The
//     prior `--no-embed`-default baseline is retired.
//   - text-only FALLBACK is complete: when disabled, OR the optional embedder
//     package is not installed, OR embedding throws, ranking degrades to the
//     pure BM25 + recency + locality + salience path with ZERO behavior change.
//   - the install footprint stays degrade-safe: TASK-004 moves `fastembed` into
//     `optionalDependencies` — the default install ATTEMPTS to build it, but a
//     platform that cannot build the native addon still starts (npm tolerates an
//     optional-dependency build failure). It is lazy-loaded at runtime via a
//     variable specifier (so it is not statically resolved / bundled — verified:
//     esbuild keeps the `await import(moduleName)` un-resolved). For a GLOBAL MCP
//     install that resolves modules from the server's own location (W2-REVIEW
//     codex HIGH-3: a bare specifier resolves by the server module's location,
//     not the project cwd). Absent → null → fallback + a ONE-TIME stderr hint.
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
// resolved by the bundler/tsc. TASK-004: fastembed is now an OPTIONAL dependency
// (default install attempts it; a platform that can't build it still starts).
const OPTIONAL_EMBED_PACKAGE = "fastembed";

// TASK-004: emit the missing-embedder hint AT MOST ONCE per process. Vectors are
// on by default now, so a fresh install without a built fastembed would otherwise
// degrade silently every recall. We surface ONE stderr line, then stay quiet — a
// per-call warning would spam the MCP stderr channel on every recall.
const MISSING_EMBEDDER_HINT =
  "[fabric] vector semantic recall is enabled but the optional 'fastembed' " +
  "package is unavailable — falling back to text-only ranking. Install it where " +
  "the server resolves modules (e.g. `npm i -g fastembed`) to enable embeddings, " +
  "or set embed_enabled:false to silence this.\n";

const defaultMissingEmbedderHint = (): void => {
  process.stderr.write(MISSING_EMBEDDER_HINT);
};

let missingEmbedderHinted = false;

// Test seam: the hint sink + its one-shot latch are injectable so a test can
// assert the hint fires EXACTLY ONCE without scraping the real stderr stream.
let emitMissingEmbedderHint: () => void = defaultMissingEmbedderHint;

function hintMissingEmbedderOnce(): void {
  if (missingEmbedderHinted) {
    return;
  }
  missingEmbedderHinted = true;
  emitMissingEmbedderHint();
}

// Test seam: override the hint sink and reset the one-shot latch. Passing
// undefined restores the real stderr sink. Not part of the runtime contract.
export function __setMissingEmbedderHintForTesting(sink: (() => void) | undefined): void {
  missingEmbedderHinted = false;
  emitMissingEmbedderHint = sink ?? defaultMissingEmbedderHint;
}

// v2.1 ③ vector-chinese-model (P3): build the fastembed init options. Pure +
// exported so the model-threading is unit-testable without the optional package
// installed. `model` is a fastembed EmbeddingModel enum VALUE (e.g.
// "fast-bge-small-zh-v1.5"); when omitted, fastembed falls back to ITS default
// (English bge-small) — the pre-③ behavior, preserved for callers that pass no
// model. `maxLength` + operator-controlled `cacheDir` are unchanged.
export function buildEmbedInitOptions(
  modelName?: string,
): { maxLength: number; cacheDir: string | undefined; model?: string } {
  return {
    maxLength: 512,
    cacheDir: process.env.FABRIC_EMBED_CACHE_DIR,
    ...(typeof modelName === "string" && modelName.length > 0 ? { model: modelName } : {}),
  };
}

/**
 * Lazy-load the optional fastembed embedder, pinned to CPU + cache-only. Returns
 * null (cached) when the package is not installed or initialization throws, so
 * every caller degrades to the text-only path. Never throws.
 *
 * v2.1 ③: `modelName` (a fastembed EmbeddingModel enum value) selects the
 * embedding model — the caller threads `embed_model` config through so the
 * Chinese-heavy KB no longer embeds against fastembed's English default. The
 * load is cached per-process; the FIRST model wins (a config change needs a
 * server restart, already the norm for MCP config changes).
 */
export async function loadEmbedder(modelName?: string): Promise<Embedder | null> {
  if (embedderLoad === undefined) {
    embedderLoad = (async (): Promise<Embedder | null> => {
      try {
        // Variable specifier → not statically resolved. `fastembed` is an
        // optional, operator-installed package; absent in the default install.
        const moduleName: string = OPTIONAL_EMBED_PACKAGE;
        const mod = (await import(moduleName)) as unknown as FastembedModule;
        if (mod?.FlagEmbedding?.init === undefined) {
          // Loaded but not the embedder we expect → degrade + one-time hint.
          hintMissingEmbedderOnce();
          return null;
        }
        // CPU execution; model cache dir is operator-controlled (pre-warm for
        // strict offline — see the HONEST CAVEAT in the header comment). v2.1 ③:
        // model pinned via buildEmbedInitOptions (Chinese default, not English).
        const model = await mod.FlagEmbedding.init(buildEmbedInitOptions(modelName));
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
        // TASK-004: surface a ONE-TIME hint (vectors are on by default now, so a
        // missing optional embedder must not degrade silently).
        hintMissingEmbedderOnce();
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
    init(opts: { maxLength?: number; cacheDir?: string; model?: string }): Promise<{
      embed(texts: string[]): AsyncIterable<Iterable<number>[] | Float32Array[]>;
    }>;
  };
}

/**
 * Cosine similarity of two equal-length dense vectors. Returns 0 for a zero
 * vector, a length mismatch, OR any non-finite element / result — so a corrupt
 * embedding (NaN / Infinity) can never poison the additive score or the sort
 * comparator (W2-REVIEW codex HIGH-2 / MED-5).
 *
 * TASK-004 (P1 recall-engine-refactor): the result is clamped to [0, 1]. A
 * negative cosine means the query and doc point in OPPOSITE semantic directions
 * — for recall that is just "unrelated", indistinguishable from 0, and letting a
 * negative value flow into the additive/RRF fusion would subtract score from an
 * otherwise-ranked candidate. The lower bound is therefore 0 (was -1); the upper
 * bound still absorbs floating-point overshoot above 1. Contract: [0, 1].
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
  // TASK-004: clamp to [0, 1] — lower bound 0 (a negative/opposite cosine is
  // treated as "unrelated", never a negative fusion contribution).
  return Math.max(0, Math.min(1, sim));
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

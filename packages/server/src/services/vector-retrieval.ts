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

import { mkdirSync } from "node:fs";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

import { resolveGlobalRoot } from "@fenglimg/fabric-shared";
import { migrateLegacyFabricCache } from "./fabric-cache-migration.js";

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
export const OPTIONAL_EMBED_PACKAGE = "fastembed";

/**
 * Is the optional embedder package resolvable FROM THE SERVER'S module location —
 * i.e. from exactly where `loadEmbedder`'s dynamic `import()` will look for it?
 *
 * This is the honest "is fastembed installed?" probe. The naive alternative — a
 * `createRequire(import.meta.url)` check run inside the CLI package — answers from
 * the WRONG base: in a pnpm / non-hoisted layout (or a dev-linked global install)
 * fastembed lives under the SERVER's `node_modules` (it is the server's
 * optionalDependency), so the CLI cannot resolve it even though the server — the
 * only code that actually imports it — can. That mismatch made `fabric info
 * --recall` report "not installed" on a perfectly working setup. Callers that
 * surface embedder availability MUST use this server-anchored probe.
 */
export function isEmbedderResolvable(): boolean {
  try {
    createRequire(import.meta.url).resolve(OPTIONAL_EMBED_PACKAGE);
    return true;
  } catch {
    return false;
  }
}

// Test seam: the module loader behind the optional import, injectable so a test
// can force the "package absent / load throws" path DETERMINISTICALLY. Required
// now that fastembed is an optionalDependency CI actually installs — a test can no
// longer create the absent-package condition by relying on physical absence.
// Passing undefined restores the real dynamic import. Not part of the runtime
// contract.
let embedderModuleLoader: (name: string) => Promise<unknown> = (name) => import(name);

export function __setEmbedderModuleLoaderForTesting(
  loader: ((name: string) => Promise<unknown>) | undefined,
): void {
  embedderModuleLoader = loader ?? ((name) => import(name));
}

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
// Stable default model cache: ~/.fabric/cache/embed (FABRIC_HOME-aware). Replaces
// fastembed's cwd-relative ./local_cache default, which re-downloaded the ~90MB
// model per working directory and (via commit 35e91e1) once got committed into
// the repo. A single home-rooted cache means the model downloads ONCE and every
// MCP server / CLI invocation reuses it regardless of cwd. An explicit
// FABRIC_EMBED_CACHE_DIR still wins (strict-offline / custom prewarm).
export function defaultEmbedCacheDir(): string {
  return join(resolveGlobalRoot(), "cache", "embed");
}

export function buildEmbedInitOptions(
  modelName?: string,
): { maxLength: number; cacheDir: string; model?: string } {
  return {
    maxLength: 512,
    cacheDir: process.env.FABRIC_EMBED_CACHE_DIR ?? defaultEmbedCacheDir(),
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
        const mod = (await embedderModuleLoader(moduleName)) as unknown as FastembedModule;
        if (mod?.FlagEmbedding?.init === undefined) {
          // Loaded but not the embedder we expect → degrade + one-time hint.
          hintMissingEmbedderOnce();
          return null;
        }
        // CPU execution; model cache dir defaults to ~/.fabric/cache/embed (stable
        // across cwd) unless FABRIC_EMBED_CACHE_DIR overrides. v2.1 ③: model pinned
        // via buildEmbedInitOptions (Chinese default, not English). Ensure the cache
        // dir exists so fastembed's first-run download lands somewhere predictable.
        const initOpts = buildEmbedInitOptions(modelName);
        mkdirSync(initOpts.cacheDir, { recursive: true });
        const model = await mod.FlagEmbedding.init(initOpts);
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

// TASK-004 (P1 recall-engine-refactor): version-of-record for the on-disk
// doc-vector snapshot layout. Bump on ANY serialization-shape change so a stale
// snapshot from an older layout is rejected as a miss (never rehydrated into a
// broken shape). Mirrors the SerializedBm25Model.version === 1 gate.
const VECTOR_CACHE_VERSION = 1;

// TASK-004: on-disk doc-embedding cache, tier 2 behind the in-memory Map (tier 1).
// docVectorCache alone re-embeds the WHOLE corpus on every COLD process (a fresh
// hook invocation starts with an empty Map). Doc embeddings are a pure function
// of (doc text, embedding model), so a snapshot keyed on the read-set revision
// lets a cold process rehydrate instead of re-embedding the corpus on CPU — the
// cold-start perf win, mirroring the BM25 disk cache (plan-context.ts).
//
// The payload pins THREE invalidation axes beyond the filename revision:
//   - embedding_model: a model swap produces incomparable vectors of a DIFFERENT
//     space — must not mix. Model changes need a server restart (loadEmbedder is
//     per-process, first-model-wins), but a persisted snapshot outlives the
//     process, so the model is pinned in the payload, not just the process.
//   - dimension: a hard guard against reading vectors of the WRONG width into
//     cosineSimilarity (a length mismatch there silently scores 0 — a stale
//     snapshot at the wrong dimension would poison recall invisibly).
//   - corpus_revision: bound in the filename AND re-checked in the body, so a
//     revision↔filename mismatch (e.g. a truncated/renamed file) is also a miss.
// Any mismatch on ANY axis → miss → re-embed + write-through (overwrite). Stored
// under `.fabric/cache/vectors/`, alongside the BM25 cache's `.fabric/cache/bm25/`.

async function pruneRevisionCacheDir(dir: string, keep = 2): Promise<void> {
  try {
    const names = await readdir(dir);
    const jsons = names.filter((n) => n.endsWith(".json"));
    if (jsons.length <= keep) return;
    const withStat: Array<{ name: string; mtimeMs: number }> = [];
    for (const name of jsons) {
      try {
        const st = await stat(join(dir, name));
        withStat.push({ name, mtimeMs: st.mtimeMs });
      } catch {
        /* skip */
      }
    }
    withStat.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const stale of withStat.slice(keep)) {
      try {
        await unlink(join(dir, stale.name));
      } catch {
        /* best-effort */
      }
    }
  } catch {
    /* ok */
  }
}

// Stored under `.fabric/.cache/vectors/`, alongside the BM25 cache's
// `.fabric/.cache/bm25/` (unify-fabric-cache-dir — the `.fabric/.gitignore`'s
// single `.cache/` rule now covers both). Older installs are migrated lazily on
// first read/write via migrateLegacyFabricCache; a legacy `.fabric/cache/vectors/`
// is renamed in place, preserving every cached embedding so no re-embed is paid.
const VECTOR_CACHE_DIR = ".fabric/.cache/vectors";

// Context threaded from the caller so the disk tier can key/validate the snapshot.
// OPTIONAL on buildVectorScores: when absent, the disk tier is skipped entirely
// and behavior is byte-identical to the pre-TASK-004 in-memory-only path
// (backward compatible for callers/tests that pass no cache context).
export interface VectorCacheContext {
  projectRoot: string;
  corpusRevision: string;
  embeddingModel: string;
}

// The serialized snapshot. `vectors` maps doc TEXT → vector (same key as the
// in-memory docVectorCache) so rehydration seeds tier 1 directly.
interface SerializedVectorCache {
  version: number;
  embedding_model: string;
  dimension: number;
  corpus_revision: string;
  vectors: Array<[string, number[]]>;
}

function vectorCachePath(projectRoot: string, revision: string): string {
  // The revision is a sha256 hex string (computeReadSetRevision), optionally
  // `sha256:`-prefixed — safe as a filename once the colon is normalized. Mirrors
  // bm25CachePath's normalization so the two caches key filenames identically.
  const safe = revision.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(projectRoot, VECTOR_CACHE_DIR, `${safe}.json`);
}

/**
 * Load the persisted doc-vector snapshot for this (revision, model). Returns null
 * — a miss — on a missing file, parse error, version/model/dimension/revision
 * mismatch, or an empty snapshot. The cache is a perf accelerator, never
 * load-bearing: any bad read just falls through to re-embedding.
 */
async function loadVectorCacheFromDisk(
  ctx: VectorCacheContext,
): Promise<Map<string, number[]> | null> {
  try {
    const raw = await readFile(vectorCachePath(ctx.projectRoot, ctx.corpusRevision), "utf8");
    const parsed = JSON.parse(raw) as SerializedVectorCache;
    // Reject a snapshot from a different layout / model / corpus. The dimension
    // is validated per-vector below (against the snapshot's own declared width),
    // so a corrupt row cannot smuggle a wrong-width vector into the tier-1 Map.
    if (parsed.version !== VECTOR_CACHE_VERSION) return null;
    if (parsed.embedding_model !== ctx.embeddingModel) return null;
    if (parsed.corpus_revision !== ctx.corpusRevision) return null;
    if (!Array.isArray(parsed.vectors) || parsed.vectors.length === 0) return null;
    const dimension = parsed.dimension;
    if (!Number.isInteger(dimension) || dimension <= 0) return null;
    const out = new Map<string, number[]>();
    for (const entry of parsed.vectors) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const [text, vector] = entry;
      if (typeof text !== "string" || !Array.isArray(vector)) return null;
      // Hard dimension guard: a row whose width disagrees with the declared
      // dimension is a corrupt/mismatched snapshot — reject the WHOLE file rather
      // than seeding a wrong-width vector that cosineSimilarity silently zeroes.
      if (vector.length !== dimension) return null;
      out.set(text, vector);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Persist the current doc-vector snapshot for this (revision, model). Best-effort:
 * a write failure (read-only FS, concurrent writer) must never block ranking —
 * the in-memory Map still serves this process. Mirrors saveBm25ModelToDisk.
 */
async function saveVectorCacheToDisk(
  ctx: VectorCacheContext,
  vectors: Array<[string, number[]]>,
  dimension: number,
): Promise<void> {
  try {
    const payload: SerializedVectorCache = {
      version: VECTOR_CACHE_VERSION,
      embedding_model: ctx.embeddingModel,
      dimension,
      corpus_revision: ctx.corpusRevision,
      vectors,
    };
    const path = vectorCachePath(ctx.projectRoot, ctx.corpusRevision);
    const dir = join(ctx.projectRoot, VECTOR_CACHE_DIR);
    await mkdir(dir, { recursive: true });
    await writeFile(path, JSON.stringify(payload), "utf8");
    await pruneRevisionCacheDir(dir, 2); // ISS-20260713-015
  } catch {
    // Best-effort: never let a persistence failure surface into recall.
  }
}

export async function buildVectorScores(
  embedder: Embedder | null,
  queryText: string,
  items: VectorScoreItem[],
  cache?: VectorCacheContext,
): Promise<Map<string, number> | null> {
  // Degrade-safe hard gate (unchanged): with no embedder / empty query / no
  // items we return null WITHOUT ever touching the disk cache, so the text-only
  // fallback path behaves byte-identically to pre-TASK-004.
  if (embedder === null || queryText.trim().length === 0 || items.length === 0) {
    return null;
  }
  try {
    // Tier 2 (disk): on a COLD process, rehydrate the persisted snapshot into the
    // in-memory Map BEFORE computing misses, so the miss loop finds the docs
    // cached and only the (varying) query is embedded. Skipped entirely when the
    // caller passes no cache context (backward compatible).
    if (cache !== undefined) {
      // Legacy `.fabric/cache/vectors/` → `.fabric/.cache/vectors/` migration
      // is idempotent + cheap (existsSync gate); run once per cold read so a
      // pre-migration snapshot rehydrates without a re-embed round.
      migrateLegacyFabricCache(cache.projectRoot);
      const fromDisk = await loadVectorCacheFromDisk(cache);
      if (fromDisk !== null) {
        for (const [text, vector] of fromDisk) {
          cacheDocVector(text, vector);
        }
      }
    }

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

    // Query-anchored dimension guard (TASK-004 red line). `queryVec` was produced
    // by the CURRENT embedder, so its width is the authoritative dimension. A
    // freshly-embedded miss always matches it (same batch, same embedder); a
    // WIDTH MISMATCH can therefore only be a stale CACHED vector — from an L2 disk
    // snapshot (or a lingering L1 entry) written by a different-dimension model.
    // cosineSimilarity would silently score such a pair 0, poisoning recall — so
    // we evict the mismatched entries and re-embed them at the correct width
    // rather than scoring against them. Belt-and-suspenders behind the disk
    // loader's own dimension check (which cannot know the current width pre-embed).
    const staleTexts: string[] = [];
    for (const item of items) {
      const cached = docVectorCache.get(item.text);
      if (cached !== undefined && cached.length !== queryVec.length) {
        docVectorCache.delete(item.text);
        staleTexts.push(item.text);
      }
    }
    if (staleTexts.length > 0) {
      const reEmbedded = await embedder.embed(staleTexts);
      if (reEmbedded.length !== staleTexts.length) {
        return null;
      }
      for (let s = 0; s < staleTexts.length; s += 1) {
        cacheDocVector(staleTexts[s], reEmbedded[s]);
      }
    }
    const embeddedNewDoc = missTexts.length > 0 || staleTexts.length > 0;

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

    // Tier 2 write-through: persist THIS corpus's doc vectors keyed by revision.
    // Only when we actually embedded new docs (a full disk hit has nothing new to
    // write) and the vectors carry a consistent, positive dimension. The snapshot
    // is the current call's corpus — a content change moves the revision → a new
    // filename → the old snapshot is simply left in place (harmless; a churning
    // corpus is naturally bounded by revision turnover, and stale files never
    // load because their filename revision no longer matches).
    if (cache !== undefined && embeddedNewDoc) {
      const snapshot: Array<[string, number[]]> = [];
      for (const item of items) {
        const vec = docVectorCache.get(item.text);
        if (vec !== undefined) {
          snapshot.push([item.text, vec]);
        }
      }
      const dimension = snapshot.length > 0 ? snapshot[0][1].length : 0;
      // Guard: only persist a uniform, positive-width snapshot. A ragged corpus
      // (mixed widths — should never happen for one model) is not written rather
      // than persisting a payload that would fail its own dimension check on load.
      const uniform = dimension > 0 && snapshot.every(([, v]) => v.length === dimension);
      if (uniform) {
        await saveVectorCacheToDisk(cache, snapshot, dimension);
      }
    }

    return scores;
  } catch {
    return null;
  }
}

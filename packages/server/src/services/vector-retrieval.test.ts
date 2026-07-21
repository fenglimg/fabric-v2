import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  buildVectorScores,
  buildEmbedInitOptions,
  embeddingCacheIdentity,
  loadEmbedder,
  __resetEmbedderForTesting,
  __resetVectorCache,
  __setMissingEmbedderHintForTesting,
  __setEmbedderModuleLoaderForTesting,
  type Embedder,
} from "./vector-retrieval.js";

// Simulate the optional package being absent: the dynamic import REJECTS the way
// Node's loader does for an unresolved module. Used by the degradation tests so
// they exercise the catch/fallback path DETERMINISTICALLY — fastembed is now an
// optionalDependency CI installs, so physical absence can no longer be assumed.
const rejectAsMissing = (): Promise<unknown> =>
  Promise.reject(new Error("Cannot find module 'fastembed'"));

afterEach(() => {
  // Restore the real lazy-load probe + clear the doc-embedding cache between tests.
  __resetEmbedderForTesting(undefined);
  __resetVectorCache();
  // Restore the real stderr hint sink + reset the one-shot latch.
  __setMissingEmbedderHintForTesting(undefined);
  // Restore the real dynamic import behind loadEmbedder.
  __setEmbedderModuleLoaderForTesting(undefined);
});

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
  });
  it("is 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });
  it("is 0 for a zero vector (no NaN)", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
  it("is 0 on a length mismatch (defensive)", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });
  it("ranks a closer vector higher", () => {
    const q = [1, 1, 0];
    const near = cosineSimilarity(q, [1, 1, 0.1]);
    const far = cosineSimilarity(q, [0, 0, 1]);
    expect(near).toBeGreaterThan(far);
  });

  // W2-REVIEW codex HIGH-2 / MED-5: non-finite elements must never produce NaN.
  it("returns 0 (never NaN) for NaN or Infinity elements", () => {
    expect(cosineSimilarity([Number.NaN, 1], [1, 1])).toBe(0);
    expect(cosineSimilarity([1, 1], [Number.POSITIVE_INFINITY, 1])).toBe(0);
    expect(Number.isFinite(cosineSimilarity([1e308, 1e308], [1e308, 1e308]))).toBe(true);
  });

  // TASK-004: the contract is [0, 1]. A raw negative/opposite cosine is clamped
  // to 0 — a negative semantic similarity is meaningless for recall and must
  // never subtract from the fused score.
  it("clamps the result into [0, 1] (lower bound 0)", () => {
    const parallel = cosineSimilarity([1, 2, 3], [2, 4, 6]); // raw +1
    expect(parallel).toBeLessThanOrEqual(1);
    expect(parallel).toBeGreaterThanOrEqual(0);
  });

  it("clamps an opposite-direction pair (raw cosine -1) to 0", () => {
    // Anti-parallel vectors → raw cosine = -1 → clamped to 0 (was -1 pre-TASK-004).
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBe(0);
    // A partially-opposed pair is still non-negative.
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });

  it("never returns a negative value across mixed-sign inputs", () => {
    const cases: Array<[number[], number[]]> = [
      [[1, 0], [-1, 0]],
      [[3, -4], [-3, 4]],
      [[1, 1, 1], [-1, -1, 0]],
    ];
    for (const [a, b] of cases) {
      expect(cosineSimilarity(a, b)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildVectorScores fallback contract", () => {
  const fake: Embedder = {
    // Deterministic toy embedder: vector = [length, count of 'a', count of 'b'].
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => [t.length, (t.match(/a/g) ?? []).length, (t.match(/b/g) ?? []).length]);
    },
  };

  it("returns null when the embedder is unavailable (→ text-only fallback)", async () => {
    expect(await buildVectorScores(null, "query", [{ stable_id: "x", text: "doc" }])).toBeNull();
  });

  it("returns null for an empty query", async () => {
    expect(await buildVectorScores(fake, "   ", [{ stable_id: "x", text: "doc" }])).toBeNull();
  });

  it("returns null for no items", async () => {
    expect(await buildVectorScores(fake, "query", [])).toBeNull();
  });

  it("returns null (not a throw) when the embedder errors", async () => {
    const boom: Embedder = {
      async embed(): Promise<number[][]> {
        throw new Error("model exploded");
      },
    };
    expect(await buildVectorScores(boom, "query", [{ stable_id: "x", text: "doc" }])).toBeNull();
  });

  it("produces a cosine score per item when the embedder is available", async () => {
    const scores = await buildVectorScores(fake, "aab", [
      { stable_id: "near", text: "aab" },
      { stable_id: "far", text: "zzzzzzzz" },
    ]);
    expect(scores).not.toBeNull();
    expect(scores?.get("near") ?? 0).toBeGreaterThan(scores?.get("far") ?? 1);
  });

  // W4-08 (ISS-023): doc embeddings are cached by text, so repeated queries over
  // the same corpus do NOT re-embed every document — only the (varying) query
  // plus any newly-seen docs are embedded.
  it("re-embeds only the query on a repeated query over an unchanged corpus", async () => {
    __resetVectorCache();
    const embeddedBatches: string[][] = [];
    const counting: Embedder = {
      async embed(texts: string[]): Promise<number[][]> {
        embeddedBatches.push(texts);
        return texts.map((t) => [t.length, (t.match(/a/g) ?? []).length, (t.match(/b/g) ?? []).length]);
      },
    };
    const items = [
      { stable_id: "d1", text: "alpha bravo" },
      { stable_id: "d2", text: "charlie delta" },
      { stable_id: "d3", text: "echo foxtrot" },
    ];

    const first = await buildVectorScores(counting, "q1", items);
    const second = await buildVectorScores(counting, "q2", items);

    // First call embeds query + all 3 docs; second embeds only the new query.
    expect(embeddedBatches[0]).toHaveLength(4); // q1 + 3 docs
    expect(embeddedBatches[1]).toHaveLength(1); // q2 only (docs cached)
    expect(embeddedBatches[1]).toEqual(["q2"]);

    // Equivalence: the cached run scores identically to a fresh full embed.
    __resetVectorCache();
    const fresh = await buildVectorScores(counting, "q2", items);
    expect(second).not.toBeNull();
    for (const item of items) {
      expect(second?.get(item.stable_id)).toBeCloseTo(fresh?.get(item.stable_id) ?? NaN, 10);
    }
  });

  it("embeds only the newly-added doc when the corpus grows", async () => {
    __resetVectorCache();
    const batches: string[][] = [];
    const counting: Embedder = {
      async embed(texts: string[]): Promise<number[][]> {
        batches.push(texts);
        return texts.map((t) => [t.length, 0, 0]);
      },
    };
    await buildVectorScores(counting, "q", [{ stable_id: "d1", text: "one" }]);
    await buildVectorScores(counting, "q", [
      { stable_id: "d1", text: "one" },
      { stable_id: "d2", text: "two" },
    ]);
    expect(batches[1]).toEqual(["q", "two"]); // d1 cached, only the new doc embedded
  });
});

describe("loadEmbedder", () => {
  it("returns null when the optional fastembed package cannot be loaded", async () => {
    // fastembed is an optionalDependency: CI installs it, so absence is simulated
    // by forcing the dynamic import to reject. The lazy load must degrade to null
    // rather than throw.
    __setEmbedderModuleLoaderForTesting(rejectAsMissing);
    __resetEmbedderForTesting(undefined);
    const embedder = await loadEmbedder();
    expect(embedder).toBeNull();
  });

  it("still degrades to null when given an explicit model and the package fails to load", async () => {
    __setEmbedderModuleLoaderForTesting(rejectAsMissing);
    __resetEmbedderForTesting(undefined);
    const embedder = await loadEmbedder("fast-bge-small-zh-v1.5");
    expect(embedder).toBeNull();
  });

  // TASK-004: vectors are on by default, so a missing optional embedder must
  // (a) NOT throw, (b) take the text-only fallback (null), and (c) emit the
  // missing-embedder hint EXACTLY ONCE — not on every recall.
  it("emits a one-time hint and degrades (no throw) when fastembed fails to load", async () => {
    let hintCount = 0;
    __setMissingEmbedderHintForTesting(() => {
      hintCount += 1;
    });
    // Force the import to reject so the catch/degrade path runs deterministically.
    __setEmbedderModuleLoaderForTesting(rejectAsMissing);

    // First probe: import rejects → catch → null + hint fires.
    __resetEmbedderForTesting(undefined);
    await expect(loadEmbedder()).resolves.toBeNull();
    expect(hintCount).toBe(1);

    // Re-probe (reset the cached load, NOT the hint latch): still null, but the
    // hint does NOT fire a second time — it is one-shot per process.
    __resetEmbedderForTesting(undefined);
    await expect(loadEmbedder("fast-bge-small-zh-v1.5")).resolves.toBeNull();
    expect(hintCount).toBe(1);
  });
});

// v2.1 ③ vector-chinese-model (P3): the model threads into fastembed init opts.
describe("buildEmbedInitOptions (v2.1 ③)", () => {
  const prevCache = process.env.FABRIC_EMBED_CACHE_DIR;
  afterEach(() => {
    if (prevCache === undefined) delete process.env.FABRIC_EMBED_CACHE_DIR;
    else process.env.FABRIC_EMBED_CACHE_DIR = prevCache;
  });

  it("includes the model when a name is given (Chinese pin)", () => {
    const opts = buildEmbedInitOptions("fast-bge-small-zh-v1.5");
    expect(opts.model).toBe("fast-bge-small-zh-v1.5");
    expect(opts.maxLength).toBe(512);
  });

  it("includes a multilingual model override", () => {
    expect(buildEmbedInitOptions("fast-multilingual-e5-large").model).toBe("fast-multilingual-e5-large");
  });

  it("omits model when no name is given (preserves fastembed's English default — pre-③ behavior)", () => {
    const opts = buildEmbedInitOptions();
    expect("model" in opts).toBe(false);
    expect(buildEmbedInitOptions("").model).toBeUndefined();
  });

  it("threads the operator cacheDir through", () => {
    process.env.FABRIC_EMBED_CACHE_DIR = "/tmp/fabric-embed-cache";
    expect(buildEmbedInitOptions("fast-bge-small-zh-v1.5").cacheDir).toBe("/tmp/fabric-embed-cache");
  });

  it("defaults cacheDir to a stable ~/.fabric/cache/embed (not cwd-relative) when unset", () => {
    // Follow-up: the model cache must NOT be fastembed's cwd-relative ./local_cache
    // (re-downloaded per cwd; once committed into the repo). With no operator
    // override it resolves under the FABRIC_HOME-aware global root, so every server
    // / CLI invocation reuses one download.
    delete process.env.FABRIC_EMBED_CACHE_DIR;
    const prevHome = process.env.FABRIC_HOME;
    process.env.FABRIC_HOME = "/tmp/fabric-home-probe";
    try {
      expect(buildEmbedInitOptions().cacheDir).toBe("/tmp/fabric-home-probe/.fabric/cache/embed");
    } finally {
      if (prevHome === undefined) delete process.env.FABRIC_HOME;
      else process.env.FABRIC_HOME = prevHome;
    }
  });
});

// TASK-004 (P1 recall-engine-refactor): version-keyed doc-vector DISK cache. The
// in-memory Map is tier 1 (per-process); this tier 2 lets a COLD process (a fresh
// hook invocation) rehydrate the corpus embeddings from disk instead of
// re-embedding on CPU. The suite drives buildVectorScores with a COUNTING fake
// embedder + a temp projectRoot so it asserts real read/write/invalidate behavior
// without the optional fastembed package or a model download.
describe("buildVectorScores disk cache (TASK-004)", () => {
  let root: string;
  // Deterministic fixed-width (3-dim) embedder that records every batch it embeds,
  // so the test can prove which texts got re-embedded vs served from cache.
  function countingEmbedder(): { embedder: Embedder; batches: string[][] } {
    const batches: string[][] = [];
    const embedder: Embedder = {
      async embed(texts: string[]): Promise<number[][]> {
        batches.push(texts);
        return texts.map((t) => [t.length, (t.match(/a/g) ?? []).length, (t.match(/b/g) ?? []).length]);
      },
    };
    return { embedder, batches };
  }
  const items = [
    { stable_id: "d1", text: "alpha bravo" },
    { stable_id: "d2", text: "charlie delta" },
    { stable_id: "d3", text: "echo foxtrot" },
  ];
  const cacheFiles = (): string[] => {
    try {
      return readdirSync(join(root, ".fabric", ".cache", "vectors"));
    } catch {
      return [];
    }
  };

  afterEach(() => {
    __resetVectorCache();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  it("writes a versioned snapshot on first embed (identity included)", async () => {
    root = mkdtempSync(join(tmpdir(), "fab-vec-cache-"));
    __resetVectorCache();
    const { embedder } = countingEmbedder();
    const scores = await buildVectorScores(embedder, "query", items, {
      projectRoot: root,
      corpusRevision: "rev-abc",
      embeddingModel: "fast-bge-small-zh-v1.5",
    });
    expect(scores).not.toBeNull();

    const files = cacheFiles();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^rev-abc\.[a-f0-9]{16}\.json$/);
    const payload = JSON.parse(readFileSync(join(root, ".fabric", ".cache", "vectors", files[0]), "utf8"));
    expect(payload.version).toBe(2);
    expect(payload.embedding_model).toBe("fast-bge-small-zh-v1.5");
    expect(payload.embedding_identity).toBe("local:fast-bge-small-zh-v1.5");
    expect(payload.dimension).toBe(3);
    expect(payload.corpus_revision).toBe("rev-abc");
    // The snapshot holds every doc's vector, keyed by doc text.
    expect(payload.vectors).toHaveLength(3);
  });

  it("cold-process hit rehydrates from disk — only the query is re-embedded", async () => {
    root = mkdtempSync(join(tmpdir(), "fab-vec-cache-"));
    const ctx = { projectRoot: root, corpusRevision: "rev-cold", embeddingModel: "m1" };

    // Warm run: builds the snapshot (embeds query + 3 docs), writes it to disk.
    __resetVectorCache();
    const warm = countingEmbedder();
    await buildVectorScores(warm.embedder, "q1", items, ctx);
    expect(warm.batches[0]).toHaveLength(4); // q1 + 3 docs

    // Simulate a COLD process: clear the in-memory Map so only disk can serve docs.
    __resetVectorCache();
    const cold = countingEmbedder();
    const scores = await buildVectorScores(cold.embedder, "q2", items, ctx);
    expect(scores).not.toBeNull();
    // The docs were rehydrated from disk → the cold run embeds ONLY the new query.
    expect(cold.batches).toHaveLength(1);
    expect(cold.batches[0]).toEqual(["q2"]);

    // Equivalence: the disk-rehydrated run scores identically to a full fresh embed.
    __resetVectorCache();
    const fresh = countingEmbedder();
    const freshScores = await buildVectorScores(fresh.embedder, "q2", items);
    for (const item of items) {
      expect(scores?.get(item.stable_id)).toBeCloseTo(freshScores?.get(item.stable_id) ?? NaN, 10);
    }
  });

  it("misses when the embedding model changed (never mixes vector spaces)", async () => {
    root = mkdtempSync(join(tmpdir(), "fab-vec-cache-"));

    __resetVectorCache();
    const first = countingEmbedder();
    await buildVectorScores(first.embedder, "q", items, {
      projectRoot: root,
      corpusRevision: "rev-model",
      embeddingModel: "model-A",
    });

    // Same revision + corpus, DIFFERENT model → the model-A snapshot must NOT be
    // reused. A cold process on model-B re-embeds the docs (model mismatch → miss).
    __resetVectorCache();
    const second = countingEmbedder();
    await buildVectorScores(second.embedder, "q", items, {
      projectRoot: root,
      corpusRevision: "rev-model",
      embeddingModel: "model-B",
    });
    expect(second.batches[0]).toHaveLength(4); // q + 3 docs re-embedded (no reuse)
  });

  it("misses when the persisted dimension disagrees (never reads wrong-width vectors)", async () => {
    root = mkdtempSync(join(tmpdir(), "fab-vec-cache-"));

    // Warm a snapshot with a 3-dim embedder.
    __resetVectorCache();
    const warm = countingEmbedder();
    await buildVectorScores(warm.embedder, "q", items, {
      projectRoot: root,
      corpusRevision: "rev-dim",
      embeddingModel: "m",
    });

    // A cold process whose embedder now produces 4-dim vectors: the 3-dim disk
    // snapshot would be a WIDTH MISMATCH. loadVectorCacheFromDisk rejects the whole
    // file (dimension guard), so every doc is re-embedded at the new width rather
    // than seeding cosineSimilarity with mismatched-width vectors (which it zeroes).
    __resetVectorCache();
    const batches: string[][] = [];
    const wide: Embedder = {
      async embed(texts: string[]): Promise<number[][]> {
        batches.push(texts);
        return texts.map((t) => [t.length, 0, 0, 1]); // 4-dim
      },
    };
    const scores = await buildVectorScores(wide, "q", items, {
      projectRoot: root,
      corpusRevision: "rev-dim",
      embeddingModel: "m",
    });
    expect(scores).not.toBeNull();
    // The stale 3-dim docs load from disk, but the query-anchored dimension guard
    // detects the width mismatch against the fresh 4-dim query, evicts them, and
    // re-embeds in a SECOND batch (rather than scoring cosine 0 against them).
    expect(batches[0]).toEqual(["q"]); // batch 1: query only (docs served from disk)
    expect(batches[1]).toHaveLength(3); // batch 2: the 3 evicted stale-width docs
    // The rewritten snapshot now records the new dimension.
    const payload = JSON.parse(
      readFileSync(join(root, ".fabric", ".cache", "vectors", cacheFiles()[0]), "utf8"),
    );
    expect(payload.dimension).toBe(4);
  });

  it("isolates L1 and L2 vectors by transport, model, and endpoint", async () => {
    root = mkdtempSync(join(tmpdir(), "fab-vec-cache-"));
    const localIdentity = embeddingCacheIdentity("m");
    const remoteIdentity = embeddingCacheIdentity("m", "https://embed.example/a");
    const local = countingEmbedder();
    await buildVectorScores(local.embedder, "q1", items, {
      projectRoot: root,
      corpusRevision: "rev-identity",
      embeddingModel: "m",
      embeddingIdentity: localIdentity,
    });

    const remote = countingEmbedder();
    await buildVectorScores(remote.embedder, "q2", items, {
      projectRoot: root,
      corpusRevision: "rev-identity",
      embeddingModel: "m",
      embeddingIdentity: remoteIdentity,
    });

    expect(remote.batches[0]).toHaveLength(4);
    expect(cacheFiles()).toHaveLength(2);
  });

  it("NEVER touches the disk cache when the embedder is unavailable (degrade-safe)", async () => {
    root = mkdtempSync(join(tmpdir(), "fab-vec-cache-"));
    __resetVectorCache();
    const scores = await buildVectorScores(null, "query", items, {
      projectRoot: root,
      corpusRevision: "rev-null",
      embeddingModel: "m",
    });
    // Same early-return contract as pre-TASK-004: null, and ZERO disk artifacts.
    expect(scores).toBeNull();
    expect(cacheFiles()).toEqual([]);
  });

  it("skips the disk tier entirely when no cache context is passed (backward compatible)", async () => {
    root = mkdtempSync(join(tmpdir(), "fab-vec-cache-"));
    __resetVectorCache();
    const { embedder } = countingEmbedder();
    // No 4th arg → the in-memory-only path; nothing is persisted under root.
    const scores = await buildVectorScores(embedder, "query", items);
    expect(scores).not.toBeNull();
    expect(cacheFiles()).toEqual([]);
  });
});

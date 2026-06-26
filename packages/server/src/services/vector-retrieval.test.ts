import { afterEach, describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  buildVectorScores,
  buildEmbedInitOptions,
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
});

import { afterEach, describe, expect, it } from "vitest";

import {
  cosineSimilarity,
  buildVectorScores,
  loadEmbedder,
  __resetEmbedderForTesting,
  __resetVectorCache,
  type Embedder,
} from "./vector-retrieval.js";

afterEach(() => {
  // Restore the real lazy-load probe + clear the doc-embedding cache between tests.
  __resetEmbedderForTesting(undefined);
  __resetVectorCache();
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

  it("clamps the result into [-1, 1]", () => {
    const sim = cosineSimilarity([1, 2, 3], [2, 4, 6]); // parallel → 1
    expect(sim).toBeLessThanOrEqual(1);
    expect(sim).toBeGreaterThanOrEqual(-1);
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
  it("returns null when the optional fastembed package is not installed (CI default)", async () => {
    // fastembed is NOT a declared dependency — CI never has it, so the lazy
    // load must degrade to null rather than throw.
    __resetEmbedderForTesting(undefined);
    const embedder = await loadEmbedder();
    expect(embedder).toBeNull();
  });
});

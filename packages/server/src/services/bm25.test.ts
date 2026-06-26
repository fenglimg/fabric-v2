import { describe, expect, it } from "vitest";

import {
  buildBm25Model,
  buildQueryTerms,
  serializeBm25Model,
  rehydrateBm25Model,
  type Bm25Field,
} from "./bm25.js";

// Single-field helper: puts all text in `body` (boost 1, b 0.75) so these
// classic BM25 invariants are exercised without field-boost interference.
function model(docs: Record<string, string>) {
  return buildBm25Model(
    Object.entries(docs).map(([id, text]) => ({
      id,
      fields: { title: [], summary: [], tags: [], body: buildQueryTerms(text) },
    })),
  );
}

// Build a doc that places `text` into a single named field, the rest empty.
function fieldDoc(id: string, field: Bm25Field, text: string) {
  const fields: Record<Bm25Field, string[]> = { title: [], summary: [], tags: [], body: [] };
  fields[field] = buildQueryTerms(text);
  return { id, fields };
}

describe("buildBm25Model (BM25F)", () => {
  it("scores a document containing the query term above one that does not", () => {
    const m = model({
      a: "BM25 content relevance scoring for retrieval",
      b: "unrelated lifecycle governance skill",
    });
    const q = buildQueryTerms("relevance scoring");
    expect(m.scoreDoc("a", q)).toBeGreaterThan(0);
    expect(m.scoreDoc("b", q)).toBe(0);
  });

  it("returns 0 for empty query terms", () => {
    const m = model({ a: "anything", b: "else" });
    expect(m.scoreDoc("a", [])).toBe(0);
  });

  it("returns 0 for an unknown document id", () => {
    const m = model({ a: "term here" });
    expect(m.scoreDoc("missing", buildQueryTerms("term"))).toBe(0);
  });

  it("rewards rarer terms more (IDF): a term in one doc outweighs a term in all docs", () => {
    const m = model({
      a: "common rare",
      b: "common other",
      c: "common another",
    });
    // 'rare' appears in 1/3 docs, 'common' in 3/3 — a doc matching 'rare'
    // should score higher than the same-length doc matching only 'common'.
    const rareScore = m.scoreDoc("a", buildQueryTerms("rare"));
    const commonScore = m.scoreDoc("b", buildQueryTerms("common"));
    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it("does not inflate the score when a query term is repeated", () => {
    const m = model({ a: "alpha beta", b: "gamma" });
    const once = m.scoreDoc("a", buildQueryTerms("alpha"));
    const twice = m.scoreDoc("a", buildQueryTerms("alpha alpha"));
    expect(twice).toBe(once);
  });

  it("scores CJK content via shared n-gram tokenization", () => {
    const m = model({
      zh: "检索治理里程碑实现",
      other: "无关条目内容",
    });
    const q = buildQueryTerms("检索治理");
    expect(m.scoreDoc("zh", q)).toBeGreaterThan(0);
    expect(m.scoreDoc("other", q)).toBe(0);
  });

  it("boosts a term hit in a high-weight field (title) over a low-weight one (body)", () => {
    // Same single term, same corpus size — only the field it lands in differs.
    // title boost 3 > body boost 1, so the title hit must score strictly higher.
    const m = buildBm25Model([
      fieldDoc("inTitle", "title", "auth"),
      fieldDoc("inBody", "body", "auth"),
    ]);
    const q = buildQueryTerms("auth");
    expect(m.scoreDoc("inTitle", q)).toBeGreaterThan(m.scoreDoc("inBody", q));
  });
});

// P1 recall-engine-refactor (TASK-002): serialize/rehydrate round-trip. A model
// rehydrated from its JSON snapshot must score IDENTICALLY to the freshly-built
// one, so a cold hook can load the disk snapshot and skip the rebuild without any
// numeric drift. The snapshot is JSON-stringified on the way to disk, so the test
// round-trips through JSON to mirror the real path.
describe("serializeBm25Model / rehydrateBm25Model round-trip (TASK-002)", () => {
  // A multi-field, multi-doc corpus so df / avg-length / per-field tf all carry
  // real values that must survive the round-trip (not a degenerate single doc).
  function buildCorpus() {
    return buildBm25Model([
      {
        id: "a",
        fields: {
          title: buildQueryTerms("BM25 retrieval relevance"),
          summary: buildQueryTerms("when scoring candidates by content"),
          tags: buildQueryTerms("bm25 retrieval typescript"),
          body: buildQueryTerms("content relevance over the candidate corpus"),
        },
      },
      {
        id: "b",
        fields: {
          title: buildQueryTerms("lifecycle governance skill"),
          summary: buildQueryTerms("unrelated process documentation"),
          tags: buildQueryTerms("lifecycle"),
          body: buildQueryTerms("governance prose with no overlap"),
        },
      },
      {
        id: "zh",
        fields: {
          title: buildQueryTerms("检索治理里程碑"),
          summary: [],
          tags: buildQueryTerms("检索"),
          body: buildQueryTerms("检索治理实现内容"),
        },
      },
    ]);
  }

  it("rehydrated scoreDoc equals the original for the same id/queryTerms", () => {
    const original = buildCorpus();
    const rehydrated = rehydrateBm25Model(
      JSON.parse(JSON.stringify(serializeBm25Model(original))),
    );

    const queries = [
      buildQueryTerms("relevance scoring"),
      buildQueryTerms("retrieval"),
      buildQueryTerms("lifecycle governance"),
      buildQueryTerms("检索治理"),
      buildQueryTerms("nonexistent term"),
      [], // empty query
    ];
    for (const id of ["a", "b", "zh", "missing"]) {
      for (const q of queries) {
        expect(rehydrated.scoreDoc(id, q)).toBe(original.scoreDoc(id, q));
      }
    }
  });

  it("preserves a non-zero score through the round-trip (not all-zero degenerate)", () => {
    const original = buildCorpus();
    const q = buildQueryTerms("relevance retrieval");
    // Guard: the round-trip equality test above is only meaningful if there is a
    // real non-zero score to preserve.
    expect(original.scoreDoc("a", q)).toBeGreaterThan(0);
    const rehydrated = rehydrateBm25Model(
      JSON.parse(JSON.stringify(serializeBm25Model(original))),
    );
    expect(rehydrated.scoreDoc("a", q)).toBe(original.scoreDoc("a", q));
  });
});

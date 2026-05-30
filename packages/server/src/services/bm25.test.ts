import { describe, expect, it } from "vitest";

import { buildBm25Model, buildQueryTerms } from "./bm25.js";

function model(docs: Record<string, string>) {
  return buildBm25Model(
    Object.entries(docs).map(([id, text]) => ({ id, tokens: buildQueryTerms(text) })),
  );
}

describe("buildBm25Model", () => {
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

  it("scores CJK content via shared bigram tokenization", () => {
    const m = model({
      zh: "检索治理里程碑实现",
      other: "无关条目内容",
    });
    const q = buildQueryTerms("检索治理");
    expect(m.scoreDoc("zh", q)).toBeGreaterThan(0);
    expect(m.scoreDoc("other", q)).toBe(0);
  });
});

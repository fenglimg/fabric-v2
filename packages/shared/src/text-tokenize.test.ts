import { describe, expect, it } from "vitest";

import { tokenize } from "./text-tokenize.js";

describe("tokenize (CJK-aware BM25 tokenizer)", () => {
  it("returns no tokens for an empty string", () => {
    expect(tokenize("")).toEqual([]);
  });

  it("lower-cases Latin word runs", () => {
    expect(tokenize("BM25 Scoring")).toEqual(["bm25", "scoring"]);
  });

  it("splits Latin runs on non-alphanumeric separators", () => {
    expect(tokenize("top_k truncation")).toEqual(["top", "k", "truncation"]);
  });

  it("keeps digits as part of alphanumeric tokens", () => {
    expect(tokenize("rc.37 wave2")).toEqual(["rc", "37", "wave2"]);
  });

  it("emits overlapping bigrams for a multi-character CJK run", () => {
    // 检索治理 → 检索, 索治, 治理
    expect(tokenize("检索治理")).toEqual(["检索", "索治", "治理"]);
  });

  it("emits a singleton for a lone CJK character", () => {
    expect(tokenize("中")).toEqual(["中"]);
  });

  it("tokenizes mixed CJK + Latin text on equal footing", () => {
    // "BM25 检索" → bm25 + (检索)
    expect(tokenize("BM25 检索")).toEqual(["bm25", "检索"]);
  });

  it("treats CJK punctuation as a run separator", () => {
    // 检索,治理 (fullwidth comma) → two separate runs, no cross-comma bigram
    expect(tokenize("检索,治理")).toEqual(["检索", "治理"]);
  });

  it("handles Hiragana / Katakana / Hangul runs as CJK bigrams", () => {
    expect(tokenize("ひらがな")).toEqual(["ひら", "らが", "がな"]);
    expect(tokenize("한국어")).toEqual(["한국", "국어"]);
  });

  it("produces shared terms between a query phrase and a containing document", () => {
    const docTerms = new Set(tokenize("本项目实现检索治理里程碑"));
    const queryTerms = tokenize("检索治理");
    // every query bigram appears in the document — BM25 gets real overlap
    expect(queryTerms.every((term) => docTerms.has(term))).toBe(true);
  });
});

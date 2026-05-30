// v2.2 A-INFRA-2 (W1-T1-CJK): CJK-aware tokenizer feeding BM25 content
// relevance scoring (and, downstream, injection-side salience). The KB corpus
// is bilingual zh/en — a plain `/\w+/` split collapses every Chinese summary
// into one giant "word" (or drops it entirely under some engines), giving BM25
// zero term overlap on the half of the corpus that is CJK. This tokenizer
// keeps the two scripts on equal footing without pulling in a dictionary
// segmenter:
//
//   - Latin / digit runs           → lower-cased word tokens (`bm25`, `top_k`
//                                     splits into `top` + `k`, which is fine —
//                                     queries split identically).
//   - CJK runs (Han, Kana, Hangul) → overlapping character bigrams. Bigrams
//                                     are the standard dictionary-free CJK
//                                     indexing unit: they give BM25 meaningful
//                                     term overlap (`检索治理` → `检索`,`索治`,
//                                     `治理`) where unigrams over-match on
//                                     common single characters and full-string
//                                     tokens never match a sub-phrase query.
//
// A length-1 CJK run degrades to a single-character token (no bigram possible),
// which is the correct degenerate behavior for a lone ideograph.

// Han (incl. Ext-A + compatibility), Hiragana, Katakana, Hangul syllables.
// Kept as a character class string so both the run matcher and the
// single-char classifier stay in lockstep.
const CJK_CLASS = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\uac00-\\ud7af";

// A token run is EITHER an alphanumeric word OR a maximal run of CJK chars.
// Anything else (punctuation, whitespace, symbols) is a separator and is
// skipped. The alternation order does not matter — the two classes are
// disjoint — but alphanumeric is listed first for readability.
const RUN_RE = new RegExp(`[a-z0-9]+|[${CJK_CLASS}]+`, "gu");
const CJK_FIRST_RE = new RegExp(`[${CJK_CLASS}]`, "u");

/**
 * Tokenize bilingual text into BM25 terms.
 *
 * Latin/digit runs become lower-cased word tokens; CJK runs become overlapping
 * character bigrams (singleton for length-1 runs). Returns terms in document
 * order, including duplicates — callers that need term frequencies count them,
 * callers that need a vocabulary dedupe.
 */
export function tokenize(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const tokens: string[] = [];
  const lowered = text.toLowerCase();
  RUN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RUN_RE.exec(lowered)) !== null) {
    const run = match[0];
    if (CJK_FIRST_RE.test(run[0])) {
      if (run.length === 1) {
        tokens.push(run);
      } else {
        for (let i = 0; i < run.length - 1; i += 1) {
          tokens.push(run.slice(i, i + 2));
        }
      }
    } else {
      tokens.push(run);
    }
  }

  return tokens;
}

// v2.2 A-INFRA-2 (W1-T1-CJK) + C1-W6 (BM25F port): CJK-aware tokenizer feeding
// BM25F content relevance scoring (and, downstream, injection-side salience).
// The KB corpus is bilingual zh/en — a plain `/\w+/` split collapses every
// Chinese summary into one giant "word" (or drops it entirely under some
// engines), giving BM25 zero term overlap on the half of the corpus that is
// CJK. This tokenizer keeps the two scripts on equal footing without pulling in
// a dictionary segmenter:
//
//   - Latin / digit runs           → lower-cased word tokens, dropping
//                                     single-character tokens and English stop
//                                     words (noise that only inflates length
//                                     normalization). `top_k` → `top` (the lone
//                                     `k` is dropped); queries filter
//                                     identically so matching stays symmetric.
//   - CJK runs (Han, Kana, Hangul) → overlapping character bi- AND tri-grams.
//                                     N-grams are the standard dictionary-free
//                                     CJK indexing unit: `检索治理` → `检索`,
//                                     `索治`,`治理` (bigrams) + `检索治`,`索治理`
//                                     (trigrams). Bigrams give broad overlap;
//                                     trigrams add phrase precision so a doc
//                                     containing the contiguous phrase outranks
//                                     one that merely shares the loose bigrams.
//                                     (C1-W6 port of maestro-flow wiki
//                                     search.ts cjkNgrams n=2..3.)
//
// A length-1 CJK run degrades to a single-character token (no n-gram possible),
// which is the correct degenerate behavior for a lone ideograph; a length-2 run
// emits only its single bigram (no trigram possible).

// Han (incl. Ext-A + compatibility), Hiragana, Katakana, Hangul syllables.
// Kept as a character class string so both the run matcher and the
// single-char classifier stay in lockstep. (Broader than maestro-flow's
// Han-only class on purpose — fabric must not regress JP/KR n-gram support.)
const CJK_CLASS = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\uac00-\\ud7af";

// A token run is EITHER an alphanumeric word OR a maximal run of CJK chars.
// Anything else (punctuation, whitespace, symbols) is a separator and is
// skipped. The alternation order does not matter — the two classes are
// disjoint — but alphanumeric is listed first for readability.
const RUN_RE = new RegExp(`[a-z0-9]+|[${CJK_CLASS}]+`, "gu");
const CJK_FIRST_RE = new RegExp(`[${CJK_CLASS}]`, "u");

// C1-W6: English stop words (maestro-flow wiki search.ts STOP_WORDS). These
// carry no selection signal and only distort BM25F length normalization.
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for",
  "is", "it", "with", "as", "at", "by", "be", "are", "was", "were",
  "this", "that", "from", "but", "not",
]);

// Longest CJK n-gram emitted. Bigrams (broad recall) + trigrams (phrase
// precision); higher n hits diminishing returns and bloats the index.
const MAX_CJK_NGRAM = 3;

/**
 * Tokenize bilingual text into BM25F terms.
 *
 * Latin/digit runs become lower-cased word tokens (single-character tokens and
 * English stop words dropped); CJK runs become overlapping character bi- and
 * tri-grams (singleton for length-1 runs, bigram-only for length-2). Returns
 * terms in document order, including duplicates — callers that need term
 * frequencies count them, callers that need a vocabulary dedupe.
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
        continue;
      }
      for (let n = 2; n <= MAX_CJK_NGRAM; n += 1) {
        if (run.length < n) {
          break;
        }
        for (let i = 0; i + n <= run.length; i += 1) {
          tokens.push(run.slice(i, i + n));
        }
      }
    } else if (run.length >= 2 && !STOP_WORDS.has(run)) {
      tokens.push(run);
    }
  }

  return tokens;
}

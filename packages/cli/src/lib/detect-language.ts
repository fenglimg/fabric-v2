import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Resolved fabric language enum. Mirrors `fabricLanguageSchema` in
 * `@fenglimg/fabric-shared` minus the "match-existing" placeholder — this
 * type is what fixated config stores after auto-detection.
 *
 * rc.23 TASK-012 (F8a): extracted from the deleted `fabric scan` command. The
 * detector is the sole remaining caller — `writeDefaultFabricConfig` invokes
 * it once on a fresh init to fixate `fabric_language` in fabric-config.json.
 */
export type ResolvedLanguage = "en" | "zh-CN" | "zh-CN-hybrid";

/**
 * Heuristic language detection used when `fabric_language` is set to
 * `'match-existing'` (the default).
 *
 * Reads README.md (top-level) and the `docs/` directory (one level deep) and
 * counts characters in the CJK Unified Ideographs range U+4E00..U+9FFF
 * (zh-CN, ja, ko share this block; we treat any CJK-heavy prose as Chinese
 * for v2.0 since Q3 scope explicitly limits us to en + zh-CN).
 *
 * rc.12 broad-gate-fabric-lang: returns `'zh-CN-hybrid'` (NOT pure
 * `'zh-CN'`) when CJK characters account for more than 30 % of the
 * combined CJK + ASCII letter count. The hybrid variant renders Chinese
 * narrative prose while preserving English technical terms verbatim,
 * which is what real-world CJK projects almost always want — pure
 * `'zh-CN'` is intentional opt-in via the config field and is never
 * auto-detected. Otherwise returns `'en'`. An empty repo (no README, no
 * docs/) defaults to `'en'`. The 30 % threshold is deliberately liberal
 * so a short bilingual README with a sizeable zh-CN section still
 * resolves to hybrid; pure-EN docs sit well below it.
 */
export function detectExistingLanguage(target: string): ResolvedLanguage {
  const ZH_CN_RATIO_THRESHOLD = 0.3;
  const samples: string[] = [];

  const readmePath = join(target, "README.md");
  if (existsSync(readmePath)) {
    try {
      samples.push(readFileSync(readmePath, "utf8"));
    } catch {
      // unreadable README — treat as missing
    }
  }

  const docsDir = join(target, "docs");
  if (existsSync(docsDir)) {
    try {
      const stat = statSync(docsDir);
      if (stat.isDirectory()) {
        for (const entry of readdirSync(docsDir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          if (!/\.(md|mdx|txt)$/iu.test(entry.name)) continue;
          try {
            samples.push(readFileSync(join(docsDir, entry.name), "utf8"));
          } catch {
            // skip unreadable doc files
          }
        }
      }
    } catch {
      // unreadable docs/ — treat as absent
    }
  }

  if (samples.length === 0) {
    // Empty-repo default. Documented contract: no README + no docs/ → 'en'.
    return "en";
  }

  let cjkCount = 0;
  let asciiLetterCount = 0;
  for (const sample of samples) {
    for (const ch of sample) {
      const code = ch.codePointAt(0) ?? 0;
      if (code >= 0x4e00 && code <= 0x9fff) {
        cjkCount += 1;
      } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
        asciiLetterCount += 1;
      }
    }
  }

  const denominator = cjkCount + asciiLetterCount;
  if (denominator === 0) {
    return "en";
  }

  const ratio = cjkCount / denominator;
  // rc.12 broad-gate-fabric-lang: CJK signal → 'zh-CN-hybrid' (not 'zh-CN').
  // Real-world CJK projects preserve English technical terms; pure 'zh-CN'
  // is intentional opt-in via the config field, never auto-detected.
  return ratio > ZH_CN_RATIO_THRESHOLD ? "zh-CN-hybrid" : "en";
}

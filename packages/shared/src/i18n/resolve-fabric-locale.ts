import fs from "node:fs";
import path from "node:path";

import { detectNodeLocale } from "./detect-node-locale.js";
import type { Locale } from "./types.js";

/**
 * Resolve the effective runtime locale for a given project root.
 *
 * Resolution order (rc.26 — closes KT-DEC-9004 runtime gap):
 *   1. Read `<projectRoot>/.fabric/fabric-config.json` and inspect
 *      `fabric_language`.
 *   2. If the value is `"en"` or `"zh-CN"` (the two concrete Locale members),
 *      return it verbatim — this is the eager-resolved value `fabric init` is
 *      supposed to write back per KT-DEC-9004.
 *   3. If the value is `"match-existing"` or `"zh-CN-hybrid"` (placeholders
 *      that should NEVER survive `fabric init` per KT-DEC-9004's invariant),
 *      emit a `console.warn` and fall through to `detectNodeLocale()`.
 *   4. If the file is missing, unreadable, malformed JSON, or `fabric_language`
 *      is absent / has any other shape, silently fall through to
 *      `detectNodeLocale()` (env-driven: `FAB_LANG` → `LANG` → `"en"`).
 *
 * Never throws — all failure paths degrade to `detectNodeLocale()`.
 */
export function resolveFabricLocale(projectRoot: string): Locale {
  const configPath = path.join(projectRoot, ".fabric", "fabric-config.json");

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch {
    return detectNodeLocale();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return detectNodeLocale();
  }

  if (typeof parsed !== "object" || parsed === null) {
    return detectNodeLocale();
  }

  const fabricLanguage = (parsed as { fabric_language?: unknown }).fabric_language;

  if (fabricLanguage === "en" || fabricLanguage === "zh-CN") {
    return fabricLanguage;
  }

  if (fabricLanguage === "match-existing" || fabricLanguage === "zh-CN-hybrid") {
    // KT-DEC-9004 invariant: `fabric init` is expected to eager-resolve these
    // placeholders into a concrete Locale ("en" | "zh-CN") and write back to
    // fabric-config.json. Encountering one of them at runtime means either
    // (a) `fabric init` was never run, (b) the user hand-edited the config, or
    // (c) a legacy v1.x config slipped through the v2.0 lenient root parser.
    // Warn loudly and degrade to env detection.
    console.warn(
      `[fabric] fabric_language="${fabricLanguage}" is a pre-init placeholder ` +
        `that should have been resolved during 'fabric init' (KT-DEC-9004). ` +
        `Falling back to FAB_LANG / LANG environment detection.`,
    );
    return detectNodeLocale();
  }

  return detectNodeLocale();
}

import { loadGlobalConfig } from "../store/global-config-io.js";

import { detectNodeLocale } from "./detect-node-locale.js";
import type { Locale } from "./types.js";

/**
 * Resolve the effective runtime locale from the single machine-wide language
 * base tone (grill-6fixes D1).
 *
 * Resolution order:
 *   1. `~/.fabric/fabric-global.json` → `language` (`"zh-CN"` | `"en"`), the
 *      value the install language selector wrote. This governs BOTH CLI
 *      display and knowledge authoring — there is no per-project override.
 *   2. Otherwise fall through to `detectNodeLocale()` (env-driven:
 *      `FAB_LANG` → `LANG` → `"en"`), covering the pre-install window and any
 *      machine where the user never picked a language.
 *
 * Never throws — every failure path degrades to `detectNodeLocale()`.
 */
export function resolveGlobalLocale(globalRoot?: string): Locale {
  try {
    const config = globalRoot === undefined ? loadGlobalConfig() : loadGlobalConfig(globalRoot);
    const language = config?.language;
    if (language === "zh-CN" || language === "en") {
      return language;
    }
  } catch {
    // Unreadable / malformed global config — degrade to env detection.
  }
  return detectNodeLocale();
}

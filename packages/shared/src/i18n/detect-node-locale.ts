import type { Locale } from "./types.js";
import { normalizeLocale } from "./normalize-locale.js";

export function detectNodeLocale(): Locale {
  const fromFabricEnv = process.env.FAB_LANG;
  if (typeof fromFabricEnv === "string" && fromFabricEnv.trim().length > 0) {
    return normalizeLocale(fromFabricEnv);
  }

  const fromLangEnv = process.env.LANG;
  if (typeof fromLangEnv === "string" && fromLangEnv.trim().length > 0) {
    return normalizeLocale(fromLangEnv);
  }

  return "en";
}

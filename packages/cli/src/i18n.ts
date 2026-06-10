import {
  createTranslator,
  resolveGlobalLocale,
  type Translator,
} from "@fenglimg/fabric-shared";

// grill-6fixes (D1): the single machine-wide language base tone governs both
// CLI display AND knowledge authoring. The module-level `locale`/`t` resolve
// from `~/.fabric/fabric-global.json` → `language` (set once by the install
// language selector), falling back to env detection (FAB_LANG → LANG → en)
// before the language is picked. There is no per-project override anymore, so
// `getProjectTranslator` resolves the same global locale — the `projectRoot`
// parameter is retained for call-site compatibility but no longer consulted.
export const locale = resolveGlobalLocale();
export const t = createTranslator(locale);

export function getProjectTranslator(_projectRoot: string = process.cwd()): Translator {
  return createTranslator(resolveGlobalLocale());
}

// Back-compat alias — doctor's existing call site. New code should call
// getProjectTranslator directly.
export function getDoctorTranslator(projectRoot: string): Translator {
  return getProjectTranslator(projectRoot);
}

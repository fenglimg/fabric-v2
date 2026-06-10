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
//
// `locale`/`t` are mutable live bindings (not `const`): the install language
// selector picks the tone mid-run, on a machine where the global config did
// not yet carry `language`, so the initial resolution falls back to env
// detection. `refreshLocale()` re-resolves both after the pick persists, and
// because ES module named imports are live bindings every `import { t }`
// call site immediately renders in the freshly-chosen tone for the rest of
// the process — without it the choice would only take effect on the next run.
export let locale = resolveGlobalLocale();
export let t = createTranslator(locale);

/**
 * Re-resolve the module-level `locale`/`t` from the (now-persisted) global
 * language. Called right after the install language selector writes the pick
 * so the remaining stages/prompts of the SAME install honor it.
 */
export function refreshLocale(): void {
  locale = resolveGlobalLocale();
  t = createTranslator(locale);
}

export function getProjectTranslator(_projectRoot: string = process.cwd()): Translator {
  return createTranslator(resolveGlobalLocale());
}

// Back-compat alias — doctor's existing call site. New code should call
// getProjectTranslator directly.
export function getDoctorTranslator(projectRoot: string): Translator {
  return getProjectTranslator(projectRoot);
}

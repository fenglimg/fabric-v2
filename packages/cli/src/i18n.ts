import {
  createTranslator,
  detectNodeLocale,
  resolveFabricLocale,
  type Translator,
} from "@fenglimg/fabric-shared";

// rc.26 TASK-01 — γ-pattern: the module-level `t` and `locale` exports stay
// based on `detectNodeLocale()` so non-projectRoot consumers (banner/version/
// help and the 6 existing call sites in install/uninstall/serve/config/
// hooks-orchestrator/index) keep their current env-driven behavior. A new
// `getDoctorTranslator(projectRoot)` factory provides projectRoot-aware
// locale resolution for the doctor command per KT-DEC-9004.
export const locale = detectNodeLocale();
export const t = createTranslator(locale);

export function getDoctorTranslator(projectRoot: string): Translator {
  return createTranslator(resolveFabricLocale(projectRoot));
}

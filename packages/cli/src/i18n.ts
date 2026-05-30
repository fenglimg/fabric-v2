import {
  createTranslator,
  detectNodeLocale,
  resolveFabricLocale,
  type Translator,
} from "@fenglimg/fabric-shared";

// rc.26 TASK-01 — γ-pattern: the module-level `t` and `locale` exports stay
// based on `detectNodeLocale()` so non-projectRoot consumers (banner/version/
// help and the install/uninstall/serve/config/hooks-orchestrator/index call
// sites — which run before a project root is known or are deliberately
// env-scoped) keep their current env-driven behavior. The
// `getProjectTranslator(projectRoot)` factory provides projectRoot-aware
// locale resolution (reads `.fabric/fabric-config.json` fabric_language) per
// KT-DEC-9004 for the project-scoped commands that DO have a workspace root.
export const locale = detectNodeLocale();
export const t = createTranslator(locale);

// W3-05 (ISS-033/034): projectRoot-aware translator for project-scoped
// commands (doctor, whoami, store, scope-explain, sync, metrics). Resolves the
// repo's configured fabric_language, falling back to env detection when no
// `.fabric/fabric-config.json` is present. `projectRoot` defaults to the cwd.
export function getProjectTranslator(projectRoot: string = process.cwd()): Translator {
  return createTranslator(resolveFabricLocale(projectRoot));
}

// Back-compat alias — doctor's existing call site. New code should call
// getProjectTranslator directly.
export function getDoctorTranslator(projectRoot: string): Translator {
  return getProjectTranslator(projectRoot);
}

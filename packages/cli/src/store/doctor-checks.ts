import { loadGlobalConfig, resolveGlobalRoot } from "./global-config-io.js";
import { missingRequiredStores } from "./store-ops.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric doctor` multi-store health checks (S10/S51/R5#5).
//
// Pure diagnostic core the doctor command surfaces: no global config, required
// stores declared by the project but not mounted (S51), and local-only stores
// that want a backup remote (R5#5). Read-only; hook/CLI never blocks on these.
// ---------------------------------------------------------------------------

export type StoreDiagnosticCode =
  | "no_global_config"
  | "missing_required_store"
  | "local_only_store";

export interface StoreDiagnostic {
  code: StoreDiagnosticCode;
  severity: "warn" | "info";
  ref?: string;
  message: string;
}

export function storeDoctorChecks(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): StoreDiagnostic[] {
  const diagnostics: StoreDiagnostic[] = [];

  const global = loadGlobalConfig(globalRoot);
  if (global === null) {
    diagnostics.push({
      code: "no_global_config",
      severity: "warn",
      message: "no global Fabric config — run `fabric install --global <url>`",
    });
    return diagnostics;
  }

  for (const missing of missingRequiredStores(projectRoot, globalRoot)) {
    diagnostics.push({
      code: "missing_required_store",
      severity: "warn",
      ref: missing.id,
      message: `required store '${missing.id}' is not mounted; run \`fabric store add\``,
    });
  }

  for (const store of global.stores) {
    if (store.remote === undefined && store.personal !== true) {
      diagnostics.push({
        code: "local_only_store",
        severity: "info",
        ref: store.alias,
        message: `store '${store.alias}' is local-only; add a git remote to back it up`,
      });
    }
  }

  return diagnostics;
}

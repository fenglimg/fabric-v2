import { join } from "node:path";

import { findStoreExecutableViolations, storeRelativePath } from "@fenglimg/fabric-shared";

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
  | "local_only_store"
  | "executable_in_store";

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
    // S65 RCE defense: a mounted store must be data-only. Flag any executable /
    // hook surface smuggled into the store tree (it is NEVER projected/run).
    const violations = findStoreExecutableViolations(join(globalRoot, storeRelativePath(store.store_uuid)));
    if (violations.length > 0) {
      diagnostics.push({
        code: "executable_in_store",
        severity: "warn",
        ref: store.alias,
        message: `store '${store.alias}' contains executable/script files (${violations.slice(0, 3).join(", ")}${violations.length > 3 ? ", …" : ""}) — stores are data-only; Fabric never runs them (S65)`,
      });
    }
  }

  return diagnostics;
}

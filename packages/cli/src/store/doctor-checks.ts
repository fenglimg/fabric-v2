import { join } from "node:path";

import { findStoreExecutableViolations, storeRelativePathForMount } from "@fenglimg/fabric-shared";

import { loadGlobalConfig, resolveGlobalRoot } from "./global-config-io.js";
import { detectAliasLinkDrift, missingRequiredStores, unboundAvailableStores } from "./store-ops.js";

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
  | "unbound_available_store"
  | "local_only_store"
  | "executable_in_store"
  | "store_alias_link_drift"
  // 语义 A (multi-personal): active_personal_store points at a store that is not
  // a mounted personal store (dangling/typo/non-personal) — error.
  | "active_personal_invalid"
  // 语义 A (multi-personal): ≥2 personal stores mounted but no active pointer —
  // the resolver falls back to the first, but the user should pick (info nudge).
  | "active_personal_unset";

export interface StoreDiagnostic {
  code: StoreDiagnosticCode;
  severity: "error" | "warn" | "info";
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
      message: `required store '${missing.id}' is not mounted; run \`fabric store mount\``,
    });
  }

  // Wave A (D4/F3 onboarding nudge): a store is mounted but this project never
  // bound it → its knowledge is invisible to the project read-set. INFO-level
  // reminder (never a gate, KT-DEC-0007): point the user at `store bind`.
  for (const store of unboundAvailableStores(projectRoot, globalRoot)) {
    diagnostics.push({
      code: "unbound_available_store",
      severity: "info",
      ref: store.alias,
      message: `store '${store.alias}' is mounted but not bound to this project; run \`fabric store bind ${store.alias}\` to read its knowledge here (then \`fabric store switch-write ${store.alias}\` to write team knowledge into it)`,
    });
  }

  // C3: by-alias readability links drifted from the registry (missing / wrong
  // target). INFO — `fabric doctor --fix` re-syncs them via syncStoreAliasLinks.
  const aliasDrift = detectAliasLinkDrift(globalRoot);
  if (aliasDrift.length > 0) {
    diagnostics.push({
      code: "store_alias_link_drift",
      severity: "info",
      ref: aliasDrift.join(", "),
      message: `by-alias readability link(s) out of sync for ${aliasDrift.join(", ")}; run \`fabric doctor --fix\` to repair ~/.fabric/stores/by-alias/`,
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
    const violations = findStoreExecutableViolations(join(globalRoot, storeRelativePathForMount(store)));
    if (violations.length > 0) {
      diagnostics.push({
        code: "executable_in_store",
        severity: "warn",
        ref: store.alias,
        message: `store '${store.alias}' contains executable/script files (${violations.slice(0, 3).join(", ")}${violations.length > 3 ? ", …" : ""}) — stores are data-only; Fabric never runs them (S65)`,
      });
    }
  }

  // 语义 A (multi-personal): active_personal_store pointer integrity. An invalid
  // pointer (set but not a mounted personal store) silently mis-routes personal
  // reads/writes via the resolver fallback, so it is an ERROR. ≥2 personal stores
  // with no active pointer is only an INFO nudge (the resolver deterministically
  // falls back to the first; KT-DEC-0007 — nudge, never a gate). `fabric doctor
  // --fix` repairs both via fixActivePersonalPointer. A single personal (the
  // common case) with no pointer is correct and silent.
  const personals = global.stores.filter((store) => store.personal === true);
  const activePersonal = global.active_personal_store;
  if (
    activePersonal !== undefined &&
    !personals.some((p) => p.alias === activePersonal || p.store_uuid === activePersonal)
  ) {
    diagnostics.push({
      code: "active_personal_invalid",
      severity: "error",
      ref: activePersonal,
      message: `active personal store '${activePersonal}' is not a mounted personal store; run \`fabric store switch-personal <alias>\` or \`fabric doctor --fix\``,
    });
  } else if (activePersonal === undefined && personals.length >= 2) {
    diagnostics.push({
      code: "active_personal_unset",
      severity: "info",
      message: `${personals.length} personal stores are mounted but none is active; run \`fabric store switch-personal <alias>\` to pick one (or \`fabric doctor --fix\` to default to the first)`,
    });
  }

  return diagnostics;
}

import { join } from "node:path";

import { findStoreExecutableViolations, storeRelativePathForMount } from "@fenglimg/fabric-shared";

import { getProjectTranslator } from "../i18n.js";
import { assessFirstHitSync, type FirstHitCode } from "./first-hit.js";
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
  | "active_personal_unset"
  // Re-wired borrowed knowledge-health checks (see knowledge-doctor-checks.ts).
  // BORROW-007: a `related` edge points at an id absent from the corpus (warn).
  | "related_graph_broken_link"
  // BORROW-007: most-referenced entries by `related` in-degree (info heatmap).
  | "related_graph_hub"
  // BORROW-019: a read-set store's on-disk directory is missing/corrupt (warn).
  | "store_unreachable"
  // BORROW-005: per-entry consumption heatmap (info, always when data present).
  | "knowledge_consumption_heatmap"
  // BORROW-005: entries never consumed in the window (warn, GATED on data maturity).
  | "knowledge_consumption_zero"
  // M-first-value-loop readiness: empty store / no bind / no write target.
  | "first_hit_unbound"
  | "first_hit_no_write_target"
  | "first_hit_empty_store"
  | "first_hit_no_match"
  | "first_hit_ok";

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
  const t = getProjectTranslator(projectRoot);

  const global = loadGlobalConfig(globalRoot);
  if (global === null) {
    diagnostics.push({
      code: "no_global_config",
      severity: "warn",
      message: t("doctor.store.no-global-config"),
    });
    return diagnostics;
  }

  for (const missing of missingRequiredStores(projectRoot, globalRoot)) {
    diagnostics.push({
      code: "missing_required_store",
      severity: "warn",
      ref: missing.id,
      message: t("doctor.store.missing-required", { id: missing.id }),
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
      message: t("doctor.store.unbound", { alias: store.alias }),
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
      message: t("doctor.store.alias-drift", { refs: aliasDrift.join(", ") }),
    });
  }

  for (const store of global.stores) {
    if (store.remote === undefined && store.personal !== true) {
      diagnostics.push({
        code: "local_only_store",
        severity: "info",
        ref: store.alias,
        message: t("doctor.store.local-only", { alias: store.alias }),
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
        message: t("doctor.store.executable", {
          alias: store.alias,
          files: `${violations.slice(0, 3).join(", ")}${violations.length > 3 ? ", …" : ""}`,
        }),
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
      message: t("doctor.store.active-personal-invalid", { store: activePersonal }),
    });
  } else if (activePersonal === undefined && personals.length >= 2) {
    diagnostics.push({
      code: "active_personal_unset",
      severity: "info",
      message: t("doctor.store.active-personal-unset", { count: String(personals.length) }),
    });
  }

  // First-hit readiness (M-first-value-loop): only the empty-store + hooks gaps
  // that existing store diagnostics do not cover. Unbound / no-write-target are
  // already implied by missing required bind / active_write; surfacing them here
  // would noise healthy "mounted + required" doctor fixtures. Full oracle lives
  // on `fabric first-hit`.
  try {
    const hit = assessFirstHitSync(projectRoot, { globalRoot });
    if (hit.code === "empty_store") {
      const stores =
        hit.bound_stores.map((s) => s.alias).join(", ") || hit.write_target || "—";
      diagnostics.push({
        code: "first_hit_empty_store",
        severity: "warn",
        ref: hit.write_target ?? hit.bound_stores[0]?.alias,
        message: t("doctor.store.empty", { stores }),
      });
    } else if (hit.code === "hooks_missing") {
      diagnostics.push({
        code: "first_hit_unbound",
        severity: "warn",
        ref: hit.write_target ?? undefined,
        message: t("doctor.store.hooks-missing"),
      });
    }
  } catch {
    // Never crash doctor for first-hit assessment.
  }

  return diagnostics;
}

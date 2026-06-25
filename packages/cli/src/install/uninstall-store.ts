import type { FabricConfig } from "@fenglimg/fabric-shared";

import { loadProjectConfig, saveProjectConfig } from "../store/project-config-io.js";
import { resolveStoreByAliasOrUuid } from "../store/store-ops.js";
import { regenerateBindingsSnapshot } from "../store/bindings-io.js";
import { resolveGlobalRoot } from "../store/global-config-io.js";

/**
 * `unbindStoreProject` — the PROJECT-side inverse of
 * {@link ../install/store-project-onboarding.ts `ensureStoreProjectBinding`}.
 *
 * Install's store stage writes the team-slot binding into the project's
 * `.fabric/fabric-config.json`:
 *   - `required_stores`        (the team store entry — `storeBind`)
 *   - `active_write_store` / `default_write_store`  (`storeSwitchWrite`)
 *   - `write_routes` (`project:<id>` scope — `storeSetWriteRoute`)
 *   - `active_project`         (the repo's project coordinate)
 * plus a store-SIDE `projects.json` registration and a resolved-bindings
 * snapshot. This helper reverses ONLY the project-side config writes.
 *
 * Hard scope invariants (locked with the user):
 *   - The global store under `~/.fabric/stores/` is NEVER touched.
 *   - The store's `projects.json` is NEVER touched — it is team-shared data;
 *     removing this repo's project coordinate from it would mutate everyone's
 *     store. We therefore do NOT import any store-mutating op (storeRemove /
 *     addStoreProject / …).
 *   - `project_id` and the config FILE are preserved. `project_id` is the repo's
 *     stable identity (reusable on re-install); clearing it would mint a fresh
 *     coordinate next time. Mirrors install's "create, never destroy" stance.
 *
 * Idempotent + best-effort: a missing / unparseable / already-unbound config
 * returns `status: 'skipped'` and never throws.
 */

export type UnbindStoreStatus = "unbound" | "skipped";

export interface UnbindStoreResult {
  status: UnbindStoreStatus;
  /** Reason for a `skipped` result (no-config / nothing-bound). */
  reason?: string;
  /** Aliases/uuids of the team stores removed from `required_stores`. */
  unboundAliases: string[];
}

export interface UnbindStoreOptions {
  globalRoot?: string;
  /** ISO-8601 timestamp; injected for deterministic snapshot regeneration. */
  now?: string;
}

export function unbindStoreProject(
  projectRoot: string,
  options: UnbindStoreOptions = {},
): UnbindStoreResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();

  let config: FabricConfig | null;
  try {
    config = loadProjectConfig(projectRoot);
  } catch {
    // A legacy / corrupt config that fails the strict parse is left untouched —
    // unbind is best-effort and never the place to repair config drift.
    return { status: "skipped", reason: "config-unreadable", unboundAliases: [] };
  }
  if (config === null) {
    return { status: "skipped", reason: "no-config", unboundAliases: [] };
  }

  // Partition required_stores into personal (always implicit, never bound by
  // install — kept defensively) and team-class (the slot install binds). Only
  // team-class entries are removed. A store that no longer resolves in the
  // global registry is treated as team-class (it was bound, now orphaned) so a
  // stale binding still gets cleared.
  const declared = config.required_stores ?? [];
  const removed: string[] = [];
  const keptRequired = declared.filter((entry) => {
    const store = resolveStoreByAliasOrUuid(entry.id, globalRoot);
    const isPersonal = store?.personal === true;
    if (isPersonal) {
      return true;
    }
    removed.push(entry.id);
    return false;
  });

  const hadProjectScopedRoutes = (config.write_routes ?? []).length > 0;
  const hadWriteTarget =
    config.active_write_store !== undefined || config.default_write_store !== undefined;
  const hadActiveProject = config.active_project !== undefined;

  if (
    removed.length === 0 &&
    !hadProjectScopedRoutes &&
    !hadWriteTarget &&
    !hadActiveProject
  ) {
    return { status: "skipped", reason: "nothing-bound", unboundAliases: [] };
  }

  // Strip every team-side binding field; preserve project_id + everything else
  // (e.g. workspace_binding_id, embed config). `write_routes` only ever route to
  // non-personal writable stores (storeSetWriteRoute guard), so clearing the
  // whole array is consistent with removing the team slot.
  const next: FabricConfig = { ...config };
  if (keptRequired.length > 0) {
    next.required_stores = keptRequired;
  } else {
    delete next.required_stores;
  }
  delete next.active_write_store;
  delete next.default_write_store;
  delete next.write_routes;
  delete next.active_project;

  saveProjectConfig(next, projectRoot);

  // Refresh the resolved-bindings snapshot so `.fabric/state` reflects the now-
  // empty team read-set. Returns null (no-op) when there is no global config or
  // no binding id — both acceptable here; the project config is the source of
  // truth and is already saved.
  regenerateBindingsSnapshot(projectRoot, {
    globalRoot,
    now: options.now ?? new Date().toISOString(),
  });

  return { status: "unbound", unboundAliases: removed };
}

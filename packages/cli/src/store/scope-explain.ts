import {
  createStoreResolver,
  type StoreReadSet,
  type StoreResolveInput,
  type WriteTarget,
} from "@fenglimg/fabric-shared";

import { loadGlobalConfig, resolveGlobalRoot } from "./global-config-io.js";
import { loadProjectConfig } from "./project-config-io.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric scope-explain` (F5 / S21/S53 surfaced in the CLI).
//
// Assembles the StoreResolveInput from the global config (uid + mounted stores)
// + the project config (required_stores + active_write_store), then runs the
// StoreResolver to show the resolved read-set + write-target for a given scope.
// Pure read; no mutation. This is how a user inspects "which stores do I read,
// and where do my writes go for scope X".
// ---------------------------------------------------------------------------

export interface ScopeExplanation {
  scope: string;
  readSet: StoreReadSet;
  writeTarget: WriteTarget | null;
}

// Build the resolver input from the on-disk configs. Returns null when no global
// config exists (the caller guides to `install --global`).
export function buildResolveInput(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): StoreResolveInput | null {
  const global = loadGlobalConfig(globalRoot);
  if (global === null) {
    return null;
  }
  const project = loadProjectConfig(projectRoot);
  return {
    uid: global.uid,
    mountedStores: global.stores.map((s) => ({
      store_uuid: s.store_uuid,
      alias: s.alias,
      ...(s.remote === undefined ? {} : { remote: s.remote }),
      writable: s.writable ?? true,
      personal: s.personal ?? false,
    })),
    requiredStores: (project?.required_stores ?? []).map((r) => ({
      id: r.id,
      ...(r.suggested_remote === undefined ? {} : { suggested_remote: r.suggested_remote }),
    })),
    ...(project?.active_write_store === undefined
      ? {}
      : { activeWriteAlias: project.active_write_store }),
  };
}

export function scopeExplain(
  projectRoot: string,
  scope: string,
  globalRoot: string = resolveGlobalRoot(),
): ScopeExplanation | null {
  const input = buildResolveInput(projectRoot, globalRoot);
  if (input === null) {
    return null;
  }
  const resolver = createStoreResolver();
  return {
    scope,
    readSet: resolver.resolveReadSet(input),
    writeTarget: resolver.resolveWriteTarget(input, scope).target,
  };
}

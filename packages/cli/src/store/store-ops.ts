import {
  addMountedStore,
  detachMountedStore,
  explainStore,
  type GlobalConfig,
  type MountedStore,
  type StoreExplain,
} from "@fenglimg/fabric-shared";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfig } from "./global-config-io.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric store {list,add,remove,explain}` orchestration.
//
// Thin load → mutate (shared lifecycle core) → save wrappers, parameterized on
// `globalRoot` so they integration-test against an isolated FABRIC_HOME. The
// citty command (commands/store.ts) is a presentation-only shell over these.
// `remove` is detach (E4): it never deletes the store's on-disk git tree.
// ---------------------------------------------------------------------------

const NO_GLOBAL_CONFIG =
  "no global Fabric config found — run `fabric install --global <url>` first";

function requireConfig(globalRoot: string): GlobalConfig {
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    throw new Error(NO_GLOBAL_CONFIG);
  }
  return config;
}

export function storeList(globalRoot: string = resolveGlobalRoot()): MountedStore[] {
  return requireConfig(globalRoot).stores;
}

export function storeAdd(
  store: MountedStore,
  globalRoot: string = resolveGlobalRoot(),
): GlobalConfig {
  const next = addMountedStore(requireConfig(globalRoot), store);
  saveGlobalConfig(next, globalRoot);
  return next;
}

export function storeRemove(
  alias: string,
  globalRoot: string = resolveGlobalRoot(),
): { config: GlobalConfig; detached: MountedStore | null } {
  const result = detachMountedStore(requireConfig(globalRoot), alias);
  saveGlobalConfig(result.config, globalRoot);
  return result;
}

export function storeExplain(
  alias: string,
  globalRoot: string = resolveGlobalRoot(),
): StoreExplain | null {
  return explainStore(requireConfig(globalRoot), alias);
}

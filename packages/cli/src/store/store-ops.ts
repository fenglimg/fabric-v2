import {
  addMountedStore,
  bindRequiredStore,
  detachMountedStore,
  explainStore,
  type FabricConfig,
  type GlobalConfig,
  type MountedStore,
  type RequiredStoreEntry,
  type StoreExplain,
} from "@fenglimg/fabric-shared";

import { loadGlobalConfig, resolveGlobalRoot, saveGlobalConfig } from "./global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "./project-config-io.js";

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

const NO_PROJECT_CONFIG =
  "no project Fabric config — run `fabric install` in this repo first";

function requireProjectConfig(projectRoot: string): FabricConfig {
  const config = loadProjectConfig(projectRoot);
  if (config === null) {
    throw new Error(NO_PROJECT_CONFIG);
  }
  return config;
}

// `fabric store bind <id>`: declare a required store on the PROJECT config
// (drives the read-set + clone onboarding). Dedupes by id (S59).
export function storeBind(
  projectRoot: string,
  entry: RequiredStoreEntry,
): FabricConfig {
  const config = requireProjectConfig(projectRoot);
  const next: FabricConfig = {
    ...config,
    required_stores: bindRequiredStore(config.required_stores ?? [], entry),
  };
  saveProjectConfig(next, projectRoot);
  return next;
}

// `fabric store switch-write <alias>`: set the project's active write store for
// non-personal scopes (S60). Personal-scope writes are unaffected (R5#3).
export function storeSwitchWrite(projectRoot: string, alias: string): FabricConfig {
  const config = requireProjectConfig(projectRoot);
  const next: FabricConfig = { ...config, active_write_store: alias };
  saveProjectConfig(next, projectRoot);
  return next;
}

// Clone-onboarding guidance core (S51): which of this project's required_stores
// are NOT mounted in the global registry. After `git clone` of a Fabric project
// the CLI runs this to guide the user to `fabric store add` the missing stores.
// Empty global config ⇒ every required store is missing (nothing mounted yet).
export function missingRequiredStores(
  projectRoot: string,
  globalRoot: string = resolveGlobalRoot(),
): RequiredStoreEntry[] {
  const project = loadProjectConfig(projectRoot);
  if (project === null || project.required_stores === undefined) {
    return [];
  }
  const global = loadGlobalConfig(globalRoot);
  const mounted = new Set(
    (global?.stores ?? []).flatMap((s) => [s.alias, s.store_uuid]),
  );
  return project.required_stores.filter((r) => !mounted.has(r.id));
}

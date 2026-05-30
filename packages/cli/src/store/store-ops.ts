import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  addMountedStore,
  bindRequiredStore,
  detachMountedStore,
  explainStore,
  initStore,
  storeRelativePath,
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

// ADJ-NEWN-5 (v2.1 dogfood): create a brand-new LOCAL store + mount it.
//
// Wave0 found there was no CLI path to birth a fresh store: `install --global`
// only mints the personal store, `install --global --url` clones an EXISTING
// remote, and `store add` merely registers an already-on-disk store. The first
// team store therefore had to be hand-rolled (git init + the internal initStore
// symbol). This wraps that into a first-class command: mint an intrinsic uuid
// (S55 identity-is-intrinsic), scaffold the store tree via initStore (git), and
// mount it into the registry. `now`/`uuid` are injectable for deterministic
// tests; production mints them.
export interface StoreCreateResult {
  config: GlobalConfig;
  store_uuid: string;
  storeDir: string;
}

export function storeCreate(
  alias: string,
  now: string,
  options: { uuid?: string; remote?: string; git?: boolean; globalRoot?: string } = {},
): StoreCreateResult {
  const globalRoot = options.globalRoot ?? resolveGlobalRoot();
  // requireConfig first: refuse to create before `install --global` (no uid).
  const config = requireConfig(globalRoot);
  const uuid = options.uuid ?? randomUUID();
  const storeDir = join(globalRoot, storeRelativePath(uuid));

  initStore(
    storeDir,
    { store_uuid: uuid, created_at: now, canonical_alias: alias },
    { git: options.git },
  );

  const mounted: MountedStore =
    options.remote === undefined
      ? { store_uuid: uuid, alias }
      : { store_uuid: uuid, alias, remote: options.remote };
  const next = addMountedStore(config, mounted);
  saveGlobalConfig(next, globalRoot);
  return { config: next, store_uuid: uuid, storeDir };
}

// ADJ-NEWN-6 (v2.1 dogfood): refuse a "phantom mount". `store add` previously
// wrote the registry entry even when no store tree existed on disk for that
// uuid — the failure only surfaced later when `fabric sync` crashed on a
// non-existent cwd (spawnSync git ENOENT). This guard moves the failure to
// `add` time: the store directory must already exist on disk (cloned via
// `fabric install --global --url <remote>` or created locally). Pure existence
// check so the I/O edge (commands/store.ts) stays testable.
export function assertStoreMountable(
  uuid: string,
  globalRoot: string = resolveGlobalRoot(),
): void {
  const storeDir = join(globalRoot, storeRelativePath(uuid));
  if (!existsSync(join(storeDir, "store.json"))) {
    throw new Error(
      `cannot mount store ${uuid}: no store tree at ${storeDir} — ` +
        `clone it first (\`fabric install --global --url <remote>\`) or create it locally, ` +
        `then re-run \`fabric store add\`. Refusing to register a phantom store.`,
    );
  }
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

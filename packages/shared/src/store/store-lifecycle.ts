import type { GlobalConfig, MountedStore, RequiredStoreEntry } from "../schemas/store.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — Store lifecycle config core (pure transforms).
//
// The testable heart of `fabric store add / remove / bind / switch-write /
// explain` (S57/E4/S7). These functions mutate CONFIG OBJECTS only — the CLI
// command wrappers handle the surrounding I/O (clone the remote, write the
// config, etc.). Keeping the logic pure makes the lifecycle deterministically
// testable and keeps git/fs side effects at the edges.
//
// detach ≠ delete (E4): `detachMountedStore` removes a store from the mounted
// registry but NEVER implies deleting the store's on-disk git tree — that is a
// separate, explicit destructive op the CLI must gate behind confirmation.
// ---------------------------------------------------------------------------

export function findMountedStore(config: GlobalConfig, aliasOrUuid: string): MountedStore | undefined {
  return config.stores.find((s) => s.alias === aliasOrUuid || s.store_uuid === aliasOrUuid);
}

// Add (or idempotently update) a mounted store. Throws when the alias is already
// taken by a DIFFERENT store (alias collisions are a config error, not a silent
// overwrite). Re-adding the same store_uuid updates its alias/remote in place.
export function addMountedStore(config: GlobalConfig, store: MountedStore): GlobalConfig {
  const aliasClash = config.stores.find(
    (s) => s.alias === store.alias && s.store_uuid !== store.store_uuid,
  );
  if (aliasClash !== undefined) {
    throw new Error(
      `alias '${store.alias}' already mounts store ${aliasClash.store_uuid}; choose another alias`,
    );
  }
  const existing = config.stores.find((s) => s.store_uuid === store.store_uuid);
  const stores =
    existing === undefined
      ? [...config.stores, store]
      : config.stores.map((s) => (s.store_uuid === store.store_uuid ? store : s));
  return { ...config, stores };
}

// Detach a store from the registry (E4: NOT a delete — on-disk tree untouched).
// Returns the new config plus the detached entry (null when alias not mounted).
export function detachMountedStore(
  config: GlobalConfig,
  alias: string,
): { config: GlobalConfig; detached: MountedStore | null } {
  const detached = config.stores.find((s) => s.alias === alias) ?? null;
  if (detached === null) {
    return { config, detached: null };
  }
  return {
    config: { ...config, stores: config.stores.filter((s) => s.alias !== alias) },
    detached,
  };
}

// Bind (or idempotently update) a required-store entry on a PROJECT config's
// `required_stores` list (dedupe by id). Pure list transform.
export function bindRequiredStore(
  required: RequiredStoreEntry[],
  entry: RequiredStoreEntry,
): RequiredStoreEntry[] {
  return required.some((r) => r.id === entry.id)
    ? required.map((r) => (r.id === entry.id ? entry : r))
    : [...required, entry];
}

// Human-readable explanation of how an alias resolves (S7 `store explain`).
export interface StoreExplain {
  alias: string;
  store_uuid: string;
  remote: string | null;
  // No git remote configured — doctor nudges to add one for backup (R5#5).
  local_only: boolean;
}

export function explainStore(config: GlobalConfig, alias: string): StoreExplain | null {
  const store = findMountedStore(config, alias);
  if (store === undefined) {
    return null;
  }
  return {
    alias: store.alias,
    store_uuid: store.store_uuid,
    remote: store.remote ?? null,
    local_only: store.remote === undefined,
  };
}

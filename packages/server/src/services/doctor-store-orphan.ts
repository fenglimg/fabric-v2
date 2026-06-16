import { readdirSync } from "node:fs";
import { join } from "node:path";

import {
  STORES_ROOT_DIR,
  addMountedStore,
  disambiguateAlias,
  loadGlobalConfig,
  readStoreIdentity,
  resolveGlobalRoot,
  saveGlobalConfig,
  type GlobalConfig,
  type Translator,
} from "@fenglimg/fabric-shared";

import type { DoctorCheck } from "./doctor.js";

// ---------------------------------------------------------------------------
// Store-orphan detection (store-onboarding grill, Q5).
//
// An "orphan" is a store directory present on disk under
// `~/.fabric/stores/<group>/<mount_name>/` (with a valid store.json) whose
// intrinsic store_uuid is NOT registered in the global config. Such a store is
// invisible to recall / bind — the exact residue the pre-fix
// `mountStoreFromRemote` left behind when its rename onto a pre-existing target
// failed (ENOTEMPTY). The robust mount path (uuid-based adopt) prevents NEW
// orphans; this check surfaces any that already exist, and `--fix` ADOPTS them
// (re-registers — rescue-before-delete, never an on-disk delete).
//
// Read-only; never throws (a multi-store hiccup degrades to "no orphans
// observable", never crashes doctor). Mirrors the doctor-store-counters.ts
// store-access pattern.
// ---------------------------------------------------------------------------

// `by-alias` is the readability symlink layer (store-ops.ts), not a store group.
const STORE_BY_ALIAS_DIR = "by-alias";

export interface StoreOrphan {
  store_uuid: string;
  dir: string; // absolute store directory
  group: string; // `personal` | `team` bucket
  mount_name: string;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// Scan the stores root for directories holding a valid store.json whose uuid is
// absent from the registry. [] when there is no global config / nothing on disk.
export function inspectStoreOrphans(globalRoot: string = resolveGlobalRoot()): StoreOrphan[] {
  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    return [];
  }
  const registered = new Set(config.stores.map((s) => s.store_uuid));
  const storesRoot = join(globalRoot, STORES_ROOT_DIR);
  const orphans: StoreOrphan[] = [];

  for (const group of listDir(storesRoot)) {
    if (group === STORE_BY_ALIAS_DIR) {
      continue;
    }
    const groupDir = join(storesRoot, group);
    for (const mount of listDir(groupDir)) {
      const dir = join(groupDir, mount);
      const identity = readStoreIdentity(dir);
      if (identity === null || registered.has(identity.store_uuid)) {
        continue;
      }
      orphans.push({ store_uuid: identity.store_uuid, dir, group, mount_name: mount });
    }
  }
  return orphans;
}

// Adopt every on-disk orphan into the registry (re-register; the on-disk tree is
// never touched). Alias is derived from the store's canonical_alias, auto-
// disambiguated against the live registry (S55 — uuid is the real identity).
// Returns the orphans that were adopted. Used by `doctor --fix`. Best-effort: a
// single un-adoptable orphan (alias/mount_name clash that survives
// disambiguation) is skipped, never aborts the pass.
export function fixStoreOrphans(globalRoot: string = resolveGlobalRoot()): StoreOrphan[] {
  let config: GlobalConfig | null = loadGlobalConfig(globalRoot);
  if (config === null) {
    return [];
  }
  const adopted: StoreOrphan[] = [];
  for (const orphan of inspectStoreOrphans(globalRoot)) {
    const identity = readStoreIdentity(orphan.dir);
    if (identity === null || config === null) {
      continue;
    }
    const desiredAlias = identity.canonical_alias ?? orphan.group;
    const alias = disambiguateAlias(
      config.stores.map((s) => s.alias),
      desiredAlias,
    );
    const personal = orphan.group === "personal";
    try {
      config = addMountedStore(config, {
        store_uuid: identity.store_uuid,
        alias,
        mount_name: orphan.mount_name,
        ...(personal ? { personal: true } : {}),
      });
      saveGlobalConfig(config, globalRoot);
      adopted.push(orphan);
    } catch {
      // alias/mount_name clash disambiguation couldn't resolve — skip, never abort.
    }
  }
  return adopted;
}

// Warning-kind check: an on-disk store invisible to the registry. Fixable —
// `doctor --fix` adopts it (re-registers), so the warning clears without any
// destructive action.
export function createStoreOrphanCheck(t: Translator, orphans: StoreOrphan[]): DoctorCheck {
  if (orphans.length > 0) {
    const first = orphans[0];
    const count = orphans.length;
    return {
      name: t("doctor.check.store_orphan.name"),
      status: "warn",
      kind: "warning",
      code: "store_orphan",
      fixable: true,
      message: t(`doctor.check.store_orphan.message.${count === 1 ? "singular" : "plural"}`, {
        count: String(count),
        detail: `${first.group}/${first.mount_name} (${first.store_uuid})`,
      }),
      actionHint: t("doctor.check.store_orphan.remediation"),
    };
  }
  return {
    name: t("doctor.check.store_orphan.name"),
    status: "ok",
    message: t("doctor.check.store_orphan.ok"),
  };
}

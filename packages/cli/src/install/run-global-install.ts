import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  STORES_ROOT_DIR,
  addMountedStore,
  readStoreIdentity,
  storeMountNameSchema,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";
import { GenericIOError } from "@fenglimg/fabric-shared/errors";

import {
  loadGlobalConfig,
  resolveGlobalRoot,
  saveGlobalConfig,
} from "../store/global-config-io.js";
import { deriveUid } from "../store/uid.js";
import { syncStoreAliasLinks } from "../store/store-ops.js";
import { installGlobalCore } from "./install-global.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric install --global [<url>]` orchestration.
//
// 1. Transactional global setup (uid + personal store + global config) via
//    installGlobalCore (idempotent).
// 2. If a <url> is given, clone that shared store and mount it (read its
//    intrinsic store_uuid from the cloned store.json — never derive identity
//    from the remote, S55).
//
// The uid / personalStoreUuid / now are injectable for deterministic tests;
// production derives them from git + crypto + the clock.
// ---------------------------------------------------------------------------

export interface RunGlobalInstallOptions {
  url?: string;
  uid?: string;
  personalStoreUuid?: string;
  now?: string;
}

function gitClone(url: string, dest: string): void {
  // ISS-031: announce the clone so `fabric install --global <url>` is not silent
  // during a slow network fetch, and inherit git's stderr so its native progress
  // bar (and, on failure, its real diagnostic — ISS-032) reaches the user.
  console.log(`cloning store from ${url} (this may take a while)…`);
  try {
    // `--` terminates option parsing so an option-like url (e.g. `--upload-pack=…`,
    // `-x`, `ext::sh -c …`) is treated as a positional repo argument, never as a
    // git option (ISS-002 arg-injection hardening).
    execFileSync("git", ["clone", "--", url, dest], { stdio: ["ignore", "ignore", "inherit"] });
  } catch (error) {
    // ISS-037: git's own diagnostic was just printed (inherited stderr); add the
    // actionable next step so the failure is not a bare "Command failed".
    throw new GenericIOError(`git clone of ${url} failed`, {
      actionHint:
        "check the url is reachable and points to a Fabric store git repo (the git error above shows the cause), then re-run `fabric install --global <url>`",
      details: error,
    });
  }
}

// W1 (install --url top-level): exported so `fabric install --url=<remote>` can
// reuse the exact clone+mount path (the per-repo flow then binds the returned
// store to the project + sets it as the write target). Returns the mounted
// store's intrinsic identity so the caller never re-derives it from the remote.
export function mountStoreFromRemote(url: string, globalRoot: string): { store_uuid: string; alias: string } {
  const storesRoot = join(globalRoot, STORES_ROOT_DIR);
  mkdirSync(storesRoot, { recursive: true });

  const tmp = mkdtempSync(join(tmpdir(), "fabric-clone-"));
  const cloneDest = join(tmp, "store");
  gitClone(url, cloneDest);

  const identity = readStoreIdentity(cloneDest);
  if (identity === null) {
    // ISS-037: a successful clone of a repo that is not a Fabric store.
    throw new GenericIOError(`cloned store at ${url} has no valid store.json (not a Fabric store)`, {
      actionHint:
        "verify the url points to a repository created by `fabric` (it must contain a store.json at its root); if you meant to mount a different store, re-run with the correct url",
    });
  }

  const alias = identity.canonical_alias ?? "team";
  const mount_name = storeMountNameSchema.safeParse(alias).success ? alias : identity.store_uuid;
  const finalDir = join(globalRoot, storeRelativePathForMount({ store_uuid: identity.store_uuid, mount_name }));
  renameSync(cloneDest, finalDir);

  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    // ISS-037: internal invariant — the global config should exist by now.
    throw new GenericIOError("global config missing after install", {
      actionHint:
        "re-run `fabric install --global` to (re)create the global config, then retry mounting the store; if it persists, inspect ~/.fabric for a partial install",
    });
  }
  saveGlobalConfig(
    addMountedStore(config, { store_uuid: identity.store_uuid, alias, mount_name, remote: url }),
    globalRoot,
  );
  syncStoreAliasLinks(globalRoot);
  console.log(`mounted store '${alias}' (${identity.store_uuid}) from ${url}`);
  return { store_uuid: identity.store_uuid, alias };
}

export async function runGlobalInstall(
  options: RunGlobalInstallOptions = {},
  globalRoot: string = resolveGlobalRoot(),
): Promise<void> {
  const uid = options.uid ?? deriveUid();
  const personalStoreUuid = options.personalStoreUuid ?? randomUUID();
  const now = options.now ?? new Date().toISOString();

  const result = await installGlobalCore({ globalRoot, uid, personalStoreUuid, now });
  if (!result.receipt.ok) {
    // ISS-037: surface which step failed with a concrete remedy instead of a
    // bare internal step name.
    throw new GenericIOError(
      `global install failed at step '${result.receipt.failedStep}': ${result.receipt.error}`,
      {
        actionHint:
          "check write permissions and free space under ~/.fabric, then re-run `fabric install --global` (the install is transactional and rolls back partial state)",
      },
    );
  }
  console.log(
    result.alreadyInstalled
      ? "global Fabric already installed"
      : `installed global Fabric (uid ${uid})`,
  );

  if (options.url !== undefined) {
    mountStoreFromRemote(options.url, globalRoot);
  }

  // C3: materialize the by-alias readability links for the freshly-minted
  // personal store (+ any cloned store). Best-effort — never blocks install.
  syncStoreAliasLinks(globalRoot);
}

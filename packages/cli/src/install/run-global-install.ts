import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STORES_ROOT_DIR, addMountedStore, readStoreIdentity } from "@fenglimg/fabric-shared";

import {
  loadGlobalConfig,
  resolveGlobalRoot,
  saveGlobalConfig,
} from "../store/global-config-io.js";
import { deriveUid } from "../store/uid.js";
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
  execFileSync("git", ["clone", url, dest], { stdio: ["ignore", "ignore", "pipe"] });
}

function mountStoreFromRemote(url: string, globalRoot: string): void {
  const storesRoot = join(globalRoot, STORES_ROOT_DIR);
  mkdirSync(storesRoot, { recursive: true });

  const tmp = mkdtempSync(join(tmpdir(), "fabric-clone-"));
  const cloneDest = join(tmp, "store");
  gitClone(url, cloneDest);

  const identity = readStoreIdentity(cloneDest);
  if (identity === null) {
    throw new Error(`cloned store at ${url} has no valid store.json (not a Fabric store)`);
  }

  const finalDir = join(storesRoot, identity.store_uuid);
  renameSync(cloneDest, finalDir);

  const config = loadGlobalConfig(globalRoot);
  if (config === null) {
    throw new Error("global config missing after install");
  }
  const alias = identity.canonical_alias ?? "team";
  saveGlobalConfig(
    addMountedStore(config, { store_uuid: identity.store_uuid, alias, remote: url }),
    globalRoot,
  );
  console.log(`mounted store '${alias}' (${identity.store_uuid}) from ${url}`);
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
    throw new Error(`global install failed at step '${result.receipt.failedStep}': ${result.receipt.error}`);
  }
  console.log(
    result.alreadyInstalled
      ? "global Fabric already installed"
      : `installed global Fabric (uid ${uid})`,
  );

  if (options.url !== undefined) {
    mountStoreFromRemote(options.url, globalRoot);
  }
}

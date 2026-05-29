import { rmSync } from "node:fs";
import { join } from "node:path";

import {
  STORES_ROOT_DIR,
  globalConfigSchema,
  initStore,
  type GlobalConfig,
} from "@fenglimg/fabric-shared";

import { globalConfigPath, loadGlobalConfig, saveGlobalConfig } from "../store/global-config-io.js";
import { runInstallTransaction, type InstallReceipt } from "./transaction.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric install --global` core (S1/S4/S8/S24/S28).
//
// First-touch global setup: mint the machine `uid`, init the implicit personal
// store under ~/.fabric/stores/<uuid>/, and write the global config — all under
// the install transaction so a mid-setup failure rolls back cleanly (no half
// global state). Idempotent: a second run with an existing global config is a
// no-op. The MCP-client registration + cloning a team store from a remote are
// handled by the surrounding `install` command (existing flow / `store add`);
// this is the multi-store global-state core they build on.
//
// `uid` and `personalStoreUuid` are injected (the command derives uid from
// `git config user.email` and mints the uuid via crypto.randomUUID) so this
// core stays deterministic + testable against an isolated HOME.
// ---------------------------------------------------------------------------

export interface InstallGlobalOptions {
  globalRoot: string;
  uid: string;
  personalStoreUuid: string;
  personalAlias?: string;
  // ISO-8601 store.json created_at.
  now: string;
  // git init the personal store (default true; false for pure-fs tests).
  git?: boolean;
}

export interface InstallGlobalResult {
  receipt: InstallReceipt;
  config: GlobalConfig | null;
  alreadyInstalled: boolean;
}

export async function installGlobalCore(
  options: InstallGlobalOptions,
): Promise<InstallGlobalResult> {
  const existing = loadGlobalConfig(options.globalRoot);
  if (existing !== null) {
    return {
      receipt: { ok: true, steps: [{ name: "already-installed", status: "applied" }] },
      config: existing,
      alreadyInstalled: true,
    };
  }

  const alias = options.personalAlias ?? "personal";
  const personalDir = join(options.globalRoot, STORES_ROOT_DIR, options.personalStoreUuid);
  let config: GlobalConfig | null = null;

  const receipt = await runInstallTransaction([
    {
      name: "init-personal-store",
      apply: () => {
        initStore(
          personalDir,
          {
            store_uuid: options.personalStoreUuid,
            created_at: options.now,
            canonical_alias: alias,
          },
          { git: options.git },
        );
      },
      rollback: () => {
        rmSync(personalDir, { recursive: true, force: true });
      },
    },
    {
      name: "write-global-config",
      apply: () => {
        const next = globalConfigSchema.parse({
          uid: options.uid,
          stores: [{ store_uuid: options.personalStoreUuid, alias, personal: true }],
        });
        saveGlobalConfig(next, options.globalRoot);
        config = next;
      },
      rollback: () => {
        rmSync(globalConfigPath(options.globalRoot), { force: true });
      },
    },
  ]);

  return { receipt, config, alreadyInstalled: false };
}

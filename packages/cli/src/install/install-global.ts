import { rmSync } from "node:fs";
import { join } from "node:path";

import { globalConfigSchema, initStore, storeRelativePathForMount, type GlobalConfig } from "@fenglimg/fabric-shared";

import { globalConfigPath, loadGlobalConfig, mutateGlobalConfig } from "../store/global-config-io.js";
import { GLOBAL_POLICY_DEFAULTS } from "./install-scaffold-config.js";
import { runInstallTransaction, type InstallReceipt } from "./transaction.js";

// ---------------------------------------------------------------------------
// v2.1.0-rc.1 P3 — `fabric install --global` core (S1/S4/S8/S24/S28).
//
// First-touch global setup: mint the machine `uid`, init the implicit personal
// store under ~/.fabric/stores/<uuid>/, and write the global config — all under
// the install transaction so a mid-setup failure rolls back cleanly (no half
// global state). Idempotent: a second run with an existing global config is a
// no-op. The MCP-client registration + cloning a team store from a remote are
// handled by the surrounding `install` command (existing flow / `store mount`);
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

/**
 * config-single-home W6/W9 — make sure the shipped policy defaults exist.
 *
 * W5 seeded `defaults` only when the global config was CREATED, so every machine
 * that already had one silently kept the library defaults: the install banner
 * promised `nudge_mode: minimal` while the runtime resolved `normal`. Seeding
 * has to run on the ordinary `fabric install` path too, not just the
 * first-ever-global one — which is why this lives here as its own step rather
 * than inline in installGlobalCore's already-installed branch.
 *
 * Narrow on purpose: seeds ONLY when the whole `defaults` segment is missing.
 * A user who tuned it, or who deliberately emptied it to `{}`, is left alone —
 * "present but empty" is a choice, "absent" is a config predating the segment.
 *
 * Returns the updated config, or null when nothing needed seeding.
 */
export async function ensurePolicyDefaults(globalRoot: string): Promise<GlobalConfig | null> {
  const existing = loadGlobalConfig(globalRoot);
  if (existing === null || existing.defaults !== undefined) {
    return null;
  }
  return mutateGlobalConfig(
    // Re-check inside the lock: a concurrent install may have seeded it between
    // the read above and acquiring the lock.
    (current) =>
      current === null || current.defaults !== undefined
        ? null
        : { ...current, defaults: { ...GLOBAL_POLICY_DEFAULTS } },
    globalRoot,
  );
}

export async function installGlobalCore(
  options: InstallGlobalOptions,
): Promise<InstallGlobalResult> {
  const existing = loadGlobalConfig(options.globalRoot);
  if (existing !== null) {
    // config-single-home W6 — seed the policy defaults onto an ALREADY-EXISTING
    // global config too. W5 seeded them only in the create branch below, so every
    // machine that had a global config before the upgrade (i.e. every existing
    // user) silently kept the library defaults and never received the shipped
    // ones — the redesign's "defaults live in the global config" was true for
    // fresh installs only.
    //
    // Deliberately narrow: seeds ONLY when the whole `defaults` segment is
    // absent, and never merges into a segment the user already has.
    const seeded = (await ensurePolicyDefaults(options.globalRoot)) ?? existing;
    return {
      receipt: {
        ok: true,
        steps: [
          { name: "already-installed", status: "applied" },
          ...(existing.defaults === undefined
            ? [{ name: "seed-policy-defaults", status: "applied" as const }]
            : []),
        ],
      },
      config: seeded ?? existing,
      alreadyInstalled: true,
    };
  }

  const alias = options.personalAlias ?? "personal";
  const personalStore = {
    store_uuid: options.personalStoreUuid,
    alias,
    mount_name: alias,
    personal: true,
  };
  const personalDir = join(options.globalRoot, storeRelativePathForMount(personalStore));
  let config: GlobalConfig | null = null;

  const receipt = await runInstallTransaction([
    {
      name: "init-personal-store",
      apply: async () => {
        await initStore(
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
      apply: async () => {
        // config-single-home W1: the `existing !== null` early-return at the top
        // of installGlobalCore runs before the store init, so re-assert it inside
        // the lock. When a concurrent install won the race, adopt ITS config
        // rather than overwriting (the mutator returns null → no write).
        const persisted = await mutateGlobalConfig(
          (current) =>
            current ??
            globalConfigSchema.parse({
              uid: options.uid,
              stores: [personalStore],
              // config-single-home W5: the shipped policy defaults live here now
              // (the repo config is identity-only). Seeded ONLY on first-time
              // creation — the `current ??` branch above means an existing config
              // is never touched, so a user's edits are safe.
              defaults: { ...GLOBAL_POLICY_DEFAULTS },
            }),
          options.globalRoot,
        );
        config = persisted;
      },
      rollback: () => {
        rmSync(globalConfigPath(options.globalRoot), { force: true });
      },
    },
  ]);

  return { receipt, config, alreadyInstalled: false };
}

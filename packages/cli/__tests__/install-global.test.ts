import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recognizeStoreDir } from "@fenglimg/fabric-shared";

import { loadGlobalConfig, mutateGlobalConfig } from "../src/store/global-config-io.js";
import { ensurePolicyDefaults, installGlobalCore } from "../src/install/install-global.js";
import { GLOBAL_POLICY_DEFAULTS } from "../src/install/install-scaffold-config.js";

// v2.1.0-rc.1 P3 — `install --global` core: transactional global setup
// (uid + personal store + global config), idempotent, isolated HOME.

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function isolatedGlobalRoot(): string {
  const home = mkdtempSync(join(tmpdir(), "fabric-install-global-"));
  dirs.push(home);
  return join(home, ".fabric");
}

describe("P3 install --global core", () => {
  it("mints uid, inits the personal store, and writes the global config", async () => {
    const globalRoot = isolatedGlobalRoot();
    const result = await installGlobalCore({
      globalRoot,
      uid: "u-derived",
      personalStoreUuid: PERSONAL,
      now: "2026-05-30T00:00:00.000Z",
    });

    expect(result.receipt.ok).toBe(true);
    expect(result.alreadyInstalled).toBe(false);
    expect(result.config?.uid).toBe("u-derived");

    // Personal store is a recognizable v2.1 store on disk.
    const personalDir = join(globalRoot, "stores", "personal", "personal");
    expect(recognizeStoreDir(personalDir)).toBe(true);
    expect(existsSync(join(personalDir, ".git"))).toBe(true);

    // Global config persisted with the personal store mounted.
    expect(loadGlobalConfig(globalRoot)?.stores[0]?.alias).toBe("personal");
    expect(loadGlobalConfig(globalRoot)?.stores[0]?.mount_name).toBe("personal");
  });

  it("is idempotent on a second run (no-op)", async () => {
    const globalRoot = isolatedGlobalRoot();
    const opts = {
      globalRoot,
      uid: "u-derived",
      personalStoreUuid: PERSONAL,
      now: "2026-05-30T00:00:00.000Z",
    };
    await installGlobalCore(opts);
    const second = await installGlobalCore(opts);
    expect(second.alreadyInstalled).toBe(true);
    expect(second.receipt.ok).toBe(true);
  });
});

// config-single-home W6 — the UPGRADE path for the shipped policy defaults.
//
// W5 seeded `defaults` only in the create branch, so every machine that already
// had a global config (i.e. every existing user) kept the library defaults
// forever: `nudge_mode` stayed `normal` where the shipped intent was `minimal`.
// Seeding is deliberately narrow — whole-segment-absent only — so a user who
// tuned or emptied `defaults` is never overwritten.
describe("W6 install --global: policy defaults reach an existing global config", () => {
  const opts = (globalRoot: string) => ({
    globalRoot,
    uid: "u-derived",
    personalStoreUuid: PERSONAL,
    now: "2026-05-30T00:00:00.000Z",
  });

  it("seeds `defaults` onto a pre-existing config that lacks the segment", async () => {
    const globalRoot = isolatedGlobalRoot();
    await installGlobalCore(opts(globalRoot));
    // Simulate a config written before W5 introduced the segment.
    await mutateGlobalConfig((current) => {
      const { defaults: _dropped, ...rest } = current as Record<string, unknown>;
      return rest as never;
    }, globalRoot);
    expect(loadGlobalConfig(globalRoot)?.defaults).toBeUndefined();

    const result = await installGlobalCore(opts(globalRoot));

    expect(result.alreadyInstalled).toBe(true);
    expect(loadGlobalConfig(globalRoot)?.defaults).toEqual({ ...GLOBAL_POLICY_DEFAULTS });
    expect(result.receipt.steps.map((s) => s.name)).toContain("seed-policy-defaults");
  });

  it("never overwrites a `defaults` segment the user already has", async () => {
    const globalRoot = isolatedGlobalRoot();
    await installGlobalCore(opts(globalRoot));
    await mutateGlobalConfig(
      (current) => ({ ...(current as never), defaults: { nudge_mode: "verbose" } }),
      globalRoot,
    );

    const result = await installGlobalCore(opts(globalRoot));

    expect(loadGlobalConfig(globalRoot)?.defaults).toEqual({ nudge_mode: "verbose" });
    expect(result.receipt.steps.map((s) => s.name)).not.toContain("seed-policy-defaults");
  });

  it("leaves an intentionally-emptied `defaults` empty (present ≠ absent)", async () => {
    const globalRoot = isolatedGlobalRoot();
    await installGlobalCore(opts(globalRoot));
    await mutateGlobalConfig((current) => ({ ...(current as never), defaults: {} }), globalRoot);

    await installGlobalCore(opts(globalRoot));

    expect(loadGlobalConfig(globalRoot)?.defaults).toEqual({});
  });

  // W9: the seeding was originally reachable ONLY through installGlobalCore,
  // which the ordinary per-repo `fabric install` does not call once a global
  // config exists — so on a real machine it never ran. `ensurePolicyDefaults`
  // is the standalone step the install stages call; these pin its contract
  // directly, independent of who happens to invoke it.
  it("ensurePolicyDefaults seeds a config missing the segment and reports the write", async () => {
    const globalRoot = isolatedGlobalRoot();
    await installGlobalCore(opts(globalRoot));
    await mutateGlobalConfig((current) => {
      const { defaults: _dropped, ...rest } = current as Record<string, unknown>;
      return rest as never;
    }, globalRoot);

    const seeded = await ensurePolicyDefaults(globalRoot);

    expect(seeded?.defaults).toEqual({ ...GLOBAL_POLICY_DEFAULTS });
    expect(loadGlobalConfig(globalRoot)?.defaults).toEqual({ ...GLOBAL_POLICY_DEFAULTS });
  });

  it("ensurePolicyDefaults is a no-op (returns null) when the segment exists", async () => {
    const globalRoot = isolatedGlobalRoot();
    await installGlobalCore(opts(globalRoot));

    expect(await ensurePolicyDefaults(globalRoot)).toBeNull();
    // …and on a home with no global config at all.
    expect(await ensurePolicyDefaults(isolatedGlobalRoot())).toBeNull();
  });
});

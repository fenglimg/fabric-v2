import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recognizeStoreDir } from "@fenglimg/fabric-shared";

import { loadGlobalConfig } from "../src/store/global-config-io.js";
import { installGlobalCore } from "../src/install/install-global.js";

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

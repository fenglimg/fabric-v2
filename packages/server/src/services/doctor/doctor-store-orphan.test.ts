import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTranslator,
  globalConfigSchema,
  initStore,
  loadGlobalConfig,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import {
  createStoreOrphanCheck,
  fixStoreOrphans,
  inspectStoreOrphans,
  type StoreOrphan,
} from "./doctor-store-orphan.js";

const NOW = "2026-06-16T00:00:00.000Z";
const ORPHAN_UUID = "99999999-9999-4999-8999-999999999999";
const REGISTERED_UUID = "88888888-8888-4888-8888-888888888888";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function newGlobalRoot(): string {
  const root = join(mkdtempSync(join(tmpdir(), "fabric-orphan-")), ".fabric");
  dirs.push(root);
  // A valid (but store-less) global config so loadGlobalConfig !== null.
  saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test", stores: [] }), root);
  return root;
}

// Scaffold a real on-disk store tree under stores/<group>/<mount_name>/.
async function scaffoldStore(
  globalRoot: string,
  uuid: string,
  mountName: string,
  personal = false,
): Promise<void> {
  const dir = join(
    globalRoot,
    storeRelativePathForMount({ store_uuid: uuid, mount_name: mountName, personal }),
  );
  await initStore(dir, { store_uuid: uuid, created_at: NOW, canonical_alias: "team" }, { git: false });
}

describe("createStoreOrphanCheck", () => {
  const t = createTranslator("en");

  it("renders ok when there are no orphans", () => {
    const check = createStoreOrphanCheck(t, []);
    expect(check.status).toBe("ok");
    expect(check.kind).toBeUndefined();
    expect(check.code).toBeUndefined();
  });

  it("renders an orphan as a fixable warning", () => {
    const orphan: StoreOrphan = {
      store_uuid: ORPHAN_UUID,
      dir: "/x/stores/team/fabric-team-synthetic",
      group: "team",
      mount_name: "fabric-team-synthetic",
    };
    const check = createStoreOrphanCheck(t, [orphan]);
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("store_orphan");
    expect(check.fixable).toBe(true);
    expect(check.message).toContain("fabric-team-synthetic");
    expect(check.actionHint).toContain("fabric doctor --fix");
  });
});

describe("store-orphan detection + adopt round-trip (KT-PIT-0014)", () => {
  it("detects an on-disk store missing from the registry", async () => {
    const globalRoot = newGlobalRoot();
    await scaffoldStore(globalRoot, ORPHAN_UUID, "fabric-team-synthetic");

    const orphans = inspectStoreOrphans(globalRoot);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]?.store_uuid).toBe(ORPHAN_UUID);
    expect(orphans[0]?.group).toBe("team");
  });

  it("does NOT flag a store that is already in the registry", async () => {
    const globalRoot = newGlobalRoot();
    await scaffoldStore(globalRoot, REGISTERED_UUID, "fabric-team-knowledge");
    const cfg = loadGlobalConfig(globalRoot)!;
    saveGlobalConfig(
      {
        ...cfg,
        stores: [
          { store_uuid: REGISTERED_UUID, alias: "team", mount_name: "fabric-team-knowledge" },
        ],
      },
      globalRoot,
    );

    expect(inspectStoreOrphans(globalRoot)).toHaveLength(0);
  });

  it("--fix adopts the orphan (re-register) and the re-scan is clean", async () => {
    const globalRoot = newGlobalRoot();
    await scaffoldStore(globalRoot, ORPHAN_UUID, "fabric-team-synthetic");
    // producer: an orphan is present.
    expect(inspectStoreOrphans(globalRoot)).toHaveLength(1);

    // consumer: --fix adopts it into the registry…
    const adopted = fixStoreOrphans(globalRoot);
    expect(adopted.map((o) => o.store_uuid)).toEqual([ORPHAN_UUID]);
    expect(loadGlobalConfig(globalRoot)?.stores.some((s) => s.store_uuid === ORPHAN_UUID)).toBe(true);

    // …and the orphan no longer shows up (round-trip closes — no false-green).
    expect(inspectStoreOrphans(globalRoot)).toHaveLength(0);
  });

  it("auto-disambiguates the adopted alias when it collides with a registered store", async () => {
    const globalRoot = newGlobalRoot();
    // A registered store already owns alias "team".
    await scaffoldStore(globalRoot, REGISTERED_UUID, "fabric-team-knowledge");
    const cfg = loadGlobalConfig(globalRoot)!;
    saveGlobalConfig(
      {
        ...cfg,
        stores: [
          { store_uuid: REGISTERED_UUID, alias: "team", mount_name: "fabric-team-knowledge" },
        ],
      },
      globalRoot,
    );
    // The orphan's canonical_alias is also "team" → adopt must pick a free alias.
    await scaffoldStore(globalRoot, ORPHAN_UUID, "fabric-team-synthetic");

    fixStoreOrphans(globalRoot);
    const stores = loadGlobalConfig(globalRoot)?.stores ?? [];
    const adopted = stores.find((s) => s.store_uuid === ORPHAN_UUID);
    expect(adopted).toBeDefined();
    expect(adopted?.alias).not.toBe("team"); // disambiguated (e.g. team-2)
    // both stores remain registered with distinct aliases.
    expect(new Set(stores.map((s) => s.alias)).size).toBe(stores.length);
  });
});

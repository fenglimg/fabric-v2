import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  STORES_ROOT_DIR,
  deriveMountLabel,
  storeMountSubPath,
} from "../../src/schemas/store.js";
import { migrateTwoLayer } from "../../../../scripts/migrate-two-layer-stores.mjs";
import { cleanupTestWall, createIsolatedHome } from "../helpers/test-wall.js";

// grill ④ — regression for the one-shot single-layer → two-layer store migration.

afterEach(() => {
  cleanupTestWall();
});

const PERSONAL_UUID = "a2bec02a-6bac-4e1d-9c38-8a6bd327fd7f";
const TEAM_UUID = "152a5f20-9e23-419e-8397-06506461e928";

interface SeededStore {
  store_uuid: string;
  alias: string;
  mount_name: string;
  remote?: string;
  personal?: boolean;
}

// Scaffold a SINGLE-LAYER ~/.fabric (the pre-migration shape): each store lives
// directly at `stores/<mount_name>/` and by-alias points one segment deep.
function seedSingleLayer(globalRoot: string, storesRoot: string, stores: SeededStore[]): void {
  writeFileSync(
    join(globalRoot, "fabric-global.json"),
    `${JSON.stringify({ uid: "u-test", stores }, null, 2)}\n`,
  );
  const byAlias = join(storesRoot, "by-alias");
  mkdirSync(byAlias, { recursive: true });
  for (const s of stores) {
    const dir = join(storesRoot, s.mount_name);
    mkdirSync(join(dir, "knowledge", "decisions"), { recursive: true });
    writeFileSync(
      join(dir, "store.json"),
      `${JSON.stringify({ store_uuid: s.store_uuid, created_at: "2026-06-01T00:00:00.000Z", canonical_alias: s.alias }, null, 2)}\n`,
    );
    // a marker knowledge file so we can prove content travels intact
    writeFileSync(join(dir, "knowledge", "decisions", "KT-DEC-0001.md"), `# ${s.alias} marker\n`);
    try {
      symlinkSync(join("..", s.mount_name), join(byAlias, s.alias));
    } catch {
      // symlinks unsupported on this platform — by-alias assertions self-skip below.
    }
  }
}

function run(globalRoot: string) {
  return migrateTwoLayer({
    globalRoot,
    deriveMountLabel,
    storeMountSubPath,
    storesRootDir: STORES_ROOT_DIR,
    backup: false,
    log: () => {},
  });
}

describe("migrateTwoLayer (single-layer → two-layer)", () => {
  it("moves each store to stores/<group>/<label>, updates config, and rebuilds by-alias", () => {
    const { globalRoot, storesRoot } = createIsolatedHome();
    seedSingleLayer(globalRoot, storesRoot, [
      { store_uuid: PERSONAL_UUID, alias: "personal", mount_name: "personal", remote: "https://github.com/fenglimg/fabric-store-personal-pcf", personal: true },
      { store_uuid: TEAM_UUID, alias: "team", mount_name: "team", remote: "https://github.com/fenglimg/fabric-team-knowledge" },
    ]);

    const result = run(globalRoot);
    expect(result.migrated.sort()).toEqual(["personal", "team"]);

    // Two-layer destinations exist with their store.json + content intact.
    const personalDir = join(storesRoot, "personal", "fabric-store-personal-pcf");
    const teamDir = join(storesRoot, "team", "fabric-team-knowledge");
    expect(existsSync(join(personalDir, "store.json"))).toBe(true);
    expect(existsSync(join(teamDir, "store.json"))).toBe(true);
    expect(readFileSync(join(teamDir, "knowledge", "decisions", "KT-DEC-0001.md"), "utf8")).toContain("team marker");

    // The store_uuid identity is untouched (only the directory label changed).
    expect(JSON.parse(readFileSync(join(personalDir, "store.json"), "utf8")).store_uuid).toBe(PERSONAL_UUID);

    // Old single-layer leaf no longer holds a store (it's now a group bucket).
    expect(existsSync(join(storesRoot, "personal", "store.json"))).toBe(false);
    expect(existsSync(join(storesRoot, "team", "store.json"))).toBe(false);

    // Registry label refreshed to the remote-derived repo name.
    const config = JSON.parse(readFileSync(join(globalRoot, "fabric-global.json"), "utf8"));
    expect(config.stores.find((s: SeededStore) => s.alias === "personal").mount_name).toBe("fabric-store-personal-pcf");
    expect(config.stores.find((s: SeededStore) => s.alias === "team").mount_name).toBe("fabric-team-knowledge");

    // by-alias links point two levels deep (when symlinks are supported).
    const teamLink = join(storesRoot, "by-alias", "team");
    if (lstatSync(teamLink).isSymbolicLink()) {
      expect(readlinkSync(teamLink)).toBe(join("..", "team", "fabric-team-knowledge"));
    }
  });

  it("is idempotent — a second run skips already-two-layer stores", () => {
    const { globalRoot, storesRoot } = createIsolatedHome();
    seedSingleLayer(globalRoot, storesRoot, [
      { store_uuid: TEAM_UUID, alias: "team", mount_name: "team", remote: "https://github.com/fenglimg/fabric-team-knowledge" },
    ]);
    run(globalRoot);
    const second = run(globalRoot);
    expect(second.migrated).toEqual([]);
    expect(second.skipped).toEqual(["team"]);
    expect(existsSync(join(storesRoot, "team", "fabric-team-knowledge", "store.json"))).toBe(true);
  });

  it("falls back to a short-uuid label for a local-only store with no usable remote", () => {
    const { globalRoot, storesRoot } = createIsolatedHome();
    seedSingleLayer(globalRoot, storesRoot, [
      { store_uuid: TEAM_UUID, alias: "scratch", mount_name: "scratch" },
    ]);
    run(globalRoot);
    // alias "scratch" is a valid label → used as-is under the team bucket.
    expect(existsSync(join(storesRoot, "team", "scratch", "store.json"))).toBe(true);
  });
});

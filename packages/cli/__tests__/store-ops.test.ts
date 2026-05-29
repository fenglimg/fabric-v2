import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { storeAdd, storeExplain, storeList, storeRemove } from "../src/store/store-ops.js";

// v2.1.0-rc.1 P3 — `fabric store {list,add,remove,explain}` integration tests
// against an isolated global root (no FABRIC_HOME / real ~/.fabric touched).

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const dirs: string[] = [];
let globalRoot: string;

beforeEach(() => {
  const home = mkdtempSync(join(tmpdir(), "fabric-store-ops-"));
  dirs.push(home);
  globalRoot = join(home, ".fabric");
  // Seed an installed global config (uid minted by `install --global`).
  saveGlobalConfig(globalConfigSchema.parse({ uid: "u-test" }), globalRoot);
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("fabric store add/list", () => {
  it("adds a store and persists it to the global config", () => {
    storeAdd({ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }, globalRoot);
    expect(storeList(globalRoot)).toHaveLength(1);
    // Persisted: a fresh load sees it.
    expect(loadGlobalConfig(globalRoot)?.stores[0]?.alias).toBe("team");
  });

  it("rejects an alias collision against a different store", () => {
    storeAdd({ store_uuid: TEAM, alias: "team" }, globalRoot);
    expect(() => storeAdd({ store_uuid: PLATFORM, alias: "team" }, globalRoot)).toThrow(
      /alias 'team' already mounts/,
    );
  });
});

describe("fabric store remove (detach ≠ delete, E4)", () => {
  it("detaches from the registry and reports the on-disk tree is intact", () => {
    storeAdd({ store_uuid: TEAM, alias: "team" }, globalRoot);
    const { detached } = storeRemove("team", globalRoot);
    expect(detached?.store_uuid).toBe(TEAM);
    expect(storeList(globalRoot)).toHaveLength(0);
  });
});

describe("fabric store explain", () => {
  it("explains a store and flags local-only", () => {
    storeAdd({ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }, globalRoot);
    storeAdd({ store_uuid: PLATFORM, alias: "platform" }, globalRoot);
    expect(storeExplain("team", globalRoot)?.local_only).toBe(false);
    expect(storeExplain("platform", globalRoot)?.local_only).toBe(true);
    expect(storeExplain("ghost", globalRoot)).toBeNull();
  });
});

describe("no global config", () => {
  it("guides to `install --global` when the config is absent", () => {
    const fresh = join(mkdtempSync(join(tmpdir(), "fabric-store-empty-")), ".fabric");
    dirs.push(fresh);
    expect(() => storeList(fresh)).toThrow(/install --global/);
  });
});

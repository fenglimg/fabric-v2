import { describe, expect, it } from "vitest";

import { globalConfigSchema, type GlobalConfig } from "../../src/schemas/store.js";
import {
  addMountedStore,
  bindRequiredStore,
  detachMountedStore,
  explainStore,
  findMountedStore,
} from "../../src/store/store-lifecycle.js";

// v2.1.0-rc.1 P3 — store lifecycle config-core unit tests (S57/E4/S7).

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function baseConfig(): GlobalConfig {
  return globalConfigSchema.parse({
    uid: "u-abc",
    stores: [{ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }],
  });
}

describe("P3 store lifecycle — add", () => {
  it("adds a new mounted store", () => {
    const next = addMountedStore(baseConfig(), { store_uuid: PLATFORM, alias: "platform" });
    expect(next.stores).toHaveLength(2);
    expect(findMountedStore(next, "platform")?.store_uuid).toBe(PLATFORM);
  });

  it("idempotently updates the same store_uuid in place", () => {
    const next = addMountedStore(baseConfig(), {
      store_uuid: TEAM,
      alias: "team",
      remote: "git@h:team-new.git",
    });
    expect(next.stores).toHaveLength(1);
    expect(findMountedStore(next, "team")?.remote).toBe("git@h:team-new.git");
  });

  it("rejects an alias collision against a different store", () => {
    expect(() =>
      addMountedStore(baseConfig(), { store_uuid: PLATFORM, alias: "team" }),
    ).toThrow(/alias 'team' already mounts/);
  });
});

describe("P3 store lifecycle — detach ≠ delete (E4)", () => {
  it("removes from the registry and returns the detached entry", () => {
    const { config, detached } = detachMountedStore(baseConfig(), "team");
    expect(detached?.store_uuid).toBe(TEAM);
    expect(config.stores).toHaveLength(0);
  });

  it("is a no-op for an unknown alias", () => {
    const { config, detached } = detachMountedStore(baseConfig(), "nope");
    expect(detached).toBeNull();
    expect(config.stores).toHaveLength(1);
  });
});

describe("P3 store lifecycle — bind + explain", () => {
  it("binds a required store and dedupes by id", () => {
    const r1 = bindRequiredStore([], { id: "team", suggested_remote: "git@h:team.git" });
    const r2 = bindRequiredStore(r1, { id: "team", suggested_remote: "git@h:team-2.git" });
    expect(r2).toHaveLength(1);
    expect(r2[0].suggested_remote).toBe("git@h:team-2.git");
  });

  it("explains a mounted store and flags local-only", () => {
    const cfg = addMountedStore(baseConfig(), { store_uuid: PLATFORM, alias: "platform" });
    expect(explainStore(cfg, "team")?.local_only).toBe(false);
    expect(explainStore(cfg, "platform")?.local_only).toBe(true);
    expect(explainStore(cfg, "ghost")).toBeNull();
  });
});

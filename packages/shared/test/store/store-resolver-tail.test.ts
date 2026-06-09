import { describe, expect, it } from "vitest";

import { createStoreResolver } from "../../src/resolver/store-resolver.js";
import type { StoreResolveInput } from "../../src/resolver/contracts.js";

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function input(overrides: Partial<StoreResolveInput> = {}): StoreResolveInput {
  return {
    uid: "u-test",
    mountedStores: [
      { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM, alias: "team", remote: "git@h:team.git", personal: false, writable: true },
      { store_uuid: PLATFORM, alias: "platform", remote: "git@h:platform.git", personal: false, writable: true },
    ],
    requiredStores: [{ id: "team" }],
    activeWriteAlias: "team",
    writeRoutes: [],
    ...overrides,
  };
}

describe("StoreResolver read-set/write-target edge cases", () => {
  it("does not resolve a non-personal write target outside the project read-set", () => {
    const resolver = createStoreResolver();
    const resolved = resolver.resolveWriteTarget(
      input({ activeWriteAlias: "platform" }),
      "team",
    );

    expect(resolved.target).toBeNull();
    expect(resolved.warnings).toEqual([
      expect.objectContaining({ code: "alias_unresolved", ref: "platform" }),
    ]);
  });

  it("maps required_stores suggested_remote=$personal to the implicit personal store", () => {
    const readSet = createStoreResolver().resolveReadSet(
      input({ requiredStores: [{ id: "p", suggested_remote: "$personal" }] }),
    );

    expect(readSet.stores).toEqual([
      { store_uuid: PERSONAL, alias: "personal", writable: true },
    ]);
    expect(readSet.warnings).toEqual([]);
  });

  it("deduplicates alias and UUID declarations for the same required store", () => {
    const readSet = createStoreResolver().resolveReadSet(
      input({ requiredStores: [{ id: "team" }, { id: TEAM }] }),
    );

    expect(readSet.stores.filter((store) => store.store_uuid === TEAM)).toHaveLength(1);
    expect(readSet.stores.map((store) => store.alias)).toEqual(["team", "personal"]);
  });
});

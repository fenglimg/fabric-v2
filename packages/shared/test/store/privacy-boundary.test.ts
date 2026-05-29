import { describe, expect, it } from "vitest";

import { isPersonalLeakIntoSharedStore } from "../../src/store/cross-store-lint.js";
import { createStoreResolver } from "../../src/resolver/store-resolver.js";
import type { StoreResolveInput } from "../../src/resolver/contracts.js";

// v2.1.0-rc.1 P5 — R5#3 privacy boundary: personal knowledge must NEVER enter a
// shared store. Two enforcement layers, both asserted here:
//   1. Write guard — a personal-layer entry targeted at a shared store is blocked.
//   2. Resolver routing — personal-scope writes resolve to the personal store,
//      never a shared one (the boundary is structural, not just a late check).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const input: StoreResolveInput = {
  uid: "u-test",
  mountedStores: [
    { store_uuid: PERSONAL, alias: "personal", writable: true, personal: true },
    { store_uuid: TEAM, alias: "team", remote: "git@h:team.git", writable: true, personal: false },
  ],
  requiredStores: [{ id: "team" }],
  activeWriteAlias: "team",
};

describe("R5#3 privacy boundary — personal never enters a shared store", () => {
  it("BLOCKS a personal-layer entry written into a shared store (negative)", () => {
    expect(isPersonalLeakIntoSharedStore("personal", "shared")).toBe(true);
  });

  it("allows team→shared, personal→personal, team→personal", () => {
    expect(isPersonalLeakIntoSharedStore("team", "shared")).toBe(false);
    expect(isPersonalLeakIntoSharedStore("personal", "personal")).toBe(false);
    expect(isPersonalLeakIntoSharedStore("team", "personal")).toBe(false);
  });

  it("resolver routes a personal-scope write to the personal store, never the shared one", () => {
    const resolver = createStoreResolver();
    const { target } = resolver.resolveWriteTarget(input, "personal");
    expect(target?.alias).toBe("personal");
    expect(target?.store_uuid).toBe(PERSONAL);
    // The shared team store is NEVER the personal-scope write target.
    expect(target?.store_uuid).not.toBe(TEAM);
  });

  it("a non-personal (team) scope write lands in the shared active write store", () => {
    const resolver = createStoreResolver();
    const { target } = resolver.resolveWriteTarget(input, "team");
    expect(target?.alias).toBe("team");
  });
});

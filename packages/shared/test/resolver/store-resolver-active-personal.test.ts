import { describe, expect, it } from "vitest";

import type { StoreResolveInput } from "../../src/resolver/contracts.js";
import { createStoreResolver } from "../../src/resolver/store-resolver.js";

// ---------------------------------------------------------------------------
// Multi-personal store + switch active (语义 A: singleton-at-a-time).
//
// The whole feature rides on ONE choke point — store-resolver.findPersonal —
// which drives BOTH read-set inclusion (personalEntry) AND the personal-scope
// write-target. With multiple `personal:true` stores mounted, the resolver must
// select the ACTIVE one (input.activePersonalAlias), falling back to the first
// mounted personal when the pointer is absent or dangling. Non-active personal
// stores are NEVER in the read-set (they are not declared in required_stores),
// so only the active personal ever surfaces.
// ---------------------------------------------------------------------------

const P1 = {
  store_uuid: "uuid-p1",
  alias: "personal",
  writable: true,
  personal: true,
} as const;

const P2 = {
  store_uuid: "uuid-p2",
  alias: "personal-work",
  writable: true,
  personal: true,
} as const;

function input(
  mountedStores: ReadonlyArray<typeof P1 | typeof P2>,
  activePersonalAlias?: string,
): StoreResolveInput {
  return {
    uid: "u-test",
    mountedStores: mountedStores.map((s) => ({ ...s })),
    requiredStores: [],
    writeRoutes: [],
    ...(activePersonalAlias === undefined ? {} : { activePersonalAlias }),
  } as StoreResolveInput;
}

const resolver = createStoreResolver();

describe("store-resolver active personal selection", () => {
  it("(a) active pointer selects that personal for both read-set and personal write", () => {
    const got = input([P1, P2], "personal-work");
    expect(resolver.resolveWriteTarget(got, "personal").target?.alias).toBe("personal-work");
    const readUuids = resolver.resolveReadSet(got).stores.map((s) => s.store_uuid);
    expect(readUuids).toContain("uuid-p2");
    expect(readUuids).not.toContain("uuid-p1");
  });

  it("(b) no active pointer falls back to the first mounted personal", () => {
    const got = input([P1, P2]);
    expect(resolver.resolveWriteTarget(got, "personal").target?.alias).toBe("personal");
    expect(resolver.resolveReadSet(got).stores.map((s) => s.store_uuid)).toContain("uuid-p1");
  });

  it("(c) dangling active pointer falls back to the first mounted personal", () => {
    const got = input([P1, P2], "does-not-exist");
    expect(resolver.resolveWriteTarget(got, "personal").target?.alias).toBe("personal");
    expect(resolver.resolveReadSet(got).stores.map((s) => s.store_uuid)).toContain("uuid-p1");
  });

  it("(d) back-compat: single personal, no pointer → that personal", () => {
    const got = input([P1]);
    expect(resolver.resolveWriteTarget(got, "personal").target?.alias).toBe("personal");
    expect(resolver.resolveReadSet(got).stores.map((s) => s.store_uuid)).toEqual(["uuid-p1"]);
  });

  it("active pointer may also match by store_uuid", () => {
    const got = input([P1, P2], "uuid-p2");
    expect(resolver.resolveWriteTarget(got, "personal").target?.alias).toBe("personal-work");
  });
});

import { afterEach, describe, expect, it } from "vitest";

import { createStoreResolver } from "../../src/resolver/store-resolver.js";
import type { StoreResolveInput } from "../../src/resolver/contracts.js";
import {
  bindingsSnapshotPath,
  readBindingsSnapshot,
  writeBindingsSnapshot,
} from "../../src/store/bindings.js";
import { cleanupTestWall, createIsolatedHome } from "../helpers/test-wall.js";

// v2.1.0-rc.1 P3 — bindings snapshot generation + consistency with the resolver
// (P3→P4 dependency chain; done_when: "bindings/<id>_resolved.json 生成且与
// resolver 解析一致").

afterEach(() => {
  cleanupTestWall();
});

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT = "11111111-1111-4111-8111-111111111111";

const resolveInput: StoreResolveInput = {
  uid: "u-abc",
  mountedStores: [
    { store_uuid: PERSONAL, alias: "personal", writable: true, personal: true },
    { store_uuid: TEAM, alias: "team", remote: "git@h:r.git", writable: true, personal: false },
  ],
  requiredStores: [{ id: "team" }],
  activeWriteAlias: "team",
};

describe("P3 bindings snapshot", () => {
  it("generates a snapshot that matches the resolver's own resolution", () => {
    const home = createIsolatedHome();
    const snapshot = writeBindingsSnapshot({
      globalRoot: home.globalRoot,
      projectId: PROJECT,
      resolveInput,
      writeScope: "team",
      now: "2026-05-30T00:00:00.000Z",
    });

    // Snapshot must equal what the resolver produces from the same inputs.
    const resolver = createStoreResolver();
    expect(snapshot.read_set).toEqual(resolver.resolveReadSet(resolveInput));
    expect(snapshot.write_target).toEqual(
      resolver.resolveWriteTarget(resolveInput, "team").target,
    );
    expect(snapshot.project_id).toBe(PROJECT);
  });

  it("round-trips through disk and is readable by hooks", () => {
    const home = createIsolatedHome();
    writeBindingsSnapshot({
      globalRoot: home.globalRoot,
      projectId: PROJECT,
      resolveInput,
      writeScope: "team",
      now: "2026-05-30T00:00:00.000Z",
    });

    const onDisk = readBindingsSnapshot(home.globalRoot, PROJECT);
    expect(onDisk?.write_target?.alias).toBe("team");
    expect(onDisk?.read_set.stores.map((s) => s.alias).sort()).toEqual(["personal", "team"]);
    expect(bindingsSnapshotPath(home.globalRoot, PROJECT)).toContain(`${PROJECT}_resolved.json`);
  });

  it("returns null for a missing snapshot (hooks degrade harmlessly)", () => {
    const home = createIsolatedHome();
    expect(readBindingsSnapshot(home.globalRoot, "no-such-project")).toBeNull();
  });
});

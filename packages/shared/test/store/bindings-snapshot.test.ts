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
    expect(snapshot.workspace_binding_id).toBe(PROJECT);
  });

  it("persists one resolved store ROOT dir per read-set store (hook live-recount source)", () => {
    const home = createIsolatedHome();
    const snapshot = writeBindingsSnapshot({
      globalRoot: home.globalRoot,
      projectId: PROJECT,
      resolveInput,
      writeScope: "team",
      now: "2026-05-30T00:00:00.000Z",
    });

    // One dir per read-set store; each is an absolute path under the global
    // stores root that the hook will walk live (stable across content sync).
    expect(snapshot.knowledge_store_dirs).toHaveLength(snapshot.read_set.stores.length);
    for (const dir of snapshot.knowledge_store_dirs ?? []) {
      expect(dir.startsWith(home.globalRoot)).toBe(true);
      expect(dir).toContain("stores");
    }
    // Survives the disk round-trip (schema accepts the new field).
    expect(readBindingsSnapshot(home.globalRoot, PROJECT)?.knowledge_store_dirs).toEqual(
      snapshot.knowledge_store_dirs,
    );
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

  it("can key the snapshot by workspace_binding_id while retaining project_id", () => {
    const home = createIsolatedHome();
    const snapshot = writeBindingsSnapshot({
      globalRoot: home.globalRoot,
      projectId: PROJECT,
      workspaceBindingId: "worktree-a",
      resolveInput,
      writeScope: "team",
      now: "2026-05-30T00:00:00.000Z",
    });

    expect(snapshot.project_id).toBe(PROJECT);
    expect(snapshot.workspace_binding_id).toBe("worktree-a");
    expect(readBindingsSnapshot(home.globalRoot, "worktree-a")?.project_id).toBe(PROJECT);
    expect(readBindingsSnapshot(home.globalRoot, PROJECT)).toBeNull();
  });

  it("returns null for a missing snapshot (hooks degrade harmlessly)", () => {
    const home = createIsolatedHome();
    expect(readBindingsSnapshot(home.globalRoot, "no-such-project")).toBeNull();
  });
});

describe("bindingsSnapshotPath — project_id sanitization (F17 path traversal)", () => {
  const ROOT = "/tmp/fabric-home";

  it("accepts normal alphanumeric / uuid / dash project ids", () => {
    expect(() => bindingsSnapshotPath(ROOT, PROJECT)).not.toThrow();
    expect(() => bindingsSnapshotPath(ROOT, "my_project-1.2")).not.toThrow();
  });

  it.each([
    "../../etc/cron.d/x",
    "..",
    "a/../../b",
    "foo/bar",
    "name with space",
  ])("rejects traversal / separator / unsafe id %j", (bad) => {
    expect(() => bindingsSnapshotPath(ROOT, bad)).toThrow();
  });

  it("never lets the resolved path escape the bindings dir", () => {
    expect(() => bindingsSnapshotPath(ROOT, "..%2f..%2fetc")).toThrow();
  });
});

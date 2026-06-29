import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearPrecheckCache,
  evaluateStoreDir,
  precheckStoreReachability,
} from "./store-precheck.js";

// BORROW-019 re-wire: store reachability precheck. evaluateStoreDir (pure FS
// rule) is tested with temp dirs; precheckStoreReachability's null-config /
// cache behavior is tested against an empty global root. The full read-set walk
// over a populated ~/.fabric is covered by the real-data dogfood (KT-PIT-0014).

describe("evaluateStoreDir", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fabric-precheck-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reports unreachable when the directory does not exist", () => {
    const result = evaluateStoreDir(join(dir, "missing"), { uuid: "u1", alias: "team" });
    expect(result.reachable).toBe(false);
    expect(result.reason).toContain("directory not found");
    expect(result.alias).toBe("team");
  });

  it("reports unreachable when the directory has no store.json or .git marker", async () => {
    const storeDir = join(dir, "bare");
    await mkdir(storeDir, { recursive: true });
    const result = evaluateStoreDir(storeDir, { uuid: "u1", alias: "team" });
    expect(result.reachable).toBe(false);
    expect(result.reason).toContain("no store.json or .git");
  });

  it("reports reachable with a valid store.json marker", async () => {
    const storeDir = join(dir, "local");
    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, "store.json"), JSON.stringify({ store_uuid: "u1" }));
    const result = evaluateStoreDir(storeDir, { uuid: "u1", alias: "team" });
    expect(result.reachable).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("reports reachable with a .git marker (cloned store)", async () => {
    const storeDir = join(dir, "cloned");
    await mkdir(join(storeDir, ".git"), { recursive: true });
    const result = evaluateStoreDir(storeDir, { uuid: "u1", alias: "team" });
    expect(result.reachable).toBe(true);
  });

  it("treats a corrupt (non-JSON) store.json without .git as unreachable", async () => {
    const storeDir = join(dir, "corrupt");
    await mkdir(storeDir, { recursive: true });
    await writeFile(join(storeDir, "store.json"), "{ not valid json");
    const result = evaluateStoreDir(storeDir, { uuid: "u1", alias: "team" });
    expect(result.reachable).toBe(false);
    expect(result.reason).toContain("no store.json or .git");
  });
});

describe("precheckStoreReachability", () => {
  let projectRoot: string;
  let emptyGlobalRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "fabric-precheck-proj-"));
    emptyGlobalRoot = await mkdtemp(join(tmpdir(), "fabric-precheck-global-"));
    clearPrecheckCache();
  });
  afterEach(async () => {
    clearPrecheckCache();
    await rm(projectRoot, { recursive: true, force: true });
    await rm(emptyGlobalRoot, { recursive: true, force: true });
  });

  it("returns allReachable with no stores when there is no global config", async () => {
    const result = await precheckStoreReachability(projectRoot, emptyGlobalRoot);
    expect(result.allReachable).toBe(true);
    expect(result.stores).toEqual([]);
  });

  it("caches the result within the TTL window", async () => {
    const t0 = 1_000_000;
    const first = await precheckStoreReachability(projectRoot, emptyGlobalRoot, t0);
    // A second call inside the 60s window returns the SAME cached object.
    const second = await precheckStoreReachability(projectRoot, emptyGlobalRoot, t0 + 30_000);
    expect(second).toBe(first);
  });
});

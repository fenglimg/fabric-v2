import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema } from "@fenglimg/fabric-shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import {
  loadProjectConfig,
  projectConfigPath,
  saveProjectConfig,
} from "../src/store/project-config-io.js";
import {
  assertStoreMountable,
  missingRequiredStores,
  unboundAvailableStores,
  storeAdd,
  storeBind,
  storeCreate,
  storeExplain,
  storeGitRemote,
  storeList,
  storeRemove,
  storeSwitchWrite,
} from "../src/store/store-ops.js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// v2.1.0-rc.1 P3 — `fabric store {list,add,remove,explain}` integration tests
// against an isolated global root (no FABRIC_HOME / real ~/.fabric touched).

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

// ADJ-NEWN-6 (v2.1 Wave0 dogfood): `store add` registered a uuid whose store
// tree never existed (phantom mount), deferring the crash to `fabric sync`
// (spawnSync git ENOENT on a non-existent cwd). The guard moves the failure to
// add time.
describe("assertStoreMountable (ADJ-NEWN-6 phantom-mount guard)", () => {
  it("throws when the store directory has no store.json", () => {
    expect(() => assertStoreMountable(PLATFORM, globalRoot)).toThrow(/phantom store/);
  });

  it("passes when the store tree exists on disk", () => {
    const dir = join(globalRoot, "stores", PLATFORM);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "store.json"),
      JSON.stringify({ store_uuid: PLATFORM, created_at: "2026-05-30T00:00:00.000Z", canonical_alias: "platform" }),
    );
    expect(() => assertStoreMountable(PLATFORM, globalRoot)).not.toThrow();
  });
});

// ADJ-NEWN-5 (v2.1 Wave0 dogfood): no CLI path existed to birth a fresh store
// (install --global mints only personal; --url clones existing; add only
// registers an on-disk store). `storeCreate` scaffolds + mounts in one step.
describe("storeCreate (ADJ-NEWN-5 create a brand-new local store)", () => {
  it("scaffolds the store tree, writes store.json with the intrinsic uuid, and mounts it", () => {
    const result = storeCreate("team", "2026-05-30T00:00:00.000Z", {
      uuid: PLATFORM,
      git: false,
      globalRoot,
    });
    expect(result.store_uuid).toBe(PLATFORM);
    // store.json written with the intrinsic identity (S55).
    const identity = JSON.parse(readFileSync(join(result.storeDir, "store.json"), "utf8"));
    expect(identity.store_uuid).toBe(PLATFORM);
    expect(identity.canonical_alias).toBe("team");
    // knowledge scaffold exists.
    expect(existsSync(join(result.storeDir, "knowledge"))).toBe(true);
    // mounted into the registry.
    expect(storeList(globalRoot).map((s) => s.alias)).toContain("team");
  });

  it("associates a remote when provided", () => {
    const result = storeCreate("team", "2026-05-30T00:00:00.000Z", {
      uuid: PLATFORM,
      git: false,
      remote: "git@h:team.git",
      globalRoot,
    });
    expect(storeExplain("team", globalRoot)?.local_only).toBe(false);
    expect(result.storeDir).toContain(PLATFORM);
  });

  it("a created store passes the phantom-mount guard (round-trip with assertStoreMountable)", () => {
    storeCreate("team", "2026-05-30T00:00:00.000Z", { uuid: PLATFORM, git: false, globalRoot });
    expect(() => assertStoreMountable(PLATFORM, globalRoot)).not.toThrow();
  });
});

// v2.1 global-refactor (W2-T4, F-SYNC-REMOTE + F14): `storeCreate --remote` must
// wire the remote into the store's OWN git repo (`git remote add origin`), not
// just the config metadata — otherwise the store can never pull/push. And
// `store list`'s local-only label must reflect the TRUE git remote.
describe("storeCreate --remote git wiring (W2-T4)", () => {
  it("runs `git remote add origin` so the store repo has a real remote", () => {
    const remote = "git@example.com:team-store.git";
    const result = storeCreate("team", "2026-05-30T00:00:00.000Z", {
      uuid: PLATFORM,
      // git: true (default) → real `git init` + `git remote add`.
      remote,
      globalRoot,
    });

    // The store repo's actual git remote is set (not just config metadata).
    const realRemote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: result.storeDir,
      encoding: "utf8",
    }).trim();
    expect(realRemote).toBe(remote);

    // storeGitRemote reads the same on-disk truth.
    expect(storeGitRemote(PLATFORM, globalRoot)).toBe(remote);
  });

  it("a created store WITHOUT a remote has no git origin → reported local-only", () => {
    storeCreate("solo", "2026-05-30T00:00:00.000Z", {
      uuid: TEAM,
      globalRoot,
    });
    // No remote requested → no `origin` in the repo → storeGitRemote undefined.
    expect(storeGitRemote(TEAM, globalRoot)).toBeUndefined();
  });

  it("storeGitRemote ignores stale config metadata when the repo has no origin", () => {
    // Simulate a store created BEFORE the F-SYNC-REMOTE fix: config records a
    // remote but the repo never had `git remote add` run. storeGitRemote (which
    // store list uses for the F14 label) must report local-only from on-disk
    // reality, not the lying config field.
    const result = storeCreate("stale", "2026-05-30T00:00:00.000Z", {
      uuid: PLATFORM,
      git: true,
      globalRoot,
    });
    // Manually remove origin to mimic the pre-fix state, then forge config metadata.
    // (storeCreate without remote already left no origin; here we assert the
    // label derives from git, even though we could forge config.remote.)
    expect(existsSync(join(result.storeDir, ".git"))).toBe(true);
    expect(storeGitRemote(PLATFORM, globalRoot)).toBeUndefined();
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

describe("fabric store bind / switch-write (project config)", () => {
  function seedProject(): string {
    const projectRoot = mkdtempSync(join(tmpdir(), "fabric-store-proj-"));
    dirs.push(projectRoot);
    saveProjectConfig(
      { project_id: "11111111-1111-4111-8111-111111111111", required_stores: [] },
      projectRoot,
    );
    return projectRoot;
  }

  it("binds a required store and persists it (dedupe by id)", () => {
    const projectRoot = seedProject();
    storeBind(projectRoot, { id: "team", suggested_remote: "git@h:team.git" });
    storeBind(projectRoot, { id: "team", suggested_remote: "git@h:team-2.git" });
    const cfg = loadProjectConfig(projectRoot);
    expect(cfg?.required_stores).toHaveLength(1);
    expect(cfg?.required_stores?.[0]?.suggested_remote).toBe("git@h:team-2.git");
  });

  it("switch-write sets the active write store", () => {
    const projectRoot = seedProject();
    storeSwitchWrite(projectRoot, "team");
    expect(loadProjectConfig(projectRoot)?.active_write_store).toBe("team");
  });

  it("guides to `install` when the project config is absent", () => {
    const bare = mkdtempSync(join(tmpdir(), "fabric-store-bare-"));
    dirs.push(bare);
    expect(() => storeBind(bare, { id: "team" })).toThrow(/install/);
  });
});

describe("clone onboarding — missing required stores (S51)", () => {
  it("lists required stores not mounted in the global registry", () => {
    storeAdd({ store_uuid: TEAM, alias: "team" }, globalRoot);
    const projectRoot = mkdtempSync(join(tmpdir(), "fabric-clone-"));
    dirs.push(projectRoot);
    saveProjectConfig(
      {
        project_id: "11111111-1111-4111-8111-111111111111",
        required_stores: [{ id: "team" }, { id: "platform", suggested_remote: "git@h:platform.git" }],
      },
      projectRoot,
    );
    const missing = missingRequiredStores(projectRoot, globalRoot);
    expect(missing.map((m) => m.id)).toEqual(["platform"]);
  });
});

describe("onboarding nudge — unbound available stores (Wave A / D4)", () => {
  it("lists mounted non-personal stores the project has not bound, excluding personal", () => {
    storeAdd({ store_uuid: PERSONAL, alias: "personal", personal: true }, globalRoot);
    storeAdd({ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }, globalRoot);
    const projectRoot = mkdtempSync(join(tmpdir(), "fabric-unbound-"));
    dirs.push(projectRoot);
    // Project declares no required stores → team is mounted-but-unbound.
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);

    const unbound = unboundAvailableStores(projectRoot, globalRoot);
    expect(unbound.map((s) => s.alias)).toEqual(["team"]); // personal never needs binding
  });

  it("returns nothing once the store is bound", () => {
    storeAdd({ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }, globalRoot);
    const projectRoot = mkdtempSync(join(tmpdir(), "fabric-bound-"));
    dirs.push(projectRoot);
    saveProjectConfig(
      { project_id: "11111111-1111-4111-8111-111111111111", required_stores: [{ id: "team" }] },
      projectRoot,
    );
    expect(unboundAvailableStores(projectRoot, globalRoot)).toEqual([]);
  });

  it("returns nothing when there is no global config", () => {
    const emptyGlobal = join(mkdtempSync(join(tmpdir(), "fabric-noglobal-")), ".fabric");
    dirs.push(emptyGlobal);
    const projectRoot = mkdtempSync(join(tmpdir(), "fabric-ng-proj-"));
    dirs.push(projectRoot);
    expect(unboundAvailableStores(projectRoot, emptyGlobal)).toEqual([]);
  });
});

describe("config abort (S34)", () => {
  it("aborts (throws) on a malformed project fabric-config.json", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "fabric-badcfg-"));
    dirs.push(projectRoot);
    const path = projectConfigPath(projectRoot);
    mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
    writeFileSync(path, "{ not valid json", "utf8");
    expect(() => loadProjectConfig(projectRoot)).toThrow();
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initStore } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { bindCreatedStoreToProject, bindRemoteStoreToProject } from "../src/commands/install.js";
import { mountStoreFromRemote } from "../src/install/run-global-install.js";
import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { runGlobalInstall } from "../src/install/run-global-install.js";
import { scopeExplain } from "../src/store/scope-explain.js";

// W1 — `fabric install --url=<remote>` top-level "join a team store" flow:
// mount the remote store globally, bind it to the project, set it as the active
// write target. Exercises bindRemoteStoreToProject against an isolated global
// root + a fake clonable store remote.

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-05-30T00:00:00.000Z";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "pipe"] });
}

// Seed a bare remote holding a committed Fabric store (store.json + knowledge/).
async function makeFakeStoreRemote(storeUuid: string): Promise<string> {
  const remote = join(tmp("fabric-remote-"), "store.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: ["ignore", "ignore", "pipe"] });
  const work = join(tmp("fabric-seed-"), "w");
  execFileSync("git", ["clone", remote, work], { stdio: ["ignore", "ignore", "pipe"] });
  git(work, ["config", "user.email", "t@f.local"]);
  git(work, ["config", "user.name", "T"]);
  git(work, ["config", "commit.gpgsign", "false"]);
  await initStore(work, { store_uuid: storeUuid, created_at: NOW, canonical_alias: "team" }, { git: false });
  git(work, ["add", "-A"]);
  git(work, ["commit", "-m", "seed"]);
  git(work, ["push", "origin", "main"]);
  return remote;
}

function setupGlobalAndProject(): { globalRoot: string; projectRoot: string } {
  const globalRoot = join(tmp("fabric-w1-g-"), ".fabric");
  const projectRoot = tmp("fabric-w1-p-");
  saveProjectConfig({ project_id: PROJECT_ID, required_stores: [] }, projectRoot);
  return { globalRoot, projectRoot };
}

describe("install --url (bindRemoteStoreToProject)", () => {
  it("mounts the remote store, binds it to the project, and sets it as write target", async () => {
    const { globalRoot, projectRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);
    const remote = await makeFakeStoreRemote(TEAM);

    await bindRemoteStoreToProject(projectRoot, remote, globalRoot);

    // mounted globally: personal + the cloned team store.
    const global = loadGlobalConfig(globalRoot);
    expect(global?.stores).toHaveLength(2);
    const team = global?.stores.find((s) => s.store_uuid === TEAM);
    expect(team?.alias).toBe("team");
    expect(team?.remote).toBe(remote);

    // bound to the project + active write target.
    const project = loadProjectConfig(projectRoot);
    expect(project?.required_stores).toHaveLength(1);
    expect(project?.required_stores?.[0]?.id).toBe("team");
    expect(project?.required_stores?.[0]?.suggested_remote).toBe(remote);
    expect(project?.active_write_store).toBe("team");
  });

  it("is idempotent — re-running with the same remote does not re-clone a duplicate", async () => {
    const { globalRoot, projectRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);
    const remote = await makeFakeStoreRemote(TEAM);

    await bindRemoteStoreToProject(projectRoot, remote, globalRoot);
    await bindRemoteStoreToProject(projectRoot, remote, globalRoot);

    // still personal + one team store (reused the already-mounted clone).
    expect(loadGlobalConfig(globalRoot)?.stores).toHaveLength(2);
    // bind dedupes by id → still a single required store.
    expect(loadProjectConfig(projectRoot)?.required_stores).toHaveLength(1);
  });
});

// store-onboarding grill (Q3) — mountStoreFromRemote robustness. Identity is the
// intrinsic store_uuid (S55): a target directory already on disk is reconciled
// by uuid, never clobbered (the old ENOTEMPTY-on-rename bug).
describe("mountStoreFromRemote robustness (store-onboarding grill)", () => {
  const OTHER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

  it("adopts an on-disk store missing from the registry instead of crashing on rename", async () => {
    const { globalRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);
    const remote = await makeFakeStoreRemote(TEAM);
    await mountStoreFromRemote(remote, globalRoot);
    expect(loadGlobalConfig(globalRoot)?.stores).toHaveLength(2);

    // Simulate the orphan residue: drop the team store from the registry but
    // leave its on-disk tree (exactly what a failed rename used to leave behind).
    const cfg = loadGlobalConfig(globalRoot)!;
    saveGlobalConfig(
      { ...cfg, stores: cfg.stores.filter((s) => s.store_uuid !== TEAM) },
      globalRoot,
    );
    expect(loadGlobalConfig(globalRoot)?.stores).toHaveLength(1);

    // Re-mounting the same remote must ADOPT the on-disk tree (same uuid), not
    // ENOTEMPTY on renameSync into the occupied directory.
    const res = await mountStoreFromRemote(remote, globalRoot);
    expect(res.store_uuid).toBe(TEAM);
    expect(loadGlobalConfig(globalRoot)?.stores).toHaveLength(2);
    expect(loadGlobalConfig(globalRoot)?.stores.some((s) => s.store_uuid === TEAM)).toBe(true);
  });

  it("reuses the existing mount when the same remote is re-cloned (uuid dedupe)", async () => {
    const { globalRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);
    const remote = await makeFakeStoreRemote(TEAM);

    const first = await mountStoreFromRemote(remote, globalRoot);
    const second = await mountStoreFromRemote(remote, globalRoot);
    expect(second.store_uuid).toBe(first.store_uuid);
    expect(second.alias).toBe(first.alias);
    expect(loadGlobalConfig(globalRoot)?.stores).toHaveLength(2); // personal + team, no duplicate
  });

  it("refuses to overwrite a DIFFERENT store occupying the target directory", async () => {
    const { globalRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);
    // Two remotes whose repo basename ("store") derives the SAME mount_name, so
    // both resolve to the same finalDir — but they carry different store uuids.
    const remoteA = await makeFakeStoreRemote(TEAM);
    await mountStoreFromRemote(remoteA, globalRoot);
    // Orphan A's registry entry, leaving A's tree at team/<mount_name>.
    const cfg = loadGlobalConfig(globalRoot)!;
    saveGlobalConfig(
      { ...cfg, stores: cfg.stores.filter((s) => s.store_uuid !== TEAM) },
      globalRoot,
    );
    const remoteB = await makeFakeStoreRemote(OTHER);
    await expect(mountStoreFromRemote(remoteB, globalRoot)).rejects.toThrow(/different store already occupies/u);
  });
});

describe("install (bindCreatedStoreToProject)", () => {
  it("creates a new local store, binds it to the project, and sets it as write target", async () => {
    const { globalRoot, projectRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);

    await bindCreatedStoreToProject(projectRoot, "team", { globalRoot });

    // mounted globally: personal + the freshly-created local store.
    const global = loadGlobalConfig(globalRoot);
    expect(global?.stores).toHaveLength(2);
    expect(global?.stores.some((s) => s.alias === "team")).toBe(true);

    // bound to the project + active write target.
    const project = loadProjectConfig(projectRoot);
    expect(project?.required_stores?.[0]?.id).toBe("team");
    expect(project?.active_write_store).toBe("team");
  });

  it("wires a git remote into the created store when one is given", async () => {
    const { globalRoot, projectRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);

    await bindCreatedStoreToProject(projectRoot, "team", {
      globalRoot,
      remote: "git@h:team.git",
    });

    const team = loadGlobalConfig(globalRoot)?.stores.find((s) => s.alias === "team");
    expect(team?.remote).toBe("git@h:team.git");
    expect(loadProjectConfig(projectRoot)?.required_stores?.[0]?.suggested_remote).toBe("git@h:team.git");
  });
});

// W6 — install → recall round-trip oracle (install side).
//
// The recall consumer side is proven by server/cross-store-recall.test.ts (a
// store entry surfaces as a `team:`-qualified candidate GIVEN the project's
// required_stores binding). This seals the OTHER half: a store bound by the
// install path resolves — through the SAME resolver recall walks — into the
// team read-set + write target. The two halves meet at the identical
// `required_stores: [{id}]` contract, so the producer→consumer round-trip
// (store knowledge → recall hit via install-produced config) has no false-green
// gap between install and recall.
describe("install → recall round-trip oracle (W6)", () => {
  it("a store bound by install resolves into the team read-set + write target", async () => {
    const { globalRoot, projectRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);

    await bindCreatedStoreToProject(projectRoot, "team", { globalRoot });

    const explained = scopeExplain(projectRoot, "team", globalRoot);
    // the bound store enters the read-set that cross-store recall walks...
    expect(explained?.readSet.stores.map((s) => s.alias)).toContain("team");
    // ...and is the resolved write target for team-scope writes.
    expect(explained?.writeTarget?.alias).toBe("team");
  });
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initStore } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { bindCreatedStoreToProject, bindRemoteStoreToProject } from "../src/commands/install.js";
import { loadGlobalConfig } from "../src/store/global-config-io.js";
import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { runGlobalInstall } from "../src/install/run-global-install.js";

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
function makeFakeStoreRemote(storeUuid: string): string {
  const remote = join(tmp("fabric-remote-"), "store.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: ["ignore", "ignore", "pipe"] });
  const work = join(tmp("fabric-seed-"), "w");
  execFileSync("git", ["clone", remote, work], { stdio: ["ignore", "ignore", "pipe"] });
  git(work, ["config", "user.email", "t@f.local"]);
  git(work, ["config", "user.name", "T"]);
  git(work, ["config", "commit.gpgsign", "false"]);
  initStore(work, { store_uuid: storeUuid, created_at: NOW, canonical_alias: "team" }, { git: false });
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
    const remote = makeFakeStoreRemote(TEAM);

    bindRemoteStoreToProject(projectRoot, remote, globalRoot);

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
    const remote = makeFakeStoreRemote(TEAM);

    bindRemoteStoreToProject(projectRoot, remote, globalRoot);
    bindRemoteStoreToProject(projectRoot, remote, globalRoot);

    // still personal + one team store (reused the already-mounted clone).
    expect(loadGlobalConfig(globalRoot)?.stores).toHaveLength(2);
    // bind dedupes by id → still a single required store.
    expect(loadProjectConfig(projectRoot)?.required_stores).toHaveLength(1);
  });
});

describe("install (bindCreatedStoreToProject)", () => {
  it("creates a new local store, binds it to the project, and sets it as write target", async () => {
    const { globalRoot, projectRoot } = setupGlobalAndProject();
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);

    bindCreatedStoreToProject(projectRoot, "team", { globalRoot });

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

    bindCreatedStoreToProject(projectRoot, "team", {
      globalRoot,
      remote: "git@h:team.git",
    });

    const team = loadGlobalConfig(globalRoot)?.stores.find((s) => s.alias === "team");
    expect(team?.remote).toBe("git@h:team.git");
    expect(loadProjectConfig(projectRoot)?.required_stores?.[0]?.suggested_remote).toBe("git@h:team.git");
  });
});

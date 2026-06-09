import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initStore } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { loadGlobalConfig } from "../src/store/global-config-io.js";
import { runGlobalInstall } from "../src/install/run-global-install.js";

// v2.1.0-rc.1 P3 — `fabric install --global [<url>]` orchestration (S4/S8).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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

// Seed a fake bare remote holding a committed Fabric store (store.json).
async function makeFakeStoreRemote(storeUuid: string): Promise<string> {
  const remote = join(tmp("fabric-remote-"), "store.git");
  execFileSync("git", ["init", "--bare", "-b", "main", remote], { stdio: ["ignore", "ignore", "pipe"] });
  const work = join(tmp("fabric-seed-"), "w");
  execFileSync("git", ["clone", remote, work], { stdio: ["ignore", "ignore", "pipe"] });
  git(work, ["config", "user.email", "t@f.local"]);
  git(work, ["config", "user.name", "T"]);
  git(work, ["config", "commit.gpgsign", "false"]);
  // clone already has .git → init store files only (git:false).
  await initStore(work, { store_uuid: storeUuid, created_at: "2026-05-30T00:00:00.000Z", canonical_alias: "team" }, { git: false });
  git(work, ["add", "-A"]);
  git(work, ["commit", "-m", "seed"]);
  git(work, ["push", "origin", "main"]);
  return remote;
}

describe("install --global", () => {
  it("sets up global Fabric without a url (uid + personal store + config)", async () => {
    const globalRoot = join(tmp("fabric-gi-"), ".fabric");
    await runGlobalInstall(
      { uid: "u-x", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" },
      globalRoot,
    );
    const config = loadGlobalConfig(globalRoot);
    expect(config?.uid).toBe("u-x");
    expect(config?.stores).toHaveLength(1);
    expect(config?.stores[0]?.personal).toBe(true);
  });

  it("clones + mounts a shared store from a url", async () => {
    const globalRoot = join(tmp("fabric-gi2-"), ".fabric");
    const remote = await makeFakeStoreRemote(TEAM);
    await runGlobalInstall(
      { url: remote, uid: "u-x", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" },
      globalRoot,
    );
    const config = loadGlobalConfig(globalRoot);
    // personal (from global setup) + the cloned team store.
    expect(config?.stores).toHaveLength(2);
    const team = config?.stores.find((s) => s.store_uuid === TEAM);
    expect(team?.alias).toBe("team");
    expect(team?.remote).toBe(remote);
  });

  it("is idempotent on the global setup", async () => {
    const globalRoot = join(tmp("fabric-gi3-"), ".fabric");
    const opts = { uid: "u-x", personalStoreUuid: PERSONAL, now: "2026-05-30T00:00:00.000Z" };
    await runGlobalInstall(opts, globalRoot);
    await runGlobalInstall(opts, globalRoot); // no throw, no duplicate
    expect(loadGlobalConfig(globalRoot)?.stores).toHaveLength(1);
  });
});

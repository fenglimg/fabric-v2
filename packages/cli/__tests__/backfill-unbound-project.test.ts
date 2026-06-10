import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backfillUnboundProject } from "../src/install/backfill-unbound-project.js";
import { bindCreatedStoreToProject } from "../src/install/install-onboarding.js";
import { loadProjectConfig, saveProjectConfig } from "../src/store/project-config-io.js";
import { runGlobalInstall } from "../src/install/run-global-install.js";
import { readStoreProjects } from "@fenglimg/fabric-shared";
import { resolveStoreDir } from "../src/store/store-ops.js";

// Doctor `--fix` backfill for the pre-fix "store bound but no project_id /
// active_project" state. Drives the REAL backfill (detect + the same
// ensureStoreProjectBinding the install path runs) against an isolated global
// root, then asserts the project coordinate is minted and a second run is a
// no-op.

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = "2026-06-10T00:00:00.000Z";
const dirs: string[] = [];
let savedFabricHome: string | undefined;

beforeEach(() => {
  savedFabricHome = process.env.FABRIC_HOME;
});

afterEach(() => {
  if (savedFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = savedFabricHome;
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function gitProject(remote: string): string {
  const projectRoot = tmp("fab-backfill-p-");
  execFileSync("git", ["init", "-q", projectRoot], { stdio: "ignore" });
  execFileSync("git", ["-C", projectRoot, "remote", "add", "origin", remote], { stdio: "ignore" });
  return projectRoot;
}

describe("backfillUnboundProject", () => {
  it("backfills project_id + active_project for a bound-but-unbound project, idempotently", async () => {
    const globalRoot = join(tmp("fab-backfill-g-"), ".fabric");
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);

    const projectRoot = gitProject("git@github.com:acme/legacyrepo.git");
    // Create + bind a local team store so the store is genuinely mounted, then
    // strip the project coordinate to reproduce the pre-fix legacy state.
    saveProjectConfig({ required_stores: [] }, projectRoot);
    await bindCreatedStoreToProject(projectRoot, "team", { globalRoot });
    const bound = loadProjectConfig(projectRoot);
    saveProjectConfig(
      {
        required_stores: bound?.required_stores ?? [],
        active_write_store: "team",
      },
      projectRoot,
    );
    expect(loadProjectConfig(projectRoot)?.project_id).toBeUndefined();
    expect(loadProjectConfig(projectRoot)?.active_project).toBeUndefined();

    // Run 1: backfills, derives the project id from the git remote name.
    const result = await backfillUnboundProject(projectRoot, globalRoot);
    expect(result).not.toBeNull();
    expect(result?.alias).toBe("team");
    expect(result?.active_project).toBe("legacyrepo");

    const fixed = loadProjectConfig(projectRoot);
    expect(typeof fixed?.project_id).toBe("string");
    expect(fixed?.active_project).toBe("legacyrepo");
    expect(fixed?.write_routes).toContainEqual({ scope: "project:legacyrepo", store: "team" });

    // The project is registered in the store it is bound to.
    const storeDir = resolveStoreDir("team", globalRoot);
    expect(storeDir).not.toBeNull();
    const projects = await readStoreProjects(storeDir as string);
    expect(projects.map((p) => p.id)).toContain("legacyrepo");

    // Run 2: nothing to backfill → clean no-op.
    expect(await backfillUnboundProject(projectRoot, globalRoot)).toBeNull();
  });

  it("is a no-op when there is no active write store (nothing bound yet)", async () => {
    const globalRoot = join(tmp("fab-backfill-g2-"), ".fabric");
    await runGlobalInstall({ uid: "u-x", personalStoreUuid: PERSONAL, now: NOW }, globalRoot);
    const projectRoot = gitProject("git@github.com:acme/unbound.git");
    saveProjectConfig({ required_stores: [] }, projectRoot);

    expect(await backfillUnboundProject(projectRoot, globalRoot)).toBeNull();
    expect(loadProjectConfig(projectRoot)?.active_project).toBeUndefined();
  });
});

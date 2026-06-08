import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema, storeRelativePath } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { projectStatus, whoami } from "../src/store/info-ops.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";

// v2.1.0-rc.1 P3 — whoami / status read-only info ops (S30/F5).

const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
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

describe("whoami", () => {
  it("reports uid + mounted stores with local-only flag", () => {
    const globalRoot = join(tmp("fabric-whoami-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [{ store_uuid: TEAM, alias: "team" }],
      }),
      globalRoot,
    );
    const info = whoami(globalRoot);
    expect(info?.uid).toBe("u-me");
    expect(info?.stores[0]).toEqual({
      alias: "team",
      mount_name: null,
      store_uuid: TEAM,
      local_only: true,
    });
  });

  it("reports a store with a physical git remote as NOT local-only even when the registry omits remote (F4 parity with `store list`)", () => {
    const globalRoot = join(tmp("fabric-whoami-phys-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [{ store_uuid: TEAM, alias: "team" }], // registry: NO remote field
      }),
      globalRoot,
    );
    // …but the on-disk store repo HAS an origin remote (what sync actually uses).
    const storeDir = join(globalRoot, storeRelativePath(TEAM));
    mkdirSync(storeDir, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: storeDir });
    execFileSync("git", ["remote", "add", "origin", "git@h:team.git"], { cwd: storeDir });

    // `store list` shows the remote → whoami must agree → not local-only.
    expect(whoami(globalRoot)?.stores[0]?.local_only).toBe(false);
  });

  it("returns null with no global config", () => {
    expect(whoami(join(tmp("fabric-whoami-empty-"), ".fabric"))).toBeNull();
  });
});

describe("status", () => {
  it("aggregates global identity + project required/active-write", () => {
    const globalRoot = join(tmp("fabric-status-g-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({ uid: "u-me", stores: [{ store_uuid: TEAM, alias: "team" }] }),
      globalRoot,
    );
    const projectRoot = tmp("fabric-status-p-");
    saveProjectConfig(
      {
        project_id: "11111111-1111-4111-8111-111111111111",
        required_stores: [{ id: "team" }],
        active_write_store: "team",
      },
      projectRoot,
    );

    const status = projectStatus(projectRoot, globalRoot);
    expect(status.uid).toBe("u-me");
    expect(status.mounted).toEqual(["team"]);
    expect(status.project_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(status.required).toEqual(["team"]);
    expect(status.active_write_store).toBe("team");
  });

  it("degrades field-by-field when configs are absent", () => {
    const status = projectStatus(tmp("fabric-status-bare-"), join(tmp("fabric-status-bareg-"), ".fabric"));
    expect(status.uid).toBeNull();
    expect(status.project_id).toBeNull();
    expect(status.mounted).toEqual([]);
  });
});

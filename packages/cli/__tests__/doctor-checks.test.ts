import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { storeDoctorChecks } from "../src/store/doctor-checks.js";
import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";

// v2.1.0-rc.1 P3 — doctor multi-store health checks (S10/S51/R5#5).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
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

describe("doctor store checks", () => {
  it("warns when no global config exists", () => {
    const diags = storeDoctorChecks(tmp("dr-proj-"), join(tmp("dr-g-"), ".fabric"));
    expect(diags).toEqual([expect.objectContaining({ code: "no_global_config", severity: "warn" })]);
  });

  it("warns on a missing required store and nudges a local-only store", () => {
    const globalRoot = join(tmp("dr-g2-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team" }, // local-only (no remote)
        ],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-p2-");
    saveProjectConfig(
      { project_id: "11111111-1111-4111-8111-111111111111", required_stores: [{ id: "platform" }] },
      projectRoot,
    );

    const diags = storeDoctorChecks(projectRoot, globalRoot);
    const codes = diags.map((d) => d.code);
    expect(codes).toContain("missing_required_store"); // platform not mounted
    expect(codes).toContain("local_only_store"); // team has no remote
    // personal store (no remote) does NOT trigger the local-only nudge.
    expect(diags.filter((d) => d.code === "local_only_store").map((d) => d.ref)).toEqual(["team"]);
  });

  it("is clean when everything is mounted with remotes", () => {
    const globalRoot = join(tmp("dr-g3-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
        ],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-p3-");
    saveProjectConfig(
      { project_id: "11111111-1111-4111-8111-111111111111", required_stores: [{ id: "team" }] },
      projectRoot,
    );
    expect(storeDoctorChecks(projectRoot, globalRoot)).toEqual([]);
  });
});

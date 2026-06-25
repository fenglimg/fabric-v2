import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema, storeRelativePathForMount } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it } from "vitest";

import { storeDoctorChecks } from "../src/store/doctor-checks.js";
import { fixActivePersonalPointer } from "../src/store/store-ops.js";
import { loadGlobalConfig, saveGlobalConfig } from "../src/store/global-config-io.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";

// v2.1.0-rc.1 P3 — doctor multi-store health checks (S10/S51/R5#5).

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSONAL2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
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

  it("nudges (info) a mounted store the project has not bound, never personal", () => {
    const globalRoot = join(tmp("dr-g5-"), ".fabric");
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
    // Project declares NO required stores → team is mounted-but-unbound.
    const projectRoot = tmp("dr-p5-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);

    const diags = storeDoctorChecks(projectRoot, globalRoot);
    const unbound = diags.filter((d) => d.code === "unbound_available_store");
    expect(unbound.map((d) => d.ref)).toEqual(["team"]); // personal excluded
    expect(unbound[0]?.severity).toBe("info");
  });

  it("warns when a mounted store smuggles an executable/hook file (S65 RCE defense)", () => {
    const globalRoot = join(tmp("dr-g4-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [{ store_uuid: TEAM, alias: "team", remote: "git@h:team.git" }],
      }),
      globalRoot,
    );
    // Plant an executable hook inside the on-disk store tree.
    const storeDir = join(globalRoot, storeRelativePathForMount({ store_uuid: TEAM }));
    mkdirSync(join(storeDir, "hooks"), { recursive: true });
    writeFileSync(join(storeDir, "hooks", "evil.cjs"), "console.log('rce')\n", "utf8");

    const projectRoot = tmp("dr-p4-");
    saveProjectConfig(
      { project_id: "11111111-1111-4111-8111-111111111111", required_stores: [{ id: "team" }] },
      projectRoot,
    );
    const diags = storeDoctorChecks(projectRoot, globalRoot);
    const exec = diags.find((d) => d.code === "executable_in_store");
    expect(exec).toBeDefined();
    expect(exec?.severity).toBe("warn");
    expect(exec?.ref).toBe("team");
  });

  // 语义 A (multi-personal): active_personal_store pointer integrity lints.
  it("errors when active_personal_store points at a non-personal store", () => {
    const globalRoot = join(tmp("dr-ap1-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        active_personal_store: "team",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
        ],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-ap1p-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);
    const diag = storeDoctorChecks(projectRoot, globalRoot).find(
      (d) => d.code === "active_personal_invalid",
    );
    expect(diag?.severity).toBe("error");
    expect(diag?.ref).toBe("team");
  });

  it("info-nudges when ≥2 personal stores are mounted but none is active", () => {
    const globalRoot = join(tmp("dr-ap2-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: PERSONAL2, alias: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-ap2p-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);
    const diag = storeDoctorChecks(projectRoot, globalRoot).find(
      (d) => d.code === "active_personal_unset",
    );
    expect(diag?.severity).toBe("info");
  });

  it("is silent for a single personal store with no active pointer", () => {
    const globalRoot = join(tmp("dr-ap3-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [{ store_uuid: PERSONAL, alias: "personal", personal: true }],
      }),
      globalRoot,
    );
    const projectRoot = tmp("dr-ap3p-");
    saveProjectConfig({ project_id: "11111111-1111-4111-8111-111111111111" }, projectRoot);
    const codes = storeDoctorChecks(projectRoot, globalRoot).map((d) => d.code);
    expect(codes).not.toContain("active_personal_invalid");
    expect(codes).not.toContain("active_personal_unset");
  });

  it("--fix rewrites a dangling active pointer to the first personal store", () => {
    const globalRoot = join(tmp("dr-ap4-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        active_personal_store: "team",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: TEAM, alias: "team", remote: "git@h:team.git" },
        ],
      }),
      globalRoot,
    );
    expect(fixActivePersonalPointer(globalRoot)).toBe(true);
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal");
  });

  it("--fix sets the active pointer to the first personal when unset with ≥2 personal", () => {
    const globalRoot = join(tmp("dr-ap5-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: PERSONAL2, alias: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    expect(fixActivePersonalPointer(globalRoot)).toBe(true);
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal");
  });

  it("--fix is a no-op (returns false) when the pointer is already valid", () => {
    const globalRoot = join(tmp("dr-ap6-"), ".fabric");
    saveGlobalConfig(
      globalConfigSchema.parse({
        uid: "u-me",
        active_personal_store: "personal-work",
        stores: [
          { store_uuid: PERSONAL, alias: "personal", personal: true },
          { store_uuid: PERSONAL2, alias: "personal-work", personal: true },
        ],
      }),
      globalRoot,
    );
    expect(fixActivePersonalPointer(globalRoot)).toBe(false);
    expect(loadGlobalConfig(globalRoot)?.active_personal_store).toBe("personal-work");
  });
});

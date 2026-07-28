/**
 * config-single-home W4: doctor `config_key_relocated` INFO advisory.
 *
 * The repo's fabric-config.json is IDENTITY-ONLY. Any other key left in it is a
 * relocated policy knob whose value no longer has any effect, so doctor points at
 * its new home (global `defaults` for preference knobs, the store's
 * store-config.json for corpus knobs).
 *
 * Severity is INFO, never warn: doctor.ts's `--strict` exit-1 expression counts
 * only `report.status` / `report.warnings` / store diagnostics of severity `warn`,
 * so a leftover key provably CANNOT flip `fabric doctor --strict` to exit 1. It is
 * cleanup guidance, not a build break.
 *
 * (Supersedes the former `store_knob_repo_override` advisory, which detected a
 * repo key overriding a store key — a situation that can no longer arise now that
 * every knob has exactly one home.)
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveGlobalConfig } from "@fenglimg/fabric-shared";

import { knowledgeDoctorChecks } from "../src/store/knowledge-doctor-checks.js";
import type { StoreDiagnostic } from "../src/store/doctor-checks.js";

const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";

const dirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fabric-relocated-key-home-"));
  dirs.push(home);
  process.env.FABRIC_HOME = home;
});

afterEach(() => {
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function mountStores(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
      { store_uuid: TEAM, alias: "team", remote: "git@e:t.git", writable: true },
    ],
  });
}

/** A repo bound to the team store, with whatever extra keys a case wants to leave behind. */
function makeRepo(projectConfig: object): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "fabric-relocated-key-proj-"));
  dirs.push(projectRoot);
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    JSON.stringify(
      { required_stores: [{ id: "team" }], active_write_store: "team", ...projectConfig },
      null,
      2,
    ),
  );
  mountStores();
  return projectRoot;
}

function relocated(diags: StoreDiagnostic[]): StoreDiagnostic[] {
  return diags.filter((d) => d.code === "config_key_relocated");
}

describe("doctor config_key_relocated advisory (config-single-home W4)", () => {
  it("emits ONE info advisory per relocated key, sorted", async () => {
    const projectRoot = makeRepo({ plan_context_top_k: 42, broad_index_backstop: 80 });
    const found = relocated(await knowledgeDoctorChecks(projectRoot));
    expect(found.map((d) => d.ref)).toEqual(["broad_index_backstop", "plan_context_top_k"]);
    // CRITICAL: info severity — the --strict exit expression counts only `warn`,
    // so a leftover key can NEVER flip `fabric doctor --strict` to exit 1.
    for (const d of found) {
      expect(d.severity).toBe("info");
    }
  });

  it("flags a corpus knob left in the repo (its home is the store)", async () => {
    const projectRoot = makeRepo({ credibility_half_life_decisions_days: 200 });
    expect(relocated(await knowledgeDoctorChecks(projectRoot)).map((d) => d.ref)).toEqual([
      "credibility_half_life_decisions_days",
    ]);
  });

  it("flags a preference knob left in the repo (its home is the global defaults)", async () => {
    const projectRoot = makeRepo({ hint_summary_max_len: 120 });
    expect(relocated(await knowledgeDoctorChecks(projectRoot)).map((d) => d.ref)).toEqual([
      "hint_summary_max_len",
    ]);
  });

  it("stays silent on an identity-only repo config", async () => {
    const projectRoot = makeRepo({});
    expect(relocated(await knowledgeDoctorChecks(projectRoot))).toEqual([]);
  });

  it("never flags the identity keys themselves", async () => {
    const projectRoot = makeRepo({
      project_id: "p1",
      workspace_binding_id: "w1",
      active_project: "proj",
      write_routes: [{ scope: "project:proj", store: "team" }],
      default_write_store: "team",
    });
    expect(relocated(await knowledgeDoctorChecks(projectRoot))).toEqual([]);
  });
});

/**
 * config-layering W3 (TASK-005): doctor `store_knob_repo_override` INFO advisory.
 *
 * When a repo's fabric-config.json overrides a store-layer knob the TEAM store
 * also defaults, doctor surfaces the divergence — but as an INFO-severity
 * StoreDiagnostic, NOT a warning. doctor.ts's `--strict` exit-1 expression counts
 * only `report.status`/`report.warnings`/store diagnostics of severity `warn`,
 * so an info advisory provably CANNOT flip `fabric doctor --strict` to exit 1
 * (the project layer is allowed to win, C-004 D2 user-in-control).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildStoreResolveInput,
  createStoreResolver,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { knowledgeDoctorChecks } from "../src/store/knowledge-doctor-checks.js";
import type { StoreDiagnostic } from "../src/store/doctor-checks.js";

const TEAM = "22222222-2222-4222-8222-222222222222";
const PERSONAL = "33333333-3333-4333-8333-333333333333";

const dirs: string[] = [];
let originalFabricHome: string | undefined;

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
  const home = mkdtempSync(join(tmpdir(), "fabric-knob-override-home-"));
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

// Build a repo bound to the team store; write the project fabric-config.json and
// (optionally) the team store-config.json at the SAME resolved team store ROOT
// the advisory reads from.
function makeRepo(opts: { projectConfig: object; storeConfig?: object }): string {
  const projectRoot = mkdtempSync(join(tmpdir(), "fabric-knob-override-proj-"));
  dirs.push(projectRoot);
  mkdirSync(join(projectRoot, ".fabric"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".fabric", "fabric-config.json"),
    JSON.stringify({ required_stores: [{ id: "team" }], active_write_store: "team", ...opts.projectConfig }, null, 2),
  );
  mountStores();
  if (opts.storeConfig !== undefined) {
    const input = buildStoreResolveInput(projectRoot);
    if (input === null) throw new Error("store resolve input null");
    const { target } = createStoreResolver().resolveWriteTarget(input, "team");
    if (target === null) throw new Error("no team write target");
    const mounted = input.mountedStores.find((s) => s.store_uuid === target.store_uuid) ?? { store_uuid: target.store_uuid };
    const storeRoot = join(resolveGlobalRoot(), storeRelativePathForMount(mounted));
    mkdirSync(storeRoot, { recursive: true });
    writeFileSync(join(storeRoot, "store-config.json"), JSON.stringify(opts.storeConfig, null, 2));
  }
  return projectRoot;
}

function knobOverrides(diags: StoreDiagnostic[]): StoreDiagnostic[] {
  return diags.filter((d) => d.code === "store_knob_repo_override");
}

describe("doctor store_knob_repo_override advisory (TASK-005)", () => {
  it("emits ONE info advisory per overlapping store-overridable knob", async () => {
    const projectRoot = makeRepo({
      projectConfig: { broad_index_backstop: 80, plan_context_top_k: 42 },
      storeConfig: { broad_index_backstop: 40, plan_context_top_k: 24 },
    });
    const overrides = knobOverrides(await knowledgeDoctorChecks(projectRoot));
    expect(overrides.map((d) => d.ref).sort()).toEqual(["broad_index_backstop", "plan_context_top_k"]);
    // CRITICAL: info severity — the --strict exit expression counts only `warn`,
    // so this advisory can NEVER flip `fabric doctor --strict` to exit 1.
    for (const d of overrides) {
      expect(d.severity).toBe("info");
    }
  });

  it("flags a grouped-family knob (credibility_half_life_* → concrete key)", async () => {
    const projectRoot = makeRepo({
      projectConfig: { credibility_half_life_decisions_days: 200 },
      storeConfig: { credibility_half_life_decisions_days: 365 },
    });
    const overrides = knobOverrides(await knowledgeDoctorChecks(projectRoot));
    expect(overrides.map((d) => d.ref)).toEqual(["credibility_half_life_decisions_days"]);
  });

  it("no advisory when the repo overrides a knob the store does NOT set", async () => {
    const projectRoot = makeRepo({
      projectConfig: { broad_index_backstop: 80 },
      storeConfig: { plan_context_top_k: 24 }, // disjoint knob
    });
    expect(knobOverrides(await knowledgeDoctorChecks(projectRoot))).toEqual([]);
  });

  it("does not treat schema defaults as explicit repo overrides", async () => {
    const projectRoot = makeRepo({
      projectConfig: {},
      storeConfig: { broad_index_backstop: 40 },
    });
    expect(knobOverrides(await knowledgeDoctorChecks(projectRoot))).toEqual([]);
  });

  it("no advisory when the team store has no store-config.json (best-effort empty)", async () => {
    const projectRoot = makeRepo({ projectConfig: { broad_index_backstop: 80 } });
    expect(knobOverrides(await knowledgeDoctorChecks(projectRoot))).toEqual([]);
  });

  it("ignores a machine-scoped (non-overridable) key set in both layers", async () => {
    // hint_summary_max_len is intentionally ABSENT from STORE_OVERRIDABLE_KNOBS.
    const projectRoot = makeRepo({
      projectConfig: { hint_summary_max_len: 120 },
      storeConfig: { hint_summary_max_len: 200 },
    });
    expect(knobOverrides(await knowledgeDoctorChecks(projectRoot))).toEqual([]);
  });
});

import { existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { globalConfigSchema, readBindingsSnapshot } from "@fenglimg/fabric-shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GuidanceStage } from "../src/install/pipeline/guidance.stage.js";
import { saveGlobalConfig } from "../src/store/global-config-io.js";
import { saveProjectConfig } from "../src/store/project-config-io.js";
import { storeCreate } from "../src/store/store-ops.js";
import { regenerateBindingsSnapshot } from "../src/store/bindings-io.js";
import type { InstallContext } from "../src/install/pipeline/types.js";

// v2.3.0-rc.11 — Guidance stage unconditionally refreshes the resolved-bindings
// snapshot as the pipeline's finalize step. The store stage only refreshes on
// real bind / create paths (via ensureStoreProjectBinding); every other path
// (--yes non-interactive, settled team+no-unbound, promptTeamSlot SKIP, a
// manually-removed snapshot file, a hand-edit of write_routes) previously left
// `~/.fabric/state/bindings/*_resolved.json` stale — the guidance stage now
// heals all of them.

const PERSONAL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_TEAM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const tempRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fabric-guidance-refresh-"));
  tempRoots.push(root);
  return root;
}

async function setupHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "fabric-guidance-refresh-home-"));
  tempRoots.push(home);
  vi.stubEnv("FABRIC_HOME", home);
  const globalRoot = join(home, ".fabric");
  saveGlobalConfig(
    globalConfigSchema.parse({
      uid: "u-test",
      language: "en",
      stores: [
        { store_uuid: PERSONAL, alias: "personal", personal: true, writable: true },
        { store_uuid: TEAM, alias: "team", remote: "git@h:team.git", writable: true },
        { store_uuid: OTHER_TEAM, alias: "other-team", remote: "git@h:other.git", writable: true },
      ],
    }),
    globalRoot,
  );
  // storeCreate is async (global config RMW + on-disk skeleton). MUST await
  // before returning — fire-and-forget races afterEach rm(home) and produces
  // ENOENT rename on fabric-global.json (CI / full suite flake, multi-repo
  // dogfood era).
  await storeCreate("personal", "2026-05-30T00:00:00.000Z", {
    uuid: PERSONAL,
    personal: true,
    git: false,
    globalRoot,
  });
  await storeCreate("team", "2026-05-30T00:00:00.000Z", { uuid: TEAM, git: false, globalRoot });
  await storeCreate("other-team", "2026-05-30T00:00:00.000Z", {
    uuid: OTHER_TEAM,
    git: false,
    globalRoot,
  });
  return globalRoot;
}

function guidanceContext(target: string, globalRoot: string): InstallContext {
  return {
    target,
    args: {},
    options: { planOnly: false, skipBootstrap: false, skipHooks: false, skipMcp: false },
    mcpInstallMode: "global",
    claudeMcpScope: "project",
    interactive: false,
    wizardEnabled: false,
    stageResults: [],
    rollbackStack: [],
    state: { globalRoot },
  };
}

describe("GuidanceStage.regenerateBindingsSnapshot (rc.11 finalize)", () => {
  it("regenerates the snapshot file after it was manually removed", async () => {
    const globalRoot = await setupHome();
    const target = await tempProject();
    saveProjectConfig(
      {
        project_id: PROJECT_ID,
        active_project: "proj-a",
        required_stores: [{ id: "team" }],
        active_write_store: "team",
        default_write_store: "team",
        write_routes: [{ scope: "project:proj-a", store: "team" }],
      },
      target,
    );
    // Seed the snapshot from a previous install …
    regenerateBindingsSnapshot(target, {
      globalRoot,
      now: "2026-05-30T00:00:00.000Z",
    });
    const bindingsDir = join(globalRoot, "state", "bindings");
    const snapshotPath = join(bindingsDir, `${PROJECT_ID}_resolved.json`);
    expect(existsSync(snapshotPath)).toBe(true);

    // … then simulate the user rm'ing it (the exact steps-to-reproduce reported
    // for the rc.11 bug — install was expected to heal this and did not).
    rmSync(snapshotPath);
    expect(existsSync(snapshotPath)).toBe(false);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const stage = new GuidanceStage();
    const result = await stage.execute(guidanceContext(target, globalRoot));
    expect(result.disposition).toBe("ran");

    // The snapshot is regenerated — the file is back and readable.
    expect(existsSync(snapshotPath)).toBe(true);
    const snapshot = readBindingsSnapshot(globalRoot, PROJECT_ID);
    expect(snapshot?.project_id).toBe(PROJECT_ID);
    expect(snapshot?.write_target?.alias).toBe("team");
  });

  it("re-writes the snapshot after a hand-edit of fabric-config.json write_routes", async () => {
    const globalRoot = await setupHome();
    const target = await tempProject();
    saveProjectConfig(
      {
        project_id: PROJECT_ID,
        active_project: "proj-a",
        required_stores: [{ id: "team" }],
        active_write_store: "team",
        default_write_store: "team",
        write_routes: [{ scope: "project:proj-a", store: "team" }],
      },
      target,
    );
    regenerateBindingsSnapshot(target, {
      globalRoot,
      now: "2026-05-30T00:00:00.000Z",
    });
    const snapshotPath = join(globalRoot, "state", "bindings", `${PROJECT_ID}_resolved.json`);
    const stalledSnapshot = readBindingsSnapshot(globalRoot, PROJECT_ID);
    expect(stalledSnapshot?.write_target?.alias).toBe("team");
    expect(stalledSnapshot?.generated_at).toBe("2026-05-30T00:00:00.000Z");

    // The user swaps the write route from `team` to `other-team` by editing
    // fabric-config.json directly. Before rc.11, install ran fine but the
    // snapshot below still pointed at `team` — the read side kept using the
    // stale target.
    saveProjectConfig(
      {
        project_id: PROJECT_ID,
        active_project: "proj-a",
        required_stores: [{ id: "other-team" }],
        active_write_store: "other-team",
        default_write_store: "other-team",
        write_routes: [{ scope: "project:proj-a", store: "other-team" }],
      },
      target,
    );

    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await new GuidanceStage().execute(guidanceContext(target, globalRoot));
    expect(result.disposition).toBe("ran");

    // Snapshot now reflects the new write_route — the hand-edit took effect.
    const refreshed = readBindingsSnapshot(globalRoot, PROJECT_ID);
    expect(refreshed?.write_target?.alias).toBe("other-team");
    // `generated_at` moved forward, so late hook reads pick up the fresh copy.
    expect(refreshed?.generated_at).not.toBe(stalledSnapshot?.generated_at);
    expect(existsSync(snapshotPath)).toBe(true);
  });

  it("is a safe no-op on an unbound project (no project_id → returns null)", async () => {
    const globalRoot = await setupHome();
    const target = await tempProject();
    // No project_id yet — the snapshot cannot be keyed, so regenerate should
    // return null and the guidance stage must still complete cleanly (this is
    // the guard that makes the unconditional finalize call safe).
    saveProjectConfig({}, target);
    const bindingsDir = join(globalRoot, "state", "bindings");
    mkdirSync(bindingsDir, { recursive: true });
    const beforeCount = existsSync(bindingsDir)
      ? statSync(bindingsDir).isDirectory()
      : false;
    expect(beforeCount).toBe(true);

    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await new GuidanceStage().execute(guidanceContext(target, globalRoot));
    expect(result.disposition).toBe("ran");
    // No snapshot was written for this project (nothing to key on) — the guard
    // held. Guarantees rc.11's unconditional refresh does not synthesize
    // ghost snapshots for projects that never bound anything.
    expect(existsSync(join(bindingsDir, `${PROJECT_ID}_resolved.json`))).toBe(false);
  });
});

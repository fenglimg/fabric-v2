import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createStrayFabricDirCheck,
  detectStrayFabricDirs,
  fixStrayFabricDirs,
} from "./doctor-stray-fabric-dir.js";

// v2.3.0-rc.11 lint: stray_fabric_dir_detected walker + rescue-rename fix
// arm. The lint catches the exact fault mode that hit werewolf-minigame in
// dogfood — subprocess cwd=<repo>/scripts/asset-dedup/out/ made metrics.ts
// write `<subdir>/.fabric/metrics.jsonl` alongside the real one at
// `<repo>/.fabric/`. This test file mirrors doctor-write-route-lint.test.ts.

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "fab-stray-"));
  dirs.push(root);
  // Legit anchor at the root.
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(join(root, ".fabric", "events.jsonl"), "", "utf8");
  return root;
}

const t = ((key: string) => key) as never;

describe("detectStrayFabricDirs", () => {
  it("returns [] on a clean project — <root>/.fabric is not counted as stray", () => {
    const root = makeProject();
    expect(detectStrayFabricDirs(root)).toEqual([]);
  });

  it("catches the werewolf case: `.fabric/` under scripts/asset-dedup/out", () => {
    const root = makeProject();
    const stray = join(root, "scripts", "asset-dedup", "out", ".fabric");
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "metrics.jsonl"), "{}\n", "utf8");

    const strays = detectStrayFabricDirs(root);
    expect(strays).toHaveLength(1);
    expect(strays[0]).toBe(stray);
  });

  it("catches multiple strays at different depths (werewolf 5 dirs)", () => {
    const root = makeProject();
    const paths = [
      join(root, "tests", ".fabric"),
      join(root, "assets", ".fabric"),
      join(root, "assets", "RemoteBundles", "SpyGameRemote", "Audio", ".fabric"),
      join(root, "assets", "RemoteBundles", "MentorShipRemote", "Prefab", ".fabric"),
      join(root, "scripts", "asset-dedup", "out", ".fabric"),
    ];
    for (const p of paths) {
      mkdirSync(p, { recursive: true });
    }
    const strays = detectStrayFabricDirs(root).sort();
    expect(strays).toEqual([...paths].sort());
  });

  it("does not descend into ignored heavy trees (node_modules / .git / dist)", () => {
    const root = makeProject();
    // These should be invisible even if they somehow contained a stray dir.
    for (const ignored of ["node_modules", ".git", "dist", "build", "coverage"]) {
      mkdirSync(join(root, ignored, ".fabric"), { recursive: true });
    }
    expect(detectStrayFabricDirs(root)).toEqual([]);
  });

  it("does not descend into a stray .fabric (avoid stat-storming its cache)", () => {
    const root = makeProject();
    const stray = join(root, "scripts", ".fabric");
    // A nested .fabric inside a stray must NOT be reported separately —
    // walking would just re-count the same anomaly.
    mkdirSync(join(stray, "nested", ".fabric"), { recursive: true });
    const strays = detectStrayFabricDirs(root);
    expect(strays).toEqual([stray]);
  });

  it("returns [] when readdir throws (unreadable subdir does not crash)", () => {
    const root = makeProject();
    // Non-existent path — the outer walk still returns cleanly.
    expect(detectStrayFabricDirs(join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("createStrayFabricDirCheck", () => {
  it("renders ok status when strays is empty", () => {
    const check = createStrayFabricDirCheck(t, [], "/tmp/project");
    expect(check.status).toBe("ok");
    expect(check.code).toBeUndefined();
    expect(check.fixable).toBeUndefined();
  });

  it("renders a fixable warning with stray_fabric_dir_detected code", () => {
    const check = createStrayFabricDirCheck(
      t,
      ["/tmp/project/scripts/.fabric", "/tmp/project/assets/.fabric"],
      "/tmp/project",
    );
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
    expect(check.code).toBe("stray_fabric_dir_detected");
    expect(check.fixable).toBe(true);
    expect(check.actionHint).toBe("doctor.check.stray_fabric_dir_detected.remediation");
  });
});

describe("fixStrayFabricDirs", () => {
  it("renames each stray to <path>.stale-<timestamp> and reports ok=true", async () => {
    const root = makeProject();
    const stray = join(root, "assets", ".fabric");
    mkdirSync(stray, { recursive: true });
    writeFileSync(join(stray, "events.jsonl"), "{}\n", "utf8");

    const results = await fixStrayFabricDirs([stray], "2026-07-10T12-34-56-000Z");
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(results[0].from).toBe(stray);
    expect(results[0].to).toBe(`${stray}.stale-2026-07-10T12-34-56-000Z`);
    expect(existsSync(stray)).toBe(false);
    expect(existsSync(results[0].to)).toBe(true);
  });

  it("records ok=false when rename throws (missing source), no throw propagated", async () => {
    const results = await fixStrayFabricDirs(
      ["/tmp/does-not-exist/stray/.fabric"],
      "2026-01-01T00-00-00-000Z",
    );
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(typeof results[0].error).toBe("string");
  });

  it("is idempotent when re-run: second pass finds no strays (walker convergence)", async () => {
    const root = makeProject();
    const stray = join(root, "assets", ".fabric");
    mkdirSync(stray, { recursive: true });
    await fixStrayFabricDirs(detectStrayFabricDirs(root), "2026-07-10T00-00-00-000Z");
    // The renamed dir is `.fabric.stale-…`, which is NOT `.fabric`, so the
    // second walk returns no strays.
    expect(detectStrayFabricDirs(root)).toEqual([]);
    // And the rescued dir is still on disk for ops review — never a hard delete.
    const rescued = readdirSync(join(root, "assets")).filter((n) => n.startsWith(".fabric.stale-"));
    expect(rescued).toHaveLength(1);
  });
});

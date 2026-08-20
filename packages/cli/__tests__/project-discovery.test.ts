/**
 * Finding projects the registry never heard of.
 *
 * The defect this fixes was not a crash — it was a console that truthfully
 * reported ONE project on a machine holding eight, because the list was built
 * from the two youngest sources and the third was never read. So the assertions
 * that matter here are about COVERAGE and about REFUSING TO GUESS:
 *
 *   - a project on disk is found even though nothing registered it;
 *   - the global root, which is literally a `.fabric` directory, is not
 *     mistaken for a project;
 *   - a scan-backfilled row carries NO version, because there is none to read
 *     and the running CLI's version would be a lie that reads as "up to date";
 *   - an id known only from a store binding still reaches the list, as a row
 *     that says "cannot be opened" rather than not existing.
 */

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { backfillProjectRegistry, discoverFabricProjects } from "../src/store/project-discovery.js";
import { listRegisteredProjects, registerProject } from "../src/store/project-registry-io.js";
import { listBoundProjectIds } from "../src/store/bindings-io.js";
import { mergeProjectList } from "../src/console/project-list.js";

let home: string;
let globalRoot: string;

/** A repo with Fabric installed. `id` absent = an install that bound no store. */
function project(rel: string, id?: string, manifestVersion?: string): string {
  const root = join(home, ...rel.split("/"));
  mkdirSync(join(root, ".fabric"), { recursive: true });
  writeFileSync(
    join(root, ".fabric", "fabric-config.json"),
    JSON.stringify(id === undefined ? {} : { project_id: id }),
    "utf8",
  );
  if (manifestVersion !== undefined) {
    writeFileSync(
      join(root, ".fabric", "install-manifest.json"),
      JSON.stringify({ fabric_version: manifestVersion, files: {} }),
      "utf8",
    );
  }
  return root;
}

function scan(overrides: Record<string, unknown> = {}) {
  return discoverFabricProjects({ roots: [home], globalRoot, ...overrides });
}

// Restored, not deleted. Deleting is the tempting one-liner and it is wrong:
// if the worker inherited a FABRIC_HOME, every file that runs after this one in
// the same process would silently fall back to the REAL `~/.fabric`. A test
// file that widens another file's blast radius is worse than no test file.
let originalFabricHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fabric-discovery-"));
  globalRoot = join(home, ".fabric");
  mkdirSync(join(globalRoot, "state", "bindings"), { recursive: true });
  originalFabricHome = process.env.FABRIC_HOME;
  process.env.FABRIC_HOME = home;
});

afterEach(() => {
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  rmSync(home, { recursive: true, force: true });
});

describe("discovery walks the disk instead of trusting a table", () => {
  it("finds a project nothing ever registered", async () => {
    const root = project("code/alpha", "p-alpha");
    const result = await scan();
    expect(result.projects).toEqual([{ path: root, projectId: "p-alpha", fabricVersion: null }]);
  });

  it("does not mistake the global root for a project", async () => {
    // `~/.fabric` matches "a directory containing .fabric" from its parent, and
    // `~` is the scan root. Without the identity check the user's home would be
    // listed as a project on every single machine.
    writeFileSync(join(globalRoot, "fabric-config.json"), JSON.stringify({ project_id: "x" }));
    const result = await scan();
    expect(result.projects).toEqual([]);
  });

  it("ignores a bare .fabric directory with no config in it", async () => {
    // Five repos on the machine this was written for hold nothing but an empty
    // `.fabric/.cache`. Counting those as projects would inflate the list with
    // rows that can never be opened or configured.
    mkdirSync(join(home, "code", "leftover", ".fabric", ".cache"), { recursive: true });
    expect((await scan()).projects).toEqual([]);
  });

  it("reads the id even when the install bound no store", async () => {
    const root = project("code/unbound");
    const result = await scan();
    expect(result.projects).toEqual([{ path: root, projectId: null, fabricVersion: null }]);
  });

  it("reads the install version when a manifest is there", async () => {
    project("code/versioned", "p-v", "2.6.0");
    expect((await scan()).projects[0]?.fabricVersion).toBe("2.6.0");
  });

  it("does not descend into pruned directories", async () => {
    // A vendored checkout inside node_modules is not the user's project, and
    // walking node_modules is the difference between a 0.3s scan and a stalled
    // console.
    project("code/app/node_modules/some-dep", "p-vendored");
    const found = project("code/app", "p-app");
    expect((await scan()).projects.map((p) => p.path)).toEqual([found]);
  });

  it("still descends into dot-directories that hold worktrees", async () => {
    // The tempting prune rule is "skip anything starting with a dot". Worktrees
    // live under `.claude/worktrees/`, so that rule would have made every
    // worktree undiscoverable — the same class of miss this module fixes.
    const root = project(".claude/worktrees/feature-x", "p-wt");
    expect((await scan()).projects.map((p) => p.path)).toContain(root);
  });

  it("lists a project once when two roots overlap", async () => {
    // Roots are configurable, and the natural configuration overlaps: scan
    // `~` and also `~/code` because that is where the repos are. Without the
    // seen-set every project under the inner root is queued from both and the
    // switcher offers the same repo twice.
    const root = project("code/app", "p-app");
    const result = await discoverFabricProjects({
      roots: [home, join(home, "code")],
      globalRoot,
    });
    expect(result.projects.map((p) => p.path)).toEqual([root]);
  });

  it("does not follow a symlink out of the scanned tree", async () => {
    // The deliberate limit, pinned so it is a decision rather than an accident:
    // descent tests `isDirectory()`, which is false for a symlink, so a
    // symlinked project is NOT found. The alternative — following links — lets
    // a single link inside `~` walk the whole disk, and lets a cycle spin. If
    // this ever starts passing, someone swapped in `stat` and needs to say what
    // now bounds the walk.
    const outside = mkdtempSync(join(tmpdir(), "fabric-outside-"));
    mkdirSync(join(outside, "repo", ".fabric"), { recursive: true });
    writeFileSync(
      join(outside, "repo", ".fabric", "fabric-config.json"),
      JSON.stringify({ project_id: "p-elsewhere" }),
      "utf8",
    );
    symlinkSync(join(outside, "repo"), join(home, "linked"), "dir");

    expect((await scan()).projects).toEqual([]);
    rmSync(outside, { recursive: true, force: true });
  });

  it("stops at the depth limit rather than walking forever", async () => {
    project("a/b/c/d/e/f/g/deep", "p-deep");
    expect((await scan({ maxDepth: 3 })).projects).toEqual([]);
    expect((await scan({ maxDepth: 9 })).projects).toHaveLength(1);
  });

  it("reports truncation instead of silently returning a short list", async () => {
    for (let i = 0; i < 12; i += 1) mkdirSync(join(home, `dir-${String(i)}`), { recursive: true });
    project("dir-11/target", "p-late");
    const result = await scan({ maxDirs: 3 });
    expect(result.stoppedBy).toBe("dirs");
    // The point of the flag: "found 0" and "gave up before looking" must not
    // render as the same answer.
    expect(result.visitedDirs).toBeLessThanOrEqual(3);
  });

  it("gives up on a time budget, not just a directory count", async () => {
    // The defect this pins cost a hung console: the walk was bounded by
    // directory COUNT only, and the per-directory cost is not a constant. The
    // same walk over the same home ran ~600x slower from one process than
    // another (per-call security checks), which turned a 20000-directory
    // ceiling into a ten-minute request that never answered.
    //
    // `maxMs: 0` is the deterministic form of "the budget is already gone" —
    // no sleeping, no timing flake.
    project("code/app", "p-app");
    const result = await scan({ maxMs: 0 });
    expect(result.stoppedBy).toBe("time");
    expect(result.visitedDirs).toBe(0);
  });

  it("reports no stop reason when the walk actually finished", async () => {
    // The other half of the contract: `stoppedBy` must not be a permanent
    // "maybe". A run that completed has to say so, or the page shows the
    // partial-result caveat on every successful scan and users learn to ignore
    // it.
    project("code/app", "p-app");
    expect((await scan()).stoppedBy).toBeNull();
  });
});

describe("backfill writes what it found, and nothing it guessed", () => {
  it("registers a discovered project with no version at all", async () => {
    const root = project("code/ancient", "p-old");
    const result = await backfillProjectRegistry({ roots: [home], globalRoot });

    expect(result.added.map((p) => p.path)).toEqual([root]);
    const [entry] = await listRegisteredProjects(globalRoot);
    expect(entry).toMatchObject({ path: root, projectId: "p-old" });
    // NOT the running CLI version, and not the string "unknown": a
    // pre-manifest install has no version, and inventing one would report five
    // ancient installs as current.
    expect(entry?.fabricVersion).toBeNull();
  });

  it("leaves an existing entry's recorded version alone", async () => {
    const root = project("code/known", "p-known");
    await registerProject({ path: root, projectId: "p-known", fabricVersion: "2.1.0" }, globalRoot);

    const result = await backfillProjectRegistry({ roots: [home], globalRoot });
    expect(result.added).toEqual([]);
    expect(result.alreadyKnown).toBe(1);
    // A real install date and version beat an observation made just now.
    expect((await listRegisteredProjects(globalRoot))[0]?.fabricVersion).toBe("2.1.0");
  });

  it("turns an unopenable id into an openable project", async () => {
    // The end-to-end claim: before the scan the console can name this project
    // but not open it; after the scan it can do both. Asserted through
    // mergeProjectList because that is what the switcher actually renders.
    const root = project("code/found", "p-found");
    writeFileSync(
      join(globalRoot, "state", "bindings", "p-found_resolved.json"),
      JSON.stringify({ project_id: "p-found" }),
      "utf8",
    );

    const before = mergeProjectList({
      registry: await listRegisteredProjects(globalRoot),
      configuredIds: [],
      boundIds: listBoundProjectIds(globalRoot),
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(before).toHaveLength(1);
    expect(before[0]?.path).toBeNull();

    await backfillProjectRegistry({ roots: [home], globalRoot });

    const after = mergeProjectList({
      registry: await listRegisteredProjects(globalRoot),
      configuredIds: [],
      boundIds: listBoundProjectIds(globalRoot),
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(after).toHaveLength(1);
    expect(after[0]?.path).toBe(root);
  });
});

describe("store bindings are a source of project identity", () => {
  it("surfaces an id that only a binding snapshot knows about", async () => {
    writeFileSync(
      join(globalRoot, "state", "bindings", "p-bound_resolved.json"),
      JSON.stringify({ project_id: "p-bound" }),
      "utf8",
    );
    expect(listBoundProjectIds(globalRoot)).toEqual(["p-bound"]);

    // It reaches the list as a row that cannot be opened — which is the whole
    // point. Not reaching the list at all is how the console came to report one
    // project on a machine with eight, and a row nobody counts is a row nobody
    // can be told about.
    const rows = mergeProjectList({
      registry: [],
      configuredIds: [],
      boundIds: listBoundProjectIds(globalRoot),
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(rows).toMatchObject([{ projectId: "p-bound", path: null, origin: "config-only" }]);
  });

  it("survives a corrupt snapshot without losing the others", async () => {
    const dir = join(globalRoot, "state", "bindings");
    writeFileSync(join(dir, "good_resolved.json"), JSON.stringify({ project_id: "p-good" }));
    writeFileSync(join(dir, "bad_resolved.json"), "{ not json");
    expect(listBoundProjectIds(globalRoot)).toEqual(["p-good"]);
  });

  it("does not double-count an id the registry already has", async () => {
    const dir = join(globalRoot, "state", "bindings");
    writeFileSync(join(dir, "dup_resolved.json"), JSON.stringify({ project_id: "p-dup" }));
    const rows = mergeProjectList({
      registry: [
        {
          projectId: "p-dup",
          path: "/repos/dup",
          fabricVersion: "2.6.0",
          registeredAt: "2026-01-01T00:00:00.000Z",
          stale: false,
        },
      ],
      configuredIds: ["p-dup"],
      boundIds: ["p-dup"],
      currentProjectId: null,
      currentProjectPath: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe("/repos/dup");
  });
});

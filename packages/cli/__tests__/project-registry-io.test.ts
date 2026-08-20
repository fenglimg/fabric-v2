import { existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deregisterProjectByPath,
  listRegisteredProjects,
  projectRegistryPath,
  registerProject,
} from "../src/store/project-registry-io.js";

// ---------------------------------------------------------------------------
// Machine-level project registry (~/.fabric/state/projects.json).
//
// The registry is what makes cross-project version overview possible at all:
// `bindings/<project_id>_resolved.json` records which stores a project reads,
// but nothing on the machine records WHERE the project lives on disk.
//
// Conventions follow bindings-io.test.ts: the global root is passed EXPLICITLY
// rather than via FABRIC_HOME. That is deliberate — KT-PIT-0062 records a
// config-layer suite that set HOME while the reader read FABRIC_HOME, so the
// config was never loaded and the tests only passed because the asserted value
// happened to equal the code default. Passing the root as an argument removes
// that entire failure class instead of guarding against it.
//
// For the same reason every asserted value below is deliberately UNLIKE any
// plausible default: versions are "9.9.9-test.N", never "unknown" or the real
// CLI version.
// ---------------------------------------------------------------------------

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

const dirs: string[] = [];
let globalRoot: string;

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

beforeEach(() => {
  globalRoot = join(makeDir("fabric-registry-home-"), ".fabric");
});

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("registerProject", () => {
  it("records path, version and timestamp for a new project", async () => {
    const projectPath = makeDir("fabric-registry-proj-");

    const ok = await registerProject(
      {
        projectId: PROJECT_A,
        path: projectPath,
        fabricVersion: "9.9.9-test.1",
        registeredAt: "2026-08-17T10:00:00.000Z",
      },
      globalRoot,
    );

    expect(ok).toBe(true);

    const raw = JSON.parse(readFileSync(projectRegistryPath(globalRoot), "utf8")) as {
      schema_version: number;
      projects: Record<string, { project_id?: string; fabric_version: string; registered_at: string }>;
    };
    expect(raw.schema_version).toBe(1);
    // Keyed by install PATH, not project_id — a store-less install has no id.
    expect(raw.projects[projectPath]).toEqual({
      project_id: PROJECT_A,
      fabric_version: "9.9.9-test.1",
      registered_at: "2026-08-17T10:00:00.000Z",
    });
  });

  it("is a snapshot, not an append log: three registrations leave one entry (AC2)", async () => {
    const projectPath = makeDir("fabric-registry-proj-");

    // Three runs is the minimum that separates "accumulates one per run" from
    // "only the second run takes effect" — two runs cannot tell those apart.
    for (const [i, version] of ["9.9.9-test.1", "9.9.9-test.2", "9.9.9-test.3"].entries()) {
      await registerProject(
        {
          projectId: PROJECT_A,
          path: projectPath,
          fabricVersion: version,
          registeredAt: `2026-08-17T10:0${i}:00.000Z`,
        },
        globalRoot,
      );
    }

    const entries = await listRegisteredProjects(globalRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.fabricVersion).toBe("9.9.9-test.3");
    expect(entries[0]!.registeredAt).toBe("2026-08-17T10:02:00.000Z");
  });

  it("drops the old location when a project with a known id moves", async () => {
    const before = makeDir("fabric-registry-before-");
    const after = makeDir("fabric-registry-after-");

    await registerProject(
      { projectId: PROJECT_A, path: before, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );
    await registerProject(
      { projectId: PROJECT_A, path: after, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );

    const entries = await listRegisteredProjects(globalRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(after);
  });

  it("registers a project that has no store binding (no project_id)", async () => {
    // A `fabric install` that binds no store leaves fabric-config.json as `{}`.
    // Such projects MUST still be registered — gating on project_id would make
    // exactly them invisible to the console, which is the failure this registry
    // exists to prevent. Regression guard: an earlier revision skipped these.
    const projectPath = makeDir("fabric-registry-nostore-");

    const ok = await registerProject(
      { path: projectPath, fabricVersion: "9.9.9-test.7" },
      globalRoot,
    );

    expect(ok).toBe(true);
    const entries = await listRegisteredProjects(globalRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe(projectPath);
    expect(entries[0]!.projectId).toBeUndefined();
    expect(entries[0]!.fabricVersion).toBe("9.9.9-test.7");
  });

  it("leaves the old location as a stale entry when an id-less project moves", async () => {
    // Without an id there is no way to know the two paths are the same project,
    // so the old one survives as `stale` rather than being silently guessed at.
    const before = makeDir("fabric-registry-idless-before-");
    const after = makeDir("fabric-registry-idless-after-");

    await registerProject({ path: before, fabricVersion: "9.9.9-test.1" }, globalRoot);
    await registerProject({ path: after, fabricVersion: "9.9.9-test.1" }, globalRoot);

    const entries = await listRegisteredProjects(globalRoot);
    expect(entries.map((e) => e.path).sort()).toEqual([before, after].sort());
  });

  it("keeps distinct projects side by side", async () => {
    const pathA = makeDir("fabric-registry-a-");
    const pathB = makeDir("fabric-registry-b-");

    await registerProject(
      { projectId: PROJECT_A, path: pathA, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );
    await registerProject(
      { projectId: PROJECT_B, path: pathB, fabricVersion: "9.9.9-test.2" },
      globalRoot,
    );

    const ids = (await listRegisteredProjects(globalRoot)).map((e) => e.projectId).sort();
    expect(ids).toEqual([PROJECT_A, PROJECT_B]);
  });

  it("survives a corrupted registry file and rebuilds it (AC6)", async () => {
    mkdirSync(join(globalRoot, "state"), { recursive: true });
    writeFileSync(projectRegistryPath(globalRoot), "{ this is not json", "utf8");

    const projectPath = makeDir("fabric-registry-proj-");
    const ok = await registerProject(
      { projectId: PROJECT_A, path: projectPath, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );

    expect(ok).toBe(true);
    const entries = await listRegisteredProjects(globalRoot);
    expect(entries.map((e) => e.projectId)).toEqual([PROJECT_A]);
  });

  it("never throws when the registry cannot be written (C6)", async () => {
    // A path whose parent is a FILE cannot be created as a directory — this is
    // the portable way to make the write fail (chmod is a no-op for root in CI
    // containers, and Windows ignores it entirely).
    const blocker = join(makeDir("fabric-registry-blocked-"), "not-a-dir");
    writeFileSync(blocker, "", "utf8");

    const ok = await registerProject(
      { projectId: PROJECT_A, path: "/tmp/whatever", fabricVersion: "9.9.9-test.1" },
      join(blocker, ".fabric"),
    );

    expect(ok).toBe(false);
  });

  it("does not lose entries when two registrations race (AC9)", async () => {
    const pathA = makeDir("fabric-registry-a-");
    const pathB = makeDir("fabric-registry-b-");

    // Both read-modify-write the same file concurrently. Without the file lock
    // the later write clobbers the earlier one and a project silently vanishes
    // from the console's list.
    await Promise.all([
      registerProject(
        { projectId: PROJECT_A, path: pathA, fabricVersion: "9.9.9-test.1" },
        globalRoot,
      ),
      registerProject(
        { projectId: PROJECT_B, path: pathB, fabricVersion: "9.9.9-test.2" },
        globalRoot,
      ),
    ]);

    const ids = (await listRegisteredProjects(globalRoot)).map((e) => e.projectId).sort();
    expect(ids).toEqual([PROJECT_A, PROJECT_B]);
  });
});

describe("deregisterProjectByPath", () => {
  // KT-PIT-0074: a register mechanism without its uninstall-side twin leaves a
  // self-contradicting half-mechanism — here, a ghost entry the console shows as
  // "installed but outdated" forever, whose upgrade button reinstalls Fabric.
  //
  // Matching is by PATH, not project_id: uninstall deletes
  // `.fabric/fabric-config.json` (where project_id lives), so an id-based
  // deregistration would depend on read-before-delete ordering.
  it("removes only the named project (AC10)", async () => {
    const pathA = makeDir("fabric-registry-a-");
    const pathB = makeDir("fabric-registry-b-");

    await registerProject(
      { projectId: PROJECT_A, path: pathA, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );
    await registerProject(
      { projectId: PROJECT_B, path: pathB, fabricVersion: "9.9.9-test.2" },
      globalRoot,
    );

    expect(await deregisterProjectByPath(pathA, globalRoot)).toBe(true);

    const entries = await listRegisteredProjects(globalRoot);
    expect(entries.map((e) => e.projectId)).toEqual([PROJECT_B]);
    expect(entries[0]!.fabricVersion).toBe("9.9.9-test.2");
  });

  it("is a silent no-op for an unknown path", async () => {
    const known = makeDir("fabric-registry-known-");
    await registerProject(
      { projectId: PROJECT_A, path: known, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );

    expect(await deregisterProjectByPath("/no/such/project", globalRoot)).toBe(false);
    expect(await listRegisteredProjects(globalRoot)).toHaveLength(1);
  });

  it("is a silent no-op when the registry does not exist", async () => {
    expect(await deregisterProjectByPath("/no/such/project", globalRoot)).toBe(false);
    expect(existsSync(projectRegistryPath(globalRoot))).toBe(false);
  });
});

describe("listRegisteredProjects", () => {
  it("returns an empty list when the registry does not exist", async () => {
    expect(await listRegisteredProjects(globalRoot)).toEqual([]);
    // Reading must not create the file — a read should leave no trace.
    expect(existsSync(projectRegistryPath(globalRoot))).toBe(false);
  });

  it("returns an empty list when the registry is corrupt", async () => {
    mkdirSync(join(globalRoot, "state"), { recursive: true });
    writeFileSync(projectRegistryPath(globalRoot), "not json at all", "utf8");

    expect(await listRegisteredProjects(globalRoot)).toEqual([]);
  });

  it("derives stale from disk without affecting healthy entries (AC4)", async () => {
    const alive = makeDir("fabric-registry-alive-");
    const doomed = makeDir("fabric-registry-doomed-");

    await registerProject(
      { projectId: PROJECT_A, path: alive, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );
    await registerProject(
      { projectId: PROJECT_B, path: doomed, fabricVersion: "9.9.9-test.2" },
      globalRoot,
    );

    // Rename rather than delete: "the path still exists but is no longer that
    // repo" is the realistic failure, and it also proves stale is derived at
    // read time rather than stamped at write time.
    renameSync(doomed, `${doomed}-moved`);
    dirs.push(`${doomed}-moved`);

    const byId = new Map((await listRegisteredProjects(globalRoot)).map((e) => [e.projectId, e]));
    expect(byId.get(PROJECT_A)!.stale).toBe(false);
    expect(byId.get(PROJECT_B)!.stale).toBe(true);
    // The healthy entry keeps its full payload — a stale sibling must not
    // degrade it.
    expect(byId.get(PROJECT_A)!.fabricVersion).toBe("9.9.9-test.1");
  });

  it("does not write to disk while reading", async () => {
    const projectPath = makeDir("fabric-registry-proj-");
    await registerProject(
      { projectId: PROJECT_A, path: projectPath, fabricVersion: "9.9.9-test.1" },
      globalRoot,
    );

    const before = statSync(projectRegistryPath(globalRoot)).mtimeMs;
    await listRegisteredProjects(globalRoot);
    expect(statSync(projectRegistryPath(globalRoot)).mtimeMs).toBe(before);
  });
});

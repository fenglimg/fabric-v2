import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createTranslator,
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import {
  createProjectRegistryDriftCheck,
  fixProjectRegistryDrift,
  inspectProjectRegistryDrift,
  type RegistryDriftInspection,
} from "./doctor-project-registry-drift.js";

// W2 (F-003) — doctor lint over projects.json ↔ knowledge/projects/<id>/ folder
// tree. Fixture mirrors doctor-scope-lint.test.ts (FABRIC_HOME redirect +
// saveGlobalConfig + seeded store dirs + project required_stores binding).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const TEAM_STORE = "44444444-4444-4444-8444-444444444444";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-regdrift-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function createProject(config: object): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-regdrift-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return projectRoot;
}

function storeDirOf(storeUuid: string): string {
  return join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: storeUuid }));
}

// Register `ids` in the store's projects.json.
async function registerProjects(storeUuid: string, ids: string[]): Promise<void> {
  const storeDir = storeDirOf(storeUuid);
  await mkdir(storeDir, { recursive: true });
  await writeFile(
    join(storeDir, STORE_LAYOUT.projectsFile),
    `${JSON.stringify(
      { projects: ids.map((id) => ({ id, created_at: "2026-07-01T00:00:00.000Z" })) },
      null,
      2,
    )}\n`,
  );
}

// Create an on-disk projects/<id>/ folder. When `withEntry` is true, seed one
// .md file in the decisions/ type subdir so the folder is non-empty.
async function seedProjectFolder(
  storeUuid: string,
  projectId: string,
  opts: { withEntry: boolean },
): Promise<void> {
  const base = join(
    storeDirOf(storeUuid),
    STORE_LAYOUT.knowledgeDir,
    "projects",
    projectId,
    "decisions",
  );
  await mkdir(base, { recursive: true });
  if (opts.withEntry) {
    await writeFile(join(base, "KT-DEC-9001.md"), "---\nid: KT-DEC-9001\n---\n# Fixture\n");
  }
}

function mountTeamOnly(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

const TEAM_BINDING = { required_stores: [{ id: "team" }] };

describe("inspectProjectRegistryDrift (F-003 four-state matrix)", () => {
  it("orphan-folder: on-disk folder NOT registered and empty → warning-grade finding", async () => {
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, []);
    await seedProjectFolder(TEAM_STORE, "orphan", { withEntry: false });
    mountTeamOnly();

    const { findings } = await inspectProjectRegistryDrift(projectRoot);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "orphan_folder", project_id: "orphan" });

    const check = createProjectRegistryDriftCheck(createTranslator("en"), { findings });
    expect(check.status).toBe("warn");
    expect(check.kind).toBe("warning");
  });

  it("unregistered-write: on-disk folder NOT registered but has entries → error / manual_error", async () => {
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, []);
    await seedProjectFolder(TEAM_STORE, "unrouted", { withEntry: true });
    mountTeamOnly();

    const { findings } = await inspectProjectRegistryDrift(projectRoot);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "unregistered_write", project_id: "unrouted" });

    const check = createProjectRegistryDriftCheck(createTranslator("en"), { findings });
    expect(check.status).toBe("error");
    expect(check.kind).toBe("manual_error");
  });

  it("empty-folder: registered id with an empty folder → info", async () => {
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, ["alpha"]);
    await seedProjectFolder(TEAM_STORE, "alpha", { withEntry: false });
    mountTeamOnly();

    const { findings } = await inspectProjectRegistryDrift(projectRoot);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ kind: "empty_folder", project_id: "alpha" });

    const check = createProjectRegistryDriftCheck(createTranslator("en"), { findings });
    expect(check.kind).toBe("info");
  });

  it("ghost-registration: registered id with NO folder → ZERO findings (lazy is legal, DA-05)", async () => {
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, ["lazy"]); // registered, but no folder on disk
    mountTeamOnly();

    await expect(inspectProjectRegistryDrift(projectRoot)).resolves.toEqual({ findings: [] });
  });

  it("healthy: every projects/<id>/ registered and non-empty → ZERO findings", async () => {
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, ["alpha", "beta"]);
    await seedProjectFolder(TEAM_STORE, "alpha", { withEntry: true });
    await seedProjectFolder(TEAM_STORE, "beta", { withEntry: true });
    mountTeamOnly();

    await expect(inspectProjectRegistryDrift(projectRoot)).resolves.toEqual({ findings: [] });
  });

  it("returns [] when the project has no mounted store (degrades, never throws)", async () => {
    const projectRoot = await createProject({});
    await expect(inspectProjectRegistryDrift(projectRoot)).resolves.toEqual({ findings: [] });
  });

  it("deprecated-not-orphan: a registered id is never reported as orphan (DA-07)", async () => {
    // A projects.json registration is exactly what makes an id NOT an orphan —
    // there is no deprecated/status axis on storeProjectSchema, so a registered
    // id (whatever its lifecycle) with a healthy folder yields no drift.
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, ["kept"]);
    await seedProjectFolder(TEAM_STORE, "kept", { withEntry: true });
    mountTeamOnly();

    const { findings } = await inspectProjectRegistryDrift(projectRoot);
    expect(findings.some((f) => f.kind === "orphan_folder")).toBe(false);
  });
});

describe("fixProjectRegistryDrift (rescue-before-delete)", () => {
  it("rescue-registers a non-empty unregistered folder WITHOUT deleting it", async () => {
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, []);
    await seedProjectFolder(TEAM_STORE, "unrouted", { withEntry: true });
    mountTeamOnly();

    const result = await fixProjectRegistryDrift(projectRoot);
    expect(result.registered.map((f) => f.project_id)).toContain("unrouted");
    expect(result.pruned).toHaveLength(0);

    // The registration landed …
    const projectsJson = JSON.parse(
      await readFile(join(storeDirOf(TEAM_STORE), STORE_LAYOUT.projectsFile), "utf8"),
    ) as { projects: Array<{ id: string }> };
    expect(projectsJson.projects.map((p) => p.id)).toContain("unrouted");

    // … and the data-bearing folder was NEVER deleted (rescue-before-delete).
    const entry = await readFile(
      join(
        storeDirOf(TEAM_STORE),
        STORE_LAYOUT.knowledgeDir,
        "projects",
        "unrouted",
        "decisions",
        "KT-DEC-9001.md",
      ),
      "utf8",
    );
    expect(entry).toContain("KT-DEC-9001");

    // Post-fix the drift is resolved (registered + non-empty → healthy).
    await expect(inspectProjectRegistryDrift(projectRoot)).resolves.toEqual({ findings: [] });
  });

  it("prunes ONLY a genuinely-empty registered folder", async () => {
    const projectRoot = await createProject(TEAM_BINDING);
    await registerProjects(TEAM_STORE, ["alpha"]);
    await seedProjectFolder(TEAM_STORE, "alpha", { withEntry: false });
    mountTeamOnly();

    const result = await fixProjectRegistryDrift(projectRoot);
    expect(result.pruned.map((f) => f.project_id)).toContain("alpha");

    // Folder gone → registered id with no folder = ghost = no finding.
    await expect(inspectProjectRegistryDrift(projectRoot)).resolves.toEqual({ findings: [] });
  });
});

describe("createProjectRegistryDriftCheck", () => {
  const t = createTranslator("en");
  const base = { store_alias: "team", store_uuid: TEAM_STORE, store_dir: "/x" };

  it("renders ok when there is no drift", () => {
    const check = createProjectRegistryDriftCheck(t, { findings: [] });
    expect(check.status).toBe("ok");
    expect(check.code).toBeUndefined();
  });

  it("escalates to manual_error when any unregistered-write is present", () => {
    const inspection: RegistryDriftInspection = {
      findings: [
        { ...base, project_id: "e", kind: "empty_folder" },
        { ...base, project_id: "u", kind: "unregistered_write" },
      ],
    };
    const check = createProjectRegistryDriftCheck(t, inspection);
    expect(check.status).toBe("error");
    expect(check.kind).toBe("manual_error");
    expect(check.code).toBe("project_registry_drift");
    expect(check.fixable).toBe(true);
    expect(check.message).toContain("unregistered-write");
  });
});

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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
  createLayerMismatchCheck,
  createStableIdCollisionCheck,
  inspectStoreStableIdIntegrity,
} from "./doctor-stable-id-collision.js";
import { runDoctorReport } from "./doctor.js";

// v2.2 Goal B (G-INTEGRITY) — store-aware stable_id collision + layer mismatch.
// Fixture mirrors doctor-scope-lint.test.ts (FABRIC_HOME redirect +
// saveGlobalConfig + seeded store knowledge + project required_stores binding).
// Each case is a producer-consumer round-trip: seed a store entry that SHOULD
// trip the lint → run the inspect / full doctor report → assert it actually
// fires (the fallback-purge anti-false-green oracle, KT-PIT-0010).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const TEAM_STORE = "44444444-4444-4444-8444-444444444444";
const PERSONAL_STORE = "55555555-5555-4555-8555-555555555555";
const TEAM_STORE_2 = "66666666-6666-4666-8666-666666666666";

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

async function freshHome(): Promise<void> {
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-integrity-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
}

async function createProject(config: object): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-integrity-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return projectRoot;
}

function entryMd(id: string): string {
  return [
    "---",
    `id: ${id}`,
    "type: decisions",
    "layer: team",
    "maturity: proven",
    "summary: fixture entry",
    "---",
    "",
    "# Fixture",
    "",
  ].join("\n");
}

async function seedEntry(storeUuid: string, fileName: string, id: string): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: storeUuid, personal: storeUuid === PERSONAL_STORE }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), entryMd(id));
}

function mountTeamOnly(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

function mountTeamAndPersonal(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" },
      { store_uuid: PERSONAL_STORE, alias: "personal", personal: true },
    ],
  });
}

function mountTwoTeams(): void {
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: TEAM_STORE, alias: "team", remote: "git@e:t.git" },
      { store_uuid: TEAM_STORE_2, alias: "team2", remote: "git@e:t2.git" },
    ],
  });
}

describe("inspectStoreStableIdIntegrity (G-INTEGRITY)", () => {
  it("clean store → no collisions, no layer mismatches", async () => {
    await freshHome();
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedEntry(TEAM_STORE, "KT-DEC-0001--a.md", "KT-DEC-0001");
    await seedEntry(TEAM_STORE, "KT-DEC-0002--b.md", "KT-DEC-0002");
    mountTeamOnly();

    const result = await inspectStoreStableIdIntegrity(projectRoot);
    expect(result.collision.collisions).toEqual([]);
    expect(result.layerMismatch.mismatches).toEqual([]);
  });

  it("FIRES collision when two files in ONE store declare the same stable_id", async () => {
    await freshHome();
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedEntry(TEAM_STORE, "KT-DEC-0001--original.md", "KT-DEC-0001");
    await seedEntry(TEAM_STORE, "KT-DEC-0001--dupe.md", "KT-DEC-0001");
    mountTeamOnly();

    const result = await inspectStoreStableIdIntegrity(projectRoot);
    expect(result.collision.collisions).toHaveLength(1);
    expect(result.collision.collisions[0].stable_id).toBe("team:KT-DEC-0001");
    expect(result.collision.collisions[0].files).toHaveLength(2);
  });

  it("does NOT flag the same local id across DIFFERENT stores (store-qualified)", async () => {
    await freshHome();
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }, { id: "team2" }],
    });
    await seedEntry(TEAM_STORE, "KT-DEC-0001--a.md", "KT-DEC-0001");
    await seedEntry(TEAM_STORE_2, "KT-DEC-0001--b.md", "KT-DEC-0001");
    mountTwoTeams();

    const result = await inspectStoreStableIdIntegrity(projectRoot);
    expect(result.collision.collisions).toEqual([]);
  });

  it("FIRES layer mismatch for a KP-* id physically in a team (shared) store", async () => {
    await freshHome();
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedEntry(TEAM_STORE, "KP-DEC-0001--leaked.md", "KP-DEC-0001");
    mountTeamOnly();

    const result = await inspectStoreStableIdIntegrity(projectRoot);
    expect(result.layerMismatch.mismatches).toHaveLength(1);
    expect(result.layerMismatch.mismatches[0].stable_id).toBe("KP-DEC-0001");
    expect(result.layerMismatch.mismatches[0].located_in).toBe("team");
    expect(result.layerMismatch.mismatches[0].expected_layer).toBe("personal");
  });

  it("FIRES layer mismatch for a KT-* id physically in the personal store", async () => {
    await freshHome();
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }, { id: "personal" }],
    });
    await seedEntry(PERSONAL_STORE, "KT-DEC-0001--misplaced.md", "KT-DEC-0001");
    mountTeamAndPersonal();

    const result = await inspectStoreStableIdIntegrity(projectRoot);
    const mismatch = result.layerMismatch.mismatches.find((m) => m.stable_id === "KT-DEC-0001");
    expect(mismatch).toBeDefined();
    expect(mismatch?.located_in).toBe("personal");
    expect(mismatch?.expected_layer).toBe("team");
  });

  it("does NOT flag KP-* in personal store / KT-* in team store (correctly aligned)", async () => {
    await freshHome();
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }, { id: "personal" }],
    });
    await seedEntry(TEAM_STORE, "KT-DEC-0001--ok.md", "KT-DEC-0001");
    await seedEntry(PERSONAL_STORE, "KP-DEC-0001--ok.md", "KP-DEC-0001");
    mountTeamAndPersonal();

    const result = await inspectStoreStableIdIntegrity(projectRoot);
    expect(result.layerMismatch.mismatches).toEqual([]);
  });
});

describe("runDoctorReport round-trip (G-INTEGRITY consumer)", () => {
  it("surfaces stable_id_collision as a warning when a store has a colliding id", async () => {
    await freshHome();
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedEntry(TEAM_STORE, "KT-DEC-0001--a.md", "KT-DEC-0001");
    await seedEntry(TEAM_STORE, "KT-DEC-0001--b.md", "KT-DEC-0001");
    mountTeamOnly();

    const report = await runDoctorReport(projectRoot);
    const warning = report.warnings.find((w) => w.code === "stable_id_collision");
    expect(warning).toBeDefined();
    expect(warning?.message).toContain("KT-DEC-0001");
  });

  it("surfaces knowledge_layer_mismatch as a manual error when a KP id sits in a shared store", async () => {
    await freshHome();
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedEntry(TEAM_STORE, "KP-DEC-0001--leaked.md", "KP-DEC-0001");
    mountTeamOnly();

    const report = await runDoctorReport(projectRoot);
    const manual = report.manual_errors.find((e) => e.code === "knowledge_layer_mismatch");
    expect(manual).toBeDefined();
    expect(manual?.message).toContain("KP-DEC-0001");
  });
});

describe("createStableIdCollisionCheck / createLayerMismatchCheck (renderers)", () => {
  const t = createTranslator("en");

  it("collision renderer: ok when empty, warning when populated", () => {
    expect(createStableIdCollisionCheck(t, { collisions: [] }).status).toBe("ok");
    const fired = createStableIdCollisionCheck(t, {
      collisions: [{ stable_id: "team:KT-DEC-0001", files: ["team:decisions/a.md", "team:decisions/b.md"] }],
    });
    expect(fired.status).toBe("warn");
    expect(fired.kind).toBe("warning");
    expect(fired.code).toBe("stable_id_collision");
  });

  it("layer mismatch renderer: ok when empty, manual error when populated", () => {
    expect(createLayerMismatchCheck(t, { mismatches: [] }).status).toBe("ok");
    const fired = createLayerMismatchCheck(t, {
      mismatches: [
        { path: "team:decisions/KP-DEC-0001--x.md", located_in: "team", expected_layer: "personal", stable_id: "KP-DEC-0001" },
      ],
    });
    expect(fired.status).toBe("error");
    expect(fired.kind).toBe("manual_error");
    expect(fired.code).toBe("knowledge_layer_mismatch");
  });
});

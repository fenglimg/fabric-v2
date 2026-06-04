import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { lintStoreScopes } from "./doctor-scope-lint.js";

// v2.2 W4 (G-GUARD / A6) — doctor scope lint over read-set stores. Fixture
// mirrors cross-store-recall-project-filter.test.ts (FABRIC_HOME redirect +
// saveGlobalConfig + seeded store knowledge + project required_stores binding).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const TEAM_STORE = "44444444-4444-4444-8444-444444444444";
const PERSONAL_STORE = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-scopelint-home-"));
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
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-scopelint-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return projectRoot;
}

// Build a knowledge entry, omitting a field entirely when its value is null.
function entryMd(opts: {
  id: string;
  semanticScope: string | null;
  visibilityStore: string | null;
}): string {
  const lines = ["---", `id: ${opts.id}`, "type: decision", "layer: team"];
  if (opts.semanticScope !== null) {
    lines.push(`semantic_scope: ${opts.semanticScope}`);
  }
  if (opts.visibilityStore !== null) {
    lines.push(`visibility_store: "${opts.visibilityStore}"`);
  }
  lines.push("maturity: proven", "summary: fixture entry", "---", "", "# Fixture", "");
  return lines.join("\n");
}

async function seedEntry(
  storeUuid: string,
  fileName: string,
  opts: { id: string; semanticScope: string | null; visibilityStore: string | null },
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePath(storeUuid),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), entryMd(opts));
}

async function registerProjects(storeUuid: string, ids: string[]): Promise<void> {
  const storeDir = join(resolveGlobalRoot(), storeRelativePath(storeUuid));
  await mkdir(storeDir, { recursive: true });
  const path = join(storeDir, STORE_LAYOUT.projectsFile);
  await writeFile(
    path,
    `${JSON.stringify(
      { projects: ids.map((id) => ({ id, created_at: "2026-06-04T00:00:00.000Z" })) },
      null,
      2,
    )}\n`,
  );
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

describe("lintStoreScopes (G-GUARD / A6)", () => {
  it("returns no violations for a clean store with valid scope metadata", async () => {
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await registerProjects(TEAM_STORE, ["alpha"]);
    await seedEntry(TEAM_STORE, "KT-DEC-9001.md", {
      id: "KT-DEC-9001",
      semanticScope: "project:alpha",
      visibilityStore: "team",
    });
    await seedEntry(TEAM_STORE, "KT-DEC-9002.md", {
      id: "KT-DEC-9002",
      semanticScope: "team",
      visibilityStore: "team",
    });
    mountTeamOnly();

    expect(lintStoreScopes(projectRoot)).toEqual([]);
  });

  it("flags an entry missing semantic_scope and/or visibility_store", async () => {
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedEntry(TEAM_STORE, "KT-DEC-9001.md", {
      id: "KT-DEC-9001",
      semanticScope: null,
      visibilityStore: null,
    });
    mountTeamOnly();

    const violations = lintStoreScopes(projectRoot);
    const missing = violations.filter((v) => v.code === "missing_scope_fields");
    expect(missing).toHaveLength(1);
    expect(missing[0].stable_id).toBe("KT-DEC-9001");
    expect(missing[0].detail).toContain("semantic_scope");
    expect(missing[0].detail).toContain("visibility_store");
  });

  it("flags a personal-scope entry physically resident in a SHARED store (R5#3)", async () => {
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    // personal semantic_scope sitting in the shared team store — the privacy leak.
    await seedEntry(TEAM_STORE, "KP-DEC-9001.md", {
      id: "KP-DEC-9001",
      semanticScope: "personal",
      visibilityStore: "team",
    });
    mountTeamOnly();

    const leaks = lintStoreScopes(projectRoot).filter(
      (v) => v.code === "personal_leak_in_shared_store",
    );
    expect(leaks).toHaveLength(1);
    expect(leaks[0].store_alias).toBe("team");
  });

  it("does NOT flag a personal entry resident in the personal store", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }, { id: "personal" }],
    });
    await seedEntry(PERSONAL_STORE, "KP-DEC-9001.md", {
      id: "KP-DEC-9001",
      semanticScope: "personal",
      visibilityStore: "personal",
    });
    mountTeamAndPersonal();

    const leaks = lintStoreScopes(projectRoot).filter(
      (v) => v.code === "personal_leak_in_shared_store",
    );
    expect(leaks).toHaveLength(0);
  });

  it("flags a project:<id> coordinate whose project is not registered in the store", async () => {
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await registerProjects(TEAM_STORE, ["alpha"]); // only alpha registered
    await seedEntry(TEAM_STORE, "KT-DEC-9001.md", {
      id: "KT-DEC-9001",
      semanticScope: "project:ghost", // not registered → dangling
      visibilityStore: "team",
    });
    await seedEntry(TEAM_STORE, "KT-DEC-9002.md", {
      id: "KT-DEC-9002",
      semanticScope: "project:alpha", // registered → ok
      visibilityStore: "team",
    });
    mountTeamOnly();

    const dangling = lintStoreScopes(projectRoot).filter(
      (v) => v.code === "dangling_project_ref",
    );
    expect(dangling).toHaveLength(1);
    expect(dangling[0].stable_id).toBe("KT-DEC-9001");
    expect(dangling[0].detail).toContain("ghost");
  });

  it("returns [] when the project has no mounted store (degrades, never throws)", async () => {
    const projectRoot = await createProject({});
    expect(lintStoreScopes(projectRoot)).toEqual([]);
  });
});

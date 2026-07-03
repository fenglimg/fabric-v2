import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recognizeStoreDir } from "../../src/resolver/store-disk-reader.js";
import { STORE_LAYOUT } from "../../src/schemas/store.js";
import {
  aggregatePendingAcrossStores,
  initStore,
  listStoreKnowledge,
  readKnowledgeAcrossStores,
  STORE_PENDING_DIR,
  type MountedStoreDir,
} from "../../src/store/core.js";
import { cleanupTestWall, createIsolatedHome } from "../helpers/test-wall.js";

// v2.1.0-rc.1 P1 — multi-store storage + git core integration tests (real fs +
// real git, isolated HOME). Covers: empty default store init, cross-store read
// isolation (read 不混), events/agents.meta excluded from store git, and the
// cross-store pending aggregation API.

afterEach(() => {
  cleanupTestWall();
});

const TEAM_UUID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATFORM_UUID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function makeStore(home: ReturnType<typeof createIsolatedHome>, uuid: string, alias: string): Promise<MountedStoreDir> {
  const dir = join(home.storesRoot, uuid);
  mkdirSync(dir, { recursive: true });
  await initStore(dir, { store_uuid: uuid, created_at: "2026-05-30T00:00:00.000Z", canonical_alias: alias });
  return { store_uuid: uuid, alias, dir };
}

function writeEntry(store: MountedStoreDir, type: string, name: string, body: string): void {
  const file = join(store.dir, STORE_LAYOUT.knowledgeDir, type, name);
  writeFileSync(file, body, "utf8");
}

// Write a project-partitioned entry under knowledge/projects/<id>/<type>/.
function writeProjectEntry(store: MountedStoreDir, project: string, type: string, name: string, body: string): void {
  const dir = join(store.dir, STORE_LAYOUT.knowledgeDir, "projects", project, type);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body, "utf8");
}

describe("P1 store core — init", () => {
  it("scaffolds an empty default store recognized by the disk reader", async () => {
    const home = createIsolatedHome();
    const store = await makeStore(home, TEAM_UUID, "team");
    expect(recognizeStoreDir(store.dir)).toBe(true);
    expect(existsSync(join(store.dir, STORE_LAYOUT.knowledgeDir, "decisions"))).toBe(true);
    expect(existsSync(join(store.dir, ".git"))).toBe(true);
  });

  it("refuses to re-init over an existing store.json (mint-once identity)", async () => {
    const home = createIsolatedHome();
    const store = await makeStore(home, TEAM_UUID, "team");
    await expect(
      initStore(store.dir, { store_uuid: TEAM_UUID, created_at: "x", canonical_alias: "team" }),
    ).rejects.toThrow(/already initialized/);
  });
});

describe("P1 store core — git excludes volatile/derived", () => {
  it("state/ and agents.meta.json are gitignored (S43/S58/S18)", async () => {
    const home = createIsolatedHome();
    const store = await makeStore(home, TEAM_UUID, "team");
    // Drop volatile artifacts that must never be committed.
    writeFileSync(join(store.dir, STORE_LAYOUT.stateDir, "events.jsonl"), "{}\n", "utf8");
    writeFileSync(join(store.dir, "agents.meta.json"), "{}\n", "utf8");

    const tracked = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
      cwd: store.dir,
      encoding: "utf8",
    });
    expect(tracked).not.toContain("state/");
    expect(tracked).not.toContain("agents.meta.json");
    // store.json + .gitignore + knowledge dirs ARE visible to git.
    expect(tracked).toContain("store.json");
  });
});

describe("P1 store core — cross-store read isolation", () => {
  it("reads across stores without merging identity (each entry keeps store_uuid)", async () => {
    const home = createIsolatedHome();
    const team = await makeStore(home, TEAM_UUID, "team");
    const platform = await makeStore(home, PLATFORM_UUID, "platform");
    // Same local id KT-DEC-0001 in BOTH stores — must stay distinct by provenance.
    writeEntry(team, "decisions", "KT-DEC-0001.md", "# team decision\n");
    writeEntry(platform, "decisions", "KT-DEC-0001.md", "# platform decision\n");

    const all = await readKnowledgeAcrossStores([team, platform]);
    expect(all).toHaveLength(2);
    const byStore = new Map(all.map((r) => [r.store_uuid, r]));
    expect(byStore.get(TEAM_UUID)?.alias).toBe("team");
    expect(byStore.get(PLATFORM_UUID)?.alias).toBe("platform");
    // Single-store read sees only its own entry.
    await expect(listStoreKnowledge(team)).resolves.toHaveLength(1);
  });
});

describe("W1 store core — project-aware two-pass scan", () => {
  it("a store with no knowledge/projects/ dir yields root-only refs (project===undefined)", async () => {
    const home = createIsolatedHome();
    const team = await makeStore(home, TEAM_UUID, "team");
    writeEntry(team, "decisions", "KT-DEC-0001.md", "# team decision\n");
    writeEntry(team, "pitfalls", "KT-PIT-0001.md", "# team pitfall\n");

    const refs = await listStoreKnowledge(team);
    expect(refs).toHaveLength(2);
    // root-only equivalence — every ref is team-general (no project tag).
    expect(refs.every((r) => r.project === undefined)).toBe(true);
    const byType = new Map(refs.map((r) => [r.type, r]));
    // join() the expected suffix so the separator matches production's join()
    // output on every platform (POSIX "/" vs Windows "\").
    expect(byType.get("decisions")?.file.endsWith(join("decisions", "KT-DEC-0001.md"))).toBe(true);
    expect(byType.get("pitfalls")?.file.endsWith(join("pitfalls", "KT-PIT-0001.md"))).toBe(true);
  });

  it("knowledge/projects/alpha/decisions/x.md yields a ref {type:'decisions', project:'alpha'}", async () => {
    const home = createIsolatedHome();
    const team = await makeStore(home, TEAM_UUID, "team");
    // Root team-general entry stays untagged; project entry carries project id.
    writeEntry(team, "decisions", "KT-DEC-0001.md", "# team-general\n");
    writeProjectEntry(team, "alpha", "decisions", "x.md", "# alpha decision\n");

    const refs = await listStoreKnowledge(team);
    expect(refs).toHaveLength(2);
    const alpha = refs.find((r) => r.project === "alpha");
    expect(alpha).toMatchObject({ type: "decisions", project: "alpha" });
    expect(alpha?.file.endsWith(join("projects", "alpha", "decisions", "x.md"))).toBe(true);
    // The root entry remains team-general.
    expect(refs.filter((r) => r.project === undefined)).toHaveLength(1);
  });

  it("a projects/ subdir colliding with a type name (projects/models/) is skipped by the C-107 guard", async () => {
    const home = createIsolatedHome();
    const team = await makeStore(home, TEAM_UUID, "team");
    // "models" collides with a reserved type dir name → must NOT become a project id.
    writeProjectEntry(team, "models", "decisions", "trap.md", "# collision trap\n");
    // "projects" (the literal dir name) is likewise excluded.
    writeProjectEntry(team, "projects", "decisions", "trap2.md", "# nested trap\n");
    // A well-formed sibling id still surfaces, proving the guard is selective.
    writeProjectEntry(team, "beta", "decisions", "ok.md", "# beta decision\n");

    const refs = await listStoreKnowledge(team);
    const projects = refs.filter((r) => r.project !== undefined).map((r) => r.project);
    expect(projects).toEqual(["beta"]);
    expect(projects).not.toContain("models");
    expect(projects).not.toContain("projects");
  });

  it("iterates project ids in sorted order for determinism", async () => {
    const home = createIsolatedHome();
    const team = await makeStore(home, TEAM_UUID, "team");
    writeProjectEntry(team, "gamma", "decisions", "g.md", "# g\n");
    writeProjectEntry(team, "alpha", "decisions", "a.md", "# a\n");
    writeProjectEntry(team, "beta", "decisions", "b.md", "# b\n");

    const refs = await listStoreKnowledge(team);
    const projectOrder = refs.filter((r) => r.project !== undefined).map((r) => r.project);
    expect(projectOrder).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("P1 store core — cross-store pending aggregation API", () => {
  it("returns the union of pending across writable stores with provenance", async () => {
    const home = createIsolatedHome();
    const team = await makeStore(home, TEAM_UUID, "team");
    const platform = await makeStore(home, PLATFORM_UUID, "platform");
    writeEntry(team, STORE_PENDING_DIR, "draft-a.md", "# a\n");
    writeEntry(team, STORE_PENDING_DIR, "draft-b.md", "# b\n");
    writeEntry(platform, STORE_PENDING_DIR, "draft-c.md", "# c\n");

    const pending = await aggregatePendingAcrossStores([team, platform]);
    expect(pending).toHaveLength(3);
    expect(pending.filter((p) => p.store_uuid === TEAM_UUID)).toHaveLength(2);
    expect(pending.filter((p) => p.store_uuid === PLATFORM_UUID)).toHaveLength(1);
    expect(pending.every((p) => p.type === STORE_PENDING_DIR)).toBe(true);
  });
});

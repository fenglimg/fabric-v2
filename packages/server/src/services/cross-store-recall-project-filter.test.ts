import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { planContext } from "./plan-context.js";
import { buildAlwaysActiveBodies } from "./cross-store-recall.js";
import { contextCache } from "../cache.js";

// v2.1 global-refactor (W2/A3): recall must filter cross-store candidates by the
// repo's active project — keep `project:<active>` + non-project coords, drop
// entries专属 to OTHER projects. Unbound repo → no filter.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const STORE = "44444444-4444-4444-8444-444444444444";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-a3-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
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
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-a3-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    `${JSON.stringify({ revision: "rev-empty", nodes: {} }, null, 2)}\n`,
  );
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  return projectRoot;
}

function entry(id: string, scope: string, title: string, type = "decision"): string {
  return [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    "layer: team",
    `semantic_scope: ${scope}`,
    `visibility_store: "team"`,
    "maturity: proven",
    "created_at: 2026-06-04T00:00:00.000Z",
    `summary: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    "Body for the project-filter recall fixture.",
    "",
  ].join("\n");
}

async function seedStore(): Promise<void> {
  const decisionsDir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: STORE }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(decisionsDir, { recursive: true });
  await writeFile(join(decisionsDir, "KT-DEC-9001.md"), entry("KT-DEC-9001", "project:alpha", "Alpha decision"));
  await writeFile(join(decisionsDir, "KT-DEC-9002.md"), entry("KT-DEC-9002", "project:beta", "Beta decision"));
  await writeFile(join(decisionsDir, "KT-DEC-9003.md"), entry("KT-DEC-9003", "team", "Team-wide decision"));
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

describe("W2/A3 — project-grained recall filter", () => {
  it("bound to project:alpha → keeps alpha + team-wide, drops other-project (beta)", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_project: "alpha",
    });
    await seedStore();

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    expect(ids).toContain("team:KT-DEC-9001"); // current project
    expect(ids).toContain("team:KT-DEC-9003"); // non-project (team-wide)
    expect(ids).not.toContain("team:KT-DEC-9002"); // other project → blocked
  });

  it("unbound repo (no active_project) → no project filter, all entries surface", async () => {
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedStore();

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    expect(ids).toContain("team:KT-DEC-9001");
    expect(ids).toContain("team:KT-DEC-9002");
    expect(ids).toContain("team:KT-DEC-9003");
  });
});

// v2.2 dual-sink (Goal A / D9+C3): buildAlwaysActiveBodies (the SessionStart AI
// sink) must mirror recall's project filter — and select ONLY always-active
// (guideline/model) types, never decisions/pitfalls/processes.
async function seedAlwaysStore(): Promise<void> {
  const root = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: STORE }), STORE_LAYOUT.knowledgeDir);
  const gdir = join(root, "guidelines");
  const mdir = join(root, "models");
  const ddir = join(root, "decisions");
  await mkdir(gdir, { recursive: true });
  await mkdir(mdir, { recursive: true });
  await mkdir(ddir, { recursive: true });
  await writeFile(join(gdir, "KT-GLD-9001.md"), entry("KT-GLD-9001", "project:alpha", "Alpha guideline", "guideline"));
  await writeFile(join(gdir, "KT-GLD-9002.md"), entry("KT-GLD-9002", "project:beta", "Beta guideline", "guideline"));
  await writeFile(join(mdir, "KT-MOD-9001.md"), entry("KT-MOD-9001", "team", "Team model", "model"));
  await writeFile(join(ddir, "KT-DEC-9009.md"), entry("KT-DEC-9009", "team", "Team decision", "decision"));
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

describe("dual-sink — buildAlwaysActiveBodies project filter + type selection", () => {
  it("bound to project:alpha → keeps alpha + team always-types, drops beta + non-always types", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_project: "alpha",
    });
    await seedAlwaysStore();

    const bodies = await buildAlwaysActiveBodies(projectRoot);
    const ids = bodies.map((b) => b.stable_id);

    expect(ids).toContain("team:KT-GLD-9001"); // alpha guideline → kept
    expect(ids).toContain("team:KT-MOD-9001"); // team model → kept (always-type)
    expect(ids).not.toContain("team:KT-GLD-9002"); // beta guideline → other project
    expect(ids).not.toContain("team:KT-DEC-9009"); // decision → not an always-type
    // every returned entry is a guideline/model with a non-empty body
    for (const b of bodies) {
      expect(["guidelines", "models"]).toContain(b.type);
      expect(b.body.length).toBeGreaterThan(0);
      expect(b.body).not.toContain("semantic_scope:"); // frontmatter stripped
    }
  });
});

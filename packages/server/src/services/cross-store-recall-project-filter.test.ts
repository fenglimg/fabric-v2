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
import { buildAlwaysActiveBodies, buildKnowledgeCensus } from "./cross-store-recall.js";
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

function entry(
  id: string,
  scope: string,
  title: string,
  type = "decision",
  relevanceScope: "broad" | "narrow" = "broad",
): string {
  return [
    "---",
    `id: ${id}`,
    `type: ${type}`,
    "layer: team",
    `semantic_scope: ${scope}`,
    `relevance_scope: ${relevanceScope}`,
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
  // narrow guideline: an always-type but NOT unconditional → must be dropped from
  // the always-active sink (surfaces via PreToolUse narrow hint instead).
  await writeFile(
    join(gdir, "KT-GLD-9003.md"),
    entry("KT-GLD-9003", "team", "Narrow guideline", "guideline", "narrow"),
  );
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

// v2.2 HUD (Goal H1): buildKnowledgeCensus must slice by relevance_scope so the
// scope-primary human sink can render `broad N · 本会话注入` (spine) separately
// from `narrow M · 编辑对应文件时浮现`. Invariant: sum(broad_by_type) +
// narrow_total == total, and existing by_type stays unsliced (backward compat).
async function seedCensusStore(): Promise<void> {
  const root = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: STORE }), STORE_LAYOUT.knowledgeDir);
  const ddir = join(root, "decisions");
  const pdir = join(root, "pitfalls");
  const gdir = join(root, "guidelines");
  const mdir = join(root, "models");
  for (const d of [ddir, pdir, gdir, mdir]) await mkdir(d, { recursive: true });
  // 2 decisions (1 broad, 1 narrow), 1 broad pitfall, 2 guidelines (1 broad, 1
  // narrow), 1 broad model → total 6, narrow 2, broad_by_type sums to 4.
  await writeFile(join(ddir, "KT-DEC-7001.md"), entry("KT-DEC-7001", "team", "Broad decision", "decision", "broad"));
  await writeFile(join(ddir, "KT-DEC-7002.md"), entry("KT-DEC-7002", "team", "Narrow decision", "decision", "narrow"));
  await writeFile(join(pdir, "KT-PIT-7001.md"), entry("KT-PIT-7001", "team", "Broad pitfall", "pitfall", "broad"));
  await writeFile(join(gdir, "KT-GLD-7001.md"), entry("KT-GLD-7001", "team", "Broad guideline", "guideline", "broad"));
  await writeFile(join(gdir, "KT-GLD-7002.md"), entry("KT-GLD-7002", "team", "Narrow guideline", "guideline", "narrow"));
  await writeFile(join(mdir, "KT-MOD-7001.md"), entry("KT-MOD-7001", "team", "Broad model", "model", "broad"));
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

describe("HUD — buildKnowledgeCensus relevance_scope slice", () => {
  it("splits broad_by_type / narrow_total with sum(broad)+narrow == total", async () => {
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    await seedCensusStore();

    const census = await buildKnowledgeCensus(projectRoot);

    expect(census.total).toBe(6);
    expect(census.narrow_total).toBe(2);
    // broad-only per type (narrow decision + narrow guideline excluded)
    expect(census.broad_by_type).toEqual({
      decisions: 1,
      pitfalls: 1,
      guidelines: 1,
      models: 1,
    });
    // backward compat: full (unsliced) by_type still counts narrow too
    expect(census.by_type).toEqual({
      decisions: 2,
      pitfalls: 1,
      guidelines: 2,
      models: 1,
    });
    // self-consistency invariant the scope-primary HUD relies on
    const broadSum = Object.values(census.broad_by_type).reduce((a, b) => a + b, 0);
    expect(broadSum + census.narrow_total).toBe(census.total);
    expect(broadSum).toBe(4);
  });
});

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
    expect(ids).not.toContain("team:KT-GLD-9003"); // narrow guideline → broad-only invariant
    // every returned entry is a guideline/model with a non-empty body
    for (const b of bodies) {
      expect(["guidelines", "models"]).toContain(b.type);
      expect(b.body.length).toBeGreaterThan(0);
      expect(b.body).not.toContain("semantic_scope:"); // frontmatter stripped
    }
  });
});

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
import {
  __readSetWalkCacheStatsForTests,
  __resetReadSetWalkCacheForTests,
  buildAlwaysActiveBodies,
  buildKnowledgeCensus,
} from "./cross-store-recall.js";
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
  __resetReadSetWalkCacheForTests();
});

afterEach(async () => {
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  __resetReadSetWalkCacheForTests();
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
      // ISS-20260713-014: SessionStart wire is index-only — body intentionally empty
      expect(b.body).toBe("");
      expect(b.summary.length).toBeGreaterThan(0); // frontmatter stripped
    }
  });
});

// W1/TASK-002: readSemanticScope now DERIVES scope from structural facts (path
// project id + store layer) as the PRIMARY source; authored `semantic_scope`
// frontmatter is a phase-1 fallback only. These round-trip tests prove the
// derivation through the real recall pipeline (planContext → filterByActiveProject),
// not the private function in isolation.

const PERSONAL_STORE = "55555555-5555-4555-8555-555555555555";

// Seed an entry into a store's project-partitioned dir
// (knowledge/projects/<project>/<type>/), the path that structurally tags a ref
// with `project`. `bodyScope` controls the authored `semantic_scope:` frontmatter
// value; pass undefined to OMIT the line entirely (missing-frontmatter case).
async function seedProjectPartitionedEntry(
  storeUuid: string,
  project: string,
  id: string,
  title: string,
  bodyScope: string | undefined,
  personal = false,
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    // A personal store mounts under stores/personal/<uuid> (not stores/team/) —
    // the read-set walk resolves the same way, so the flag must match here.
    storeRelativePathForMount(personal ? { store_uuid: storeUuid, personal: true } : { store_uuid: storeUuid }),
    STORE_LAYOUT.knowledgeDir,
    "projects",
    project,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  const lines = [
    "---",
    `id: ${id}`,
    "type: decision",
    "layer: team",
    ...(bodyScope === undefined ? [] : [`semantic_scope: ${bodyScope}`]),
    "relevance_scope: broad",
    `visibility_store: "team"`,
    "maturity: proven",
    "created_at: 2026-07-02T00:00:00.000Z",
    `summary: ${title}`,
    "---",
    "",
    `# ${title}`,
    "",
    "Body for the path-derive fixture.",
    "",
  ];
  await writeFile(join(dir, `${id}.md`), lines.join("\n"));
}

describe("W1/TASK-002 — path-derived scope (path wins over frontmatter)", () => {
  it("conflict: frontmatter says project:x but path is projects/y → derives project:y (path wins)", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_project: "ypro",
    });
    // Authored frontmatter deliberately lies (project:xpro); the on-disk path
    // partitions it under projects/ypro → structure must win.
    await seedProjectPartitionedEntry(STORE, "ypro", "KT-DEC-8001", "Conflict entry", "project:xpro");
    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
    });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    // Surfaces under active_project=ypro (path-derived project:ypro is kept), and
    // its semantic_scope reflects the PATH, not the frontmatter's project:xpro.
    expect(ids).toContain("team:KT-DEC-8001");
    const scope = result.candidates.find((c) => c.stable_id === "team:KT-DEC-8001")?.description
      .semantic_scope;
    expect(scope).toBe("project:ypro");
    expect(scope).not.toBe("project:xpro");
  });

  it("conflict entry does NOT surface under a DIFFERENT active_project (path-derived filtering)", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_project: "zpro",
    });
    await seedProjectPartitionedEntry(STORE, "ypro", "KT-DEC-8001", "Conflict entry", "project:zpro");
    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
    });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    // Frontmatter lies (project:zpro == active), but the PATH is projects/ypro →
    // derived project:ypro is dropped under active_project=zpro. If frontmatter
    // still won, this would leak — the failing assertion is the fail-loud guard.
    expect(ids).not.toContain("team:KT-DEC-8001");
  });

  it("missing frontmatter: projects/alpha entry with no semantic_scope line still derives project:alpha", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_project: "alpha",
    });
    await seedProjectPartitionedEntry(STORE, "alpha", "KT-DEC-8002", "No-scope entry", undefined);
    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
    });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const scope = result.candidates.find((c) => c.stable_id === "team:KT-DEC-8002")?.description
      .semantic_scope;
    expect(scope).toBe("project:alpha");
  });
});

describe("W1/TASK-002 — C-105 personal privacy round-trip (store-derived, never scope-inferred)", () => {
  it("personal-store entry under a projects/-like path still derives 'personal', never project:<id>", async () => {
    const projectRoot = await createProject({ required_stores: [{ id: "team" }] });
    // A personal store, implicitly in every read-set. Its entry is mis-nested
    // under projects/alpha AND its frontmatter lies (semantic_scope: project:alpha)
    // — both would leak it as shared/project-scoped if the personal short-circuit
    // did not precede project derivation (C-105).
    await seedProjectPartitionedEntry(
      PERSONAL_STORE,
      "alpha",
      "KP-DEC-8003",
      "Personal entry mis-nested",
      "project:alpha",
      true, // seed under the personal store's stores/personal/<uuid> path
    );
    saveGlobalConfig({
      uid: "test-uid",
      stores: [
        { store_uuid: STORE, alias: "team", remote: "git@e:t.git" },
        { store_uuid: PERSONAL_STORE, alias: "personal", remote: "git@e:p.git", personal: true },
      ],
    });

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const entry = result.candidates.find((c) => c.stable_id === "personal:KP-DEC-8003");

    // Personal entries are non-project scope → surface regardless of binding, and
    // their derived scope is 'personal' (NOT project:alpha) — no shared/project
    // leak from either the path or the lying frontmatter.
    expect(entry).toBeDefined();
    expect(entry?.description.semantic_scope).toBe("personal");
    expect(entry?.description.semantic_scope).not.toBe("project:alpha");
  });
});

describe("W1/TASK-002 — deterministic walk-count perf-regression (project partitions add no walks)", () => {
  it("dual-mode (flat + M project dirs) costs the same walk count as flat (walks ≤ flatWalks + M holds with M-cost 0)", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_project: "alpha",
    });
    // Seed one FLAT (root type dir) entry + M=2 project-partitioned dirs. The
    // read-set walk is memoized per read-set fingerprint, so adding project
    // partitions must NOT multiply the walk count — one recall = one walk,
    // independent of how many project dirs the two-pass scanner traverses.
    const M = 2;
    await seedStore(); // flat root-type entries (KT-DEC-9001..9003)
    await seedProjectPartitionedEntry(STORE, "alpha", "KT-DEC-8101", "Alpha part", "project:alpha");
    await seedProjectPartitionedEntry(STORE, "beta", "KT-DEC-8102", "Beta part", "project:beta");
    saveGlobalConfig({
      uid: "test-uid",
      stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
    });
    __resetReadSetWalkCacheForTests();

    await planContext(projectRoot, { paths: ["src/index.ts"] });
    const walks = __readSetWalkCacheStatsForTests().walks;

    // flatWalks == 1 (a single memoized read-set walk). Deterministic proxy for
    // "no per-project walk multiplication": walks ≤ flatWalks + M, and in fact ==
    // flatWalks (M contributes 0 extra walks).
    const flatWalks = 1;
    expect(walks).toBeLessThanOrEqual(flatWalks + M);
    expect(walks).toBe(flatWalks);
  });
});

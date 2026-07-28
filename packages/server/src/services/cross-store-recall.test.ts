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

import {
  __readSetWalkCacheStatsForTests,
  __resetReadSetWalkCacheForTests,
  buildAlwaysActiveBodies,
  buildCrossStoreBodyIndex,
  buildCrossStoreRawItems,
  buildKnowledgeCensus,
  computeReadSetRevision,
} from "./cross-store-recall.js";
import { planContext } from "./plan-context.js";
import { contextCache } from "../cache.js";

// v2.1 global-refactor (W1-T1): proves the cross-store read-side wiring — a
// mounted store's knowledge surfaces as a recall candidate, store-qualified.
// Mirrors plan-context.test.ts's FABRIC_HOME isolation so the developer's real
// ~/.fabric never leaks into the fixture.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE_UUID = "11111111-1111-4111-8111-111111111111";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-cross-store-home-"));
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
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function createProjectWithEmptyMeta(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-cross-store-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "agents.meta.json"),
    `${JSON.stringify({ revision: "rev-empty", nodes: {} }, null, 2)}\n`,
  );
  return projectRoot;
}

// Seed a mounted store under the isolated ~/.fabric/stores/<uuid>/ with one
// knowledge entry, and register it in the global config.
async function seedTeamStore(): Promise<void> {
  const storeDir = join(resolveGlobalRoot(), storeRelativePathForMount({ store_uuid: TEAM_STORE_UUID }));
  const decisionsDir = join(storeDir, STORE_LAYOUT.knowledgeDir, "decisions");
  await mkdir(decisionsDir, { recursive: true });
  await writeFile(
    join(decisionsDir, "KT-DEC-9001.md"),
    [
      "---",
      "id: KT-DEC-9001",
      "type: decision",
      "layer: team",
      "maturity: proven",
      "created_at: 2026-06-02T00:00:00.000Z",
      "---",
      "",
      "# Cross-store wiring proven decision",
      "",
      "Knowledge that lives in a mounted team store, not the project root.",
      "",
    ].join("\n"),
  );

  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      {
        store_uuid: TEAM_STORE_UUID,
        alias: "team",
        remote: "git@example.com:team-store.git",
      },
    ],
  });
}

describe("cross-store recall (W1-T1)", () => {
  it("surfaces a required team store's entry as a store-qualified candidate", async () => {
    const projectRoot = await createProjectWithEmptyMeta();
    await seedTeamStore();
    // Project declares the team store as required → it enters the read-set.
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    expect(ids).toContain("team:KT-DEC-9001");
  });

  it("does NOT surface a store entry the project did not require", async () => {
    const projectRoot = await createProjectWithEmptyMeta();
    await seedTeamStore();
    // No fabric-config.json → required_stores empty → team store not in read-set.

    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);

    expect(ids).not.toContain("team:KT-DEC-9001");
  });

  it("degrades to project-only recall when no global config exists", async () => {
    const projectRoot = await createProjectWithEmptyMeta();
    // No global config written at all.
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    expect(result.candidates.map((c) => c.stable_id)).not.toContain("team:KT-DEC-9001");
  });

  it("reuses one read-set walk across revision, raw candidates, and body index", async () => {
    const projectRoot = await createProjectWithEmptyMeta();
    await seedTeamStore();
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
    );

    const revision = await computeReadSetRevision(projectRoot);
    const rawItems = await buildCrossStoreRawItems(projectRoot);
    const bodyIndex = await buildCrossStoreBodyIndex(projectRoot);

    expect(revision).toEqual(expect.any(String));
    expect(rawItems.map((item) => item.stable_id)).toContain("team:KT-DEC-9001");
    expect(bodyIndex.has("team:KT-DEC-9001")).toBe(true);
    expect(__readSetWalkCacheStatsForTests().walks).toBe(1);
  });
});

// G3 — always-active is the UNCONDITIONAL rule tier (KT-DEC-0027: guideline /
// model bodies are the SessionStart spine). It filtered deprecated, other-project
// and narrow entries but never maturity, so a `draft` guideline — an unadjudicated
// proposal — was injected as a standing rule. Draft entries stay fully reachable
// via the PreToolUse narrow hint and fab_recall; this only removes them from the
// tier that presents knowledge as settled. Note this is NOT the "exclude retired
// entries from recall" idea KT-DEC-0055 deferred: recall is untouched.
describe("buildAlwaysActiveBodies maturity gate (G3)", () => {
  async function seedGuideline(id: string, maturity: string | null): Promise<void> {
    const storeDir = join(
      resolveGlobalRoot(),
      storeRelativePathForMount({ store_uuid: TEAM_STORE_UUID }),
    );
    const dir = join(storeDir, STORE_LAYOUT.knowledgeDir, "guidelines");
    await mkdir(dir, { recursive: true });
    const lines = ["---", `id: ${id}`, "type: guideline", "layer: team"];
    if (maturity !== null) lines.push(`maturity: ${maturity}`);
    lines.push(
      "created_at: 2026-06-02T00:00:00.000Z",
      "relevance_scope: broad",
      `summary: Guideline ${id} with a real summary`,
      "---",
      "",
      `# ${id}`,
      "",
      "Body text.",
      "",
    );
    await writeFile(join(dir, `${id}.md`), lines.join("\n"));
  }

  async function seedMaturityMix(): Promise<string> {
    const projectRoot = await createProjectWithEmptyMeta();
    await seedGuideline("KT-GLD-9001", "draft");
    await seedGuideline("KT-GLD-9002", "verified");
    await seedGuideline("KT-GLD-9003", null); // maturity absent entirely
    saveGlobalConfig({
      uid: "test-uid",
      stores: [
        { store_uuid: TEAM_STORE_UUID, alias: "team", remote: "git@example.com:team-store.git" },
      ],
    });
    await writeFile(
      join(projectRoot, ".fabric", "fabric-config.json"),
      `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
    );
    return projectRoot;
  }

  it("excludes draft, keeps verified, and keeps entries with no maturity declared", async () => {
    const projectRoot = await seedMaturityMix();

    const ids = (await buildAlwaysActiveBodies(projectRoot)).map((b) => b.stable_id);

    expect(ids).not.toContain("team:KT-GLD-9001");
    expect(ids).toContain("team:KT-GLD-9002");
    // Exclusion is `=== "draft"`, NOT a verified/proven whitelist: maturity is
    // optional in the schema and most existing entries omit it, so a whitelist
    // would silently empty the always-active tier.
    expect(ids).toContain("team:KT-GLD-9003");
  });

  it("leaves the census counts untouched (D2: broad_by_type stays the display axis)", async () => {
    const projectRoot = await seedMaturityMix();

    const census = await buildKnowledgeCensus(projectRoot);

    // Deliberate, documented asymmetry: the HUD still counts the draft guideline
    // as broad, so broad_by_type.guidelines exceeds the injected body count by
    // the number of draft entries.
    expect(census.broad_by_type.guidelines).toBe(3);
    expect(census.total).toBe(3);
  });
});

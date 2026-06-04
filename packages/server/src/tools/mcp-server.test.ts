// v2.0 integration tests (TASK-005) — exercise the public MCP service
// surface (planContext + getKnowledgeSections) end-to-end against the
// multi-store read model. These complement the unit tests under
// `services/*.test.ts` by going through the full code path that
// `fab_plan_context` and `fab_get_knowledge_sections` invoke at runtime.
//
// v2.2 W5 R2/R7 (agents.meta decolo): planContext no longer reads the project's
// co-location `.fabric/knowledge/` tree or `agents.meta.json`. Candidates come
// from the mounted stores in the read-set; team entries from the required team
// store and personal entries from the implicit personal store. Every candidate
// id is store-qualified (`<alias>:<stable_id>`).

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { contextCache } from "../cache.js";
import { planContext } from "../services/plan-context.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

const TEAM_STORE = "11111111-1111-4111-8111-111111111111";
const PERSONAL_STORE = "22222222-2222-4222-8222-222222222222";

beforeEach(async () => {
  // Redirect personal-root scans into a tempdir so we don't poke ~/.fabric/.
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-mcp-home-"));
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
  contextCache.invalidate("file_watch");
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("mcp-server integration (multi-store read model)", () => {
  it("plan_context_returns_layer_tagged_index — team + personal store entries surface with correct layer tags", async () => {
    const projectRoot = await createV2Project();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const indexById = new Map(
      result.candidates.map((item) => [item.stable_id, item] as const),
    );

    // v2.0.0-rc.38 UX-3: type/maturity/layer mirrors collapsed into description.*.
    // Candidate ids are store-qualified post-cutover.
    expect(indexById.get("team:KT-DEC-0001")?.description).toMatchObject({
      knowledge_type: "decisions",
      maturity: "verified",
      knowledge_layer: "team",
    });
    expect(indexById.get("personal:KP-GLD-0001")?.description).toMatchObject({
      knowledge_type: "guidelines",
      maturity: "draft",
      knowledge_layer: "personal",
    });

    // Sanity: both layers present in the merged index.
    const layers = new Set(result.candidates.map((item) => item.description.knowledge_layer));
    expect(layers).toEqual(new Set(["team", "personal"]));
  });

  it("plan_context_symmetric_shape_v2_layout — returns description_index + selection_token regardless of count", async () => {
    // v2.0-rc.7 T9: degenerate single-stage mode removed. Every response
    // returns a symmetric shape — `description_index` per entry + a
    // `selection_token` — and the Agent fetches bodies via
    // `fab_get_knowledge_sections` (which emits the `knowledge_consumed`
    // event required for rc.5 C5 closure).
    const projectRoot = await createV2Project();
    const plan = await planContext(projectRoot, { paths: ["src/index.ts"] });

    expect(plan.selection_token).toEqual(expect.any(String));
    expect(plan).not.toHaveProperty("candidates_full_content");

    const ids = plan.candidates.map((item) => item.stable_id).sort();
    expect(ids).toEqual(["personal:KP-GLD-0001", "team:KT-DEC-0001"]);
  });
});

/** Write a knowledge .md into a store under the isolated ~/.fabric. */
async function writeStoreEntry(
  storeUuid: string,
  type: string,
  id: string,
  lines: string[],
): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePath(storeUuid),
    STORE_LAYOUT.knowledgeDir,
    type,
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}.md`), lines.join("\n"));
}

async function createV2Project(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-mcp-project-"));
  tempDirs.push(projectRoot);

  // .fabric scaffolding — declares the team store as required.
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "human-lock.json"),
    `${JSON.stringify({ locked: [] }, null, 2)}\n`,
  );
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }] }, null, 2)}\n`,
  );

  // Team-layer fixture in the team store.
  await writeStoreEntry(TEAM_STORE, "decisions", "KT-DEC-0001", [
    "---",
    "summary: Team JWT decision",
    "id: KT-DEC-0001",
    "type: decision",
    "maturity: verified",
    "layer: team",
    "created_at: 2026-05-10T08:00:00Z",
    "---",
    "# Team JWT",
    "",
    "## [MANDATORY_INJECTION]",
    "Team mandatory.",
    "",
  ]);

  // Personal-layer fixture in the personal store.
  await writeStoreEntry(PERSONAL_STORE, "guidelines", "KP-GLD-0001", [
    "---",
    "summary: Personal coding style",
    "id: KP-GLD-0001",
    "type: guideline",
    "maturity: draft",
    "layer: personal",
    "created_at: 2026-05-10T08:00:00Z",
    "---",
    "# Personal style",
    "",
    "## [MANDATORY_INJECTION]",
    "Personal mandatory.",
    "",
  ]);

  // Register both stores; the personal store is auto-included in the read-set
  // via its `personal: true` flag (implicit personal).
  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: TEAM_STORE, alias: "team", remote: "git@e:team.git" },
      {
        store_uuid: PERSONAL_STORE,
        alias: "personal",
        remote: "git@e:personal.git",
        personal: true,
      },
    ],
  });

  return projectRoot;
}

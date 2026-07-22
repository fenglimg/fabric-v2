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

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePathForMount,
} from "@fenglimg/fabric-shared";

import { contextCache } from "../cache.js";
import { planContext, layerFromStableId } from "../services/plan-context.js";
import { adoptMcpClientRoots } from "../index.js";
import { ProjectContextProvider } from "../project-context-provider.js";

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

describe("MCP roots integration with real worktrees", () => {
  it("rejects ambiguous multi-root context at the provider boundary", async () => {
    const first = await createMcpGitProject("11111111-1111-4111-8111-111111111111");
    const second = await createMcpGitProject("22222222-2222-4222-8222-222222222222");
    const provider = new ProjectContextProvider();
    await adoptMcpClientRoots({
      getClientCapabilities: () => ({ roots: {} }),
      listRoots: async () => ({
        roots: [first, second].map((root) => ({ uri: pathToFileURL(root).href })),
      }),
    }, provider);

    expect(() => provider.snapshotForCall()).toThrowError(
      expect.objectContaining({ code: "FABRIC_PROJECT_CONTEXT_AMBIGUOUS" }),
    );
  });

  it("keeps project A stable in-flight while the next operation uses project B", async () => {
    const first = await createMcpGitProject("11111111-1111-4111-8111-111111111111");
    const second = await createMcpGitProject("22222222-2222-4222-8222-222222222222");
    const provider = new ProjectContextProvider();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let currentRoot = first;

    await adoptMcpClientRoots({
      getClientCapabilities: () => ({ roots: {} }),
      listRoots: async () => ({ roots: [{ uri: pathToFileURL(currentRoot).href }] }),
    }, provider);
    const inFlight = provider.snapshotForCall();

    currentRoot = second;
    const switching = adoptMcpClientRoots({
      getClientCapabilities: () => ({ roots: {} }),
      listRoots: async () => {
        await barrier;
        return { roots: [{ uri: pathToFileURL(currentRoot).href }] };
      },
    }, provider);

    expect(inFlight.projectId).toBe("11111111-1111-4111-8111-111111111111");
    expect(provider.snapshotForCall().projectId).toBe(inFlight.projectId);
    release();
    await switching;

    expect(inFlight.projectId).toBe("11111111-1111-4111-8111-111111111111");
    expect(provider.snapshotForCall().projectId).toBe("22222222-2222-4222-8222-222222222222");
  });
});

async function createMcpGitProject(projectId: string): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-mcp-roots-project-"));
  tempDirs.push(projectRoot);
  execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "mcp-matrix@fabric.local"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "MCP Matrix"], { cwd: projectRoot });
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ project_id: projectId })}\n`,
  );
  await writeFile(join(projectRoot, "README.md"), "mcp roots fixture\n");
  execFileSync("git", ["add", "."], { cwd: projectRoot });
  execFileSync("git", ["commit", "-m", "seed mcp roots fixture"], { cwd: projectRoot, stdio: "ignore" });
  return projectRoot;
}

describe("mcp-server integration (multi-store read model)", () => {
  it("plan_context_returns_layer_tagged_index — team + personal store entries surface with correct layer tags", async () => {
    const projectRoot = await createV2Project();
    const result = await planContext(projectRoot, { paths: ["src/index.ts"] });
    const indexById = new Map(
      result.candidates.map((item) => [item.stable_id, item] as const),
    );

    // v2.0.0-rc.38 UX-3: type/maturity/layer mirrors collapsed into description.*.
    // Candidate ids are store-qualified post-cutover.
    // W4/Track1 (D1): `knowledge_layer` deleted — layer is derived from the
    // stable_id prefix (KP-→personal, else team; KT-DEC-0004), no longer a field.
    expect(indexById.get("team:KT-DEC-0001")?.description).toMatchObject({
      knowledge_type: "decisions",
      maturity: "verified",
    });
    expect(indexById.get("team:KT-DEC-0001")?.description).not.toHaveProperty("knowledge_layer");
    expect(indexById.get("personal:KP-GLD-0001")?.description).toMatchObject({
      knowledge_type: "guidelines",
      maturity: "draft",
    });
    expect(indexById.get("personal:KP-GLD-0001")?.description).not.toHaveProperty("knowledge_layer");

    // Sanity: both layers present in the merged index — derived from the id
    // prefix now that the field is gone (team:KT-* → team, personal:KP-* → personal).
    const layers = new Set(
      result.candidates.map((item) => layerFromStableId(item.stable_id)),
    );
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
    storeRelativePathForMount({ store_uuid: storeUuid, personal: storeUuid === PERSONAL_STORE }),
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

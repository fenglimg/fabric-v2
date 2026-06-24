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

import { explainWhyNotSurfaced } from "./why-not-surfaced.js";

// W3-H (S6): the why-not-surfaced diagnostic answers the FIRST blocking cause of
// a non-surfacing entry across the three scope axes — store binding, project
// (semantic_scope) match, and relevance_scope timing.

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const BOUND = "11111111-1111-4111-8111-111111111111";
const UNBOUND = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  originalFabricHome = process.env.FABRIC_HOME;
});

afterEach(async () => {
  if (originalFabricHome === undefined) delete process.env.FABRIC_HOME;
  else process.env.FABRIC_HOME = originalFabricHome;
  await Promise.all(tempDirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

function entry(
  id: string,
  scope: string,
  relevanceScope: "broad" | "narrow" = "broad",
): string {
  return [
    "---",
    `id: ${id}`,
    "type: decision",
    "layer: team",
    `semantic_scope: ${scope}`,
    `relevance_scope: ${relevanceScope}`,
    "maturity: proven",
    "created_at: 2026-06-04T00:00:00.000Z",
    `summary: ${id} fixture`,
    "---",
    "",
    `# ${id}`,
    "",
    "Body.",
    "",
  ].join("\n");
}

async function writeEntry(storeUuid: string, id: string, scope: string, rel: "broad" | "narrow" = "broad"): Promise<void> {
  const dir = join(
    resolveGlobalRoot(),
    storeRelativePathForMount({ store_uuid: storeUuid }),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${id}--fixture.md`), entry(id, scope, rel));
}

// Project bound to the `team` store (alias) + active_project alpha. A second
// store (`orphan`) is mounted machine-wide but NOT in the read-set.
async function setup(activeProject?: string): Promise<string> {
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-w3h-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;

  saveGlobalConfig({
    uid: "test-uid",
    stores: [
      { store_uuid: BOUND, alias: "team", remote: "git@e:t.git" },
      { store_uuid: UNBOUND, alias: "orphan", remote: "git@e:o.git" },
    ],
  });

  await writeEntry(BOUND, "KT-DEC-0001", "team", "broad"); // should_surface
  await writeEntry(BOUND, "KT-DEC-0002", "project:beta", "broad"); // project_mismatch (when alpha)
  await writeEntry(BOUND, "KT-DEC-0003", "team", "narrow"); // narrow_timing
  await writeEntry(UNBOUND, "KT-DEC-0009", "team", "broad"); // store_unbound

  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-w3h-proj-"));
  tempDirs.push(projectRoot);
  await mkdir(join(projectRoot, ".fabric"), { recursive: true });
  await writeFile(
    join(projectRoot, ".fabric", "fabric-config.json"),
    `${JSON.stringify({ required_stores: [{ id: "team" }], ...(activeProject ? { active_project: activeProject } : {}) }, null, 2)}\n`,
  );
  return projectRoot;
}

describe("explainWhyNotSurfaced — first blocking cause across the 3 scope axes", () => {
  it("not_found: id exists in no mounted store", async () => {
    const root = await setup("alpha");
    const r = await explainWhyNotSurfaced(root, "KT-DEC-9999");
    expect(r.verdict).toBe("not_found");
    expect(r.storeAlias).toBeNull();
  });

  it("store_unbound: entry lives in a mounted-but-not-bound store", async () => {
    const root = await setup("alpha");
    const r = await explainWhyNotSurfaced(root, "KT-DEC-0009");
    expect(r.verdict).toBe("store_unbound");
    expect(r.storeAlias).toBe("orphan");
    expect(r.storeBound).toBe(false);
  });

  it("project_mismatch: entry scoped to a DIFFERENT project than this repo", async () => {
    const root = await setup("alpha");
    const r = await explainWhyNotSurfaced(root, "KT-DEC-0002");
    expect(r.verdict).toBe("project_mismatch");
    expect(r.semanticScope).toBe("project:beta");
    expect(r.activeProject).toBe("alpha");
  });

  it("narrow_timing: entry is relevance_scope=narrow (edit-time only)", async () => {
    const root = await setup("alpha");
    const r = await explainWhyNotSurfaced(root, "KT-DEC-0003");
    expect(r.verdict).toBe("narrow_timing");
    expect(r.relevanceScope).toBe("narrow");
  });

  it("should_surface: passes all gates (bound store, scope match, broad)", async () => {
    const root = await setup("alpha");
    const r = await explainWhyNotSurfaced(root, "KT-DEC-0001");
    expect(r.verdict).toBe("should_surface");
    expect(r.storeBound).toBe(true);
    expect(r.relevanceScope).toBe("broad");
  });

  it("accepts a store-qualified id (alias:ID)", async () => {
    const root = await setup("alpha");
    const r = await explainWhyNotSurfaced(root, "team:KT-DEC-0001");
    expect(r.localId).toBe("KT-DEC-0001");
    expect(r.verdict).toBe("should_surface");
  });

  it("unbound repo (no active_project): project-scoped entry is NOT a mismatch", async () => {
    const root = await setup(); // no active_project → no project filter (S20)
    const r = await explainWhyNotSurfaced(root, "KT-DEC-0002");
    expect(r.verdict).toBe("should_surface");
    expect(r.activeProject).toBeNull();
  });
});

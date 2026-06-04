import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  STORE_LAYOUT,
  resolveCandidates,
  resolveGlobalRoot,
  saveGlobalConfig,
  storeRelativePath,
} from "@fenglimg/fabric-shared";

import { planContext } from "./plan-context.js";
import { contextCache } from "../cache.js";

// v2.1 global-refactor (W2/A4): plan-context ranking consumes resolveCandidates
// — under EQUAL relevance, a more specific scope (project:x) outranks a broader
// one (team). Asserts the resolver is wired (resolution.ts no longer zero-call).

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;
const STORE = "55555555-5555-4555-8555-555555555555";

beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-a4-home-"));
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

// resolution.ts unit-level proof: a project-scoped candidate outranks a team one
// at equal store position (the double-axis specificity rule plan-context wires).
describe("W2/A4 — resolveCandidates double-axis (unit)", () => {
  it("ranks project:<id> before team (scope specificity)", () => {
    const { resolved } = resolveCandidates([
      { global_ref: "team:KT-DEC-0002", store_uuid: STORE, alias: "team", local_id: "KT-DEC-0002", semantic_scope: "team" },
      { global_ref: "team:KT-DEC-0001", store_uuid: STORE, alias: "team", local_id: "KT-DEC-0001", semantic_scope: "project:alpha" },
    ]);
    expect(resolved[0]!.global_ref).toBe("team:KT-DEC-0001"); // project:alpha first
    expect(resolved[1]!.global_ref).toBe("team:KT-DEC-0002");
  });
});

async function createProject(config: object): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-a4-proj-"));
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

// Two entries with IDENTICAL relevance signal (same created_at, broad scope, no
// query) so BM25/locality/recency tie — only the scope axis can break the tie.
function entry(id: string, scope: string): string {
  return [
    "---",
    `id: ${id}`,
    "type: decision",
    "layer: team",
    `semantic_scope: ${scope}`,
    `visibility_store: "team"`,
    "maturity: proven",
    "created_at: 2026-06-04T00:00:00.000Z",
    `summary: A knowledge entry for scope-rank ordering with shared wording.`,
    "---",
    "",
    "# Scope rank entry",
    "",
    "Identical body so content relevance ties between the two candidates.",
    "",
  ].join("\n");
}

async function seedStore(): Promise<void> {
  const decisionsDir = join(
    resolveGlobalRoot(),
    storeRelativePath(STORE),
    STORE_LAYOUT.knowledgeDir,
    "decisions",
  );
  await mkdir(decisionsDir, { recursive: true });
  // 9002 (team) written first / lower id-sort so a pure stable_id tie-break would
  // put it AFTER 9001 anyway — make the team entry the one that would win a naive
  // sort so the test actually proves the scope axis, not id luck.
  await writeFile(join(decisionsDir, "KT-DEC-9001.md"), entry("KT-DEC-9001", "team"));
  await writeFile(join(decisionsDir, "KT-DEC-9002.md"), entry("KT-DEC-9002", "project:alpha"));
  saveGlobalConfig({
    uid: "test-uid",
    stores: [{ store_uuid: STORE, alias: "team", remote: "git@e:t.git" }],
  });
}

describe("W2/A4 — plan-context consumes scope rank (integration)", () => {
  it("under equal relevance, project:alpha (9002) ranks before team (9001)", async () => {
    const projectRoot = await createProject({
      required_stores: [{ id: "team" }],
      active_project: "alpha",
    });
    await seedStore();

    // No `intent` → no query terms → BM25 off; identical created_at + no path
    // match → recency/locality tie. Scope axis is the only discriminator.
    const result = await planContext(projectRoot, { paths: ["src/unrelated.ts"] });
    const ids = result.candidates.map((c) => c.stable_id);
    const idxProject = ids.indexOf("team:KT-DEC-9002"); // project:alpha
    const idxTeam = ids.indexOf("team:KT-DEC-9001"); // team
    expect(idxProject).toBeGreaterThanOrEqual(0);
    expect(idxTeam).toBeGreaterThanOrEqual(0);
    expect(idxProject).toBeLessThan(idxTeam); // project-scoped wins the tie
  });
});

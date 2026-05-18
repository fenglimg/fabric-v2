import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getKnowledge, loadGetKnowledgeContext, resolveKnowledgeForPath } from "./get-knowledge.js";
import { contextCache } from "../cache.js";

const tempDirs: string[] = [];
let originalFabricHome: string | undefined;

// v2.0.0-rc.22 Scope D T-D2: FABRIC_HOME isolation guards the new getKnowledge
// auto-heal tests from picking up the developer's real personal knowledge
// tree. The existing loadGetKnowledgeContext tests don't trigger auto-heal
// (they call the internal helper directly) but the env reset is cheap and
// keeps behaviour deterministic across the file.
beforeEach(async () => {
  originalFabricHome = process.env.FABRIC_HOME;
  const fakeHome = await mkdtemp(join(tmpdir(), "fabric-get-knowledge-home-"));
  tempDirs.push(fakeHome);
  process.env.FABRIC_HOME = fakeHome;
  contextCache.invalidate("file_watch");
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalFabricHome === undefined) {
    delete process.env.FABRIC_HOME;
  } else {
    process.env.FABRIC_HOME = originalFabricHome;
  }
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("resolveKnowledgeForPath", () => {
  it("loads always/path tiers and returns description stubs without reading description content", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "bootstrap"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "agents", "always"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "agents", "docs"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "agents", "descriptions"), { recursive: true });

    await writeFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "# Root rules\n");
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(join(projectRoot, ".fabric", "agents", "always", "AGENTS.md"), "# Always\n");
    await writeFile(join(projectRoot, ".fabric", "agents", "docs", "AGENTS.md"), "# Docs\n");
    await writeFile(
      join(projectRoot, ".fabric", "agents", "descriptions", "typescript.md"),
      "# Description backing file\n",
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-rules",
        nodes: {
          "L1/always": {
            file: ".fabric/agents/always/AGENTS.md",
            scope_glob: "never/matched/**",
            deps: [],
            priority: "high",
            hash: "sha256:always",
            activation: {
              tier: "always",
            },
          },
          "L2/docs": {
            file: ".fabric/agents/docs/AGENTS.md",
            scope_glob: "docs/**/*.md",
            deps: [],
            priority: "medium",
            hash: "sha256:path",
          },
          "L2/description": {
            file: ".fabric/agents/descriptions/typescript.md",
            scope_glob: "**/*.ts",
            deps: [],
            priority: "low",
            hash: "sha256:description",
            activation: {
              tier: "description",
              description: "TypeScript guidance is available when needed.",
            },
          },
        },
      }, null, 2)}\n`,
    );

    const context = await loadGetKnowledgeContext(projectRoot);
    const result = await resolveKnowledgeForPath(projectRoot, context, "docs/guide.md");

    expect(result.L1).toEqual([
      {
        path: ".fabric/agents/always/AGENTS.md",
        content: "# Always\n",
      },
    ]);
    expect(result.L2).toEqual([
      {
        path: ".fabric/agents/docs/AGENTS.md",
        content: "# Docs\n",
      },
    ]);
    expect(result.description_stubs).toEqual([
      {
        path: ".fabric/agents/descriptions/typescript.md",
        description: "TypeScript guidance is available when needed.",
      },
    ]);
  });

  it("keeps legacy nodes without activation on path-based matching", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "bootstrap"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "agents", "src"), { recursive: true });

    await writeFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "# Root rules\n");
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(join(projectRoot, ".fabric", "agents", "src", "AGENTS.md"), "# Source\n");
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-legacy",
        nodes: {
          "L2/src": {
            file: ".fabric/agents/src/AGENTS.md",
            scope_glob: "src/**/*.ts",
            deps: [],
            priority: "medium",
            hash: "sha256:src",
          },
        },
      }, null, 2)}\n`,
    );

    const context = await loadGetKnowledgeContext(projectRoot);
    const matching = await resolveKnowledgeForPath(projectRoot, context, "src/index.ts");
    const nonMatching = await resolveKnowledgeForPath(projectRoot, context, "docs/index.md");

    expect(matching.L2).toEqual([
      {
        path: ".fabric/agents/src/AGENTS.md",
        content: "# Source\n",
      },
    ]);
    expect(matching.description_stubs).toBeUndefined();
    expect(nonMatching.L1).toEqual([]);
    expect(nonMatching.L2).toEqual([]);
    expect(nonMatching.description_stubs).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// v2.0.0-rc.22 Scope D T-D2 (TASK-009): getKnowledge() public-entry auto-heal.
//
// The internal loadGetKnowledgeContext continues to read raw via readAgentsMeta
// (legacy fixture compat — see file header). The public getKnowledge() entry
// runs loadActiveMeta first so a stale meta is rebuilt before path matching.
// Tests below pin both the strict-throw contract (build failure propagates)
// and the cache-invalidation behaviour (post-heal context is rebuilt fresh).
// ---------------------------------------------------------------------------

describe("getKnowledge (public entry — auto-heal contract)", () => {
  it("getKnowledge_strict_throws_on_build_failure", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "bootstrap"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "# Root\n");
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "foo.md"),
      "# Foo\n",
    );
    const knowledgeMetaBuilder = await import("./knowledge-meta-builder.js");
    // Bake a fresh on-disk meta first so readAgentsMeta succeeds — the
    // failure we inject must be scoped to the rebuild step only.
    await knowledgeMetaBuilder.writeKnowledgeMeta(projectRoot, { source: "doctor_fix" });

    vi.spyOn(knowledgeMetaBuilder, "buildKnowledgeMeta").mockRejectedValueOnce(
      new Error("synthetic build failure"),
    );

    await expect(
      getKnowledge(projectRoot, { path: "src/index.ts" }),
    ).rejects.toThrow("synthetic build failure");
  });

  it("getKnowledge_invalidates_context_cache_after_auto_heal", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "bootstrap"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "knowledge", "decisions"), { recursive: true });
    await writeFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "# Root\n");
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "foo.md"),
      "# Foo\n",
    );
    const knowledgeMetaBuilder = await import("./knowledge-meta-builder.js");
    const baseline = await knowledgeMetaBuilder.writeKnowledgeMeta(projectRoot, {
      source: "doctor_fix",
    });
    const baselineRevision = baseline.meta.revision;

    // Drift the on-disk knowledge tree without persisting the new meta —
    // loadActiveMeta in getKnowledge() detects drift and re-writes.
    await writeFile(
      join(projectRoot, ".fabric", "knowledge", "decisions", "bar.md"),
      "# Bar\n",
    );

    const result = await getKnowledge(projectRoot, { path: "src/index.ts" });

    // Post-heal revision must differ from the baseline — proves the auto-heal
    // path ran AND the cached context was rebuilt against the new meta (a
    // stale context would have surfaced baselineRevision verbatim).
    expect(result.revision_hash).not.toBe(baselineRevision);
    expect(result.revision_hash).toEqual(expect.any(String));
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-get-knowledge-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

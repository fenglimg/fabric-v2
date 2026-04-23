import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { loadGetRulesContext, resolveRulesForPath } from "./get-rules.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (path) => {
      await rm(path, { recursive: true, force: true });
    }),
  );
});

describe("resolveRulesForPath", () => {
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

    const context = await loadGetRulesContext(projectRoot);
    const result = await resolveRulesForPath(projectRoot, context, "docs/guide.md");

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

    const context = await loadGetRulesContext(projectRoot);
    const matching = await resolveRulesForPath(projectRoot, context, "src/index.ts");
    const nonMatching = await resolveRulesForPath(projectRoot, context, "docs/index.md");

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

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-get-rules-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

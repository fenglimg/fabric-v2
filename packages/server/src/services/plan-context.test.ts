import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { planContext } from "./plan-context.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("planContext", () => {
  it("aggregates unique paths and deduplicates repeated rule files per entry", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "bootstrap"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "agents", "packages", "server", "src"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "agents", "_cross"), { recursive: true });

    await writeFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "# Root rules\n");
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(
      join(projectRoot, ".fabric", "agents", "packages", "server", "AGENTS.md"),
      "# Package rules\n",
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents", "packages", "server", "src", "AGENTS.md"),
      "# Source rules\n",
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents", "_cross", "typescript.md"),
      "# TypeScript cross-cutting rules\n",
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-plan",
        nodes: {
          "L1/packages/server": {
            file: ".fabric/agents/packages/server/AGENTS.md",
            scope_glob: "packages/server/**",
            deps: [],
            priority: "medium",
            hash: "sha256:l1",
          },
          "L2/packages/server/src": {
            file: ".fabric/agents/packages/server/src/AGENTS.md",
            scope_glob: "packages/server/src/**",
            deps: [],
            priority: "medium",
            hash: "sha256:l2",
          },
          "L2/_cross/typescript-global": {
            file: ".fabric/agents/_cross/typescript.md",
            scope_glob: "**/*.ts",
            deps: [],
            priority: "high",
            hash: "sha256:cross",
          },
          "L2/_cross/typescript-shadow": {
            file: ".fabric/agents/_cross/typescript.md",
            scope_glob: "packages/server/src/views/**/*.ts",
            deps: [],
            priority: "medium",
            hash: "sha256:cross",
          },
        },
      }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, {
      paths: [
        "packages\\server\\src\\views\\dashboard.ts",
        "packages/server/src/views/dashboard.ts",
        "packages/server/src/lib/util.ts",
      ],
    });

    expect(result).toMatchObject({
      revision_hash: "rev-plan",
      stale: false,
    });
    expect(result.entries.map((entry) => entry.path)).toEqual([
      "packages/server/src/views/dashboard.ts",
      "packages/server/src/lib/util.ts",
    ]);
    expect(result.entries[0]?.rules.L0).toBe("# Root rules\n");
    expect(result.entries[0]?.rules.L1).toEqual([
      {
        path: ".fabric/agents/packages/server/AGENTS.md",
        content: "# Package rules\n",
      },
    ]);
    expect(result.entries[0]?.rules.L2).toEqual([
      {
        path: ".fabric/agents/_cross/typescript.md",
        content: "# TypeScript cross-cutting rules\n",
      },
      {
        path: ".fabric/agents/packages/server/src/AGENTS.md",
        content: "# Source rules\n",
      },
    ]);
    expect(result.entries[1]?.rules.L2).toEqual([
      {
        path: ".fabric/agents/_cross/typescript.md",
        content: "# TypeScript cross-cutting rules\n",
      },
      {
        path: ".fabric/agents/packages/server/src/AGENTS.md",
        content: "# Source rules\n",
      },
    ]);
  });

  it("marks the response stale when the client hash does not match the current revision", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "bootstrap"), { recursive: true });

    await writeFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "# Root rules\n");
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-current",
        nodes: {},
      }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, {
      paths: ["src/index.ts"],
      client_hash: "rev-old",
    });

    expect(result).toMatchObject({
      revision_hash: "rev-current",
      stale: true,
      entries: [
        {
          path: "src/index.ts",
          rules: {
            L0: "# Root rules\n",
            L1: [],
            L2: [],
            human_locked_nearby: [],
          },
        },
      ],
    });
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-plan-context-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}

import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { updateRegistry } from "./update-registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (path) => {
    await rm(path, { recursive: true, force: true });
  }));
});

describe("updateRegistry", () => {
  it("preserves enum priorities for add-node and update-node flows", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "fabric-update-registry-"));
    tempDirs.push(projectRoot);
    await mkdir(join(projectRoot, ".fabric"), { recursive: true });
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "sha256:root",
        nodes: {
          "L1/existing": {
            file: ".fabric/agents/existing.md",
            scope_glob: "src/existing/**",
            deps: [],
            priority: "medium",
            layer: "L1",
            topology_type: "mirror",
            hash: "sha256:existing",
          },
        },
      }, null, 2)}\n`,
    );

    await updateRegistry(projectRoot, {
      op: "add-node",
      node_id: "L1/new",
      data: {
        file: ".fabric/agents/new.md",
        scope_glob: "src/new/**",
        deps: [],
        priority: "high",
        hash: "sha256:new",
      },
    });

    await updateRegistry(projectRoot, {
      op: "update-node",
      node_id: "L1/new",
      data: {
        priority: "low",
      },
    });

    const meta = JSON.parse(
      await readFile(join(projectRoot, ".fabric", "agents.meta.json"), "utf8"),
    ) as {
      nodes: Record<string, { priority: string; hash: string }>;
    };

    expect(meta.nodes["L1/new"]).toMatchObject({
      priority: "low",
      hash: "sha256:new",
    });
  });
});

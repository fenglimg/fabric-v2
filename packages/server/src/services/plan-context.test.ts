import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { planContext } from "./plan-context.js";
import { sha256 } from "./_shared.js";

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
            stable_id: "rules/package-server",
            identity_source: "declared",
          },
          "L2/packages/server/src": {
            file: ".fabric/agents/packages/server/src/AGENTS.md",
            scope_glob: "packages/server/src/**",
            deps: [],
            priority: "medium",
            hash: "sha256:l2",
            stable_id: "rules/server-src",
            identity_source: "declared",
          },
          "L2/_cross/typescript-global": {
            file: ".fabric/agents/_cross/typescript.md",
            scope_glob: "**/*.ts",
            deps: [],
            priority: "high",
            hash: "sha256:cross",
            stable_id: "rules/ts-global",
            identity_source: "declared",
          },
          "L2/_cross/typescript-shadow": {
            file: ".fabric/agents/_cross/typescript.md",
            scope_glob: "packages/server/src/views/**/*.ts",
            deps: [],
            priority: "medium",
            hash: "sha256:cross",
            stable_id: "rules/ts-shadow",
            identity_source: "derived",
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
    expect(result.shared.resolved_bundle_id).toBe(
      sha256([
        "rev-plan",
        "rules/package-server",
        "rules/server-src",
        "rules/ts-global",
        "rules/ts-shadow",
      ].join("\n")),
    );
    expect(result.shared.shared_entries).toEqual([
      {
        stable_id: "rules/package-server",
        identity_source: "declared",
        level: "L1",
        path: ".fabric/agents/packages/server/AGENTS.md",
        content: "# Package rules\n",
      },
      {
        stable_id: "rules/server-src",
        identity_source: "declared",
        level: "L2",
        path: ".fabric/agents/packages/server/src/AGENTS.md",
        content: "# Source rules\n",
      },
      {
        stable_id: "rules/ts-global",
        identity_source: "declared",
        level: "L2",
        path: ".fabric/agents/_cross/typescript.md",
        content: "# TypeScript cross-cutting rules\n",
      },
      {
        stable_id: "rules/ts-shadow",
        identity_source: "derived",
        level: "L2",
        path: ".fabric/agents/_cross/typescript.md",
        content: "# TypeScript cross-cutting rules\n",
      },
    ]);
    expect(result.shared.file_map).toEqual({
      "packages/server/src/views/dashboard.ts": {
        L1: ["rules/package-server"],
        L2: ["rules/ts-global", "rules/server-src"],
        description_stubs: [],
      },
      "packages/server/src/lib/util.ts": {
        L1: ["rules/package-server"],
        L2: ["rules/ts-global", "rules/server-src"],
        description_stubs: [],
      },
    });
    expect(result.shared.preflight_diagnostics).toEqual([
      {
        code: "derived_identity",
        severity: "warn",
        stable_ids: ["rules/ts-shadow"],
        message:
          "Resolved bundle includes 1 rule node that still rely on derived identities. " +
          "Declare `<!-- fab:rule-id ... -->` in the source rule file to stabilize audit references.",
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
      shared: {
        resolved_bundle_id: sha256("rev-current"),
        shared_entries: [],
        file_map: {
          "src/index.ts": {
            L1: [],
            L2: [],
            description_stubs: [],
          },
        },
        description_stub_union: [],
        preflight_diagnostics: [],
      },
    });
  });

  it("keeps description stubs in each entry and the shared union with a stub-only diagnostic", async () => {
    const projectRoot = await createTempProject();
    await mkdir(join(projectRoot, ".fabric", "bootstrap"), { recursive: true });
    await mkdir(join(projectRoot, ".fabric", "agents", "descriptions"), { recursive: true });

    await writeFile(join(projectRoot, ".fabric", "bootstrap", "README.md"), "# Root rules\n");
    await writeFile(join(projectRoot, ".fabric", "human-lock.json"), `${JSON.stringify({ locked: [] }, null, 2)}\n`);
    await writeFile(
      join(projectRoot, ".fabric", "agents", "descriptions", "typescript.md"),
      "# TypeScript description\n",
    );
    await writeFile(
      join(projectRoot, ".fabric", "agents.meta.json"),
      `${JSON.stringify({
        revision: "rev-description",
        nodes: {
          "L2/description": {
            file: ".fabric/agents/descriptions/typescript.md",
            scope_glob: "**/*.ts",
            deps: [],
            priority: "medium",
            hash: "sha256:description",
            stable_id: "rules/ts-description",
            identity_source: "declared",
            activation: {
              tier: "description",
              description: "Load the TypeScript guidance only when the edit is confirmed.",
            },
          },
        },
      }, null, 2)}\n`,
    );

    const result = await planContext(projectRoot, {
      paths: ["src/index.ts"],
    });

    expect(result.entries[0]?.rules.description_stubs).toEqual([
      {
        path: ".fabric/agents/descriptions/typescript.md",
        description: "Load the TypeScript guidance only when the edit is confirmed.",
      },
    ]);
    expect(result.shared.description_stub_union).toEqual([
      {
        stable_id: "rules/ts-description",
        identity_source: "declared",
        level: "L2",
        path: ".fabric/agents/descriptions/typescript.md",
        description: "Load the TypeScript guidance only when the edit is confirmed.",
      },
    ]);
    expect(result.shared.preflight_diagnostics).toEqual([
      {
        code: "description_stub_only",
        severity: "info",
        path: "src/index.ts",
        stable_ids: ["rules/ts-description"],
        message:
          "Path src/index.ts only matched description stubs and no loadable L1/L2 rules. " +
          "Run fab_get_rules on the final target before editing if you need the full rule text.",
      },
    ]);
  });
});

async function createTempProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "fabric-plan-context-"));
  tempDirs.push(projectRoot);
  return projectRoot;
}
